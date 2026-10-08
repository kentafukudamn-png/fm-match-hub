const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/stats.js');

const m = (date, gf, ga, extra) => Object.assign({ date, goalsFor: gf, goalsAgainst: ga }, extra);

test('result と points', () => {
  assert.equal(S.result(m('2026-01-01', 2, 1)), 'W');
  assert.equal(S.result(m('2026-01-01', 1, 1)), 'D');
  assert.equal(S.points(m('2026-01-01', 0, 3)), 0);
});

test('summary は勝敗・得失点・xG を集計する', () => {
  const s = S.summary([
    m('2026-01-01', 2, 0, { stats: { xg: 1.5, xgAgainst: 0.4 } }),
    m('2026-01-08', 1, 1),
    m('2026-01-15', 0, 2, { stats: { xg: 0.5, xgAgainst: 1.6 } }),
  ]);
  assert.deepEqual([s.played, s.w, s.d, s.l, s.gf, s.ga, s.gd, s.pts, s.cleanSheets], [3, 1, 1, 1, 3, 3, 0, 4, 1]);
  assert.equal(s.xgCount, 2);
  assert.ok(Math.abs(s.xg - 2.0) < 1e-9);
  assert.ok(Math.abs(s.ppg - 4 / 3) < 1e-9);
});

test('form は日付順で直近 n 試合を古い順に返す', () => {
  const list = [m('2026-01-15', 0, 1), m('2026-01-01', 3, 0), m('2026-01-08', 1, 1)];
  assert.deepEqual(S.form(list, 2), ['D', 'L']);
});

test('groupBy と bestFormation', () => {
  const list = [
    m('1', 2, 0, { formation: '4-3-3' }), m('2', 1, 0, { formation: '4-3-3' }),
    m('3', 0, 1, { formation: '4-4-2' }), m('4', 3, 0, { formation: '4-4-2' }),
    m('5', 5, 0, { formation: '3-5-2' }),
  ];
  const rows = S.groupBy(list, (x) => x.formation);
  assert.equal(rows.length, 3);
  assert.equal(S.bestFormation(list, 1).key, '3-5-2');
  assert.equal(S.bestFormation(list, 2).key, '4-3-3');
  assert.equal(S.bestFormation([], 1), null);
});

test('headToHead は大文字小文字・空白を無視して一致させる', () => {
  const list = [m('2026-01-01', 1, 0, { opponent: 'Rivertown FC' }), m('2026-02-01', 0, 0, { opponent: ' rivertown fc' }), m('2026-03-01', 2, 2, { opponent: 'Other' })];
  const h = S.headToHead(list, 'RIVERTOWN FC');
  assert.equal(h.matches.length, 2);
  assert.equal(h.matches[0].date, '2026-02-01');
  assert.equal(h.summary.w, 1);
  assert.equal(S.headToHead(list, '').matches.length, 0);
});

test('playerStats は出場・得点・アシスト・平均評価・MOM を集計する', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const list = [
    m('1', 2, 0, { goals: [{ playerId: 'a', assistId: 'b' }, { playerId: 'a' }], ratings: [{ playerId: 'a', rating: 8, motm: true }, { playerId: 'b', rating: 7 }] }),
    m('2', 0, 0, { goals: [], ratings: [{ playerId: 'a', rating: 6 }, { playerId: 'b', rating: '' }] }),
  ];
  const [a, b] = S.playerStats(list, players);
  assert.deepEqual([a.apps, a.goals, a.assists, a.avgRating, a.motm], [2, 2, 0, 7, 1]);
  assert.deepEqual([b.apps, b.goals, b.assists, b.avgRating], [2, 0, 1, 7]);
});

test('cumulativePoints は日付順で累計する', () => {
  const pts = S.cumulativePoints([m('2026-01-08', 1, 1), m('2026-01-01', 2, 0)]);
  assert.deepEqual(pts.map((p) => p.total), [3, 4]);
});
