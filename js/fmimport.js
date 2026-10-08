/* Football Manager の「印刷」出力（Web ページ / テキスト）からの取り込み（DOM 非依存の純粋関数）
 * FM のセーブデータ（.fm）は独自の圧縮形式のため直接は読めない。
 * FM で表示中の画面を Ctrl+P（Mac: ⌘+P）→「Web ページ」または「テキストファイル」で保存したものを解析する。 */
(function (root) {
  'use strict';

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : all;
    });
  }
  function cellText(html) {
    return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  }

  /** HTML の <table> を { headers, rows } の配列に変換 */
  function parseHTMLTables(html) {
    const tables = [];
    const tableRe = /<table[\s\S]*?<\/table>/gi;
    let t;
    while ((t = tableRe.exec(html))) {
      const rows = [];
      const trRe = /<tr[\s\S]*?(?=<tr|<\/table)/gi;
      let tr;
      while ((tr = trRe.exec(t[0]))) {
        const cells = [];
        const cellRe = /<t([hd])[^>]*>([\s\S]*?)(?=<t[hd][\s>]|<\/tr|$)/gi;
        let c;
        while ((c = cellRe.exec(tr[0]))) cells.push(cellText(c[2].replace(/<\/t[hd]>\s*$/i, '')));
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length >= 2) tables.push({ headers: rows[0], rows: rows.slice(1) });
    }
    return tables;
  }

  /** FM のテキスト出力（| 区切り）や CSV / TSV を { headers, rows } に変換 */
  function parseDelimited(text) {
    if (/^\s*\{\\rtf/.test(text)) {
      text = text.replace(/\\par[d]?\b ?/g, '\n').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^[\s|\-=+_]+$/.test(l));
    if (!lines.length) return [];
    const sep = lines.filter((l) => l.includes('|')).length >= 2 ? '|' : lines[0].includes('\t') ? '\t' : ',';
    const split = (l) => {
      let cells;
      if (sep === ',') {
        cells = [];
        let cur = '', q = false;
        for (let i = 0; i < l.length; i++) {
          const ch = l[i];
          if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
          else if (ch === '"') q = true;
          else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
        }
        cells.push(cur);
      } else {
        cells = l.split(sep);
        if (sep === '|') { if (!cells[0].trim()) cells.shift(); if (cells.length && !cells[cells.length - 1].trim()) cells.pop(); }
      }
      return cells.map((x) => x.replace(/^﻿/, '').trim());
    };
    const rows = lines.filter((l) => sep !== '|' || l.includes('|')).map(split);
    // 見出し行: 既知の列名を最も多く含む行（タイトル行などをスキップ）
    let hi = 0, best = -1;
    rows.slice(0, 10).forEach((r, i) => {
      const score = r.filter((c) => findKey(c) !== null).length;
      if (score > best) { best = score; hi = i; }
    });
    return rows.length - hi >= 2 ? [{ headers: rows[hi], rows: rows.slice(hi + 1) }] : [];
  }

  function parseTables(text) {
    text = String(text || '');
    return /<table/i.test(text) ? parseHTMLTables(text) : parseDelimited(text);
  }

  /* ---------- 列名の対応表（英語版 FM と日本語化の両方） ---------- */
  const COLUMNS = {
    name: ['name', 'player', '名前', '選手', '選手名'],
    number: ['no.', 'no', 'num', 'number', 'shirt no.', 'squad number', '背番号', '番号', '#'],
    position: ['position', 'pos', 'best pos', 'ポジション'],
    apps: ['apps', 'appearances', 'app', '出場', '出場数', '試合'],
    starts: ['starts', '先発'],
    goals: ['gls', 'goals', 'gl', '得点', 'ゴール'],
    assists: ['ast', 'assists', 'asts', 'アシスト'],
    avgRating: ['av rat', 'avr', 'av. rat', 'average rating', 'rating', '平均評価', '平均レーティング', '評価'],
    minutes: ['mins', 'minutes', 'min', '出場時間'],
    pom: ['pom', 'player of the match', 'mom', 'mvp'],
    yellow: ['yel', 'yellow', 'yellow cards', '警告', 'イエロー'],
    red: ['red', 'red cards', '退場', 'レッド'],
    xg: ['xg'],
    date: ['date', '日付', '日時'],
    opponent: ['opposition', 'opponent', 'opponents', 'against', 'vs', '対戦相手', '相手'],
    venue: ['venue', 'h/a', 'ha', 'ground', '会場', 'ホーム/アウェイ'],
    competition: ['competition', 'comp', 'comp.', 'tournament', '大会', '大会名'],
    result: ['result', 'score', 'res', '結果', 'スコア'],
  };
  const LOOKUP = {};
  Object.keys(COLUMNS).forEach((k) => COLUMNS[k].forEach((a) => { LOOKUP[a] = k; }));
  function findKey(header) {
    const h = String(header || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return LOOKUP[h] || null;
  }
  function columnIndex(headers) {
    const idx = {};
    headers.forEach((h, i) => { const k = findKey(h); if (k && idx[k] === undefined) idx[k] = i; });
    return idx;
  }

  /** 表の種類を判定: 'squad'（選手一覧）/ 'fixtures'（日程・結果）/ null */
  function detect(table) {
    const idx = columnIndex(table.headers);
    if (idx.name !== undefined) return 'squad';
    if (idx.date !== undefined && idx.opponent !== undefined) return 'fixtures';
    return null;
  }

  /* ---------- 値の変換 ---------- */
  function num(v) {
    const s = String(v === undefined || v === null ? '' : v).replace(/,/g, '').replace(/%$/, '').trim();
    if (!s || s === '-') return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  /** FM の出場数「30 (2)」= 先発30 + 途中出場2 */
  function apps(v) {
    const m = String(v || '').match(/^\s*(\d+)\s*(?:\((\d+)\))?/);
    if (!m) return null;
    return { total: parseInt(m[1], 10) + (m[2] ? parseInt(m[2], 10) : 0), starts: parseInt(m[1], 10), subs: m[2] ? parseInt(m[2], 10) : 0 };
  }

  const KNOWN_POS = ['GK', 'DR', 'DC', 'DL', 'WBR', 'WBL', 'DM', 'MR', 'MC', 'ML', 'AMR', 'AMC', 'AML', 'ST'];
  /** FM の表記「D (RC)」「AM (RL), ST (C)」→ アプリのポジション（先頭のもの、C を優先） */
  function position(v) {
    const s = String(v || '').toUpperCase().trim();
    if (KNOWN_POS.includes(s)) return s;
    const m = s.match(/^(GK|DM|D|WB|AM|M|ST)\s*(?:\/\s*[A-Z]+\s*)*(?:\(([RLC]+)\))?/);
    if (!m) return '';
    const base = m[1];
    if (base === 'GK' || base === 'DM' || base === 'ST') return base;
    const sides = m[2] || 'C';
    const side = sides.includes('C') && base !== 'WB' ? 'C' : sides[0] === 'C' ? 'R' : sides[0];
    return base + side;
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const pad = (n) => String(n).padStart(2, '0');
  /** 「Sat 8 Aug 2026」「08/08/2026」「2026/8/8」「2026年8月8日」などを YYYY-MM-DD に */
  function date(v) {
    const s = String(v || '').trim();
    let m = s.match(/(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i);
    if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
    m = s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
    if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`;
    m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
    if (m) {
      // 日/月/年（FM の標準）。先頭が 12 より大きくない場合も日/月とみなす
      let d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
      return `${m[3]}-${pad(mo)}-${pad(d)}`;
    }
    return '';
  }

  function venue(v, opponent) {
    const s = String(v || '').trim().toLowerCase();
    if (/^(h|home|ホーム)$/.test(s)) return 'H';
    if (/^(a|away|アウェイ|アウェー)$/.test(s)) return 'A';
    if (/^(n|neutral|中立)/.test(s)) return 'N';
    const o = String(opponent || '');
    if (/\((h)\)\s*$/i.test(o)) return 'H';
    if (/\((a)\)\s*$/i.test(o)) return 'A';
    if (/\((n)\)\s*$/i.test(o)) return 'N';
    return '';
  }

  /** 「W 2-1」「2-1 L」「1 - 1」「2-1 (aet)」など → 自チーム視点のスコア */
  function score(v) {
    const s = String(v || '');
    const m = s.match(/(\d+)\s*[-–:]\s*(\d+)/);
    if (!m) return null;
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    const r = (s.match(/(?:^|[\s(])([WDL勝分敗負])(?=$|[\s)\d])/i) || [])[1];
    const res = r ? ({ w: 'W', d: 'D', l: 'L', 勝: 'W', 分: 'D', 敗: 'L', 負: 'L' })[r.toLowerCase()] : '';
    if ((res === 'W' && a < b) || (res === 'L' && a > b)) [a, b] = [b, a];
    return { goalsFor: a, goalsAgainst: b };
  }

  /* ---------- 表 → データ ---------- */
  function toPlayers(table) {
    const idx = columnIndex(table.headers);
    const get = (row, k) => (idx[k] === undefined ? '' : row[idx[k]] || '');
    return table.rows.map((row) => {
      const name = get(row, 'name').replace(/\s*-\s*Pick Player.*$/i, '').trim();
      if (!name) return null;
      const fm = {};
      const a = apps(get(row, 'apps'));
      if (a) { fm.apps = a.total; fm.starts = a.starts; fm.subs = a.subs; }
      ['goals', 'assists', 'avgRating', 'minutes', 'pom', 'yellow', 'red', 'xg'].forEach((k) => {
        const n = num(get(row, k));
        if (n !== null) fm[k] = n;
      });
      return { name, number: (get(row, 'number').match(/\d+/) || [''])[0], position: position(get(row, 'position')), fm };
    }).filter(Boolean);
  }

  function toMatches(table) {
    const idx = columnIndex(table.headers);
    const get = (row, k) => (idx[k] === undefined ? '' : row[idx[k]] || '');
    return table.rows.map((row) => {
      const d = date(get(row, 'date'));
      const sc = score(get(row, 'result'));
      const rawOpp = get(row, 'opponent');
      const opponent = rawOpp.replace(/\s*\((h|a|n)\)\s*$/i, '').trim();
      if (!d || !sc || !opponent) return null; // 未消化の試合は対象外
      return { date: d, competition: get(row, 'competition'), opponent, venue: venue(get(row, 'venue'), rawOpp) || 'H',
        goalsFor: sc.goalsFor, goalsAgainst: sc.goalsAgainst };
    }).filter(Boolean);
  }

  /** テキスト全体を解析して { players, matches } を返す（複数の表があればまとめる） */
  function parse(text) {
    const out = { players: [], matches: [] };
    parseTables(text).forEach((t) => {
      const kind = detect(t);
      if (kind === 'squad') out.players = out.players.concat(toPlayers(t));
      else if (kind === 'fixtures') out.matches = out.matches.concat(toMatches(t));
    });
    return out;
  }

  /* ---------- 既存データへの反映 ---------- */
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  /** 名前で照合し、既存選手は背番号・ポジション・FM 成績を更新、新しい選手は追加する */
  function mergePlayers(players, imported, uid, importedAt) {
    let added = 0, updated = 0;
    imported.forEach((ip) => {
      let p = players.find((x) => norm(x.name) === norm(ip.name));
      if (!p) { p = { id: uid(), name: ip.name, number: '', position: 'MC' }; players.push(p); added++; } else updated++;
      if (ip.number) p.number = ip.number;
      if (ip.position) p.position = ip.position;
      if (Object.keys(ip.fm).length) p.fm = Object.assign({}, ip.fm, { importedAt });
    });
    return { added, updated };
  }

  /** 日付と対戦相手で照合し、既存の試合はスコア等を更新（スタッツやメモは保持）、新しい試合は追加する */
  function mergeMatches(matches, imported, uid, season) {
    let added = 0, updated = 0;
    imported.forEach((im) => {
      const m = matches.find((x) => x.date === im.date && norm(x.opponent) === norm(im.opponent));
      if (m) {
        Object.assign(m, { goalsFor: im.goalsFor, goalsAgainst: im.goalsAgainst, venue: im.venue });
        if (im.competition && !m.competition) m.competition = im.competition;
        updated++;
      } else {
        matches.push(Object.assign({ id: uid(), season: season || '', formation: '', opponentFormation: '', tactic: '',
          stats: {}, goals: [], ratings: [], notes: '', source: 'fm' }, im));
        added++;
      }
    });
    return { added, updated };
  }

  const api = { parse, parseTables, detect, toPlayers, toMatches, mergePlayers, mergeMatches, position, date, score, apps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FMImport = api;
})(this);
