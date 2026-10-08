const test = require('node:test');
const assert = require('node:assert/strict');

function loadStore(initial) {
  const mem = {};
  if (initial) mem['fm-platform-data-v1'] = JSON.stringify(initial);
  const root = { localStorage: { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } } };
  const src = require('fs').readFileSync(require('path').join(__dirname, '../js/store.js'), 'utf8');
  new Function(src).call(root);
  return root.FMStore;
}

test('外部データの ID とスコアを無害化する', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const DB = loadStore({
    players: [{ id: evil, name: 'A' }],
    matches: [{ id: 'm1' + evil, goalsFor: '<b>3</b>', goalsAgainst: -2, goals: [{ playerId: evil }], ratings: 'x' }],
    preps: [{ id: 'p1', lineup: [evil] }, null],
    settings: { clubName: { toString: null } },
  });
  const d = DB.data;
  assert.match(d.players[0].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(d.matches[0].id, 'm1imgsrcxonerroralert1');
  assert.equal(d.matches[0].goalsFor, 0);
  assert.equal(d.matches[0].goalsAgainst, 0);
  assert.equal(d.matches[0].goals[0].playerId, d.players[0].id);
  assert.deepEqual(d.matches[0].ratings, []);
  assert.equal(d.preps.length, 1);
  assert.equal(d.preps[0].lineup[0], d.players[0].id);
});
