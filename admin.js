/* Pool admin: edits settings, castaways, players and picks, saving straight to the GitHub repo.
   The GitHub key is stored in the repo only in encrypted form (admin-key.json); the passcode decrypts it
   in the browser. Good enough to keep honest players honest — anyone with the passcode can edit. */
(() => {
  const cfg = window.POOL_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const REPO = cfg.GITHUB_REPO || (location.hostname.endsWith('.github.io') ? `${location.hostname.split('.')[0]}/${location.pathname.split('/')[1]}` : '');
  const BRANCH = cfg.GITHUB_BRANCH || 'main';
  const main = $('#main');
  const S = { tab: 'players', files: {}, edit: null };

  function toast(text, err = false) {
    const t = $('#toast'); t.textContent = text; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), err ? 7000 : 3500);
  }

  // ---------- base64 / crypto ----------
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const utf8b64 = (text) => { const bytes = new TextEncoder().encode(text); let s = ''; bytes.forEach((b) => (s += String.fromCharCode(b))); return btoa(s); };
  const b64utf8 = (s) => new TextDecoder().decode(unb64(s.replace(/\s/g, '')));
  async function keyFrom(pass, salt) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(secret, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pass, salt), new TextEncoder().encode(secret));
    return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function decrypt(box, pass) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, await keyFrom(pass, unb64(box.salt)), unb64(box.ct));
    return new TextDecoder().decode(pt);
  }

  // ---------- GitHub ----------
  async function gh(path, opts = {}, token = S.token) {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
      ...opts, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
    });
    if (!res.ok) {
      let msg = res.statusText; try { msg = (await res.json()).message || msg; } catch {}
      const e = new Error(res.status === 401 ? 'The saved GitHub key no longer works (it may have expired). Set a new one on the Passcode tab.' : res.status === 409 ? 'Someone else saved at the same time. Reload and try again.' : `GitHub: ${msg}`);
      e.status = res.status; throw e;
    }
    return res.status === 204 ? null : res.json();
  }
  async function readFile(path) {
    const j = await gh(`/contents/${path}?ref=${BRANCH}`);
    S.files[path] = { sha: j.sha, text: b64utf8(j.content) }; return S.files[path].text;
  }
  async function writeFile(path, text, message, token = S.token) {
    let sha = S.files[path]?.sha;
    if (sha === undefined) { try { sha = (await gh(`/contents/${path}?ref=${BRANCH}`, {}, token)).sha; } catch (e) { if (e.status !== 404) throw e; } }
    const j = await gh(`/contents/${path}`, { method: 'PUT', body: JSON.stringify({ message, content: utf8b64(text), branch: BRANCH, ...(sha ? { sha } : {}) }) }, token);
    S.files[path] = { sha: j.content.sha, text };
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }
  const cell = (v) => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';

  // ---------- data model ----------
  async function loadSeasonList() {
    S.seasonRows = parseCsv(await readFile('seasons/seasons.csv')).slice(1).map(([season, name, status]) => ({ season, name: name || `Survivor ${season}`, status: (status || '').toLowerCase() }))
      .sort((a, b) => (+b.season || 0) - (+a.season || 0));
    if (!S.folder || !S.seasonRows.some((x) => `seasons/${x.season}` === S.folder)) {
      const cur = S.seasonRows.find((x) => x.status === 'current') || S.seasonRows[0];
      S.folder = `seasons/${cur.season}`;
    }
  }
  const editingSeason = () => S.seasonRows.find((x) => `seasons/${x.season}` === S.folder);
  const saveSeasonList = (msg) => writeFile('seasons/seasons.csv', toCsv([['season', 'name', 'status'], ...S.seasonRows.map((x) => [x.season, x.name, x.status])]), msg);

  async function loadAll() {
    await loadSeasonList();
    const [st, ca, pl] = await Promise.all(['settings', 'castaways', 'players'].map((f) => readFile(`${S.folder}/${f}.csv`)));
    S.settings = parseCsv(st).slice(1).map(([k, v]) => ({ key: k, value: v ?? '' }));
    const c = parseCsv(ca); S.castHead = c[0]; S.castaways = c.slice(1).map((r) => Object.fromEntries(S.castHead.map((h, i) => [h, r[i] ?? ''])));
    const p = parseCsv(pl); const head = p[0];
    S.players = p.slice(1).map((r) => {
      const o = Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()]));
      return { player: o.player, mvp: o.mvp, picks: head.filter((h) => /^pick\d+$/.test(h)).map((h) => o[h]).filter(Boolean), merge_pick: o.merge_pick || '', swap_out: o.swap_out || '' };
    });
    const es = editingSeason();
    $('#sub').textContent = `Editing ${es?.name || setting('Pool name')}${es?.status === 'finished' ? ' (finished)' : ''}`;
  }
  const setting = (k) => S.settings.find((s) => norm(s.key) === norm(k))?.value || '';
  const perTribe = () => parseInt(setting('Picks per tribe'), 10) || 4;
  const tribes = () => [...new Set(S.castaways.map((c) => c.tribe).filter(Boolean))];
  const canon = (name) => S.castaways.find((c) => [c.name, ...(c.aliases || '').split(';')].some((n) => n && norm(n) === norm(name)))?.name || name;

  const savePlayers = (msg) => {
    const n = Math.max(perTribe() * tribes().length, ...S.players.map((p) => p.picks.length));
    const head = ['player', 'mvp', ...Array.from({ length: n }, (_, i) => `pick${i + 1}`), 'merge_pick', 'swap_out'];
    const rows = S.players.map((p) => [p.player, p.mvp, ...Array.from({ length: n }, (_, i) => p.picks[i] || ''), p.merge_pick, p.swap_out]);
    return writeFile(`${S.folder}/players.csv`, toCsv([head, ...rows]), msg);
  };
  const saveSettings = () => writeFile(`${S.folder}/settings.csv`, toCsv([['setting', 'value'], ...S.settings.map((s) => [s.key, s.value])]), 'Update pool settings');
  const saveCastaways = () => writeFile(`${S.folder}/castaways.csv`, toCsv([S.castHead, ...S.castaways.map((c) => S.castHead.map((h) => c[h] ?? ''))]), 'Update castaways');

  async function busy(el, fn, ok) {
    el?.classList.add('saving');
    try { await fn(); if (ok) toast(ok + ' The public site updates in about a minute.'); return true; }
    catch (e) { toast(e.message, true); return false; }
    finally { el?.classList.remove('saving'); }
  }

  // ---------- screens ----------
  async function start() {
    if (!REPO) { main.innerHTML = `<div class="card narrow">Add <code>GITHUB_REPO: 'owner/repo'</code> to config.js.</div>`; return; }
    let box = null;
    try { const r = await fetch('admin-key.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) box = await r.json(); } catch {}
    S.box = box;
    if (!box) return setupScreen();
    let remembered = ''; try { remembered = sessionStorage.getItem('pool-pass') || ''; } catch {}
    if (remembered && (await unlock(remembered, true))) return;
    lockScreen();
  }

  function lockScreen(msg = '') {
    $('#tabs').hidden = true; $('#lock').hidden = true;
    main.innerHTML = `<div class="card narrow"><h2>Enter the passcode</h2>
      <form id="f"><label>Passcode <input type="password" id="pass" autocomplete="current-password" required autofocus></label>
      <button class="btn primary">Unlock</button></form><p class="msg err">${esc(msg)}</p></div>`;
    $('#f').onsubmit = async (e) => { e.preventDefault(); if (!(await unlock($('#pass').value))) lockScreen('Wrong passcode.'); };
  }

  async function unlock(pass, quiet = false) {
    try { S.token = await decrypt(S.box, pass); } catch { if (!quiet) return false; return false; }
    S.pass = pass; try { sessionStorage.setItem('pool-pass', pass); } catch {}
    main.innerHTML = '<div class="card narrow muted">Loading the pool…</div>';
    try { await loadAll(); } catch (e) { main.innerHTML = `<div class="card narrow"><h2>Couldn't load the pool</h2><p class="msg err">${esc(e.message)}</p></div>`; if (e.status === 401) { S.tab = 'access'; showApp(); } return true; }
    showApp(); return true;
  }

  function setupScreen() {
    main.innerHTML = `<div class="card" style="max-width:640px;margin:30px auto"><h2>One-time setup</h2>
      <p>The admin page saves changes into your GitHub repo, so it needs a GitHub key that can edit <b>${esc(REPO)}</b>. You only do this once.</p>
      <ol class="small">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a> (signed in as the repo owner).</li>
        <li>Name it "Survivor pool admin". Set <b>Expiration</b> to the longest available.</li>
        <li><b>Repository access</b> → <i>Only select repositories</i> → <b>${esc(REPO.split('/')[1])}</b>.</li>
        <li><b>Permissions</b> → <b>Contents</b> → <i>Read and write</i>. Leave everything else as is.</li>
        <li>Click <b>Generate token</b>, copy it, and paste it below.</li>
      </ol>
      <form id="f">
        <label>GitHub key <input id="tok" required autocomplete="off" placeholder="github_pat_…"></label>
        <label>Choose a passcode to share with organizers <input id="p1" type="password" minlength="4" required autocomplete="new-password"></label>
        <label>Passcode again <input id="p2" type="password" minlength="4" required autocomplete="new-password"></label>
        <button class="btn primary">Save and unlock</button>
      </form>
      <p class="small muted">The key is stored in the repo only after being locked with your passcode. Nobody can use it without the passcode.</p>
      <p class="msg err" id="m"></p></div>`;
    $('#f').onsubmit = (e) => { e.preventDefault(); saveKey($('#tok').value.trim(), $('#p1').value, $('#p2').value, $('#m'), $('#f')); };
  }

  async function saveKey(token, p1, p2, msgEl, form) {
    if (p1 !== p2) { msgEl.textContent = "The passcodes don't match."; return; }
    form.classList.add('saving'); msgEl.textContent = '';
    try {
      const repo = await gh('', {}, token);
      if (repo.permissions && !repo.permissions.push) throw new Error("That key can read the repo but can't save to it. Give it Contents: Read and write.");
      const box = await encrypt(token, p1);
      await writeFile('admin-key.json', JSON.stringify(box, null, 2) + '\n', 'Set admin passcode', token);
      S.box = box; toast('Saved.');
      await unlock(p1);
    } catch (e) { msgEl.textContent = e.status === 401 ? "GitHub didn't accept that key. Check you copied all of it." : e.status === 404 ? `That key can't see ${REPO}. Make sure you picked that repository.` : e.message; }
    finally { form.classList.remove('saving'); }
  }

  function showApp() {
    $('#tabs').hidden = false; $('#lock').hidden = false;
    $$('#tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.tab === S.tab); b.onclick = () => { S.tab = b.dataset.tab; S.edit = null; showApp(); }; });
    ({ players, settings, castaways, access, seasons })[S.tab]();
  }
  $('#lock').onclick = () => { try { sessionStorage.removeItem('pool-pass'); } catch {} S.token = null; lockScreen(); };

  // ---------- players ----------
  function problems(p) {
    const out = []; const per = perTribe();
    tribes().forEach((t) => { const n = p.picks.filter((x) => S.castaways.find((c) => c.name === canon(x))?.tribe === t).length; if (n !== per) out.push(`${n} of ${per} ${t}`); });
    if (!p.mvp) out.push('no MVP'); else if (!p.picks.some((x) => norm(canon(x)) === norm(canon(p.mvp)))) out.push('MVP not in picks');
    p.picks.forEach((x) => { if (!S.castaways.some((c) => c.name === canon(x))) out.push(`unknown "${x}"`); });
    return out;
  }

  function players() {
    const list = S.players.map((p, i) => {
      const bad = problems(p);
      return `<tr><td><b>${esc(p.player)}</b>${bad.length ? `<div class="small" style="color:var(--bad)">⚠ ${esc(bad.join(', '))}</div>` : ''}</td>
        <td class="small">⭐ ${esc(p.mvp)}<br>${esc(p.picks.filter((x) => norm(x) !== norm(p.mvp)).join(', '))}${p.merge_pick ? `<br>➕ ${esc(p.merge_pick)}${p.swap_out ? ` (swapped out ${esc(p.swap_out)})` : ''}` : ''}</td>
        <td><button class="btn small" data-e="${i}">Edit</button></td></tr>`;
    }).join('');
    main.innerHTML = `${S.edit != null ? '<div id="editor"></div>' : ''}
      <div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Players (${S.players.length})</h2><button class="btn primary" id="add">Add a player</button></div>
      <div class="scroll"><table style="margin-top:10px"><thead><tr><th>Player</th><th>Picks</th><th></th></tr></thead><tbody>${list || '<tr><td colspan="3" class="muted">No players yet.</td></tr>'}</tbody></table></div>
      <p class="small muted">Names only here; the site and its files are public, so don't add email addresses.</p></div>`;
    $('#add').onclick = () => { S.edit = -1; players(); };
    $$('[data-e]').forEach((b) => (b.onclick = () => { S.edit = +b.dataset.e; players(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    if (S.edit != null) editor();
  }

  function editor() {
    const orig = S.edit >= 0 ? S.players[S.edit] : { player: '', mvp: '', picks: [], merge_pick: '', swap_out: '' };
    const p = { ...orig, picks: orig.picks.map(canon), mvp: canon(orig.mvp), merge_pick: canon(orig.merge_pick), swap_out: canon(orig.swap_out) };
    const per = perTribe(); const box = $('#editor');
    const draw = () => {
      const counts = Object.fromEntries(tribes().map((t) => [t, S.castaways.filter((c) => c.tribe === t && p.picks.includes(c.name)).length]));
      box.innerHTML = `<div class="card"><h2>${S.edit >= 0 ? 'Edit ' + esc(orig.player) : 'New player'}</h2>
        <div class="row"><label>Name (as shown on the leaderboard) <input id="nm" value="${esc(p.player)}" maxlength="40"></label></div>
        <p class="help">Pick ${per} from each tribe.</p>
        <div class="pick-grid">${tribes().map((t) => `<div><div class="row" style="justify-content:space-between"><b>${esc(t)}</b><span class="pill ${counts[t] === per ? 'good' : ''}">${counts[t]} / ${per}</span></div>
          ${S.castaways.filter((c) => c.tribe === t).map((c) => `<label class="cb ${p.picks.includes(c.name) ? 'on' : ''}"><input type="checkbox" data-c="${esc(c.name)}" ${p.picks.includes(c.name) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}</div>`).join('')}</div>
        <div class="row" style="margin-top:12px">
          <label>MVP <select id="mvp"><option value="">— choose —</option>${p.picks.map((x) => `<option ${x === p.mvp ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
          <label>Merge pick <span class="help">(after the merge)</span><select id="mg"><option value="">— none —</option>${S.castaways.filter((c) => !p.picks.includes(c.name)).map((c) => `<option ${c.name === p.merge_pick ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label>Swap out <span class="help">(only if the tribe is full)</span><select id="sw"><option value="">— none —</option>${p.picks.map((x) => `<option ${x === p.swap_out ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        </div>
        <div class="row"><button class="btn primary" id="sv">Save player</button><button class="btn" id="cx">Cancel</button>${S.edit >= 0 ? '<button class="btn danger" id="rm" style="margin-left:auto">Delete player</button>' : ''}</div></div>`;
      const keep = () => { p.player = $('#nm', box).value; p.mvp = $('#mvp', box).value; p.merge_pick = $('#mg', box).value; p.swap_out = $('#sw', box).value; };
      $$('[data-c]', box).forEach((cb) => (cb.onchange = () => {
        keep(); const n = cb.dataset.c; const t = S.castaways.find((c) => c.name === n).tribe;
        if (cb.checked) { if (counts[t] >= per) { cb.checked = false; return toast(`Already ${per} from ${t}. Untick one first.`); } p.picks.push(n); }
        else { p.picks = p.picks.filter((x) => x !== n); if (p.mvp === n) p.mvp = ''; if (p.swap_out === n) p.swap_out = ''; }
        draw();
      }));
      $('#cx', box).onclick = () => { S.edit = null; players(); };
      $('#sv', box).onclick = async () => {
        keep(); p.player = p.player.trim();
        if (!p.player) return toast('Enter a name.', true);
        if (S.players.some((x, i) => i !== S.edit && norm(x.player) === norm(p.player))) return toast('There is already a player with that name.', true);
        const bad = problems(p);
        if (bad.length && !confirm(`Save anyway? ${bad.join(', ')}`)) return;
        if (p.swap_out && !p.merge_pick) return toast('Choose the merge pick that replaces the swapped-out castaway.', true);
        const before = S.players.slice();
        if (S.edit >= 0) S.players[S.edit] = p; else S.players.push(p);
        const ok = await busy(box, () => savePlayers(`${S.edit >= 0 ? 'Update' : 'Add'} ${p.player}`), `Saved ${p.player}.`);
        if (!ok) S.players = before; else { S.edit = null; players(); }
      };
      const rm = $('#rm', box);
      if (rm) rm.onclick = async () => {
        if (!confirm(`Delete ${orig.player} and their picks?`)) return;
        const before = S.players.slice(); S.players.splice(S.edit, 1);
        const ok = await busy(box, () => savePlayers(`Remove ${orig.player}`), `Deleted ${orig.player}.`);
        if (!ok) S.players = before; else { S.edit = null; players(); }
      };
    };
    draw();
  }

  // ---------- settings ----------
  const SETTING_HELP = {
    'Pool name': ['text', 'Shown at the top of the site.'],
    'Season': ['number', ''],
    'Commissioner': ['text', ''],
    'Picks deadline': ['datetime', 'After this, picks are locked and shown to everyone.'],
    'First scoring episode': ['number', 'Points count from this episode on.'],
    'Picks per tribe': ['number', 'How many castaways each player picks from every tribe.'],
    'Max tribe size': ['number', "Most castaways a player can have at once. At the merge, a player with this many still in must swap one out to add a merge pick."],
    'Merge episode': ['number', 'Fill in once the tribes merge. Merge picks score from the episode after this.'],
    'Results page': ['text', "Global TV's Fantasy Tribe page for this season. Weekly scores are read from it automatically."],
    'Survival points': ['select:entered|auto', 'Only matters for weeks Global hasn\'t posted. Leave as "entered".'],
    'Announcement': ['textarea', 'Optional banner across the top of the site.'],
  };
  const toLocal = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocal = (v) => { const d = new Date(v); const off = -d.getTimezoneOffset(); const pad = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0'); return `${v}:00${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`; };

  function settings() {
    const rows = S.settings.map((s, i) => {
      if (/^(entry fee|e-?transfer email)$/i.test(s.key)) return '';
      const [type, help] = SETTING_HELP[s.key] || (s.key.startsWith('Tribe color') ? ['color', ''] : ['text', '']);
      let input;
      if (type === 'textarea') input = `<textarea data-i="${i}" rows="2">${esc(s.value)}</textarea>`;
      else if (type === 'datetime') input = `<input type="datetime-local" data-i="${i}" data-dt value="${esc(toLocal(s.value))}">`;
      else if (type === 'color') input = `<input type="color" data-i="${i}" value="${esc(s.value || '#888888')}" style="height:38px;padding:2px">`;
      else if (type.startsWith('select:')) input = `<select data-i="${i}">${type.slice(7).split('|').map((o) => `<option ${o === s.value ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      else input = `<input type="${type}" data-i="${i}" value="${esc(s.value)}">`;
      return `<div class="set-row"><div><b>${esc(s.key)}</b>${help ? `<div class="help">${esc(help)}</div>` : ''}</div><div>${input}</div></div>`;
    }).join('');
    main.innerHTML = `<div class="card"><h2>Pool settings</h2><form id="f">${rows}<div class="row" style="margin-top:14px"><button class="btn primary">Save settings</button></div></form></div>`;
    $('#f').onsubmit = async (e) => {
      e.preventDefault(); const before = S.settings.map((s) => ({ ...s }));
      $$('[data-i]').forEach((el) => { const s = S.settings[+el.dataset.i]; s.value = el.hasAttribute('data-dt') ? (el.value ? fromLocal(el.value) : '') : el.value.trim(); });
      if (!(await busy($('#f'), saveSettings, 'Settings saved.'))) S.settings = before; else settings();
    };
  }

  // ---------- castaways ----------
  function castaways() {
    main.innerHTML = `<div class="card"><h2>Castaways</h2>
      <p class="small muted">${S.castaways.some((c) => c.name) ? '' : "<b>No cast yet.</b> It fills in automatically from Global's Fantasy Tribe page (the Results page in Settings) once Global posts the tribes; the site checks every morning. You can also type it in here. "}The cast, who's out and the scores all come from Global TV. Fill in <b>Out in ep</b> or <b>Finish</b> only to correct something.</p>
      <form id="f"><div class="scroll"><table><thead><tr><th>Name</th><th>Tribe</th><th>Other spellings <span class="help">(separate with ;)</span></th><th>Out in ep</th><th>Finish</th><th></th></tr></thead><tbody>
      ${S.castaways.map((c, i) => `<tr><td><input data-i="${i}" data-k="name" value="${esc(c.name)}"></td><td><input data-i="${i}" data-k="tribe" value="${esc(c.tribe)}" style="width:110px"></td>
        <td><input data-i="${i}" data-k="aliases" value="${esc(c.aliases)}"></td><td><input data-i="${i}" data-k="out_episode" value="${esc(c.out_episode)}" style="width:70px"></td>
        <td><input data-i="${i}" data-k="finish" value="${esc(c.finish)}" style="width:60px"></td><td><button type="button" class="btn small danger" data-rm="${i}">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><button type="button" class="btn" id="add">Add castaway</button><button class="btn primary">Save castaways</button></div></form></div>`;
    const collect = () => $$('[data-i]').forEach((el) => (S.castaways[+el.dataset.i][el.dataset.k] = el.value.trim()));
    $('#add').onclick = () => { collect(); S.castaways.push(Object.fromEntries(S.castHead.map((h) => [h, '']))); castaways(); };
    $$('[data-rm]').forEach((b) => (b.onclick = () => { collect(); S.castaways.splice(+b.dataset.rm, 1); castaways(); }));
    $('#f').onsubmit = async (e) => {
      e.preventDefault(); const before = S.castaways.map((c) => ({ ...c })); collect();
      S.castaways = S.castaways.filter((c) => c.name);
      if (!(await busy($('#f'), saveCastaways, 'Castaways saved.'))) S.castaways = before; else castaways();
    };
  }

  // ---------- seasons ----------
  function seasons() {
    const next = Math.max(0, ...S.seasonRows.map((x) => +x.season || 0)) + 1;
    main.innerHTML = `<div class="card"><h2>Seasons</h2>
      <p class="small muted">The <b>current</b> season is what the site shows first and the one whose scores are fetched from Global TV each week. Finished seasons stay on the site's Seasons tab.</p>
      <div class="scroll"><table><thead><tr><th>Season</th><th>Name</th><th>Status</th><th></th></tr></thead><tbody>
      ${S.seasonRows.map((x, i) => `<tr><td>${esc(x.season)}</td><td><input data-n="${i}" value="${esc(x.name)}"></td>
        <td><select data-st="${i}">${['current', 'finished', 'hidden'].map((o) => `<option ${o === x.status ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
        <td>${`seasons/${x.season}` === S.folder ? '<span class="pill good">editing</span>' : `<button class="btn small" data-ed="${esc(x.season)}">Edit this season</button>`}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:12px"><button class="btn primary" id="svs">Save seasons</button></div></div>

      <div class="card" style="max-width:640px"><h2>Start a new season</h2>
      <p class="small">Creates an empty season with the same settings and scoring categories as <b>${esc(editingSeason()?.name || '')}</b>, makes it the current season, and marks the old one finished. Then set the picks deadline and add players. The cast and tribes fill in automatically from Global's page once it's posted.</p>
      <form id="ns"><div class="row"><label>Season number <input id="nsn" type="number" value="${next}" required></label>
      <label>Name <input id="nsname" value="Survivor ${next}"></label></div>
      <button class="btn primary">Create season</button></form></div>

      <div class="card" style="max-width:640px"><h2>Adding an old season</h2>
      <p class="small muted">Send the season's two workbooks (Players_Picks and Cast_Points) to whoever set up the site. They convert them with <code>tools/import_xlsx.py</code>, leaving out emails and notes.</p></div>`;
    $$('[data-ed]').forEach((b) => (b.onclick = async () => { S.folder = `seasons/${b.dataset.ed}`; S.edit = null; main.innerHTML = '<div class="card narrow muted">Loading…</div>'; try { await loadAll(); S.tab = 'players'; showApp(); } catch (e) { toast(e.message, true); seasons(); } }));
    $('#svs').onclick = async () => {
      const before = S.seasonRows.map((x) => ({ ...x }));
      $$('[data-n]').forEach((el) => (S.seasonRows[+el.dataset.n].name = el.value.trim()));
      $$('[data-st]').forEach((el) => (S.seasonRows[+el.dataset.st].status = el.value));
      if (S.seasonRows.filter((x) => x.status === 'current').length !== 1) { S.seasonRows = before; return toast('Exactly one season should be "current".', true); }
      if (!(await busy(main.firstElementChild, () => saveSeasonList('Update seasons'), 'Seasons saved.'))) S.seasonRows = before; else seasons();
    };
    $('#ns').onsubmit = async (e) => {
      e.preventDefault();
      const n = String(parseInt($('#nsn').value, 10)); const name = $('#nsname').value.trim() || `Survivor ${n}`;
      if (!+n) return toast('Enter a season number.', true);
      if (S.seasonRows.some((x) => x.season === n)) return toast(`Season ${n} already exists.`, true);
      if (!confirm(`Create ${name} and make it the current season?`)) return;
      const dir = `seasons/${n}`;
      const set = S.settings.map((x) => ({ ...x }));
      const put = (k, v) => { const r = set.find((x) => norm(x.key) === norm(k)); if (r) r.value = v; else set.push({ key: k, value: v }); };
      put('Season', n); put('Pool name', `${name} Fantasy Pool`); put('Picks deadline', ''); put('Merge episode', ''); put('Announcement', '');
      put('Results page', `https://www.globaltv.com/survivor-${n}-fantasy-tribe/`);
      const ok = await busy(main, async () => {
        const scoring = await readFile(`${S.folder}/scoring.csv`);
        const per = perTribe(); const nt = Math.max(2, tribes().length);
        const files = {
          'settings.csv': toCsv([['setting', 'value'], ...set.map((x) => [x.key, x.value])]),
          'scoring.csv': scoring,
          'castaways.csv': toCsv([['name', 'tribe', 'out_episode', 'finish', 'aliases']]),
          'players.csv': toCsv([['player', 'mvp', ...Array.from({ length: per * nt }, (_, i) => `pick${i + 1}`), 'merge_pick', 'swap_out']]),
          'episodes.csv': toCsv([['episode', 'air_date', 'post_merge', 'published'], ...Array.from({ length: 13 }, (_, i) => [i + 1, '', '', ''])]),
          'events.csv': toCsv([['episode', 'castaway', 'event']]),
          'official_points.csv': toCsv([['episode', 'castaway', 'points']]),
        };
        for (const [f, text] of Object.entries(files)) await writeFile(`${dir}/${f}`, text, `Start ${name}: ${f}`);
        S.seasonRows.forEach((x) => { if (x.status === 'current') x.status = 'finished'; });
        S.seasonRows.unshift({ season: n, name, status: 'current' });
        S.seasonRows.sort((a, b) => (+b.season || 0) - (+a.season || 0));
        await saveSeasonList(`Start ${name}`);
      }, `${name} created.`);
      if (ok) { S.folder = dir; await loadAll(); S.tab = 'settings'; showApp(); toast(`${name} created. Set the picks deadline. The cast fills in from Global's page within a few minutes, once Global has posted it.`); }
    };
  }

  // ---------- passcode / key ----------
  function access() {
    main.innerHTML = `<div class="card" style="max-width:640px"><h2>Change the passcode</h2>
      <form id="f1"><label>New passcode <input type="password" id="a1" minlength="4" required autocomplete="new-password"></label>
      <label>New passcode again <input type="password" id="a2" minlength="4" required autocomplete="new-password"></label>
      <button class="btn primary">Change passcode</button></form><p class="msg err" id="m1"></p>
      <p class="small muted">Everyone with the old passcode loses access. Share the new one with your organizers.</p></div>
      <div class="card" style="max-width:640px"><h2>Replace the GitHub key</h2>
      <p class="small muted">Only needed if the key expires or you revoke it. Create a new one the same way as during setup (Contents: Read and write on this repo only).</p>
      <form id="f2"><label>New GitHub key <input id="t2" required autocomplete="off" placeholder="github_pat_…"></label>
      <label>Passcode <input type="password" id="b1" minlength="4" required value="${esc(S.pass || '')}"></label><input type="hidden" id="b2">
      <button class="btn primary">Save new key</button></form><p class="msg err" id="m2"></p></div>`;
    $('#f1').onsubmit = (e) => { e.preventDefault(); saveKey(S.token, $('#a1').value, $('#a2').value, $('#m1'), $('#f1')); };
    $('#f2').onsubmit = (e) => { e.preventDefault(); saveKey($('#t2').value.trim(), $('#b1').value, $('#b1').value, $('#m2'), $('#f2')); };
  }

  start();
})();
