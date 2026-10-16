/* "Add to home screen" button: installs the site as an app icon on phones. */
(function () {
  const btn = document.getElementById('install');
  if (!btn) return;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const mobile = ios || /Android|Mobi/i.test(ua);
  let deferred = null;

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (standalone) return; // already opened from the home screen
  if (mobile) btn.hidden = false;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; btn.hidden = false; });
  addEventListener('appinstalled', () => { btn.hidden = true; });

  function help(html) {
    const old = document.getElementById('install-help'); if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'install-help'; box.className = 'install-help';
    box.innerHTML = `<div class="card"><h3 style="margin-top:0">Add to your home screen</h3>${html}<button class="btn primary" style="margin-top:12px">Got it</button></div>`;
    box.onclick = (e) => { if (e.target === box || e.target.tagName === 'BUTTON') box.remove(); };
    document.body.appendChild(box);
  }

  btn.onclick = async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; return; }
    if (ios) {
      const safari = !/CriOS|FxiOS|EdgiOS/.test(ua);
      help(safari
        ? '<ol><li>Tap the <b>Share</b> button <span aria-hidden="true">(the square with an arrow ⬆︎)</span> at the bottom or top of Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li></ol>'
        : '<ol><li>Tap the <b>Share</b> button <span aria-hidden="true">(⬆︎)</span> in the address bar.</li><li>Tap <b>Add to Home Screen</b>.</li></ol><p class="small muted">If you don\'t see it, open this page in Safari and try there.</p>');
    } else {
      help('<ol><li>Open your browser\'s menu <span aria-hidden="true">(⋮)</span>.</li><li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>');
    }
  };
})();
