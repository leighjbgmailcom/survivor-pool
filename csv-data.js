/* Spreadsheet mode: builds the whole pool (standings, picks, points) from the CSV files in /data.
   Scoring mirrors supabase/schema.sql so the two modes always agree. */
window.loadCsvPool = async function (base) {
  const warnings = [];

  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.some((c) => c.trim() !== '')).map((r, i) => {
      const o = { _line: i + 2 }; head.forEach((h, j) => (o[h] = (r[j] ?? '').trim())); return o;
    });
  }
  async function get(name) {
    const res = await fetch(base + name + '?t=' + Date.now());
    if (!res.ok) throw new Error(`${base}${name} not found`);
    return parseCsv(await res.text());
  }
  const yes = (v) => /^(y|yes|true|x|1)$/i.test(v || '');
  const int = (v) => (v === '' || v == null || isNaN(+v) ? null : parseInt(v, 10));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

  const [setRows, castRows, epRows, catRows, evRows, playerRows] = await Promise.all(
    ['settings.csv', 'castaways.csv', 'episodes.csv', 'scoring.csv', 'events.csv', 'players.csv'].map(get));

  // settings
  const kv = Object.fromEntries(setRows.map((r) => [norm(r.setting), r.value]));
  const settings = {
    pool_name: kv.poolname || 'Survivor Fantasy Pool', season: int(kv.season) || '', entry_fee: +kv.entryfee || 0,
    etransfer_email: kv.etransferemail || null, commissioner_name: kv.commissioner || null,
    picks_deadline: kv.picksdeadline || new Date(0).toISOString(), first_scoring_episode: int(kv.firstscoringepisode) || 1,
    picks_per_tribe: int(kv.pickspertribe) || 4, max_tribe_size: int(kv.maxtribesize) || 8,
    merge_episode: int(kv.mergeepisode), merge_window_open: false,
    // 'entered' = every point (survival + finale placings) is a row in events.csv, the way Mark scores; 'auto' = site adds them
    auto_points: norm(kv.survivalpoints) === 'auto', announcement: kv.announcement || null,
  };

  // castaways & tribes
  const tribes = []; const colors = {};
  Object.keys(kv).filter((k) => k.startsWith('tribecolor')).forEach((k) => (colors[k.slice(10)] = kv[k]));
  const castaways = castRows.map((r, i) => {
    if (!tribes.find((t) => t.name === r.tribe)) tribes.push({ name: r.tribe, color: colors[norm(r.tribe)] || ['#E8B820', '#7B4BB7', '#2B8A6E', '#C4521F'][tribes.length % 4], sort: tribes.length });
    const fin = norm(r.finish); const place = { '1': 1, winner: 1, '1st': 1, '2': 2, '2nd': 2, '3': 3, '3rd': 3 }[fin] || null;
    return { id: i + 1, name: r.name, tribe: r.tribe, eliminated_episode: int(r.out_episode), finish_place: place, sort: i, aliases: (r.aliases || '').split(';') };
  });
  const byName = {};
  castaways.forEach((c) => [c.name, ...c.aliases].filter(Boolean).forEach((n) => (byName[norm(n)] = c)));
  const findC = (name, where) => { if (!name) return null; const c = byName[norm(name)]; if (!c) warnings.push(`${where}: no castaway called "${name}"`); return c || null; };

  const episodes = epRows.map((r) => ({ number: int(r.episode), air_date: r.air_date || null, is_post_merge: yes(r.post_merge), is_scored: yes(r.published) })).filter((e) => e.number != null).sort((a, b) => a.number - b.number);
  const categories = catRows.map((r, i) => ({ id: i + 1, label: r.event, points: int(r.points) || 0, sort: i }));
  const catByName = Object.fromEntries(categories.map((c) => [norm(c.label), c]));

  const events = []; const seen = new Set();
  evRows.forEach((r) => {
    const where = `events.csv line ${r._line}`;
    const c = findC(r.castaway, where); const k = catByName[norm(r.event)]; const ep = int(r.episode);
    if (!k) warnings.push(`${where}: "${r.event}" isn't in scoring.csv`);
    if (ep == null) warnings.push(`${where}: missing episode number`);
    if (!c || !k || ep == null) return;
    const key = `${ep}|${c.id}|${k.id}`; if (seen.has(key)) return; // once per category per castaway per week
    seen.add(key); events.push({ episode: ep, castaway_id: c.id, category_id: k.id });
  });

  // points per castaway per published episode
  const cep = [];
  episodes.filter((e) => e.is_scored && e.number >= settings.first_scoring_episode).forEach((e) => {
    castaways.forEach((c) => {
      const mine = events.filter((v) => v.castaway_id === c.id && v.episode === e.number);
      const bonus = mine.reduce((s, v) => s + categories[v.category_id - 1].points, 0);
      if (!settings.auto_points) { if (mine.length || c.eliminated_episode == null || c.eliminated_episode >= e.number) cep.push({ castaway_id: c.id, episode: e.number, survival: 0, bonus }); return; }
      if (c.eliminated_episode != null && c.eliminated_episode < e.number) return;
      const survival = c.eliminated_episode == null || c.eliminated_episode > e.number ? (e.is_post_merge ? 3 : 1) : 0;
      cep.push({ castaway_id: c.id, episode: e.number, survival, bonus });
    });
  });
  const pts = (cid, from, to) => cep.filter((r) => r.castaway_id === cid && r.episode >= from && (to == null || r.episode <= to)).reduce((s, r) => s + r.survival + r.bonus, 0);

  // players & picks
  const picks = []; const board = []; const weekly = [];
  const lastEp = Math.max(0, ...cep.map((r) => r.episode));
  playerRows.forEach((r, i) => {
    const where = `players.csv line ${r._line} (${r.player || 'no name'})`;
    if (!r.player) { warnings.push(`${where}: missing player name`); return; }
    const id = 'p' + i;
    const names = Object.keys(r).filter((k) => /^pick\d+$/.test(k)).sort((a, b) => +a.slice(4) - +b.slice(4)).map((k) => r[k]).filter(Boolean);
    const chosen = [];
    names.forEach((n) => { const c = findC(n, where); if (c && !chosen.includes(c)) chosen.push(c); });
    const mvp = findC(r.mvp, where + ' MVP');
    if (mvp && !chosen.includes(mvp)) warnings.push(`${where}: MVP ${mvp.name} isn't one of their picks`);
    tribes.forEach((t) => { const n = chosen.filter((c) => c.tribe === t.name).length; if (chosen.length && n !== settings.picks_per_tribe) warnings.push(`${where}: has ${n} ${t.name} picks (should be ${settings.picks_per_tribe})`); });

    const mine = chosen.map((c) => ({ c, is_mvp: mvp === c, kind: 'original', start: settings.first_scoring_episode, end: null }));
    if (r.merge_pick) {
      const m = findC(r.merge_pick, where + ' merge pick');
      if (settings.merge_episode == null) warnings.push(`${where}: has a merge pick but "Merge episode" isn't set in settings.csv`);
      else if (m && chosen.includes(m)) warnings.push(`${where}: merge pick ${m.name} is already on their tribe`);
      else if (m) {
        if (r.swap_out) {
          const d = findC(r.swap_out, where + ' swap out'); const o = mine.find((p) => p.c === d);
          if (o) o.end = settings.merge_episode; else if (d) warnings.push(`${where}: can't swap out ${d.name}, not on their tribe`);
        }
        mine.push({ c: m, is_mvp: false, kind: 'merge', start: settings.merge_episode + 1, end: null });
      }
    }

    let total = 0; const wk = {};
    mine.forEach((p) => {
      const weeklyPts = pts(p.c.id, p.start, p.end);
      const finale = settings.auto_points && p.end == null ? ({ 1: 30, 2: 20, 3: 10 }[p.c.finish_place] || 0) : 0;
      const mvpBonus = p.is_mvp && p.c.finish_place === 1 ? 30 : 0;
      total += weeklyPts + finale + mvpBonus;
      cep.filter((x) => x.castaway_id === p.c.id && x.episode >= p.start && (p.end == null || x.episode <= p.end)).forEach((x) => (wk[x.episode] = (wk[x.episode] || 0) + x.survival + x.bonus));
      picks.push({ entry_id: id, display_name: r.player, castaway_id: p.c.id, castaway: p.c.name, tribe: p.c.tribe, is_mvp: p.is_mvp, kind: p.kind,
        start_episode: p.start, end_episode: p.end, eliminated_episode: p.c.eliminated_episode, points: weeklyPts + finale + mvpBonus });
    });
    Object.entries(wk).forEach(([e, v]) => weekly.push({ entry_id: id, episode: +e, points: v }));
    board.push({ entry_id: id, display_name: r.player, paid: yes(r.paid), total, last_episode: lastEp || null, last_episode_points: wk[lastEp] || 0,
      still_in: mine.filter((p) => p.end == null && p.c.eliminated_episode == null).length, mvp: mvp?.name || null });
  });
  board.sort((a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name));
  const kindOrder = { original: 0, merge: 1 };
  picks.sort((a, b) => a.display_name.localeCompare(b.display_name) || kindOrder[a.kind] - kindOrder[b.kind] || a.tribe.localeCompare(b.tribe) || a.castaway.localeCompare(b.castaway));

  return { settings, tribes, castaways, episodes, categories, events, cep, board, weekly, picks, me: null, isAdmin: false, warnings, entries: board.map((b) => ({ id: b.entry_id, paid: b.paid })) };
};
