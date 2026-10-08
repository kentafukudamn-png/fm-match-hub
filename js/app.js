/* 画面描画とイベント処理 */
(function () {
  'use strict';
  const S = window.FMStats;
  const DB = window.FMStore;
  const FMI = window.FMImport;
  const app = document.getElementById('app');
  // 他サイトに埋め込まれて操作されること（クリックジャッキング）を防ぐ
  if (window.top !== window.self) {
    document.body.innerHTML = '<p style="padding:2rem">このアプリは埋め込み表示できません。</p>';
    throw new Error('framed');
  }

  const FORMATIONS = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '4-4-1-1', '4-3-1-2', '4-1-2-1-2', '4-2-4', '4-5-1',
    '3-5-2', '3-4-3', '3-4-2-1', '3-4-1-2', '5-3-2', '5-2-3', '5-4-1'];
  const POSITIONS = ['GK', 'DR', 'DC', 'DL', 'WBR', 'WBL', 'DM', 'MR', 'MC', 'ML', 'AMR', 'AMC', 'AML', 'ST'];
  const VENUES = { H: 'ホーム', A: 'アウェイ', N: '中立' };
  const RESULT_LABEL = { W: '勝', D: '分', L: '負' };
  const DEFAULT_CHECKLIST = [
    '対戦相手のスカウティングレポートを確認',
    '選手のコンディション・負傷・出場停止を確認',
    'フォーメーションと戦術を決定',
    'セットプレーのキッカー・担当を設定',
    '相手キープレイヤーへの対策（個別指示）を設定',
    '試合前のチームトークを準備',
  ];

  /* ---------- ユーティリティ ---------- */
  function esc(v) {
    return (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmt(n, d) {
    return n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toFixed(d === undefined ? 1 : d);
  }
  function intOr(v, def) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : def;
  }
  function today() {
    return new Date().toISOString().slice(0, 10);
  }
  function playerName(id) {
    const p = DB.get('players', id);
    return p ? p.name : '（削除済み）';
  }
  function sortedPlayers() {
    const order = (pos) => { const i = POSITIONS.indexOf(pos); return i < 0 ? 99 : i; };
    return DB.data.players.slice().sort((a, b) => order(a.position) - order(b.position) || intOr(a.number, 999) - intOr(b.number, 999));
  }
  function seasons() {
    const set = new Set(DB.data.matches.map((m) => m.season).filter(Boolean));
    if (DB.data.settings.season) set.add(DB.data.settings.season);
    return Array.from(set).sort().reverse();
  }
  function uniqueValues(list, key) {
    return Array.from(new Set(list.map((x) => x[key]).filter(Boolean))).sort();
  }
  function datalist(id, values) {
    return `<datalist id="${id}">${values.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
  }
  function badge(r) {
    return `<span class="badge badge-${r}">${RESULT_LABEL[r]}</span>`;
  }
  function formBadges(list) {
    return list.length ? list.map(badge).join('') : '<span class="muted">データなし</span>';
  }
  function scoreText(m) {
    return esc(`${m.goalsFor} - ${m.goalsAgainst}`);
  }
  function query() {
    const q = location.hash.split('?')[1] || '';
    const out = {};
    q.split('&').filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split('=');
      out[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return out;
  }
  function go(hash) {
    location.hash = hash;
  }

  /* ---------- 共通部品 ---------- */
  function summaryCards(s) {
    const cards = [
      ['試合', s.played],
      ['勝-分-負', `${s.w}-${s.d}-${s.l}`],
      ['勝率', s.played ? fmt(s.winPct, 0) + '%' : '–'],
      ['勝ち点/試合', s.played ? fmt(s.ppg, 2) : '–'],
      ['得点 / 失点', `${s.gf} / ${s.ga}`],
      ['得失点差', (s.gd > 0 ? '+' : '') + s.gd],
      ['クリーンシート', s.cleanSheets],
      ['xG / xGA', s.xgCount ? `${fmt(s.xg)} / ${fmt(s.xga)}` : '–'],
    ];
    return `<div class="cards">${cards.map(([l, v]) => `<div class="card"><div class="card-label">${l}</div><div class="card-value">${esc(v)}</div></div>`).join('')}</div>`;
  }

  function matchTable(matches, opts) {
    opts = opts || {};
    if (!matches.length) return '<p class="muted">試合記録がありません。</p>';
    return `<div class="table-wrap"><table class="table">
      <thead><tr><th>日付</th><th>大会</th><th>対戦相手</th><th>H/A</th><th>結果</th><th>スコア</th><th>フォーメーション</th><th>xG</th>${opts.actions ? '<th></th>' : ''}</tr></thead>
      <tbody>${matches.map((m) => `<tr>
        <td>${esc(m.date)}</td><td>${esc(m.competition)}</td><td>${esc(m.opponent)}</td>
        <td>${VENUES[m.venue] || ''}</td><td>${badge(S.result(m))}</td><td class="score">${scoreText(m)}</td>
        <td>${esc(m.formation)}${m.opponentFormation ? ` <span class="muted">vs ${esc(m.opponentFormation)}</span>` : ''}</td>
        <td>${m.stats && m.stats.xg !== '' && m.stats.xg !== undefined ? `${esc(m.stats.xg)} - ${esc(m.stats.xgAgainst)}` : '–'}</td>
        ${opts.actions ? `<td class="actions"><a class="btn btn-sm" href="#/matches/${esc(m.id)}">編集</a></td>` : ''}
      </tr>`).join('')}</tbody></table></div>`;
  }

  function groupTable(title, rows) {
    if (!rows.length) return '';
    return `<section class="panel"><h3>${title}</h3><div class="table-wrap"><table class="table">
      <thead><tr><th></th><th>試合</th><th>勝</th><th>分</th><th>負</th><th>得点</th><th>失点</th><th>勝率</th><th>勝ち点/試合</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><th>${esc(r.key)}</th><td>${r.played}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td>
        <td>${fmt(r.winPct, 0)}%</td><td><div class="bar-cell"><span class="bar" style="width:${(r.ppg / 3) * 100}%"></span><span>${fmt(r.ppg, 2)}</span></div></td></tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  /* 累計勝ち点（折れ線）と各試合の得失点差（棒） */
  function trendChart(matches) {
    const pts = S.cumulativePoints(matches);
    if (pts.length < 2) return '<p class="muted">2試合以上記録すると推移グラフが表示されます。</p>';
    const W = 720, H = 240, P = { l: 36, r: 12, t: 12, b: 28 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const maxPts = Math.max(3, pts[pts.length - 1].total);
    const gds = pts.map((p) => p.match.goalsFor - p.match.goalsAgainst);
    const maxGd = Math.max(1, ...gds.map(Math.abs));
    const x = (i) => P.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const y = (v) => P.t + ih - (v / maxPts) * ih;
    const mid = P.t + ih * 0.75;
    const barH = ih * 0.22;
    const bw = Math.max(2, Math.min(18, iw / pts.length - 2));
    const bars = gds.map((gd, i) => {
      const h = (Math.abs(gd) / maxGd) * barH;
      const cls = gd > 0 ? 'w' : gd < 0 ? 'l' : 'd';
      return `<rect class="gd-${cls}" x="${x(i) - bw / 2}" y="${gd >= 0 ? mid - h : mid}" width="${bw}" height="${Math.max(h, 1)}"><title>${esc(pts[i].match.date)} vs ${esc(pts[i].match.opponent)} ${scoreText(pts[i].match)}</title></rect>`;
    }).join('');
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');
    const ticks = [0, Math.round(maxPts / 2), maxPts].map((v) => `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${P.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="累計勝ち点の推移">
      ${ticks}<line class="zero" x1="${P.l}" x2="${W - P.r}" y1="${mid}" y2="${mid}"/>${bars}
      <path class="line" d="${line}"/>
      <text class="axis" x="${P.l}" y="${H - 8}">${esc(pts[0].match.date)}</text>
      <text class="axis" x="${W - P.r}" y="${H - 8}" text-anchor="end">${esc(pts[pts.length - 1].match.date)}</text>
    </svg>
    <p class="legend"><span class="lg lg-line"></span>累計勝ち点　<span class="lg lg-w"></span>勝ち試合の得失点差　<span class="lg lg-l"></span>負け試合の得失点差</p>`;
  }

  /* ---------- ダッシュボード ---------- */
  function viewDashboard() {
    const season = DB.data.settings.season;
    const matches = season ? DB.data.matches.filter((m) => m.season === season) : DB.data.matches;
    const s = S.summary(matches);
    const upcoming = DB.data.preps.filter((p) => p.status !== 'done').sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const next = upcoming[0];
    let nextHtml = '<p class="muted">予定されている試合準備はありません。</p><a class="btn" href="#/prep/new">＋ 次の試合の準備を始める</a>';
    if (next) {
      const h2h = S.headToHead(DB.data.matches, next.opponent).summary;
      const done = (next.checklist || []).filter((c) => c.done).length;
      const total = (next.checklist || []).length;
      nextHtml = `<div class="next-match">
        <div class="next-title">${esc(next.date)}　${esc(next.competition)}</div>
        <div class="next-opp">vs ${esc(next.opponent)} <span class="muted">(${VENUES[next.venue] || ''})</span></div>
        <p>対戦成績: ${h2h.played ? `${h2h.w}勝 ${h2h.d}分 ${h2h.l}敗（${h2h.gf}-${h2h.ga}）` : '初対戦'}</p>
        <p>予定フォーメーション: <b>${esc(next.plannedFormation || '未定')}</b>　準備チェック: <b>${done}/${total}</b></p>
        <div class="progress"><span style="width:${total ? (done / total) * 100 : 0}%"></span></div>
        <a class="btn" href="#/prep/${esc(next.id)}">準備を開く</a>
      </div>`;
    }
    const scorers = S.playerStats(matches, DB.data.players).filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 5);
    return `
      <div class="page-head"><h2>${esc(DB.data.settings.clubName || 'マイクラブ')} <span class="muted">${esc(season || '全シーズン')}</span></h2>
        <div><a class="btn btn-primary" href="#/matches/new">＋ 試合を記録</a></div></div>
      ${summaryCards(s)}
      <div class="grid-2">
        <section class="panel"><h3>次の試合</h3>${nextHtml}</section>
        <section class="panel"><h3>直近のフォーム</h3><div class="form-row">${formBadges(S.form(matches, 10))}</div>
          <h3>得点ランキング</h3>${scorers.length ? `<ol class="rank">${scorers.map((p) => `<li>${esc(p.player.name)} <b>${p.goals}</b></li>`).join('')}</ol>` : '<p class="muted">データなし</p>'}
        </section>
      </div>
      <section class="panel"><h3>最近の試合</h3>${matchTable(S.sortByDate(matches, true).slice(0, 5), { actions: true })}</section>
      ${DB.data.matches.length ? '' : `<section class="panel intro"><h3>はじめに</h3><ol>
        <li><a href="#/settings">設定</a>でクラブ名とシーズンを入力</li>
        <li><a href="#/squad">スカッド</a>に選手を登録（得点者・評価の記録に使用）</li>
        <li><a href="#/prep/new">試合準備</a>で対戦相手を分析し、試合後に結果を記録</li>
        <li>試合を重ねると<a href="#/analysis">分析</a>でフォーメーション別成績などが見られます</li>
      </ol><p>まず操作感を試したい場合は <button class="btn btn-sm" data-action="sample">サンプルデータを読み込む</button></p></section>`}`;
  }

  /* ---------- 試合記録 ---------- */
  function viewMatches() {
    const q = query();
    let list = DB.data.matches;
    if (q.season) list = list.filter((m) => m.season === q.season);
    if (q.comp) list = list.filter((m) => m.competition === q.comp);
    const comps = uniqueValues(DB.data.matches, 'competition');
    return `<div class="page-head"><h2>試合記録</h2><a class="btn btn-primary" href="#/matches/new">＋ 試合を記録</a></div>
      <div class="filters">
        <label>シーズン <select data-filter="season"><option value="">すべて</option>${seasons().map((s) => `<option ${q.season === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>大会 <select data-filter="comp"><option value="">すべて</option>${comps.map((c) => `<option ${q.comp === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <span class="muted">${list.length} 試合</span>
      </div>
      ${matchTable(S.sortByDate(list, true), { actions: true })}`;
  }

  function goalRow(g, players) {
    const opts = (sel) => `<option value="">—</option>${players.map((p) => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}`;
    return `<div class="goal-row">
      <label>得点者 <select name="g-player">${opts(g.playerId)}</select></label>
      <label>アシスト <select name="g-assist">${opts(g.assistId)}</select></label>
      <label>分 <input name="g-minute" type="number" min="1" max="130" value="${esc(g.minute)}" class="w-sm"></label>
      <button type="button" class="btn btn-sm btn-ghost" data-action="remove-row">✕</button></div>`;
  }

  function viewMatchForm(id) {
    const q = query();
    let m = id ? DB.get('matches', id) : null;
    if (id && !m) return '<p>試合が見つかりません。</p>';
    if (!m) {
      m = { date: today(), season: DB.data.settings.season, venue: 'H', goalsFor: 0, goalsAgainst: 0, stats: {}, goals: [], ratings: [] };
      const prep = q.prep && DB.get('preps', q.prep);
      if (prep) {
        Object.assign(m, { date: prep.date, competition: prep.competition, opponent: prep.opponent, venue: prep.venue,
          formation: prep.plannedFormation, opponentFormation: prep.opponentFormation, tactic: prep.plannedTactic, prepId: prep.id });
        m.ratings = (prep.lineup || []).map((pid) => ({ playerId: pid, rating: '' }));
      }
    }
    const st = m.stats || {};
    const players = sortedPlayers();
    const rmap = {};
    (m.ratings || []).forEach((r) => { rmap[r.playerId] = r; });
    const stat = (key, label, attrs) => `<label>${label}<input name="s-${key}" type="number" ${attrs || 'min="0"'} value="${esc(st[key])}"></label>`;
    return `<div class="page-head"><h2>${id ? '試合記録を編集' : '試合を記録'}</h2>
      ${id ? `<button class="btn btn-danger" data-action="delete-match" data-id="${esc(id)}">削除</button>` : ''}</div>
    <form id="match-form" class="form">
      <section class="panel"><h3>基本情報</h3><div class="fields">
        <label>日付<input name="date" type="date" required value="${esc(m.date)}"></label>
        <label>シーズン<input name="season" list="dl-season" value="${esc(m.season)}" placeholder="例: 2026/27"></label>
        <label>大会<input name="competition" list="dl-comp" value="${esc(m.competition)}" placeholder="例: リーグ"></label>
        <label>対戦相手<input name="opponent" list="dl-opp" required value="${esc(m.opponent)}"></label>
        <label>会場<select name="venue">${Object.keys(VENUES).map((k) => `<option value="${k}" ${m.venue === k ? 'selected' : ''}>${VENUES[k]}</option>`).join('')}</select></label>
      </div>
      <div class="scoreline">
        <label>自チーム<input name="goalsFor" type="number" min="0" required value="${esc(m.goalsFor)}"></label><span>-</span>
        <label>相手<input name="goalsAgainst" type="number" min="0" required value="${esc(m.goalsAgainst)}"></label>
      </div></section>

      <section class="panel"><h3>戦術</h3><div class="fields">
        <label>フォーメーション<input name="formation" list="dl-form" value="${esc(m.formation)}"></label>
        <label>相手フォーメーション<input name="opponentFormation" list="dl-form" value="${esc(m.opponentFormation)}"></label>
        <label>戦術名 / スタイル<input name="tactic" list="dl-tactic" value="${esc(m.tactic)}" placeholder="例: ゲーゲンプレス"></label>
      </div></section>

      <section class="panel"><h3>スタッツ <span class="muted">（試合後レポートから入力・任意）</span></h3><div class="fields fields-sm">
        ${stat('possession', 'ポゼッション %', 'min="0" max="100"')}
        ${stat('shots', 'シュート')}${stat('shotsOnTarget', '枠内シュート')}${stat('shotsAgainst', '被シュート')}
        ${stat('xg', 'xG', 'min="0" step="0.01"')}${stat('xgAgainst', '相手 xG', 'min="0" step="0.01"')}
        ${stat('passAcc', 'パス成功率 %', 'min="0" max="100"')}${stat('corners', 'CK')}
        ${stat('yellow', '警告')}${stat('red', '退場')}
      </div></section>

      <section class="panel"><h3>得点</h3>
        ${players.length ? `<div id="goals">${(m.goals || []).map((g) => goalRow(g, players)).join('')}</div>
        <button type="button" class="btn btn-sm" data-action="add-goal">＋ 得点を追加</button>` : '<p class="muted">得点者を記録するには<a href="#/squad">スカッド</a>に選手を登録してください。</p>'}
      </section>

      <section class="panel"><h3>選手評価 <span class="muted">（出場選手にチェックし、評価を入力）</span></h3>
        ${players.length ? `<div class="table-wrap"><table class="table ratings"><thead><tr><th>出場</th><th>#</th><th>選手</th><th>Pos</th><th>評価</th><th>MOM</th></tr></thead><tbody>
        ${players.map((p) => { const r = rmap[p.id]; return `<tr class="${r ? 'played' : ''}"><td><input type="checkbox" name="a-${esc(p.id)}" ${r ? 'checked' : ''}></td><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td>${esc(p.position)}</td>
          <td><input type="number" class="w-sm" name="r-${esc(p.id)}" min="1" max="10" step="0.1" value="${r ? esc(r.rating) : ''}"></td>
          <td><input type="radio" name="motm" value="${esc(p.id)}" ${r && r.motm ? 'checked' : ''}></td></tr>`; }).join('')}
        </tbody></table></div>` : '<p class="muted">スカッド未登録</p>'}
      </section>

      <section class="panel"><h3>メモ・振り返り</h3>
        <textarea name="notes" rows="4" placeholder="良かった点、課題、次回への改善点など">${esc(m.notes)}</textarea></section>
      <input type="hidden" name="prepId" value="${esc(m.prepId)}">
      <div class="form-actions"><a class="btn" href="#/matches">キャンセル</a><button class="btn btn-primary" type="submit">保存</button></div>
    </form>
    ${datalist('dl-season', seasons())}${datalist('dl-comp', uniqueValues(DB.data.matches, 'competition'))}
    ${datalist('dl-opp', uniqueValues(DB.data.matches.concat(DB.data.preps), 'opponent'))}${datalist('dl-form', FORMATIONS)}
    ${datalist('dl-tactic', uniqueValues(DB.data.matches, 'tactic'))}`;
  }

  function saveMatch(form, id) {
    const f = new FormData(form);
    const stats = {};
    ['possession', 'shots', 'shotsOnTarget', 'shotsAgainst', 'xg', 'xgAgainst', 'passAcc', 'corners', 'yellow', 'red'].forEach((k) => {
      const v = f.get('s-' + k);
      if (v !== '' && v !== null) stats[k] = parseFloat(v);
    });
    const goals = Array.from(form.querySelectorAll('.goal-row')).map((row) => ({
      playerId: row.querySelector('[name=g-player]').value,
      assistId: row.querySelector('[name=g-assist]').value,
      minute: row.querySelector('[name=g-minute]').value,
    })).filter((g) => g.playerId);
    const motm = f.get('motm');
    const ratings = [];
    DB.data.players.forEach((p) => {
      const v = f.get('r-' + p.id);
      const appeared = f.get('a-' + p.id) !== null || (v !== '' && v !== null) || p.id === motm;
      if (appeared) ratings.push({ playerId: p.id, rating: v === '' ? '' : parseFloat(v), motm: p.id === motm });
    });
    const m = {
      id: id || undefined,
      date: f.get('date'), season: f.get('season').trim(), competition: f.get('competition').trim(),
      opponent: f.get('opponent').trim(), venue: f.get('venue'),
      goalsFor: intOr(f.get('goalsFor'), 0), goalsAgainst: intOr(f.get('goalsAgainst'), 0),
      formation: f.get('formation').trim(), opponentFormation: f.get('opponentFormation').trim(), tactic: f.get('tactic').trim(),
      stats, goals, ratings, notes: f.get('notes'), prepId: f.get('prepId') || '',
    };
    DB.upsert('matches', m);
    if (m.prepId) {
      const prep = DB.get('preps', m.prepId);
      if (prep) { prep.status = 'done'; prep.matchId = m.id; DB.upsert('preps', prep); }
    }
    go('#/matches');
  }

  /* ---------- 分析 ---------- */
  function viewAnalysis() {
    const q = query();
    let matches = DB.data.matches;
    if (q.season) matches = matches.filter((m) => m.season === q.season);
    if (q.comp) matches = matches.filter((m) => m.competition === q.comp);
    const comps = uniqueValues(DB.data.matches, 'competition');
    const s = S.summary(matches);
    const avg = S.averageStats(matches);
    const ps = S.playerStats(matches, DB.data.players).filter((p) => p.apps > 0 || p.goals > 0);
    ps.sort((a, b) => (b.avgRating || 0) - (a.avgRating || 0));
    const best = S.bestFormation(matches, 3);
    const xgDiff = s.xgCount ? (s.gf - s.xg) : null;

    const insights = [];
    if (best) insights.push(`最も勝ち点を稼いでいるフォーメーションは <b>${esc(best.key)}</b>（${best.played}試合・勝ち点/試合 ${fmt(best.ppg, 2)}）。`);
    const venue = S.groupBy(matches, (m) => VENUES[m.venue]);
    const home = venue.find((v) => v.key === 'ホーム'), away = venue.find((v) => v.key === 'アウェイ');
    if (home && away && home.played >= 3 && away.played >= 3) {
      const diff = home.ppg - away.ppg;
      if (Math.abs(diff) >= 0.5) insights.push(`${diff > 0 ? 'アウェイ' : 'ホーム'}での成績が振るいません（勝ち点/試合 ホーム ${fmt(home.ppg, 2)} / アウェイ ${fmt(away.ppg, 2)}）。`);
    }
    if (xgDiff !== null && s.xgCount >= 5) {
      if (xgDiff <= -3) insights.push(`得点が xG を ${fmt(-xgDiff)} 下回っています。決定力の改善（フィニッシャーの見直し等）が課題です。`);
      else if (xgDiff >= 3) insights.push(`得点が xG を ${fmt(xgDiff)} 上回っています。好調ですが、持続性には注意。`);
      const xgaDiff = s.ga - s.xga;
      if (xgaDiff >= 3) insights.push(`失点が相手 xG を ${fmt(xgaDiff)} 上回っています。GK のパフォーマンスを確認しましょう。`);
    }
    if (avg.possession !== null && avg.possession < 45 && s.ppg >= 1.8) insights.push('ポゼッションは低めですが結果は良好。カウンター型のスタイルが機能しています。');
    const late = []; matches.forEach((m) => (m.goals || []).forEach((g) => { if (intOr(g.minute, 0) >= 76) late.push(g); }));
    const allGoals = matches.reduce((a, m) => a + (m.goals || []).length, 0);
    if (allGoals >= 10 && late.length / allGoals >= 0.35) insights.push(`得点の ${fmt((late.length / allGoals) * 100, 0)}% が76分以降。終盤の交代策が効いています。`);

    return `<div class="page-head"><h2>分析</h2></div>
      <div class="filters">
        <label>シーズン <select data-filter="season"><option value="">すべて</option>${seasons().map((x) => `<option ${q.season === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label>大会 <select data-filter="comp"><option value="">すべて</option>${comps.map((c) => `<option ${q.comp === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      </div>
      ${summaryCards(s)}
      ${insights.length ? `<section class="panel insights"><h3>インサイト</h3><ul>${insights.map((i) => `<li>${i}</li>`).join('')}</ul></section>` : ''}
      <section class="panel"><h3>シーズン推移</h3>${trendChart(matches)}
        <p>直近10試合: ${formBadges(S.form(matches, 10))}</p></section>
      <section class="panel"><h3>平均スタッツ</h3><div class="cards cards-sm">
        ${[['ポゼッション', avg.possession, '%', 0], ['シュート', avg.shots, '', 1], ['枠内', avg.shotsOnTarget, '', 1], ['被シュート', avg.shotsAgainst, '', 1],
           ['xG', avg.xg, '', 2], ['相手 xG', avg.xgAgainst, '', 2], ['パス成功率', avg.passAcc, '%', 0], ['CK', avg.corners, '', 1]]
          .map(([l, v, u, d]) => `<div class="card"><div class="card-label">${l}</div><div class="card-value">${v === null ? '–' : fmt(v, d) + u}</div></div>`).join('')}
      </div></section>
      <div class="grid-2">
        ${groupTable('フォーメーション別', S.groupBy(matches, (m) => m.formation))}
        ${groupTable('相手フォーメーション別', S.groupBy(matches, (m) => m.opponentFormation))}
        ${groupTable('ホーム / アウェイ', venue)}
        ${groupTable('大会別', S.groupBy(matches, (m) => m.competition))}
        ${groupTable('戦術別', S.groupBy(matches, (m) => m.tactic))}
        ${groupTable('対戦相手別（上位）', S.groupBy(matches, (m) => m.opponent).slice(0, 10))}
      </div>
      <section class="panel"><h3>選手成績</h3>${ps.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>選手</th><th>Pos</th><th>出場</th><th>得点</th><th>アシスト</th><th>平均評価</th><th>MOM</th></tr></thead>
        <tbody>${ps.map((p) => `<tr><td>${esc(p.player.name)}</td><td>${esc(p.player.position)}</td><td>${p.apps}</td><td>${p.goals}</td><td>${p.assists}</td>
          <td class="${p.avgRating >= 7.2 ? 'good' : p.avgRating !== null && p.avgRating < 6.5 ? 'bad' : ''}">${fmt(p.avgRating, 2)}</td><td>${p.motm}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">選手評価・得点を記録すると表示されます。</p>'}</section>`;
  }

  /* ---------- 試合準備 ---------- */
  function viewPreps() {
    const list = DB.data.preps.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const planned = list.filter((p) => p.status !== 'done');
    const done = list.filter((p) => p.status === 'done');
    const row = (p) => {
      const c = p.checklist || [];
      const m = p.matchId && DB.get('matches', p.matchId);
      return `<tr><td>${esc(p.date)}</td><td>${esc(p.competition)}</td><td>${esc(p.opponent)}</td><td>${VENUES[p.venue] || ''}</td>
        <td>${esc(p.plannedFormation)}</td><td>${c.filter((x) => x.done).length}/${c.length}</td>
        <td>${m ? `${badge(S.result(m))} ${scoreText(m)}` : ''}</td>
        <td class="actions"><a class="btn btn-sm" href="#/prep/${esc(p.id)}">開く</a>${p.status !== 'done' ? ` <a class="btn btn-sm btn-primary" href="#/matches/new?prep=${esc(p.id)}">結果を記録</a>` : ''}</td></tr>`;
    };
    const table = (rows) => rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>日付</th><th>大会</th><th>対戦相手</th><th>H/A</th><th>予定フォーメーション</th><th>チェック</th><th>結果</th><th></th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table></div>` : '<p class="muted">なし</p>';
    return `<div class="page-head"><h2>試合準備</h2><a class="btn btn-primary" href="#/prep/new">＋ 新しい試合準備</a></div>
      <section class="panel"><h3>予定</h3>${table(planned)}</section>
      <section class="panel"><h3>完了</h3>${table(done)}</section>`;
  }

  function checkRow(c) {
    return `<div class="check-row"><input type="checkbox" name="c-done" ${c.done ? 'checked' : ''}>
      <input name="c-text" value="${esc(c.text)}" placeholder="チェック項目"><button type="button" class="btn btn-sm btn-ghost" data-action="remove-row">✕</button></div>`;
  }

  /* 対戦相手名・相手フォーメーションに応じて動的に更新される参考情報 */
  function prepIntel(opponent, oppFormation) {
    const h2h = S.headToHead(DB.data.matches, opponent);
    let html = '<h3>対戦成績</h3>';
    if (!opponent) html += '<p class="muted">対戦相手を入力すると過去の対戦成績が表示されます。</p>';
    else if (!h2h.matches.length) html += '<p class="muted">記録上は初対戦です。</p>';
    else {
      const s = h2h.summary;
      html += `<p><b>${s.w}勝 ${s.d}分 ${s.l}敗</b>　得点 ${s.gf} / 失点 ${s.ga}</p>
        <ul class="h2h">${h2h.matches.slice(0, 5).map((m) => `<li>${badge(S.result(m))} ${esc(m.date)} ${scoreText(m)} <span class="muted">${esc(m.formation)}${m.opponentFormation ? ' vs ' + esc(m.opponentFormation) : ''}</span>${m.notes ? `<div class="note">${esc(m.notes)}</div>` : ''}</li>`).join('')}</ul>`;
      const lastOppForm = h2h.matches.find((m) => m.opponentFormation);
      if (lastOppForm && !oppFormation) html += `<p class="muted">前回の相手フォーメーション: ${esc(lastOppForm.opponentFormation)}</p>`;
    }
    html += '<h3>推奨フォーメーション</h3>';
    const tips = [];
    if (oppFormation) {
      const b = S.bestFormation(DB.data.matches, 2, (m) => m.opponentFormation === oppFormation);
      if (b) tips.push(`相手が <b>${esc(oppFormation)}</b> の試合では <b>${esc(b.key)}</b> が最も好成績（${b.played}試合 ${b.w}勝${b.d}分${b.l}敗）`);
    }
    const ho = S.bestFormation(h2h.matches, 1);
    if (ho && opponent) tips.push(`この相手には <b>${esc(ho.key)}</b> で勝ち点/試合 ${fmt(ho.ppg, 2)}`);
    const overall = S.bestFormation(DB.data.matches, 3);
    if (overall) tips.push(`全体では <b>${esc(overall.key)}</b> が最も好成績（勝ち点/試合 ${fmt(overall.ppg, 2)}）`);
    html += tips.length ? `<ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="muted">試合記録が増えると推奨が表示されます。</p>';
    return html;
  }

  function viewPrepForm(id) {
    let p = id ? DB.get('preps', id) : null;
    if (id && !p) return '<p>試合準備が見つかりません。</p>';
    if (!p) p = { date: today(), venue: 'H', lineup: [], checklist: DEFAULT_CHECKLIST.map((t) => ({ text: t, done: false })), status: 'planned' };
    const players = sortedPlayers();
    const lineup = new Set(p.lineup || []);
    const ta = (name, label, ph) => `<label class="full">${label}<textarea name="${name}" rows="3" placeholder="${ph || ''}">${esc(p[name])}</textarea></label>`;
    return `<div class="page-head"><h2>${id ? '試合準備' : '新しい試合準備'}</h2>
      <div>${id && p.status !== 'done' ? `<a class="btn btn-primary" href="#/matches/new?prep=${esc(id)}">試合結果を記録</a> ` : ''}
      ${p.matchId ? `<a class="btn" href="#/matches/${esc(p.matchId)}">試合記録を見る</a> ` : ''}
      ${id ? `<button class="btn btn-danger" data-action="delete-prep" data-id="${esc(id)}">削除</button>` : ''}</div></div>
    <div class="prep-layout">
    <form id="prep-form" class="form">
      <section class="panel"><h3>試合情報</h3><div class="fields">
        <label>日付<input name="date" type="date" required value="${esc(p.date)}"></label>
        <label>大会<input name="competition" list="dl-comp" value="${esc(p.competition)}"></label>
        <label>対戦相手<input name="opponent" list="dl-opp" required value="${esc(p.opponent)}"></label>
        <label>会場<select name="venue">${Object.keys(VENUES).map((k) => `<option value="${k}" ${p.venue === k ? 'selected' : ''}>${VENUES[k]}</option>`).join('')}</select></label>
      </div></section>
      <section class="panel"><h3>対戦相手スカウティング</h3><div class="fields">
        <label>想定フォーメーション<input name="opponentFormation" list="dl-form" value="${esc(p.opponentFormation)}"></label>
        <label>リーグ順位 / 状況<input name="opponentStanding" value="${esc(p.opponentStanding)}" placeholder="例: 3位・直近5試合 4勝1分"></label>
        <label>プレースタイル<input name="opponentStyle" value="${esc(p.opponentStyle)}" placeholder="例: ハイプレス、ロングボール"></label>
        ${ta('keyPlayers', 'キープレイヤー', '例: ST 〇〇（空中戦に強い）、AMC △△（スルーパス）')}
        ${ta('strengths', '相手の強み')}${ta('weaknesses', '相手の弱み・狙いどころ', '例: 右SBの裏、セットプレー守備')}
      </div></section>
      <section class="panel"><h3>ゲームプラン</h3><div class="fields">
        <label>予定フォーメーション<input name="plannedFormation" list="dl-form" value="${esc(p.plannedFormation)}"></label>
        <label>戦術名 / メンタリティ<input name="plannedTactic" list="dl-tactic" value="${esc(p.plannedTactic)}" placeholder="例: ポジティブ / ゲーゲンプレス"></label>
        ${ta('instructions', 'チーム指示・選手個別指示', '例: 相手SBにプレス強化、〇〇に密着マーク')}
        ${ta('setPieces', 'セットプレー', '例: CK キッカー 〇〇、ターゲット △△')}
        ${ta('inGamePlan', '試合中のプラン（スコア別の変更・交代策）', '例: リード時60分以降は守備的に、ビハインド時は 4-2-4')}
      </div></section>
      <section class="panel"><h3>スタメン候補 <span class="muted" id="lineup-count">${lineup.size}/11</span></h3>
        ${players.length ? `<div class="lineup">${players.map((pl) => `<label class="chip ${lineup.has(pl.id) ? 'on' : ''}"><input type="checkbox" name="lineup" value="${esc(pl.id)}" ${lineup.has(pl.id) ? 'checked' : ''}><span class="pos">${esc(pl.position)}</span>${esc(pl.name)}${pl.status ? ` <span class="status">${esc(pl.status)}</span>` : ''}</label>`).join('')}</div>`
          : '<p class="muted"><a href="#/squad">スカッド</a>に選手を登録すると選択できます。</p>'}
      </section>
      <section class="panel"><h3>準備チェックリスト</h3><div id="checks">${(p.checklist || []).map(checkRow).join('')}</div>
        <button type="button" class="btn btn-sm" data-action="add-check">＋ 項目を追加</button></section>
      <div class="form-actions"><a class="btn" href="#/prep">戻る</a><button class="btn btn-primary" type="submit">保存</button></div>
    </form>
    <aside class="panel intel" id="intel">${prepIntel(p.opponent, p.opponentFormation)}</aside>
    </div>
    ${datalist('dl-comp', uniqueValues(DB.data.matches.concat(DB.data.preps), 'competition'))}
    ${datalist('dl-opp', uniqueValues(DB.data.matches.concat(DB.data.preps), 'opponent'))}${datalist('dl-form', FORMATIONS)}
    ${datalist('dl-tactic', uniqueValues(DB.data.matches, 'tactic'))}`;
  }

  function savePrep(form, id) {
    const f = new FormData(form);
    const prev = id ? DB.get('preps', id) : null;
    const checklist = Array.from(form.querySelectorAll('.check-row')).map((row) => ({
      text: row.querySelector('[name=c-text]').value.trim(),
      done: row.querySelector('[name=c-done]').checked,
    })).filter((c) => c.text);
    const p = Object.assign({}, prev || { status: 'planned' }, {
      id: id || undefined,
      lineup: f.getAll('lineup'),
      checklist,
    });
    ['date', 'competition', 'opponent', 'venue', 'opponentFormation', 'opponentStanding', 'opponentStyle', 'keyPlayers', 'strengths',
      'weaknesses', 'plannedFormation', 'plannedTactic', 'instructions', 'setPieces', 'inGamePlan'].forEach((k) => {
      p[k] = String(f.get(k) || '').trim();
    });
    DB.upsert('preps', p);
    go('#/prep/' + p.id);
    toast('保存しました');
  }

  /* ---------- スカッド ---------- */
  function viewSquad() {
    const players = sortedPlayers();
    const ps = {};
    S.playerStats(DB.data.matches, DB.data.players).forEach((x) => { ps[x.player.id] = x; });
    const hasFM = players.some((p) => p.fm);
    const fmAt = players.map((p) => p.fm && p.fm.importedAt).filter(Boolean).sort().pop();
    const fmv = (p, k, d) => (p.fm && p.fm[k] !== undefined ? (d === undefined ? esc(p.fm[k]) : fmt(p.fm[k], d)) : '–');
    return `<div class="page-head"><h2>スカッド</h2><a class="btn" href="#/settings?fm=1">FM から取り込む</a></div>
      <section class="panel"><h3>選手を追加</h3>
        <form id="player-form" class="fields fields-inline">
          <label>背番号<input name="number" type="number" min="1" max="99" class="w-sm"></label>
          <label>名前<input name="name" required></label>
          <label>ポジション<select name="position">${POSITIONS.map((p) => `<option>${p}</option>`).join('')}</select></label>
          <button class="btn btn-primary" type="submit">追加</button>
        </form>
        <details><summary>まとめて追加</summary>
          <p class="muted">1行に「背番号,名前,ポジション」の形式で入力（例: 10,山田太郎,AMC）</p>
          <textarea id="bulk-players" rows="5"></textarea><button class="btn btn-sm" data-action="bulk-players">一括追加</button>
        </details>
      </section>
      <section class="panel"><h3>登録選手 <span class="muted">${players.length}人${fmAt ? ` ・ FM 成績は ${esc(new Date(fmAt).toLocaleString('ja-JP'))} 取り込み` : ''}</span></h3>
      ${players.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>名前</th><th>Pos</th><th>状態</th><th>出場</th><th>得点</th><th>平均評価</th>
        ${hasFM ? '<th class="fm-col">FM 出場</th><th class="fm-col">FM 得点</th><th class="fm-col">FM アシスト</th><th class="fm-col">FM 平均評価</th><th class="fm-col">FM PoM</th>' : ''}<th></th></tr></thead><tbody>
        ${players.map((p) => { const st = ps[p.id] || {}; return `<tr>
          <td><input class="w-sm" type="number" value="${esc(p.number)}" data-player="${esc(p.id)}" data-field="number"></td>
          <td><input value="${esc(p.name)}" data-player="${esc(p.id)}" data-field="name"></td>
          <td><select data-player="${esc(p.id)}" data-field="position">${POSITIONS.map((x) => `<option ${x === p.position ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          <td><select data-player="${esc(p.id)}" data-field="status">${['', '負傷', '出場停止', '不調', '移籍予定'].map((x) => `<option value="${x}" ${x === (p.status || '') ? 'selected' : ''}>${x || '良好'}</option>`).join('')}</select></td>
          <td>${st.apps || 0}</td><td>${st.goals || 0}</td><td>${fmt(st.avgRating, 2)}</td>
          ${hasFM ? `<td class="fm-col">${fmv(p, 'apps')}</td><td class="fm-col">${fmv(p, 'goals')}</td><td class="fm-col">${fmv(p, 'assists')}</td><td class="fm-col">${fmv(p, 'avgRating', 2)}</td><td class="fm-col">${fmv(p, 'pom')}</td>` : ''}
          <td><button class="btn btn-sm btn-ghost" data-action="delete-player" data-id="${esc(p.id)}">削除</button></td></tr>`; }).join('')}
      </tbody></table></div>` : '<p class="muted">選手が登録されていません。</p>'}</section>`;
  }

  /* ---------- 設定 ---------- */
  function viewSettings() {
    const st = DB.data.settings;
    return `<div class="page-head"><h2>設定</h2></div>
      <section class="panel"><h3>クラブ情報</h3><form id="settings-form" class="fields">
        <label>クラブ名<input name="clubName" value="${esc(st.clubName)}"></label>
        <label>現在のシーズン<input name="season" value="${esc(st.season)}" placeholder="例: 2026/27"></label>
        <div><button class="btn btn-primary" type="submit">保存</button></div></form></section>
      ${viewFMImport()}
      ${viewSyncSettings()}
      <section class="panel"><h3>データ管理</h3>
        <p class="muted">データは常にこのブラウザ（localStorage）にも保存されます。クラウド保存を使わない場合は、定期的にエクスポートしてバックアップしてください。</p>
        <div class="btn-row">
          <button class="btn" data-action="export">JSON エクスポート</button>
          <label class="btn">JSON インポート<input type="file" accept="application/json,.json" id="import-file" hidden></label>
          <button class="btn" data-action="export-csv">試合記録を CSV 出力</button>
          <button class="btn" data-action="sample">サンプルデータを読み込む</button>
          <button class="btn btn-danger" data-action="reset">全データを削除</button>
        </div></section>`;
  }

  /* ---------- FM から取り込む ---------- */
  let fmPending = null;

  function viewFMImport() {
    return `<section class="panel" id="fm-import"><h3>FM から取り込む <span class="muted">（最新のセーブデータの数字を反映）</span></h3>
      <details class="howto"><summary>FM での書き出し方</summary><ol>
        <li>FM で <b>スカッド</b> 画面（選手成績）または <b>クラブ → 日程</b> 画面（試合結果）を開く。表示列は「ビュー」から選べます（例: 背番号・名前・ポジション・出場・得点・アシスト・平均評価・出場時間・PoM）</li>
        <li><b>Ctrl+P</b>（Mac は <b>⌘+P</b>）→「<b>Web ページ</b>」（または「テキストファイル」）を選んで保存</li>
        <li>保存したファイルを下で選択（複数可）。スカッドと日程は列名から自動判別します</li>
      </ol><p class="muted">セーブデータ本体（.fm）は独自の圧縮形式のため直接は読み込めません。選手は名前で、試合は日付と対戦相手で照合するので、何度取り込んでも重複しません（入力済みのスタッツやメモは残ります）。</p></details>
      <div class="btn-row"><label class="btn btn-primary">ファイルを選択<input type="file" id="fm-file" accept=".html,.htm,.txt,.rtf,.csv,.tsv,text/html,text/plain" multiple hidden></label>
        <button class="btn" data-action="fm-paste-toggle">テキストを貼り付け</button></div>
      <div id="fm-paste" hidden><textarea id="fm-text" rows="6" placeholder="FM のテキスト出力や表をここに貼り付け"></textarea>
        <button class="btn btn-sm" data-action="fm-parse">読み取る</button></div>
      <div id="fm-preview"></div></section>`;
  }

  function fmPreview(result) {
    fmPending = result;
    const el = document.getElementById('fm-preview');
    const { players, matches } = result;
    if (!players.length && !matches.length) {
      el.innerHTML = '<p class="error-text">取り込める表が見つかりませんでした。「名前」列を含むスカッド画面、または「日付・対戦相手・結果」列を含む日程画面を書き出してください。</p>';
      return;
    }
    const known = new Set(DB.data.players.map((p) => p.name.toLowerCase().trim()));
    const newCount = players.filter((p) => !known.has(p.name.toLowerCase().trim())).length;
    const sm = S.summary(matches);
    el.innerHTML = `<div class="import-preview">
      ${players.length ? `<h4>選手 ${players.length}人 <span class="muted">（新規 ${newCount} ・ 更新 ${players.length - newCount}）</span></h4>
      <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>名前</th><th>Pos</th><th>出場</th><th>得点</th><th>アシスト</th><th>平均評価</th><th>出場時間</th></tr></thead><tbody>
      ${players.slice(0, 40).map((p) => `<tr><td>${esc(p.number)}</td><td>${esc(p.name)}</td><td>${esc(p.position || '–')}</td><td>${esc(p.fm.apps === undefined ? '–' : p.fm.apps)}</td>
        <td>${esc(p.fm.goals === undefined ? '–' : p.fm.goals)}</td><td>${esc(p.fm.assists === undefined ? '–' : p.fm.assists)}</td><td>${fmt(p.fm.avgRating, 2)}</td><td>${esc(p.fm.minutes === undefined ? '–' : p.fm.minutes)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${matches.length ? `<h4>試合結果 ${matches.length}試合 <span class="muted">（${sm.w}勝 ${sm.d}分 ${sm.l}敗 ・ 得点 ${sm.gf} 失点 ${sm.ga}）</span></h4>
      <div class="table-wrap"><table class="table"><thead><tr><th>日付</th><th>大会</th><th>対戦相手</th><th>会場</th><th>スコア</th></tr></thead><tbody>
      ${S.sortByDate(matches, true).slice(0, 40).map((m) => `<tr><td>${esc(m.date)}</td><td>${esc(m.competition)}</td><td>${esc(m.opponent)}</td><td>${VENUES[m.venue]}</td><td>${badge(S.result(m))} ${esc(m.goalsFor)}-${esc(m.goalsAgainst)}</td></tr>`).join('')}
      </tbody></table></div>
      <label class="inline">シーズン <input id="fm-season" value="${esc(DB.data.settings.season)}" placeholder="例: 2026/27" class="w-md"></label>` : ''}
      <div class="btn-row"><button class="btn btn-primary" data-action="fm-apply">この内容で取り込む</button><button class="btn" data-action="fm-cancel">キャンセル</button></div></div>`;
  }

  function fmApply() {
    if (!fmPending) return;
    const now = new Date().toISOString();
    const seasonEl = document.getElementById('fm-season');
    const rp = FMI.mergePlayers(DB.data.players, fmPending.players, DB.uid, now);
    const rm = FMI.mergeMatches(DB.data.matches, fmPending.matches, DB.uid, seasonEl ? seasonEl.value.trim() : DB.data.settings.season);
    fmPending = null;
    DB.save();
    const msg = [];
    if (rp.added + rp.updated) msg.push(`選手 新規${rp.added}・更新${rp.updated}`);
    if (rm.added + rm.updated) msg.push(`試合 新規${rm.added}・更新${rm.updated}`);
    toast('取り込みました: ' + msg.join(' / '));
    render();
  }

  /* ---------- クラウド保存（GitHub 非公開リポジトリ） ---------- */
  const SYNC_LABEL = { off: '未接続', syncing: '同期中…', ok: '同期済み', dirty: '未同期の変更あり', offline: 'オフライン（後で同期）', error: '同期エラー',
    auth: '認証エラー（トークンを確認）', locked: 'トークン入力待ち' };
  let syncDetail = '';
  const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new?' + [
    'name=' + encodeURIComponent('FM Match Hub'),
    'description=' + encodeURIComponent('FM Match Hub のデータ保存用'),
    'expires_in=90',
    'contents=write',
  ].join('&');

  function viewSyncSettings() {
    const c = Sync.config;
    const tokenForm = (id, label, button) => `<form id="${id}" class="fields-inline token-form">
        <label>${label}<input name="token" type="password" required autocomplete="off" spellcheck="false" placeholder="github_pat_..."></label>
        <button class="btn btn-primary" type="submit">${button}</button></form>`;
    if (c && Sync.locked) {
      return `<section class="panel"><h3>クラウド保存 <span class="sync-pill sync-locked">${SYNC_LABEL.locked}</span></h3>
        <p>保存先: <b>${esc(c.owner)}/${esc(c.repo)}</b>（${esc(c.branch)}）</p>
        <p class="muted">トークンを記憶しない設定のため、ブラウザを開き直すたびに入力が必要です。入力するまでの変更はこの端末に保存され、入力後にアップロードされます。</p>
        ${tokenForm('unlock-form', 'アクセストークン', '同期を再開')}
        <div class="btn-row"><button class="btn btn-danger" data-action="sync-disconnect">接続を解除</button></div></section>`;
    }
    if (c) {
      const last = Sync.meta.lastSyncedAt ? new Date(Sync.meta.lastSyncedAt).toLocaleString('ja-JP') : '–';
      return `<section class="panel"><h3>クラウド保存 <span class="sync-pill sync-${Sync.status}" data-sync-status>${SYNC_LABEL[Sync.status]}</span></h3>
        <p>保存先: <a href="https://github.com/${esc(c.owner)}/${esc(c.repo)}/commits/${esc(c.branch)}/${esc(c.path)}" target="_blank" rel="noopener"><b>${esc(c.owner)}/${esc(c.repo)}</b></a>
          （ブランチ ${esc(c.branch)} ・ ${esc(c.path)}）　<span class="muted">最終同期: ${esc(last)}</span></p>
        ${Sync.status === 'error' || Sync.status === 'offline' ? `<p class="error-text">${esc(syncDetail)}</p>` : ''}
        <p class="muted">${c.auto === false ? '自動同期はオフです。' : 'データを変更すると自動でアップロードされます。'}保存のたびにコミットされるため、GitHub の履歴から過去の状態に戻せます。</p>
        <p class="muted">トークン: ${c.remember ? 'このブラウザに記憶中' : '記憶しない（ブラウザを閉じると消去）'}</p>
        <details class="howto" ${Sync.status === 'auth' ? 'open' : ''}><summary>トークンを差し替える（期限切れ・漏えいの疑いがあるとき）</summary>
          <p class="muted">GitHub で<a href="${TOKEN_URL}" target="_blank" rel="noopener">新しいトークンを作成</a>して貼り付けてください。漏えいの疑いがある場合は、<a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">トークン一覧</a>から古いトークンを削除（Delete）してください。</p>
          ${tokenForm('token-form', '新しいアクセストークン', '差し替える')}</details>
        <div class="btn-row"><button class="btn btn-primary" data-action="sync-now">今すぐ同期</button>
          <button class="btn" data-action="sync-toggle-auto">${c.auto === false ? '自動同期をオンにする' : '自動同期をオフにする'}</button>
          <button class="btn btn-danger" data-action="sync-disconnect">接続を解除</button></div></section>`;
    }
    const last = Sync.lastConfig;
    return `<section class="panel"><h3>クラウド保存 <span class="muted">（GitHub の非公開リポジトリ）</span></h3>
      <p>データを自分専用の非公開リポジトリに保存し、PC・スマホなど複数の端末で同期できます。保存のたびにコミットされるので履歴がバックアップになります。</p>
      <details class="howto" open><summary>準備の手順</summary><ol>
        <li><a href="${TOKEN_URL}" target="_blank" rel="noopener"><b>こちらからトークンを作成</b></a>（名前・期限90日・Contents: Read and write は入力済み）
          <ul><li>Repository access で <b>Only select repositories</b> → データ保存用の<b>非公開リポジトリだけ</b>を選択</li>
          <li>ページ下部の「Generate token」を押し、表示されたトークン（github_pat_…）をコピー</li></ul></li>
        <li>下のフォームに保存先とトークンを入力して「接続」</li>
      </ol></details>
      <form id="sync-form" class="fields">
        <label>オーナー（GitHub ユーザー名）<input name="owner" required autocomplete="off" value="${esc(last.owner)}" placeholder="GitHub ユーザー名"></label>
        <label>リポジトリ名<input name="repo" required autocomplete="off" value="${esc(last.repo)}" placeholder="データ保存用の非公開リポジトリ"></label>
        <label>ブランチ<input name="branch" autocomplete="off" value="${esc(last.branch)}" placeholder="例: data（空欄でデフォルトブランチ）"></label>
        <label>ファイル名<input name="path" value="${esc(last.path || 'fm-data.json')}" required></label>
        <label class="full">アクセストークン<input name="token" type="password" required autocomplete="off" spellcheck="false" placeholder="github_pat_..."></label>
        <label class="full check"><input type="checkbox" name="remember" checked> このブラウザにトークンを記憶する
          <span class="muted">（共用 PC や他人の端末ではオフにしてください。オフの場合はブラウザを閉じると消え、次回は再入力が必要です）</span></label>
        <div class="full"><button class="btn btn-primary" type="submit">接続</button>
          <span class="muted">トークンは GitHub 以外には送信されず、データファイルにも含まれません。</span></div>
      </form></section>`;
  }

  async function connectSync(form) {
    const f = new FormData(form);
    const cfg = { owner: f.get('owner').trim(), repo: f.get('repo').trim().replace(/\.git$/, ''), branch: f.get('branch').trim(),
      path: f.get('path').trim() || 'fm-data.json', token: f.get('token').trim(), auto: true, remember: f.get('remember') !== null };
    if (/^gh[ps]_/.test(cfg.token) && !confirm('これは権限範囲の広い「クラシックトークン」です。漏えい時の被害が大きいため、Fine-grained token（github_pat_…）の使用を強く推奨します。\n\nそれでも続けますか？')) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '確認中…';
    try {
      const info = await Sync.testConnection(cfg);
      if (!info.private) throw new Error(`${info.fullName} は公開リポジトリです。データが誰でも見られる状態になるため接続できません。非公開（Private）リポジトリを指定してください。`);
      if (!info.canPush) throw new Error('このリポジトリへの書き込み権限がありません');
      cfg.branch = cfg.branch || info.defaultBranch;
      // クラウドに既存データがある場合は、どちらを残すか確認する
      const remote = await FMSync.createGitHubClient(cfg, fetch.bind(window)).pull();
      const hasLocal = DB.data.matches.length || DB.data.players.length || DB.data.preps.length;
      if (!remote.exists) {
        Sync.configure(cfg, { dirty: true });
      } else if (!hasLocal || confirm('クラウドに既存のデータがあります。\n\nOK: クラウドのデータを読み込む（この端末のデータは置き換え）\nキャンセル: この端末のデータでクラウドを上書き（以前の内容は GitHub の履歴に残ります）')) {
        applyRemote(remote.text);
        Sync.configure(cfg, { sha: remote.sha, dirty: false });
      } else {
        Sync.configure(cfg, { sha: remote.sha, dirty: true });
      }
      await Sync.syncNow();
      toast(Sync.status === 'ok' ? 'クラウドに接続しました' : '接続しましたが同期に失敗しました');
      render();
    } catch (e) {
      alert('接続に失敗しました: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '接続';
    }
  }

  function applyRemote(text) {
    DB.replaceAll(JSON.parse(text), true);
    updateBrand();
  }

  function updateSyncIndicator() {
    const el = document.getElementById('sync-indicator');
    if (el) {
      el.hidden = !Sync.config;
      el.className = `sync-indicator sync-${Sync.status}`;
      el.title = `クラウド保存: ${SYNC_LABEL[Sync.status]}${syncDetail && (Sync.status === 'error' || Sync.status === 'offline') ? ' - ' + syncDetail : ''}`;
      el.textContent = Sync.status === 'syncing' ? '⟳' : Sync.status === 'ok' ? '☁' : Sync.status === 'dirty' ? '☁•' : Sync.status === 'locked' ? '🔒' : '⚠';
    }
    document.querySelectorAll('[data-sync-status]').forEach((p) => {
      p.className = `sync-pill sync-${Sync.status}`;
      p.textContent = SYNC_LABEL[Sync.status];
    });
  }

  const Sync = FMSync.createSyncManager({
    storage: window.localStorage,
    session: window.sessionStorage,
    fetch: (u, o) => window.fetch(u, o),
    getText: () => JSON.stringify(DB.data, null, 1),
    apply: (text) => { applyRemote(text); render(); toast('他の端末の更新を反映しました'); },
    resolveConflict: () => Promise.resolve(confirm('この端末と他の端末の両方でデータが変更されています。\n\nOK: この端末の内容で上書き\nキャンセル: クラウドの内容を読み込む（この端末の変更は破棄）\n\nどちらを選んでも、上書きされた内容は GitHub の履歴に残ります。') ? 'local' : 'remote'),
    onStatus: (s, detail) => {
      syncDetail = detail || '';
      updateSyncIndicator();
      if (s === 'error' || s === 'auth') toast('クラウド同期に失敗: ' + syncDetail);
    },
  });
  DB.onChange(() => Sync.markDirty());

  /* ---------- サンプルデータ ---------- */
  function sampleData() {
    const id = DB.uid;
    const names = [['1', '中村 航', 'GK'], ['2', '佐藤 蓮', 'DR'], ['4', '鈴木 大和', 'DC'], ['5', '高橋 陸', 'DC'], ['3', '田中 湊', 'DL'],
      ['6', '伊藤 悠真', 'DM'], ['8', '渡辺 颯', 'MC'], ['10', '山本 翔', 'AMC'], ['7', '小林 陽向', 'AMR'], ['11', '加藤 樹', 'AML'],
      ['9', '吉田 蒼', 'ST'], ['14', '山田 律', 'MC'], ['19', '松本 新', 'ST'], ['15', '井上 朝陽', 'DC']];
    const players = names.map(([n, name, pos]) => ({ id: id(), number: n, name, position: pos }));
    const opps = [['Rivertown FC', '4-4-2'], ['Northbridge', '4-3-3'], ['Eastport United', '4-2-3-1'], ['Westfield City', '3-5-2'], ['Harbor Athletic', '4-4-2']];
    const forms = ['4-2-3-1', '4-2-3-1', '4-3-3', '4-2-3-1', '4-4-2'];
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const matches = [];
    const start = new Date('2026-08-08');
    for (let i = 0; i < 18; i++) {
      const [opp, of] = opps[i % opps.length];
      const formation = forms[Math.floor(rnd() * forms.length)];
      const strength = formation === '4-2-3-1' ? 0.6 : 0.4;
      const gf = Math.floor(rnd() * 3.2 + strength), ga = Math.floor(rnd() * 2.4);
      const d = new Date(start); d.setDate(d.getDate() + i * 7);
      const xg = Math.max(0.2, gf * 0.8 + rnd() * 0.8), xga = Math.max(0.1, ga * 0.8 + rnd() * 0.7);
      const xi = players.slice(0, 11);
      const goals = [];
      for (let g = 0; g < gf; g++) {
        const sc = xi[[10, 7, 8, 9, 6, 10][Math.floor(rnd() * 6)]];
        const as = xi[[7, 8, 9, 6, 1][Math.floor(rnd() * 5)]];
        goals.push({ playerId: sc.id, assistId: as.id === sc.id ? '' : as.id, minute: Math.floor(rnd() * 90) + 1 });
      }
      const motm = xi[Math.floor(rnd() * 11)].id;
      matches.push({
        id: id(), date: d.toISOString().slice(0, 10), season: '2026/27', competition: i % 6 === 5 ? 'カップ戦' : 'リーグ',
        opponent: opp, venue: i % 2 ? 'A' : 'H', goalsFor: gf, goalsAgainst: ga, formation, opponentFormation: of,
        tactic: formation === '4-4-2' ? 'カウンター' : 'ゲーゲンプレス',
        stats: { possession: Math.round(42 + rnd() * 20), shots: Math.round(8 + rnd() * 10), shotsOnTarget: Math.round(3 + rnd() * 5),
          shotsAgainst: Math.round(5 + rnd() * 9), xg: +xg.toFixed(2), xgAgainst: +xga.toFixed(2), passAcc: Math.round(76 + rnd() * 12), corners: Math.round(2 + rnd() * 7) },
        goals, ratings: xi.map((p) => ({ playerId: p.id, rating: +(6.2 + rnd() * 1.8).toFixed(1), motm: p.id === motm })),
        notes: gf > ga ? '前線からのプレスが機能した。' : gf < ga ? '中盤でボールを失う場面が多かった。' : '',
      });
    }
    const nd = new Date(start); nd.setDate(nd.getDate() + 18 * 7);
    const preps = [{ id: id(), date: nd.toISOString().slice(0, 10), competition: 'リーグ', opponent: 'Northbridge', venue: 'H', opponentFormation: '4-3-3',
      opponentStyle: 'ポゼッション重視', keyPlayers: 'AMC のパサーを自由にさせない', weaknesses: '左SBの裏のスペース', plannedFormation: '4-2-3-1',
      plannedTactic: 'ゲーゲンプレス', lineup: players.slice(0, 11).map((p) => p.id), status: 'planned',
      checklist: DEFAULT_CHECKLIST.map((t, i) => ({ text: t, done: i < 2 })) }];
    return { settings: { clubName: 'FC サンプル', season: '2026/27' }, players, matches, preps };
  }

  /* ---------- CSV ---------- */
  function matchesCSV() {
    const cols = ['date', 'season', 'competition', 'opponent', 'venue', 'goalsFor', 'goalsAgainst', 'result', 'formation', 'opponentFormation', 'tactic',
      'possession', 'shots', 'shotsOnTarget', 'shotsAgainst', 'xg', 'xgAgainst', 'passAcc', 'corners', 'notes'];
    const cell = (v) => { const s = String(v === undefined || v === null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = S.sortByDate(DB.data.matches).map((m) => cols.map((c) => cell(c === 'result' ? S.result(m) : m[c] !== undefined ? m[c] : (m.stats || {})[c])).join(','));
    return '﻿' + [cols.join(',')].concat(rows).join('\n');
  }

  /** FM の Web ページ出力は UTF-8 以外（Windows-1252 等）のこともあるので、文字化けしたら読み直す */
  function readText(file) {
    return file.arrayBuffer().then((buf) => {
      const utf8 = new TextDecoder('utf-8').decode(buf);
      if (!utf8.includes('\uFFFD')) return utf8;
      const m = utf8.match(/charset=["']?([\w-]+)/i);
      try { return new TextDecoder(m ? m[1] : 'windows-1252').decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
    });
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function toast(msg) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  /* ---------- ルーティング ---------- */
  function render() {
    const path = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
    const [section, id] = path;
    let html;
    switch (section) {
      case 'matches': html = id ? viewMatchForm(id === 'new' ? null : id) : viewMatches(); break;
      case 'analysis': html = viewAnalysis(); break;
      case 'prep': html = id ? viewPrepForm(id === 'new' ? null : id) : viewPreps(); break;
      case 'squad': html = viewSquad(); break;
      case 'settings': html = viewSettings(); break;
      default: html = viewDashboard();
    }
    app.innerHTML = html;
    document.querySelectorAll('.nav a').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + (section || ''));
    });
    bindForms(section, id === 'new' ? null : id);
    window.scrollTo(0, 0);
  }

  function bindForms(section, id) {
    const mf = document.getElementById('match-form');
    if (mf) mf.addEventListener('submit', (e) => { e.preventDefault(); saveMatch(mf, id); });
    const pf = document.getElementById('prep-form');
    if (pf) {
      pf.addEventListener('submit', (e) => { e.preventDefault(); savePrep(pf, id); });
      const refresh = () => { document.getElementById('intel').innerHTML = prepIntel(pf.opponent.value.trim(), pf.opponentFormation.value.trim()); };
      pf.opponent.addEventListener('input', refresh);
      pf.opponentFormation.addEventListener('input', refresh);
      pf.addEventListener('change', (e) => {
        if (e.target.name === 'lineup') {
          e.target.closest('.chip').classList.toggle('on', e.target.checked);
          document.getElementById('lineup-count').textContent = `${pf.querySelectorAll('[name=lineup]:checked').length}/11`;
        }
      });
    }
    const plf = document.getElementById('player-form');
    if (plf) plf.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(plf);
      DB.upsert('players', { number: f.get('number'), name: f.get('name').trim(), position: f.get('position') });
      render();
      document.querySelector('#player-form [name=name]').focus();
    });
    const sf = document.getElementById('settings-form');
    if (sf) sf.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = new FormData(sf);
      DB.data.settings.clubName = f.get('clubName').trim();
      DB.data.settings.season = f.get('season').trim();
      DB.save();
      updateBrand();
      toast('保存しました');
    });
    ['unlock-form', 'token-form'].forEach((fid) => {
      const tf = document.getElementById(fid);
      if (tf) tf.addEventListener('submit', async (e) => {
        e.preventDefault();
        const t = tf.token.value.trim();
        try {
          const info = await Sync.testToken(t);
          if (!info.private) throw new Error('公開リポジトリには接続できません');
        } catch (err) { alert('トークンを確認できませんでした: ' + err.message); return; }
        tf.reset();
        await Sync.unlock(t);
        toast(Sync.status === 'ok' ? '同期しました' : '同期に失敗しました');
        render();
      });
    });
    const syf = document.getElementById('sync-form');
    if (syf) syf.addEventListener('submit', (e) => { e.preventDefault(); connectSync(syf); });
    const fmf = document.getElementById('fm-file');
    if (fmf) fmf.addEventListener('change', () => {
      const files = Array.from(fmf.files);
      if (!files.length) return;
      Promise.all(files.map(readText)).then((texts) => {
        const r = { players: [], matches: [] };
        texts.forEach((t) => { const x = FMI.parse(t); r.players = r.players.concat(x.players); r.matches = r.matches.concat(x.matches); });
        fmPreview(r);
        fmf.value = '';
      }).catch((err) => alert('読み込みに失敗しました: ' + err.message));
    });
    if (section === 'settings' && query().fm) document.getElementById('fm-import').scrollIntoView();
    const imp = document.getElementById('import-file');
    if (imp) imp.addEventListener('change', () => {
      const file = imp.files[0];
      if (!file) return;
      file.text().then((t) => {
        if (!confirm('現在のデータを置き換えます。よろしいですか？')) return;
        DB.replaceAll(JSON.parse(t));
        updateBrand();
        toast('インポートしました');
        go('#/');
      }).catch((err) => alert('インポートに失敗しました: ' + err.message));
    });
  }

  /* ---------- イベント委譲 ---------- */
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    switch (action) {
      case 'add-goal': document.getElementById('goals').insertAdjacentHTML('beforeend', goalRow({}, sortedPlayers())); break;
      case 'add-check': document.getElementById('checks').insertAdjacentHTML('beforeend', checkRow({ text: '', done: false })); break;
      case 'remove-row': el.parentElement.remove(); break;
      case 'delete-match': if (confirm('この試合記録を削除しますか？')) { DB.remove('matches', el.dataset.id); go('#/matches'); } break;
      case 'delete-prep': if (confirm('この試合準備を削除しますか？')) { DB.remove('preps', el.dataset.id); go('#/prep'); } break;
      case 'delete-player': if (confirm('この選手を削除しますか？（過去の記録上は「削除済み」と表示されます）')) { DB.remove('players', el.dataset.id); render(); } break;
      case 'bulk-players': {
        const lines = document.getElementById('bulk-players').value.split('\n').map((l) => l.split(/[,\t]/).map((x) => x.trim())).filter((x) => x[1]);
        lines.forEach(([number, name, position]) => DB.data.players.push({ id: DB.uid(), number, name, position: POSITIONS.includes((position || '').toUpperCase()) ? position.toUpperCase() : 'MC' }));
        DB.save(); render(); toast(`${lines.length}人を追加しました`); break;
      }
      case 'fm-paste-toggle': { const p = document.getElementById('fm-paste'); p.hidden = !p.hidden; break; }
      case 'fm-parse': fmPreview(FMI.parse(document.getElementById('fm-text').value)); break;
      case 'fm-apply': fmApply(); break;
      case 'fm-cancel': fmPending = null; document.getElementById('fm-preview').innerHTML = ''; break;
      case 'sync-now': Sync.syncNow().then(() => render()); break;
      case 'sync-toggle-auto': Sync.setAuto(Sync.config.auto === false); render(); break;
      case 'sync-disconnect':
        if (confirm('クラウドとの接続を解除し、このブラウザからトークンを削除します（この端末とクラウドのデータはどちらも残ります）。')) { Sync.disconnect(); render(); }
        break;
      case 'export': download(`fm-data-${today()}.json`, DB.exportJSON(), 'application/json'); break;
      case 'export-csv': download(`fm-matches-${today()}.csv`, matchesCSV(), 'text/csv'); break;
      case 'sample':
        if (DB.data.matches.length && !confirm('現在のデータをサンプルデータで置き換えます。よろしいですか？')) return;
        DB.replaceAll(sampleData()); updateBrand(); go('#/'); render(); toast('サンプルデータを読み込みました'); break;
      case 'reset':
        if (confirm('全データを削除します。この操作は取り消せません。')) { DB.reset(); updateBrand(); go('#/'); render(); }
        break;
    }
  });

  app.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.filter) {
      const q = query();
      q[t.dataset.filter] = t.value;
      const base = location.hash.split('?')[0];
      const qs = Object.keys(q).filter((k) => q[k]).map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&');
      go(base + (qs ? '?' + qs : ''));
    }
    if (t.dataset.player) {
      const p = DB.get('players', t.dataset.player);
      if (p) { p[t.dataset.field] = t.value.trim(); DB.save(); }
    }
  });

  function updateBrand() {
    document.getElementById('brand-club').textContent = DB.data.settings.clubName || '';
  }

  window.addEventListener('hashchange', render);
  // 他の端末での更新を取り込む（タブに戻ってきたとき）
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Sync.config) Sync.syncNow(); });
  window.addEventListener('online', () => Sync.config && Sync.syncNow());
  window.addEventListener('beforeunload', (e) => { if (Sync.pending && Sync.config && Sync.config.auto !== false) { Sync.syncNow(); e.preventDefault(); e.returnValue = ''; } });
  document.getElementById('sync-indicator').addEventListener('click', () => go('#/settings'));
  updateBrand();
  render();
  updateSyncIndicator();
  if (Sync.config) Sync.syncNow();
})();
