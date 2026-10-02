/* Survivor Fantasy Pool — front end (vanilla JS + supabase-js) */
(() => {
  const cfg = window.POOL_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => new Date(d).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // No Supabase configured yet → "spreadsheet mode": read-only site built from the CSV files in /data
  const CSV = !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR_');
  const params = new URLSearchParams(location.search);
  const sb = CSV ? null : window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);

  const S = { tab: location.hash.slice(1) || 'standings', open: new Set(), openCast: new Set(), adminEp: null };
  try { S.csvMe = localStorage.getItem('pool-me') || ''; } catch { S.csvMe = ''; }

  function toast(text, err = false) {
    const t = $('#toast'); t.textContent = text; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
  }
  const errMsg = (e) => (e && (e.message || e.error_description)) || String(e);
  async function q(p) { const { data, error } = await p; if (error) throw error; return data; }

  // ---------------- Auth ----------------
  async function boot() {
    if (CSV) {
      $('#tabs').hidden = false;
      $('[data-tab=mytribe]').textContent = 'Find my tribe';
      try { await load(); } catch (e) { return; }
      go(S.tab); return;
    }
    sb.auth.onAuthStateChange((evt, session) => {
      if (evt === 'PASSWORD_RECOVERY') { showOnly('reset'); return; }
      if (evt === 'SIGNED_IN' || evt === 'SIGNED_OUT') render(session);
    });
    const { data } = await sb.auth.getSession();
    render(data.session);
  }

  function showOnly(id) {
    ['login', 'reset', ...$$('.tab').map((s) => s.id)].forEach((x) => ($('#' + x).hidden = x !== id));
  }

  async function render(session) {
    S.session = session;
    if (!session) {
      $('#tabs').hidden = true; $('#who').innerHTML = ''; $('#announce').hidden = true;
      showOnly('login'); return;
    }
    if (!$('#reset').hidden) return;
    $('#who').innerHTML = `<span>${esc(session.user.email)}</span><button class="btn small" id="logout">Sign out</button>`;
    $('#logout').onclick = () => sb.auth.signOut();
    $('#tabs').hidden = false;
    await load();
    go(S.tab);
  }

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('#login-msg'); msg.className = 'msg'; msg.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
    if (error) { msg.className = 'msg err'; msg.textContent = error.message === 'Invalid login credentials' ? 'Wrong email or password. New here? Click "Create account".' : error.message; }
    else msg.textContent = '';
  };
  $('#signup-btn').onclick = async () => {
    const msg = $('#login-msg'); const email = $('#login-email').value.trim(); const password = $('#login-pass').value;
    if (!email || password.length < 6) { msg.className = 'msg err'; msg.textContent = 'Enter your email and a password (6+ characters) first.'; return; }
    msg.className = 'msg'; msg.textContent = 'Creating account…';
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) { msg.className = 'msg err'; msg.textContent = error.message; return; }
    if (!data.session) { msg.className = 'msg ok'; msg.textContent = 'Check your email to confirm your account, then sign in.'; }
  };
  $('#forgot-btn').onclick = async () => {
    const msg = $('#login-msg'); const email = $('#login-email').value.trim();
    if (!email) { msg.className = 'msg err'; msg.textContent = 'Enter your email above first.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    msg.className = error ? 'msg err' : 'msg ok';
    msg.textContent = error ? error.message : 'If that email has an account, a reset link is on its way.';
  };
  $('#reset-form').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: $('#reset-pass').value });
    if (error) { $('#reset-msg').className = 'msg err'; $('#reset-msg').textContent = error.message; return; }
    $('#reset').hidden = true; toast('Password updated');
    const { data } = await sb.auth.getSession(); render(data.session);
  };

  // ---------------- Data ----------------
  async function load() {
    if (CSV) {
      try {
        if (!S.seasons) {
          S.seasons = await window.loadSeasons();
          const current = S.seasons.find((x) => x.status === 'current') || S.seasons[0];
          const wanted = params.get('season') || (params.has('demo') ? (S.seasons.find((x) => x.status === 'finished') || current).season : current.season);
          S.season = S.seasons.find((x) => x.season === wanted) || current;
          S.currentSeason = current;
        }
        Object.assign(S, await window.loadCsvPool(`seasons/${S.season.season}/`));
      }
      catch (e) { toast('Could not load the spreadsheets: ' + errMsg(e), true); throw e; }
      finishLoad(); return;
    }
    try {
      const [settings, tribes, castaways, episodes, categories, events, cep, board, weekly, picks, mine, isAdmin] = await Promise.all([
        q(sb.from('settings').select('*').eq('id', 1).single()),
        q(sb.from('tribes').select('*').order('sort')),
        q(sb.from('castaways').select('*').order('sort')),
        q(sb.from('episodes').select('*').order('number')),
        q(sb.from('categories').select('*').order('sort')),
        q(sb.from('events').select('*')),
        q(sb.rpc('castaway_episode_points')),
        q(sb.rpc('leaderboard')),
        q(sb.rpc('entry_weekly_points')),
        q(sb.rpc('all_picks')),
        q(sb.rpc('my_entry')),
        q(sb.rpc('is_admin')),
      ]);
      Object.assign(S, { settings, tribes, castaways, episodes, categories, events, cep, board, weekly, picks, me: mine[0] || null, isAdmin });
      if (isAdmin) S.entries = await q(sb.from('entries').select('*').order('display_name'));
    } catch (e) { toast('Could not load: ' + errMsg(e), true); throw e; }
    finishLoad();
  }

  function finishLoad() {
    S.cById = Object.fromEntries(S.castaways.map((c) => [c.id, c]));
    S.catById = Object.fromEntries(S.categories.map((c) => [c.id, c]));
    S.tribeColor = Object.fromEntries(S.tribes.map((t) => [t.name, t.color]));
    S.locked = new Date() >= new Date(S.settings.picks_deadline);
    S.scored = S.episodes.filter((e) => e.is_scored && e.number >= S.settings.first_scoring_episode);
    document.title = S.settings.pool_name;
    $('#pool-name').textContent = S.settings.pool_name;
    $('#pool-sub').textContent = `Season ${S.settings.season} · most points at the end of the season wins`;
    $('#admin-tab').hidden = !S.isAdmin;
    const past = CSV && S.season && S.currentSeason && S.season.season !== S.currentSeason.season;
    const a = $('#announce');
    const parts = [];
    if (past) parts.push(`📜 You're looking at <b>${esc(S.season.name)}</b>${S.season.status === 'finished' ? ' (finished)' : ''}. <a href="?season=${encodeURIComponent(S.currentSeason.season)}">Back to ${esc(S.currentSeason.name)} →</a>`);
    if (S.settings.announcement && !past) parts.push(esc(S.settings.announcement));
    a.hidden = !parts.length; a.innerHTML = parts.join('<br>');
    if (CSV && S.seasons) {
      $('#seasons-tab').hidden = false;
      if (S.seasons.length > 1 && !$('#season-pick')) {
        $('#who').innerHTML = `<label class="season-pick">Season <select id="season-pick">${S.seasons.map((x) => `<option value="${esc(x.season)}" ${x.season === S.season.season ? 'selected' : ''}>${esc(x.name)}${x.status === 'current' ? ' (now)' : ''}</option>`).join('')}</select></label>`;
        $('#season-pick').onchange = (e) => { location.href = `?season=${encodeURIComponent(e.target.value)}#${S.tab}`; };
      }
    }
  }

  async function reload() { await load(); go(S.tab); }

  function go(tab) {
    if (tab === 'admin' && !S.isAdmin) tab = 'standings';
    if (!$('#' + tab)?.classList.contains('tab')) tab = 'standings';
    S.tab = tab; history.replaceState(null, '', '#' + tab);
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    showOnly(tab);
    ({ standings, mytribe, castaways: castawaysTab, rules, admin, seasons: seasonsTab })[tab]();
  }
  $$('#tabs button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));

  // ---------------- Helpers ----------------
  const dot = (tribe) => `<span class="dot" style="background:${esc(S.tribeColor[tribe] || '#999')}"></span>`;
  const castawayTotal = (id) => S.cep.filter((r) => r.castaway_id === id).reduce((s, r) => s + r.survival + r.bonus, 0);
  const isOut = (c) => c.eliminated_episode != null;
  const picksFor = (entryId) => S.picks.filter((p) => p.entry_id === entryId);

  function pickChips(list) {
    return `<div class="chips">${list.map((p) => {
      const off = p.end_episode != null;
      const title = p.kind === 'merge' ? `Merge pick (from ep ${p.start_episode})` : off ? `Swapped out after ep ${p.end_episode}` : '';
      return `<span class="chip ${p.eliminated_episode != null || off ? 'out' : ''} ${p.is_mvp ? 'mvp' : ''}" title="${esc(title)}">${dot(p.tribe)}${p.is_mvp ? '⭐ ' : ''}${p.kind === 'merge' ? '➕ ' : ''}${esc(p.castaway)} <b>${p.points}</b></span>`;
    }).join('')}</div>`;
  }

  // ---------------- Standings ----------------
  function standings() {
    const el = $('#standings');
    const lastEp = S.scored.length ? S.scored[S.scored.length - 1].number : null;
    const meId = S.me?.id;

    let html = `<div class="stats">
      <div class="stat"><div class="k">Players</div><div class="v">${S.board.length}</div></div>
      <div class="stat"><div class="k">Castaways left</div><div class="v">${S.castaways.filter((c) => c.eliminated_episode == null).length}</div></div>
      <div class="stat"><div class="k">Scored through</div><div class="v">${lastEp ? 'Ep ' + lastEp : '—'}</div></div>
      <div class="stat"><div class="k">${S.locked ? 'Picks' : 'Picks due'}</div><div class="v" style="font-size:${S.locked ? 32 : 20}px">${S.locked ? 'Locked' : esc(fmtDate(S.settings.picks_deadline))}</div></div>
    </div>`;

    if (CSV && S.warnings?.length) {
      html += `<div class="card" style="border-color:var(--bad)"><h3>Spreadsheet check</h3><p class="small muted">Fix these in the CSV files on GitHub — the rows below are being ignored.</p><ul class="small">${S.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`;
    }
    if (!S.locked && CSV) {
      html += `<div class="card"><h3>Picks are open</h3><p>Email your 8 picks and MVP to ${esc(S.settings.commissioner_name || 'the commissioner')} before <b>${esc(fmtDate(S.settings.picks_deadline))}</b>.</p>
</div>`;
    } else if (!S.locked) {
      html += `<div class="card"><h3>Picks are open</h3><p>Everyone's picks stay hidden until the deadline (${esc(fmtDate(S.settings.picks_deadline))}). ${S.me ? 'Yours are in — you can still change them on <b>My Tribe</b>.' : 'Head to <b>My Tribe</b> to make yours.'}</p>
</div>`;
    }

    if (S.official?.episodes?.length) {
      const when = S.official.updated_at ? ` · updated ${esc(fmtDate(S.official.updated_at))}` : '';
      html += `<p class="small muted" style="margin:-6px 0 14px">Weekly scores come straight from the <a href="${esc(S.official.source)}" target="_blank" rel="noopener">official Global TV results</a> (episodes ${S.official.episodes.join(', ')})${when}.</p>`;
    }
    if (!S.board.length) { el.innerHTML = html + `<div class="card muted">No entries yet.${CSV && S.seasons?.some((x) => x.status === 'finished') ? ` Want to see a full season? <a href="?season=${encodeURIComponent(S.seasons.find((x) => x.status === 'finished').season)}">Look at ${esc(S.seasons.find((x) => x.status === 'finished').name)}</a>.` : ''}</div>`; return; }

    let rank = 0, prev = null;
    const rows = S.board.map((b, i) => {
      if (b.total !== prev) { rank = i + 1; prev = b.total; }
      const open = S.open.has(b.entry_id);
      const list = picksFor(b.entry_id);
      return `<tr class="click ${b.entry_id === meId ? 'me' : ''}" data-id="${b.entry_id}">
        <td class="rank ${rank === 1 && b.total > 0 ? 'r1' : ''}">${rank}</td>
        <td><b>${esc(b.display_name)}</b><div class="small muted">MVP: ${esc(b.mvp || '—')}</div></td>
        <td class="num">${b.still_in}</td>
        <td class="num">${lastEp ? (b.last_episode_points > 0 ? '+' : '') + b.last_episode_points : '—'}</td>
        <td class="num total">${b.total}</td></tr>
        ${open ? `<tr class="detail"><td></td><td colspan="4">${list.length ? pickChips(list) : '<span class="muted">Picks hidden until the deadline.</span>'}</td></tr>` : ''}`;
    }).join('');

    html += `<div class="card"><div class="scroll"><table>
      <thead><tr><th>#</th><th>Player</th><th class="num">Still in</th><th class="num">${lastEp ? 'Ep ' + lastEp : 'Last ep'}</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody></table></div><p class="small muted">Tap a player to see their tribe. ⭐ = MVP, ➕ = merge pick, struck-through = out of the game.</p></div>`;

    if (S.scored.length) {
      const wk = {}; S.weekly.forEach((w) => ((wk[w.entry_id] ||= {})[w.episode] = w.points));
      html += `<div class="card"><h3>Week by week</h3><div class="scroll"><table class="grid-pts">
        <thead><tr><th>Player</th>${S.scored.map((e) => `<th>Ep ${e.number}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${S.board.map((b) => `<tr class="${b.entry_id === meId ? 'me' : ''}"><td>${esc(b.display_name)}</td>${S.scored.map((e) => { const v = wk[b.entry_id]?.[e.number] || 0; return `<td class="${v ? '' : 'zero'}">${v}</td>`; }).join('')}<td><b>${b.total}</b></td></tr>`).join('')}</tbody>
      </table></div><p class="small muted">Weekly columns don\'t include the MVP bonus, which is added to the total at the finale.</p></div>`;
    }
    el.innerHTML = html;
    $$('tr.click', el).forEach((tr) => (tr.onclick = () => { const id = tr.dataset.id; S.open.has(id) ? S.open.delete(id) : S.open.add(id); standings(); }));
  }

  // ---------------- Picker (shared by players and admin) ----------------
  function picker(container, { selected = [], mvp = null, name = '', email = null, submitLabel, onSubmit }) {
    const sel = new Set(selected); let star = mvp;
    const per = S.settings.picks_per_tribe;
    const draw = () => {
      const counts = Object.fromEntries(S.tribes.map((t) => [t.name, S.castaways.filter((c) => c.tribe === t.name && sel.has(c.id)).length]));
      const ready = S.tribes.every((t) => counts[t.name] === per) && star && sel.has(star);
      container.innerHTML = `
        ${email !== null ? `<label>Player email <input id="pk-email" type="email" value="${esc(email)}" required></label>` : ''}
        <label>Display name (shown on the leaderboard) <input id="pk-name" maxlength="40" value="${esc(name)}" required></label>
        <p class="muted small">Choose <b>${per}</b> castaways from each tribe, then tap ☆ to make one of them your MVP.</p>
        <div class="tribes">${S.tribes.map((t) => `
          <div><div class="tribe-head" style="border-color:${esc(t.color)}"><h3 style="margin:0">${esc(t.name)}</h3><span class="pill ${counts[t.name] === per ? 'good' : ''}">${counts[t.name]} / ${per}</span></div>
          ${S.castaways.filter((c) => c.tribe === t.name).map((c) => `
            <div class="pick ${sel.has(c.id) ? 'sel' : ''} ${isOut(c) ? 'out' : ''}" data-id="${c.id}">
              <span><input type="checkbox" tabindex="-1" ${sel.has(c.id) ? 'checked' : ''}>${esc(c.name)}${isOut(c) ? ` <span class="pill bad">out ep ${c.eliminated_episode}</span>` : ''}</span>
              <button type="button" class="star ${star === c.id ? 'on' : ''}" data-star="${c.id}" ${sel.has(c.id) ? '' : 'disabled'} title="Make MVP">${star === c.id ? '⭐' : '☆'}</button>
            </div>`).join('')}</div>`).join('')}
        </div>
        <div class="sticky-bar row"><button class="btn primary" id="pk-go" ${ready ? '' : 'disabled'}>${esc(submitLabel)}</button>
          <span class="small muted">${ready ? 'MVP: ' + esc(S.cById[star].name) : !star || !sel.has(star) ? 'Pick your MVP (☆)' : 'Finish your picks'}</span></div>
        <p class="msg" id="pk-msg"></p>`;
      $$('.pick', container).forEach((d) => (d.onclick = (e) => {
        if (e.target.closest('.star')) return;
        const id = +d.dataset.id; const c = S.cById[id];
        if (sel.has(id)) { sel.delete(id); if (star === id) star = null; }
        else { if (counts[c.tribe] >= per) { toast(`You already have ${per} from ${c.tribe}. Unpick one first.`); return; } sel.add(id); }
        keep(); draw();
      }));
      $$('.star', container).forEach((b) => (b.onclick = () => { star = +b.dataset.star; keep(); draw(); }));
      $('#pk-go', container).onclick = async () => {
        const btn = $('#pk-go', container); btn.disabled = true;
        try { await onSubmit({ name: $('#pk-name', container).value.trim(), email: email !== null ? $('#pk-email', container).value.trim() : null, ids: [...sel], mvp: star }); }
        catch (e) { $('#pk-msg', container).className = 'msg err'; $('#pk-msg', container).textContent = errMsg(e); btn.disabled = false; }
      };
    };
    const keep = () => { name = $('#pk-name', container)?.value ?? name; if (email !== null) email = $('#pk-email', container)?.value ?? email; };
    draw();
  }

  // ---------------- My Tribe ----------------
  function mytribe() {
    const el = $('#mytribe');
    if (CSV) {
      const pick = S.csvMe || '';
      if (!S.board.length) { el.innerHTML = '<div class="card muted">No players yet.</div>'; return; }
      S.me = S.board.find((b) => b.entry_id === pick) ? { id: pick, display_name: S.board.find((b) => b.entry_id === pick).display_name } : null;
      const sel = `<div class="card"><label>Whose tribe? <select id="csv-me"><option value="">— choose a player —</option>${S.board.map((b) => `<option value="${b.entry_id}" ${b.entry_id === pick ? 'selected' : ''}>${esc(b.display_name)}</option>`).join('')}</select></label></div>`;
      if (!S.me) { el.innerHTML = sel; } else { lockedTribe(el, picksFor(S.me.id)); el.insertAdjacentHTML('afterbegin', sel); }
      $('#csv-me').onchange = (e) => { S.csvMe = e.target.value; try { localStorage.setItem('pool-me', S.csvMe); } catch {} mytribe(); };
      return;
    }
    const mine = S.me ? picksFor(S.me.id) : [];
    if (!S.locked) {
      el.innerHTML = `<div class="card"><h2>${S.me ? 'Your picks' : 'Make your picks'}</h2>
        <p class="muted">Deadline: <b>${esc(fmtDate(S.settings.picks_deadline))}</b>. You can change your picks until then.</p>
        <div id="pk"></div></div>`;
      const orig = mine.filter((p) => p.kind === 'original');
      picker($('#pk'), {
        selected: orig.map((p) => p.castaway_id), mvp: orig.find((p) => p.is_mvp)?.castaway_id || null,
        name: S.me?.display_name || '', submitLabel: S.me ? 'Update my picks' : 'Lock in my picks',
        onSubmit: async ({ name, ids, mvp }) => { await q(sb.rpc('submit_picks', { p_display_name: name, p_castaways: ids, p_mvp: mvp })); toast('Picks saved! 🔥'); await reload(); },
      });
      return;
    }
    if (!S.me) {
      el.innerHTML = `<div class="card"><h2>No entry found</h2><p>Picks are locked and there's no entry under <b>${esc(S.session.user.email)}</b>.
        If you emailed your picks to ${esc(S.settings.commissioner_name || 'the commissioner')}, ask them to add you with this email address.</p></div>`;
      return;
    }
    lockedTribe(el, mine);
  }

  function lockedTribe(el, mine) {
    const row = S.board.find((b) => b.entry_id === S.me.id);
    const rank = row ? S.board.filter((b) => b.total > row.total).length + 1 : '—';
    let html = `<div class="stats">
      <div class="stat"><div class="k">Rank</div><div class="v">${rank} <span class="small muted">of ${S.board.length}</span></div></div>
      <div class="stat"><div class="k">Total</div><div class="v">${row?.total ?? 0}</div></div>
      <div class="stat"><div class="k">Still in</div><div class="v">${row?.still_in ?? 0}</div></div>
      <div class="stat"><div class="k">MVP</div><div class="v" style="font-size:24px">${esc(row?.mvp || '—')}</div></div></div>`;

    html += `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(S.me.display_name)}'s tribe</h2>
      ${CSV ? '' : '<button class="btn small" id="rename">Rename</button>'}</div>
      <div class="scroll"><table class="grid-pts" style="margin-top:10px"><thead><tr><th>Castaway</th>${S.scored.map((e) => `<th>Ep ${e.number}</th>`).join('')}<th>Pts</th></tr></thead><tbody>
      ${mine.map((p) => `<tr><td>${dot(p.tribe)} ${p.is_mvp ? '⭐ ' : ''}${p.kind === 'merge' ? '➕ ' : ''}${esc(p.castaway)}
        ${p.eliminated_episode != null ? ` <span class="pill bad">out ep ${p.eliminated_episode}</span>` : ''}${p.end_episode != null ? ` <span class="pill">swapped after ep ${p.end_episode}</span>` : ''}</td>
        ${S.scored.map((e) => { const inRange = e.number >= p.start_episode && (p.end_episode == null || e.number <= p.end_episode); const r = S.cep.find((x) => x.castaway_id === p.castaway_id && x.episode === e.number); const v = inRange && r ? r.survival + r.bonus : 0; return `<td class="${v ? '' : 'zero'}" title="${esc(eventTitle(p.castaway_id, e.number))}">${inRange && r ? v : '·'}</td>`; }).join('')}
        <td><b>${p.points}</b></td></tr>`).join('')}
      </tbody></table></div><p class="small muted">Hover or tap a number to see what they scored for.</p></div>`;

    if (!CSV) html += mergePanel(mine);
    el.innerHTML = html;
    if (CSV) return;
    $('#rename').onclick = async () => {
      const n = prompt('Display name', S.me.display_name); if (!n) return;
      try { await q(sb.rpc('set_display_name', { p_display_name: n })); await reload(); } catch (e) { toast(errMsg(e), true); }
    };
    wireMerge(el, mine, (add, drop) => q(sb.rpc('submit_merge_pick', { p_add: add, p_drop: drop })));
  }

  function eventTitle(cid, ep) {
    const r = S.cep.find((x) => x.castaway_id === cid && x.episode === ep); if (!r) return '';
    const lines = [];
    if (r.survival) lines.push(`Survived: ${r.survival}`);
    S.events.filter((e) => e.castaway_id === cid && e.episode === ep).forEach((e) => { const c = S.catById[e.category_id]; lines.push(`${c.label}: ${c.points}`); });
    if (r.official) lines.push(`Global TV total: ${r.bonus}`);
    return lines.join('\n');
  }

  function mergePanel(mine) {
    const s = S.settings;
    if (!s.merge_window_open || s.merge_episode == null) return '';
    const current = mine.find((p) => p.kind === 'merge');
    const swapped = mine.find((p) => p.kind === 'original' && p.end_episode === s.merge_episode);
    const alive = mine.filter((p) => p.kind === 'original' && p.eliminated_episode == null).length;
    const mustSwap = alive >= s.max_tribe_size;
    const onTribe = new Set(mine.filter((p) => p.kind === 'original').map((p) => p.castaway_id));
    const avail = S.castaways.filter((c) => !isOut(c) && !onTribe.has(c.id));
    return `<div class="card" id="merge"><h3>Merge bonus pick</h3>
      <p>Add one castaway still in the game. Their points start from episode ${s.merge_episode + 1}.
      ${mustSwap ? `All ${s.max_tribe_size} of your picks are still in, so you can <b>swap</b> one out (you keep the points they've already earned) — or keep your tribe as is.` : ''}</p>
      ${current ? `<p>Current choice: <b>${esc(current.castaway)}</b>${swapped ? ` replacing <b>${esc(swapped.castaway)}</b>` : ''}. You can change it while the window is open.</p>` : ''}
      <div class="row">
        <label>Add <select id="m-add"><option value="">— choose —</option>${avail.map((c) => `<option value="${c.id}" ${current?.castaway_id === c.id ? 'selected' : ''}>${esc(c.name)} (${esc(c.tribe)})</option>`).join('')}</select></label>
        ${mustSwap ? `<label>Swap out <select id="m-drop"><option value="">— choose —</option>${mine.filter((p) => p.kind === 'original' && p.eliminated_episode == null).map((p) => `<option value="${p.castaway_id}" ${swapped?.castaway_id === p.castaway_id ? 'selected' : ''}>${esc(p.castaway)}</option>`).join('')}</select></label>` : ''}
      </div>
      <div class="row"><button class="btn primary" id="m-go">Save merge pick</button>${current ? '<button class="btn danger" id="m-clear">Remove merge pick</button>' : ''}</div></div>`;
  }

  function wireMerge(el, mine, call) {
    const go = $('#m-go', el); if (!go) return;
    go.onclick = async () => {
      const add = +$('#m-add', el).value || null; const drop = $('#m-drop', el) ? +$('#m-drop', el).value || null : null;
      if (!add) return toast('Choose a castaway to add.', true);
      try { await call(add, drop); toast('Merge pick saved'); await reload(); } catch (e) { toast(errMsg(e), true); }
    };
    const clr = $('#m-clear', el);
    if (clr) clr.onclick = async () => { try { await call(null, null); toast('Merge pick removed'); await reload(); } catch (e) { toast(errMsg(e), true); } };
  }

  // ---------------- Castaways ----------------
  function castawaysTab() {
    const el = $('#castaways');
    const pickCount = {}; S.picks.filter((p) => p.end_episode == null).forEach((p) => (pickCount[p.castaway_id] = (pickCount[p.castaway_id] || 0) + 1));
    const showPop = CSV || S.locked || S.isAdmin;
    const cols = 2 + (showPop ? 1 : 0) + S.scored.length;
    const rankOf = (id) => { const b = S.board.find((x) => x.entry_id === id); return b ? S.board.filter((x) => x.total > b.total).length + 1 : null; };
    const pickers = (c) => {
      const list = S.picks.filter((p) => p.castaway_id === c.id)
        .sort((a, b) => (b.is_mvp - a.is_mvp) || (a.end_episode != null) - (b.end_episode != null) || a.display_name.localeCompare(b.display_name));
      if (!list.length) return '<span class="muted">Nobody picked ' + esc(c.name) + '.</span>';
      return `<div class="chips">${list.map((p) => {
        const off = p.end_episode != null; const rank = rankOf(p.entry_id);
        const title = [p.is_mvp ? 'MVP pick' : '', p.kind === 'merge' ? `Merge pick (from ep ${p.start_episode})` : '', off ? `Swapped out after ep ${p.end_episode}` : '', rank ? `Currently #${rank}` : ''].filter(Boolean).join(' · ');
        return `<span class="chip ${off ? 'out' : ''} ${p.is_mvp ? 'mvp' : ''}" title="${esc(title)}">${p.is_mvp ? '⭐ ' : ''}${p.kind === 'merge' ? '➕ ' : ''}${esc(p.display_name)} <b>${p.points}</b></span>`;
      }).join('')}</div>`;
    };
    el.innerHTML = S.tribes.map((t) => `<div class="card"><div class="tribe-head" style="border-color:${esc(t.color)}"><h2 style="margin:0">${esc(t.name)}</h2></div>
      <div class="scroll"><table class="grid-pts"><thead><tr><th>Castaway</th>${showPop ? '<th title="How many players have them">Picked</th>' : ''}${S.scored.map((e) => `<th>Ep ${e.number}</th>`).join('')}<th>Total</th></tr></thead><tbody>
      ${S.castaways.filter((c) => c.tribe === t.name).map((c) => `<tr class="${showPop ? 'click' : ''}" data-c="${c.id}"><td>${esc(c.name)} ${c.finish_place ? `<span class="pill good">${['', '🏆 Winner', '2nd', '3rd'][c.finish_place]}</span>` : isOut(c) ? `<span class="pill bad">out ep ${c.eliminated_episode}</span>` : ''}</td>
        ${showPop ? `<td>${pickCount[c.id] || 0}</td>` : ''}
        ${S.scored.map((e) => { const r = S.cep.find((x) => x.castaway_id === c.id && x.episode === e.number); const v = r ? r.survival + r.bonus : null; return `<td class="${v ? '' : 'zero'}" title="${esc(eventTitle(c.id, e.number))}">${v ?? '·'}</td>`; }).join('')}
        <td><b>${castawayTotal(c.id)}</b></td></tr>
        ${showPop && S.openCast.has(c.id) ? `<tr class="detail"><td colspan="${cols}" style="text-align:left">${pickers(c)}</td></tr>` : ''}`).join('')}
      </tbody></table></div></div>`).join('') + `<p class="small muted">${showPop ? 'Tap a castaway to see who picked them, with the points each player has earned from them. ⭐ = their MVP, ➕ = merge pick, struck-through = swapped out. ' : ''}Castaway totals exclude finish bonuses.</p>`;
    if (showPop) $$('tr.click', el).forEach((tr) => (tr.onclick = () => { const id = +tr.dataset.c; S.openCast.has(id) ? S.openCast.delete(id) : S.openCast.add(id); castawaysTab(); }));
  }

  // ---------------- Seasons (hall of fame) ----------------
  async function seasonsTab() {
    const el = $('#seasons');
    el.innerHTML = '<div class="card muted">Loading seasons…</div>';
    if (!S.history) {
      S.history = await Promise.all(S.seasons.map(async (x) => {
        try {
          const d = x.season === S.season.season ? S : await window.loadCsvPool(`seasons/${x.season}/`);
          const champ = d.board[0]; const ties = d.board.filter((b) => champ && b.total === champ.total);
          const ss = d.castaways.find((c) => c.finish_place === 1);
          return { ...x, players: d.board.length, champs: champ ? ties.map((b) => b.display_name) : [], top: champ?.total, ss: ss?.name };
        } catch (e) { return { ...x, error: true }; }
      }));
    }
    if (S.tab !== 'seasons') return;
    el.innerHTML = `<div class="card"><h2>Seasons</h2><div class="scroll"><table>
      <thead><tr><th>Season</th><th>Pool winner</th><th class="num">Points</th><th>Sole Survivor</th><th class="num">Players</th><th></th></tr></thead><tbody>
      ${S.history.map((h) => h.error ? `<tr><td><b>${esc(h.name)}</b></td><td colspan="5" class="muted">Couldn't load this season's files.</td></tr>` : `<tr>
        <td><b>${esc(h.name)}</b>${h.status === 'current' ? ' <span class="pill good">now</span>' : ''}</td>
        <td>${h.status === 'finished' && h.champs.length ? '🏆 ' + esc(h.champs.join(' & ')) : h.champs.length ? `<span class="muted">Leading: ${esc(h.champs.join(' & '))}</span>` : '<span class="muted">—</span>'}</td>
        <td class="num">${h.top ?? '—'}</td><td>${esc(h.ss || (h.status === 'finished' ? '' : 'TBD'))}</td>
        <td class="num">${h.players}</td>
        <td><a class="btn small" href="?season=${encodeURIComponent(h.season)}#standings" style="text-decoration:none">View</a></td></tr>`).join('')}
      </tbody></table></div><p class="small muted">Older seasons get added as we find their spreadsheets.</p></div>`;
  }

  // ---------------- Rules ----------------
  function rules() {
    const s = S.settings; const by = (p) => S.categories.filter((c) => c.points === p);
    $('#rules').innerHTML = `<div class="card rules"><h2>How it works</h2><ol>
      <li>The player with the most points at the end of the season wins the pool.</li>
      <li>Pick <b>${s.picks_per_tribe}</b> castaways from each tribe (${s.picks_per_tribe * S.tribes.length} total) before <b>${esc(fmtDate(s.picks_deadline))}</b>.</li>
      <li>Choose one of your picks as your <b>MVP</b> — your call for Sole Survivor.</li>
      <li>Points start with <b>episode ${s.first_scoring_episode}</b>.</li>
      <li><b>Merge bonus:</b> after the tribes merge you can add one more castaway. Their points start the episode after the merge. If all your picks are still in, you may instead swap one out (you keep the points they earned). You can never have more than ${s.max_tribe_size} castaways at once.</li></ol></div>
      <div class="card"><h3>Survival &amp; finale</h3><ul>
      <li>1 point per castaway for each week they survive before the merge</li><li>3 points per castaway for each week they survive after the merge</li>
      <li>10 bonus points if any of your picks finishes 3rd · 20 for 2nd · 30 for the winner</li><li>30 more if your MVP wins</li></ul></div>
      <div class="card"><h3>Weekly bonus points</h3><p class="muted small">Must be visible on screen. Each category counts once per castaway per week. Recaps and previews don't count.</p>
      ${[5, 10, 15].map((p) => `<h3 style="margin-top:12px">${p} points</h3><div class="cat-cols">${by(p).map((c) => `<div>• ${esc(c.label)}</div>`).join('')}</div>`).join('')}
      <p class="small muted" style="margin-top:12px">Based on the <a href="https://www.globaltv.com/survivor-51-fantasy-tribe/" target="_blank" rel="noopener">official Global TV Fantasy Tribe rules</a>.</p></div>`;
  }

  // ---------------- Admin ----------------
  function admin() {
    const el = $('#admin'); const s = S.settings;
    if (S.adminEp == null) S.adminEp = (S.episodes.find((e) => !e.is_scored && e.number >= s.first_scoring_episode) || S.episodes[S.episodes.length - 1])?.number;
    const ep = S.episodes.find((e) => e.number === S.adminEp);
    const evs = S.events.filter((e) => e.episode === S.adminEp);
    const local = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

    el.innerHTML = `
    <div class="card"><h2>Score an episode</h2>
      <div class="row">
        <label>Episode <select id="a-ep">${S.episodes.map((e) => `<option value="${e.number}" ${e.number === S.adminEp ? 'selected' : ''}>Ep ${e.number}${e.air_date ? ' · ' + e.air_date : ''}${e.is_scored ? ' ✓' : ''}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="a-merge" ${ep?.is_post_merge ? 'checked' : ''}> Post-merge (3 pts/survivor)</label>
        <label><input type="checkbox" id="a-pub" ${ep?.is_scored ? 'checked' : ''}> Published (counts in standings)</label>
      </div>
      <div class="admin-grid">
        <div><h3>Bonus events</h3>
          <label>Castaway <select id="a-c">${S.castaways.filter((c) => !isOut(c) || c.eliminated_episode >= S.adminEp).map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.tribe)})</option>`).join('')}</select></label>
          <label>What happened <select id="a-cat">${[5, 10, 15].map((p) => `<optgroup label="${p} points">${S.categories.filter((c) => c.points === p).map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</optgroup>`).join('')}</select></label>
          <button class="btn primary" id="a-add">Add event</button>
          <ul class="ev-list">${evs.map((e) => `<li><span>${esc(S.cById[e.castaway_id]?.name)} — ${esc(S.catById[e.category_id]?.label)} <b>+${S.catById[e.category_id]?.points}</b></span><button class="btn small danger" data-del="${e.castaway_id}:${e.category_id}">✕</button></li>`).join('') || '<li class="muted">No events yet for this episode.</li>'}</ul>
        </div>
        <div><h3>Voted out / left this episode</h3><p class="small muted">They still earn bonus points for this episode, but no survival point.</p>
          ${S.castaways.filter((c) => !isOut(c) || c.eliminated_episode === S.adminEp).map((c) => `<label style="font-weight:400"><input type="checkbox" class="a-elim" value="${c.id}" ${c.eliminated_episode === S.adminEp ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}
        </div>
      </div>
      <p class="small muted">Tip: add events and eliminations first, check them, then tick “Published” so everyone sees the episode at once.</p>
    </div>

    <div class="card"><h2>Players</h2><div class="scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Picks</th><th></th></tr></thead><tbody>
      ${S.entries.map((en) => { const n = picksFor(en.id).length; return `<tr><td>${esc(en.display_name)}</td><td class="small">${esc(en.email)}</td><td>${n}</td>
        <td class="row"><button class="btn small" data-edit="${en.id}">Edit picks</button>${s.merge_episode != null ? `<button class="btn small" data-merge="${en.id}">Merge pick</button>` : ''}<button class="btn small danger" data-rm="${en.id}">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No players yet.</td></tr>'}
    </tbody></table></div>
    <button class="btn primary" id="a-new" style="margin-top:10px">Add a player's picks</button>
    <div id="a-picker"></div></div>

    <div class="card"><h2>Pool settings</h2><form id="a-set">
      <div class="row"><label>Pool name <input name="pool_name" value="${esc(s.pool_name)}"></label><label>Season <input name="season" type="number" value="${s.season}"></label></div>
      <div class="row"><label>Commissioner <input name="commissioner_name" value="${esc(s.commissioner_name || '')}"></label></div>
      <div class="row"><label>Picks deadline <input name="picks_deadline" type="datetime-local" value="${local(s.picks_deadline)}"></label><label>First scoring episode <input name="first_scoring_episode" type="number" value="${s.first_scoring_episode}"></label></div>
      <div class="row"><label>Picks per tribe <input name="picks_per_tribe" type="number" value="${s.picks_per_tribe}"></label><label>Max castaways on a tribe <input name="max_tribe_size" type="number" value="${s.max_tribe_size}"></label></div>
      <div class="row"><label>Merge happened in episode <input name="merge_episode" type="number" value="${s.merge_episode ?? ''}" placeholder="leave blank until the merge"></label>
        <label><input type="checkbox" name="merge_window_open" ${s.merge_window_open ? 'checked' : ''}> Merge pick window open</label></div>
      <label>Announcement banner <textarea name="announcement" rows="2">${esc(s.announcement || '')}</textarea></label>
      <button class="btn primary">Save settings</button></form></div>

    <div class="card"><h2>Castaways &amp; finale</h2><div class="scroll"><table><thead><tr><th>Castaway</th><th>Tribe</th><th>Out in ep</th><th>Finish</th></tr></thead><tbody>
      ${S.castaways.map((c) => `<tr><td>${esc(c.name)}</td>
        <td><select class="a-tribe" data-id="${c.id}">${S.tribes.map((t) => `<option ${t.name === c.tribe ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td>
        <td><input class="a-out" data-id="${c.id}" type="number" min="1" style="width:80px" value="${c.eliminated_episode ?? ''}"></td>
        <td><select class="a-fin" data-id="${c.id}"><option value="">—</option>${[1, 2, 3].map((n) => `<option value="${n}" ${c.finish_place === n ? 'selected' : ''}>${['', 'Winner', '2nd', '3rd'][n]}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div><p class="small muted">Tribe swaps: change a castaway's tribe here (affects the picker only). For the finale, set 1st/2nd/3rd — bonuses apply automatically.</p></div>`;

    const act = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await reload(); } catch (e) { toast(errMsg(e), true); } };

    $('#a-ep').onchange = (e) => { S.adminEp = +e.target.value; admin(); };
    $('#a-merge').onchange = (e) => act(() => q(sb.from('episodes').update({ is_post_merge: e.target.checked }).eq('number', S.adminEp)), 'Saved');
    $('#a-pub').onchange = (e) => act(() => q(sb.from('episodes').update({ is_scored: e.target.checked }).eq('number', S.adminEp)), e.target.checked ? `Episode ${S.adminEp} published` : 'Unpublished');
    $('#a-add').onclick = () => act(() => q(sb.from('events').insert({ episode: S.adminEp, castaway_id: +$('#a-c').value, category_id: +$('#a-cat').value })), 'Event added');
    $$('[data-del]', el).forEach((b) => (b.onclick = () => { const [c, k] = b.dataset.del.split(':'); act(() => q(sb.from('events').delete().match({ episode: S.adminEp, castaway_id: +c, category_id: +k }))); }));
    $$('.a-elim', el).forEach((b) => (b.onchange = () => act(() => q(sb.from('castaways').update({ eliminated_episode: b.checked ? S.adminEp : null }).eq('id', +b.value)), b.checked ? 'Marked out' : 'Back in')));
    $$('[data-rm]', el).forEach((b) => (b.onclick = () => { const en = S.entries.find((x) => x.id === b.dataset.rm); if (confirm(`Delete ${en.display_name}'s entry and picks?`)) act(() => q(sb.from('entries').delete().eq('id', en.id)), 'Deleted'); }));
    $$('.a-out', el).forEach((i) => (i.onchange = () => act(() => q(sb.from('castaways').update({ eliminated_episode: i.value ? +i.value : null }).eq('id', +i.dataset.id)), 'Saved')));
    $$('.a-fin', el).forEach((i) => (i.onchange = () => act(() => q(sb.from('castaways').update({ finish_place: i.value ? +i.value : null }).eq('id', +i.dataset.id)), 'Saved')));
    $$('.a-tribe', el).forEach((i) => (i.onchange = () => act(() => q(sb.from('castaways').update({ tribe: i.value }).eq('id', +i.dataset.id)), 'Saved')));

    const openPicker = (en) => {
      const box = $('#a-picker'); box.innerHTML = '<div class="card" style="margin-top:12px"><h3>' + (en ? 'Edit ' + esc(en.display_name) : 'New player') + '</h3><div id="a-pk"></div></div>';
      const orig = en ? picksFor(en.id).filter((p) => p.kind === 'original') : [];
      picker($('#a-pk'), { selected: orig.map((p) => p.castaway_id), mvp: orig.find((p) => p.is_mvp)?.castaway_id || null, name: en?.display_name || '', email: en?.email || '', submitLabel: 'Save picks',
        onSubmit: async ({ name, email, ids, mvp }) => { if (!email) throw new Error('Enter the player\'s email'); await q(sb.rpc('admin_set_picks', { p_email: email.toLowerCase(), p_display_name: name, p_castaways: ids, p_mvp: mvp })); toast('Saved ' + name); await reload(); } });
      box.scrollIntoView({ behavior: 'smooth' });
    };
    $('#a-new').onclick = () => openPicker(null);
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => openPicker(S.entries.find((x) => x.id === b.dataset.edit))));
    $$('[data-merge]', el).forEach((b) => (b.onclick = () => {
      const en = S.entries.find((x) => x.id === b.dataset.merge); const mine = picksFor(en.id);
      const box = $('#a-picker'); const wasOpen = s.merge_window_open; s.merge_window_open = true;
      box.innerHTML = `<div style="margin-top:12px"><p><b>${esc(en.display_name)}</b></p>${mergePanel(mine)}</div>`; s.merge_window_open = wasOpen;
      wireMerge(box, mine, (add, drop) => q(sb.rpc('admin_merge_pick', { p_entry: en.id, p_add: add, p_drop: drop })));
      box.scrollIntoView({ behavior: 'smooth' });
    }));

    $('#a-set').onsubmit = (e) => {
      e.preventDefault(); const f = new FormData(e.target); const num = (k) => (f.get(k) === '' ? null : +f.get(k));
      act(() => q(sb.from('settings').update({
        pool_name: f.get('pool_name'), season: num('season'), 
        commissioner_name: f.get('commissioner_name') || null, picks_deadline: new Date(f.get('picks_deadline')).toISOString(),
        first_scoring_episode: num('first_scoring_episode'), picks_per_tribe: num('picks_per_tribe'), max_tribe_size: num('max_tribe_size'),
        merge_episode: num('merge_episode'), merge_window_open: f.get('merge_window_open') === 'on', announcement: f.get('announcement') || null,
      }).eq('id', 1)), 'Settings saved');
    };
  }

  boot();
})();
