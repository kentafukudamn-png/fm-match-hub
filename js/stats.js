/* 集計・分析ロジック（DOM 非依存の純粋関数） */
(function (root) {
  'use strict';

  function result(m) {
    if (m.goalsFor > m.goalsAgainst) return 'W';
    if (m.goalsFor < m.goalsAgainst) return 'L';
    return 'D';
  }

  function points(m) {
    const r = result(m);
    return r === 'W' ? 3 : r === 'D' ? 1 : 0;
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function sortByDate(matches, desc) {
    return matches.slice().sort((a, b) => {
      const c = String(a.date || '').localeCompare(String(b.date || ''));
      return desc ? -c : c;
    });
  }

  function summary(matches) {
    const s = { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, ppg: 0, winPct: 0, cleanSheets: 0, xg: 0, xga: 0, xgCount: 0 };
    matches.forEach((m) => {
      s.played++;
      s[result(m).toLowerCase()]++;
      s.gf += m.goalsFor;
      s.ga += m.goalsAgainst;
      s.pts += points(m);
      if (m.goalsAgainst === 0) s.cleanSheets++;
      const xg = num(m.stats && m.stats.xg);
      const xga = num(m.stats && m.stats.xgAgainst);
      if (xg !== null && xga !== null) {
        s.xg += xg;
        s.xga += xga;
        s.xgCount++;
      }
    });
    s.gd = s.gf - s.ga;
    if (s.played) {
      s.ppg = s.pts / s.played;
      s.winPct = (s.w / s.played) * 100;
    }
    return s;
  }

  function form(matches, n) {
    return sortByDate(matches, true).slice(0, n).map(result).reverse();
  }

  /** key 関数でグループ化し、各グループの summary を返す（試合数の多い順） */
  function groupBy(matches, keyFn) {
    const groups = {};
    matches.forEach((m) => {
      const k = keyFn(m);
      if (k === undefined || k === null || k === '') return;
      (groups[k] = groups[k] || []).push(m);
    });
    return Object.keys(groups)
      .map((k) => Object.assign({ key: k }, summary(groups[k])))
      .sort((a, b) => b.played - a.played || b.ppg - a.ppg);
  }

  function averageStats(matches) {
    const keys = ['possession', 'shots', 'shotsOnTarget', 'shotsAgainst', 'passAcc', 'corners', 'xg', 'xgAgainst'];
    const out = {};
    keys.forEach((k) => {
      let sum = 0, c = 0;
      matches.forEach((m) => {
        const v = num(m.stats && m.stats[k]);
        if (v !== null) { sum += v; c++; }
      });
      out[k] = c ? sum / c : null;
    });
    return out;
  }

  function playerStats(matches, players) {
    const map = {};
    players.forEach((p) => {
      map[p.id] = { player: p, apps: 0, goals: 0, assists: 0, ratingSum: 0, ratingCount: 0, motm: 0 };
    });
    matches.forEach((m) => {
      (m.ratings || []).forEach((r) => {
        const e = map[r.playerId];
        if (!e) return;
        e.apps++;
        const v = num(r.rating);
        if (v !== null) { e.ratingSum += v; e.ratingCount++; }
        if (r.motm) e.motm++;
      });
      (m.goals || []).forEach((g) => {
        if (map[g.playerId]) map[g.playerId].goals++;
        if (g.assistId && map[g.assistId]) map[g.assistId].assists++;
      });
    });
    return Object.values(map).map((e) => Object.assign(e, {
      avgRating: e.ratingCount ? e.ratingSum / e.ratingCount : null,
    }));
  }

  function headToHead(matches, opponent) {
    const key = String(opponent || '').trim().toLowerCase();
    if (!key) return { matches: [], summary: summary([]) };
    const list = sortByDate(matches.filter((m) => String(m.opponent || '').trim().toLowerCase() === key), true);
    return { matches: list, summary: summary(list) };
  }

  /** 推奨フォーメーション: 指定条件の試合で勝ち点/試合が最も高いもの（最低 minGames 試合） */
  function bestFormation(matches, minGames, filterFn) {
    const pool = filterFn ? matches.filter(filterFn) : matches;
    const rows = groupBy(pool, (m) => m.formation).filter((r) => r.played >= (minGames || 1));
    rows.sort((a, b) => b.ppg - a.ppg || b.gd - a.gd || b.played - a.played);
    return rows[0] || null;
  }

  function cumulativePoints(matches) {
    let total = 0;
    return sortByDate(matches).map((m) => {
      total += points(m);
      return { match: m, total: total };
    });
  }

  const api = { result, points, summary, form, groupBy, averageStats, playerStats, headToHead, bestFormation, cumulativePoints, sortByDate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMStats = api;
})(this);
