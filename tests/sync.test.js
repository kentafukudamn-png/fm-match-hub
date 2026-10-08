const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSyncManager, createGitHubClient, b64encode, b64decode } = require('../js/sync.js');

/* GitHub Contents API の簡易フェイク */
function fakeGitHub(opts) {
  opts = opts || {};
  const files = {};
  const calls = [];
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  async function fetch(url, init) {
    init = init || {};
    calls.push({ url, method: init.method || 'GET' });
    if (opts.offline) throw new TypeError('Failed to fetch');
    if (init.headers.Authorization !== 'Bearer good') return json(401, { message: 'Bad credentials' });
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/(.+))?$/);
    if (!m) return json(404, {});
    if (!m[3]) return json(200, { private: opts.private !== false, full_name: `${m[1]}/${m[2]}`, default_branch: 'main', permissions: { push: true } });
    const path = decodeURIComponent(m[3]);
    if ((init.method || 'GET') === 'GET') {
      const f = files[path];
      if (!f) return json(404, { message: 'Not Found' });
      return json(200, { sha: f.sha, encoding: 'base64', content: b64encode(f.text).replace(/(.{60})/g, '$1\n') });
    }
    const body = JSON.parse(init.body);
    const cur = files[path];
    if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return json(409, { message: 'sha mismatch' });
    const text = b64decode(body.content);
    const sha = crypto.createHash('sha1').update(text).digest('hex');
    files[path] = { text, sha };
    return json(cur ? 200 : 201, { content: { sha } });
  }
  return { fetch, files, calls };
}

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } };
}

const CFG = { owner: 'me', repo: 'fm-data', branch: 'main', path: 'fm-data.json', token: 'good' };

function device(gh, initial, conflictChoice) {
  const d = { text: initial, applied: 0, statuses: [] };
  d.sync = createSyncManager({
    storage: memStorage(), fetch: gh.fetch, debounceMs: 0,
    getText: () => d.text,
    apply: (t) => { d.text = t; d.applied++; },
    resolveConflict: async () => conflictChoice || 'local',
    onStatus: (s) => d.statuses.push(s),
  });
  return d;
}

test('base64 は日本語を往復できる', () => {
  const s = '{"opponent":"浦和レッズ ⚽"}';
  assert.equal(b64decode(b64encode(s)), s);
});

test('初回接続でファイルを作成し、変更を反映する', async () => {
  const gh = fakeGitHub();
  const a = device(gh, '{"v":1}');
  a.sync.configure(CFG, { dirty: true });
  assert.equal(await a.sync.syncNow(), true);
  assert.equal(gh.files['fm-data.json'].text, '{"v":1}');
  a.text = '{"v":2}';
  a.sync.markDirty();
  await new Promise((r) => setTimeout(r, 10));
  await a.sync.syncNow();
  assert.equal(gh.files['fm-data.json'].text, '{"v":2}');
  assert.equal(a.sync.meta.dirty, false);
  assert.equal(a.sync.status, 'ok');
});

test('別端末の更新はローカル未変更なら取り込む', async () => {
  const gh = fakeGitHub();
  const a = device(gh, '{"from":"A"}');
  a.sync.configure(CFG, { dirty: true });
  await a.sync.syncNow();

  const b = device(gh, '');
  const remote = await createGitHubClient(CFG, gh.fetch).pull();
  b.sync.configure(CFG, { sha: remote.sha, dirty: false });
  b.text = remote.text;
  b.text = '{"from":"B"}';
  b.sync.markDirty();
  await b.sync.syncNow();

  await a.sync.syncNow();
  assert.equal(a.text, '{"from":"B"}');
  assert.equal(a.applied, 1);
});

test('両方で変更された場合は resolveConflict に従う', async () => {
  for (const choice of ['local', 'remote']) {
    const gh = fakeGitHub();
    const a = device(gh, '{"a":0}', choice);
    a.sync.configure(CFG, { dirty: true });
    await a.sync.syncNow();
    const b = device(gh, '');
    const r = await createGitHubClient(CFG, gh.fetch).pull();
    b.sync.configure(CFG, { sha: r.sha, dirty: true });
    b.text = '{"b":1}';
    await b.sync.syncNow();

    a.text = '{"a":1}';
    a.sync.markDirty();
    await a.sync.syncNow();
    const expected = choice === 'local' ? '{"a":1}' : '{"b":1}';
    assert.equal(gh.files['fm-data.json'].text, expected, choice);
    assert.equal(a.text, expected, choice);
  }
});

test('オフラインや認証エラーはステータスに反映し、変更は保持する', async () => {
  const gh = fakeGitHub({ offline: true });
  const a = device(gh, '{}');
  a.sync.configure(CFG, { dirty: true });
  assert.equal(await a.sync.syncNow(), false);
  assert.equal(a.sync.status, 'offline');
  assert.equal(a.sync.meta.dirty, true);

  const gh2 = fakeGitHub();
  const b = device(gh2, '{}');
  b.sync.configure(Object.assign({}, CFG, { token: 'bad' }), { dirty: true });
  assert.equal(await b.sync.syncNow(), false);
  assert.equal(b.sync.status, 'auth');
});

test('testConnection は非公開かどうかを返す', async () => {
  const pub = createSyncManager({ storage: memStorage(), fetch: fakeGitHub({ private: false }).fetch, getText: () => '' });
  assert.equal((await pub.testConnection(CFG)).private, false);
  const priv = createSyncManager({ storage: memStorage(), fetch: fakeGitHub().fetch, getText: () => '' });
  assert.equal((await priv.testConnection(CFG)).private, true);
});

test('自動同期オフでは markDirty でアップロードしない', async () => {
  const gh = fakeGitHub();
  const a = device(gh, '{"v":1}');
  a.sync.configure(Object.assign({}, CFG, { auto: false }), { dirty: true });
  a.sync.markDirty();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(gh.calls.length, 0);
  assert.equal(a.sync.status, 'dirty');
});

test('トークンを記憶しない設定ではセッション側にだけ保存し、再起動後は入力待ちになる', async () => {
  const gh = fakeGitHub();
  const local = memStorage();
  const mk = (session) => createSyncManager({ storage: local, session, fetch: gh.fetch, getText: () => '{"x":1}', apply: () => {} });
  const s1 = mk(memStorage());
  s1.configure(Object.assign({}, CFG, { remember: false }), { dirty: true });
  assert.equal(await s1.syncNow(), true);
  assert.equal(local.getItem('fm-sync-token-v1'), null);
  assert.ok(!JSON.stringify(local).includes('good'));
  assert.ok(!local.getItem('fm-sync-config-v1').includes('good'));

  const s2 = mk(memStorage()); // ブラウザを開き直した状態
  assert.equal(s2.locked, true);
  assert.equal(s2.status, 'locked');
  assert.equal(await s2.syncNow(), false);
  assert.equal(await s2.unlock('good'), true);
  assert.equal(s2.locked, false);
});

test('旧形式（設定内のトークン）は分離して移行する', () => {
  const local = memStorage();
  local.setItem('fm-sync-config-v1', JSON.stringify(CFG));
  const s = createSyncManager({ storage: local, fetch: fakeGitHub().fetch, getText: () => '' });
  assert.equal(s.locked, false);
  assert.equal(local.getItem('fm-sync-token-v1'), 'good');
  assert.ok(!local.getItem('fm-sync-config-v1').includes('good'));
});

test('接続解除でトークンを消し、接続先（トークン以外）は再接続用に残す', () => {
  const local = memStorage();
  const s = createSyncManager({ storage: local, fetch: fakeGitHub().fetch, getText: () => '' });
  s.configure(CFG, { dirty: false });
  s.disconnect();
  assert.equal(local.getItem('fm-sync-token-v1'), null);
  assert.equal(s.lastConfig.repo, 'fm-data');
  assert.equal(s.lastConfig.token, undefined);
});
