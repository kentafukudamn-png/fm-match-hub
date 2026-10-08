const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../js/fmimport.js');

// FM の「印刷 → Web ページ」出力に近い形
const SQUAD_HTML = `<html><head><title>Squad</title></head><body>
<table border="1" cellspacing="0">
<tr bgcolor="#EEEEEE"><th>Inf</th><th>No.</th><th>Name</th><th>Position</th><th>Apps</th><th>Gls</th><th>Ast</th><th>Av Rat</th><th>Mins</th><th>PoM</th></tr>
<tr><td></td><td>10</td><td>Taro Yamada</td><td>AM (RL), ST (C)</td><td>30 (2)</td><td>14</td><td>9</td><td>7.21</td><td>2,612</td><td>4</td></tr>
<tr><td>Inj</td><td>4</td><td>Kenji &amp; Co</td><td>D (RC)</td><td>12</td><td>1</td><td>-</td><td>6.90</td><td>1080</td><td>0</td></tr>
<tr><td></td><td>1</td><td>Ken Suzuki</td><td>GK</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr>
</table></body></html>`;

const FIXTURES_HTML = `<table>
<tr><th>Date</th><th>Time</th><th>Opposition</th><th>Venue</th><th>Competition</th><th>Result</th></tr>
<tr><td>Sat 8 Aug 2026</td><td>15:00</td><td>Rivertown FC</td><td>H</td><td>Premier League</td><td>W 2-1</td></tr>
<tr><td>Sat 15 Aug 2026</td><td>15:00</td><td>Northbridge</td><td>A</td><td>Premier League</td><td>L 3-0</td></tr>
<tr><td>Tue 18 Aug 2026</td><td>19:45</td><td>Eastport United</td><td>Away</td><td>League Cup</td><td>1-1</td></tr>
<tr><td>Sat 22 Aug 2026</td><td>15:00</td><td>Westfield City</td><td>H</td><td>Premier League</td><td></td></tr>
</table>`;

const SQUAD_TXT = `Squad
| Name           | Position | Apps    | Gls | Ast | Av Rat |
| -------------- | -------- | ------- | --- | --- | ------ |
| Taro Yamada    | ST (C)   | 5 (1)   | 3   | 1   | 7.05   |
| Sho Tanaka     | DM       | 6       | 0   | 2   | 6.88   |
`;

test('HTML のスカッド画面を解析する', () => {
  const { players, matches } = I.parse(SQUAD_HTML);
  assert.equal(matches.length, 0);
  assert.equal(players.length, 3);
  assert.deepEqual(players[0], { name: 'Taro Yamada', number: '10', position: 'AMR',
    fm: { apps: 32, starts: 30, subs: 2, goals: 14, assists: 9, avgRating: 7.21, minutes: 2612, pom: 4 } });
  assert.equal(players[1].name, 'Kenji & Co');
  assert.equal(players[1].position, 'DC');
  assert.equal(players[1].fm.assists, undefined);
  assert.deepEqual(players[2].fm, {});
});

test('テキスト出力（| 区切り）を解析する', () => {
  const { players } = I.parse(SQUAD_TXT);
  assert.equal(players.length, 2);
  assert.equal(players[0].position, 'ST');
  assert.equal(players[0].fm.apps, 6);
  assert.equal(players[1].fm.avgRating, 6.88);
});

test('日程・結果を解析し、スコアを自チーム視点に揃える', () => {
  const { matches } = I.parse(FIXTURES_HTML);
  assert.equal(matches.length, 3); // 未消化の試合は除外
  assert.deepEqual(matches[0], { date: '2026-08-08', competition: 'Premier League', opponent: 'Rivertown FC', venue: 'H', goalsFor: 2, goalsAgainst: 1 });
  assert.deepEqual([matches[1].goalsFor, matches[1].goalsAgainst, matches[1].venue], [0, 3, 'A']);
  assert.deepEqual([matches[2].goalsFor, matches[2].goalsAgainst, matches[2].venue], [1, 1, 'A']);
});

test('ポジション・日付・スコアの変換', () => {
  assert.equal(I.position('D (L)'), 'DL');
  assert.equal(I.position('WB (R)'), 'WBR');
  assert.equal(I.position('M (RLC)'), 'MC');
  assert.equal(I.position('DM, M (C)'), 'DM');
  assert.equal(I.date('08/09/2026'), '2026-09-08');
  assert.equal(I.date('2026年8月8日'), '2026-08-08');
  assert.equal(I.date('Aug 8, 2026'), '2026-08-08');
  assert.deepEqual(I.score('1-2 W'), { goalsFor: 2, goalsAgainst: 1 });
  assert.deepEqual(I.score('2 - 2 (aet)'), { goalsFor: 2, goalsAgainst: 2 });
  assert.equal(I.score('vs'), null);
});

test('既存データへのマージ', () => {
  let n = 0;
  const uid = () => 'id' + ++n;
  const players = [{ id: 'p1', name: 'taro yamada', number: '9', position: 'ST' }];
  const r1 = I.mergePlayers(players, I.parse(SQUAD_HTML).players, uid, '2026-10-08');
  assert.deepEqual(r1, { added: 2, updated: 1 });
  assert.equal(players[0].number, '10');
  assert.equal(players[0].fm.goals, 14);
  assert.equal(players[2].fm, undefined);

  const matches = [{ id: 'm1', date: '2026-08-08', opponent: 'Rivertown FC', goalsFor: 0, goalsAgainst: 0, stats: { xg: 1.2 }, notes: 'メモ' }];
  const r2 = I.mergeMatches(matches, I.parse(FIXTURES_HTML).matches, uid, '2026/27');
  assert.deepEqual(r2, { added: 2, updated: 1 });
  assert.equal(matches[0].goalsFor, 2);
  assert.equal(matches[0].notes, 'メモ');
  assert.equal(matches[1].season, '2026/27');
  // 2回目は重複しない
  assert.deepEqual(I.mergeMatches(matches, I.parse(FIXTURES_HTML).matches, uid, '2026/27'), { added: 0, updated: 3 });
});
