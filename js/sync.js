/* GitHub の非公開リポジトリへのデータ同期（サーバー不要・GitHub Contents API を直接利用） */
(function (root) {
  'use strict';
  const CONFIG_KEY = 'fm-sync-config-v1';
  const META_KEY = 'fm-sync-meta-v1';
  const TOKEN_KEY = 'fm-sync-token-v1';
  const LAST_KEY = 'fm-sync-last-v1';

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function SyncError(message, code) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  /** GitHub Contents API の薄いラッパー */
  function createGitHubClient(cfg, fetchFn) {
    const base = 'https://api.github.com';
    const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
    const contentsUrl = `${base}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${enc(cfg.path)}`;

    async function request(url, opts, accept) {
      let res;
      try {
        res = await fetchFn(url, Object.assign({}, opts, {
          headers: Object.assign({
            Authorization: `Bearer ${cfg.token}`,
            Accept: accept || 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          }, opts && opts.body ? { 'Content-Type': 'application/json' } : {}),
          cache: 'no-store',
        }));
      } catch (e) {
        throw SyncError('ネットワークに接続できません', 'offline');
      }
      return res;
    }

    async function fail(res) {
      let msg = '';
      try { msg = (await res.json()).message || ''; } catch (e) { /* noop */ }
      if (res.status === 401) return SyncError('トークンが無効です', 'auth');
      if (res.status === 403) return SyncError('権限がありません（トークンの Contents: Read and write を確認）: ' + msg, 'auth');
      if (res.status === 404) return SyncError('リポジトリが見つかりません（名前とトークンの対象リポジトリを確認）', 'notfound');
      if (res.status === 409 || res.status === 422) return SyncError('他の端末と更新が衝突しました', 'conflict');
      return SyncError(`GitHub API エラー (${res.status}) ${msg}`, 'http');
    }

    return {
      /** リポジトリ情報（非公開かどうかの確認用） */
      async repoInfo() {
        const res = await request(`${base}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`);
        if (!res.ok) throw await fail(res);
        const j = await res.json();
        return { private: !!j.private, fullName: j.full_name, defaultBranch: j.default_branch, canPush: !j.permissions || !!j.permissions.push };
      },
      /** ファイルを取得。存在しなければ { exists: false } */
      async pull() {
        const url = `${contentsUrl}?ref=${encodeURIComponent(cfg.branch)}`;
        const res = await request(url);
        if (res.status === 404) return { exists: false };
        if (!res.ok) throw await fail(res);
        const j = await res.json();
        let text;
        if (j.encoding === 'base64' && j.content) {
          text = b64decode(j.content);
        } else {
          // 1MB を超えるファイルは content が空になるため raw で取り直す
          const raw = await request(url, null, 'application/vnd.github.raw+json');
          if (!raw.ok) throw await fail(raw);
          text = await raw.text();
        }
        return { exists: true, sha: j.sha, text };
      },
      /** ファイルを書き込み、新しい sha を返す */
      async push(text, sha, message) {
        const body = { message, content: b64encode(text), branch: cfg.branch };
        if (sha) body.sha = sha;
        const res = await request(contentsUrl, { method: 'PUT', body: JSON.stringify(body) });
        if (!res.ok) throw await fail(res);
        return (await res.json()).content.sha;
      },
    };
  }

  /**
   * 同期マネージャ
   * opts: { storage, session, fetch, getText, apply(text), onStatus(status, detail), resolveConflict() => 'remote'|'local', debounceMs }
   * トークンは設定とは別に保存する。remember=false ならタブ/ブラウザを閉じると消える session 側に置く。
   */
  function createSyncManager(opts) {
    const storage = opts.storage;
    const session = opts.session || { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    const read = (k, def) => { try { return JSON.parse(storage.getItem(k)) || def; } catch (e) { return def; } };
    let config = read(CONFIG_KEY, null);
    if (config && config.token) { // 旧形式（設定内にトークン）からの移行
      storage.setItem(TOKEN_KEY, config.token);
      delete config.token;
      config.remember = true;
      storage.setItem(CONFIG_KEY, JSON.stringify(config));
    }
    let token = storage.getItem(TOKEN_KEY) || session.getItem(TOKEN_KEY) || '';
    let meta = read(META_KEY, { sha: null, dirty: false, lastSyncedAt: null });
    let timer = null;
    let running = null;
    let again = false;
    let status = config && !token ? 'locked' : 'off';

    function storeToken(t, remember) {
      token = t;
      storage.removeItem(TOKEN_KEY);
      session.removeItem(TOKEN_KEY);
      if (t) (remember ? storage : session).setItem(TOKEN_KEY, t);
    }

    const saveMeta = () => storage.setItem(META_KEY, JSON.stringify(meta));
    const setStatus = (s, detail) => { status = s; if (opts.onStatus) opts.onStatus(s, detail); };
    const client = () => createGitHubClient(Object.assign({}, config, { token }), opts.fetch);
    const message = () => `Update FM data (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`;

    async function doSync() {
      const gh = client();
      const remote = await gh.pull();
      if (!remote.exists) {
        meta.sha = await gh.push(opts.getText(), null, 'Create FM data');
      } else if (remote.sha === meta.sha) {
        if (meta.dirty) meta.sha = await gh.push(opts.getText(), remote.sha, message());
      } else if (!meta.dirty || remote.text === opts.getText()) {
        opts.apply(remote.text);
        meta.sha = remote.sha;
      } else {
        const choice = await opts.resolveConflict();
        if (choice === 'remote') {
          opts.apply(remote.text);
          meta.sha = remote.sha;
        } else {
          meta.sha = await gh.push(opts.getText(), remote.sha, message());
        }
      }
      meta.dirty = false;
      meta.lastSyncedAt = new Date().toISOString();
      saveMeta();
    }

    /** 同期を実行（実行中なら完了後にもう一度実行） */
    function syncNow() {
      if (!config || !token) return Promise.resolve(false);
      if (running) { again = true; return running; }
      clearTimeout(timer);
      setStatus('syncing');
      running = (async () => {
        let attempt = 0;
        for (;;) {
          try {
            await doSync();
            setStatus('ok', meta.lastSyncedAt);
            return true;
          } catch (e) {
            if (e.code === 'conflict' && attempt++ < 2) continue; // 直前に他端末が書き込んだ場合は取り直す
            setStatus(e.code === 'offline' ? 'offline' : e.code === 'auth' ? 'auth' : 'error', e.message);
            return false;
          }
        }
      })().finally(() => {
        running = null;
        if (again) { again = false; syncNow(); }
      });
      return running;
    }

    return {
      get config() { return config; },
      get meta() { return meta; },
      get status() { return status; },
      get pending() { return !!config && !!token && (meta.dirty || !!running); },
      get locked() { return !!config && !token; },
      /** 前回の接続先（トークン以外）。再接続時の入力補助用 */
      get lastConfig() { return read(LAST_KEY, {}); },
      testConnection(cfg) { return createGitHubClient(cfg, opts.fetch).repoInfo(); },
      /** 接続中の設定 + 指定トークンで接続確認 */
      testToken(t) { return createGitHubClient(Object.assign({}, config, { token: t }), opts.fetch).repoInfo(); },
      /** state: 接続時点のクラウド側 sha と、ローカルをアップロードすべきか（dirty） */
      configure(cfg, state) {
        config = Object.assign({}, cfg);
        delete config.token;
        config.remember = cfg.remember !== false;
        storeToken(cfg.token, config.remember);
        meta = { sha: (state && state.sha) || null, dirty: !state || state.dirty !== false, lastSyncedAt: null };
        storage.setItem(CONFIG_KEY, JSON.stringify(config));
        storage.setItem(LAST_KEY, JSON.stringify({ owner: config.owner, repo: config.repo, branch: config.branch, path: config.path }));
        saveMeta();
      },
      /** トークンを記憶しない設定で、ブラウザを開き直したときに再入力する */
      unlock(t) {
        if (!config) return Promise.resolve(false);
        storeToken(t, config.remember);
        return syncNow();
      },
      /** 接続先を変えずにトークンだけ差し替える（期限切れ時など） */
      replaceToken(t) { return this.unlock(t); },
      setAuto(on) {
        if (!config) return;
        config.auto = !!on;
        storage.setItem(CONFIG_KEY, JSON.stringify(config));
        if (on && meta.dirty) syncNow();
      },
      disconnect() {
        clearTimeout(timer);
        config = null;
        storeToken('', false);
        storage.removeItem(CONFIG_KEY);
        storage.removeItem(META_KEY);
        meta = { sha: null, dirty: false, lastSyncedAt: null };
        setStatus('off');
      },
      /** ローカルでデータが変更されたときに呼ぶ */
      markDirty() {
        if (!config) return;
        if (!token) { meta.dirty = true; saveMeta(); return; }
        meta.dirty = true;
        saveMeta();
        if (config.auto === false) { setStatus('dirty'); return; }
        clearTimeout(timer);
        setStatus('dirty');
        timer = setTimeout(syncNow, opts.debounceMs === undefined ? 2000 : opts.debounceMs);
      },
      syncNow,
    };
  }

  const api = { createGitHubClient, createSyncManager, b64encode, b64decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMSync = api;
})(this);
