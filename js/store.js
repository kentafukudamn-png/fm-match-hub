/* データ永続化（localStorage） */
(function (root) {
  'use strict';
  const KEY = 'fm-platform-data-v1';

  function emptyData() {
    return {
      version: 1,
      settings: { clubName: '', season: '' },
      players: [],
      matches: [],
      preps: [],
    };
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* インポート・同期で外部から入るデータを安全な形にそろえる（ID は英数字のみ、スコアは整数） */
  const cleanId = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/[^A-Za-z0-9_-]/g, '');
  const cleanInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : 0; };
  const objects = (list) => (Array.isArray(list) ? list.filter((x) => x && typeof x === 'object') : []);

  function normalize(d) {
    const base = emptyData();
    if (!d || typeof d !== 'object') return base;
    const players = objects(d.players).map((p) => Object.assign({}, p, { id: cleanId(p.id) || uid(), name: typeof p.name === 'string' ? p.name : String(p.name || '') }));
    const matches = objects(d.matches).map((m) => Object.assign({}, m, {
      id: cleanId(m.id) || uid(),
      prepId: cleanId(m.prepId),
      goalsFor: cleanInt(m.goalsFor),
      goalsAgainst: cleanInt(m.goalsAgainst),
      stats: m.stats && typeof m.stats === 'object' ? m.stats : {},
      goals: objects(m.goals).map((g) => Object.assign({}, g, { playerId: cleanId(g.playerId), assistId: cleanId(g.assistId) })),
      ratings: objects(m.ratings).map((r) => Object.assign({}, r, { playerId: cleanId(r.playerId) })),
    }));
    const preps = objects(d.preps).map((p) => Object.assign({}, p, {
      id: cleanId(p.id) || uid(),
      matchId: cleanId(p.matchId),
      lineup: Array.isArray(p.lineup) ? p.lineup.map(cleanId) : [],
      checklist: objects(p.checklist),
    }));
    const settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
    return {
      version: 1,
      settings: { clubName: typeof settings.clubName === 'string' ? settings.clubName : '', season: typeof settings.season === 'string' ? settings.season : '' },
      players, matches, preps,
    };
  }

  let data = emptyData();
  try {
    const raw = root.localStorage && root.localStorage.getItem(KEY);
    if (raw) data = normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('データの読み込みに失敗しました', e);
  }

  const listeners = [];

  function persist() {
    try {
      root.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    }
  }

  function save() {
    persist();
    listeners.forEach((fn) => fn());
  }

  function upsert(collection, item) {
    const list = data[collection];
    if (!item.id) item.id = uid();
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
    save();
    return item;
  }

  function remove(collection, id) {
    data[collection] = data[collection].filter((x) => x.id !== id);
    save();
  }

  function get(collection, id) {
    return data[collection].find((x) => x.id === id) || null;
  }

  root.FMStore = {
    get data() { return data; },
    uid, save, upsert, remove, get,
    /** silent: 同期で取得したデータを反映するときは変更通知を出さない */
    replaceAll(d, silent) { data = normalize(d); if (silent) persist(); else save(); },
    onChange(fn) { listeners.push(fn); },
    reset() { data = emptyData(); save(); },
    exportJSON() { return JSON.stringify(data, null, 2); },
  };
})(this);
