/* Light / dark theme switch. Saves the choice in localStorage and applies it on load. */
(function () {
  var KEY = 'naibi-theme', root = document.documentElement;
  function saved() { try { var v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function cur() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }
  var SUN = '<svg class="ti ti-sun" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg class="ti ti-moon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  var btn = null;
  function paint() {
    var dark = cur() === 'dark';
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#0A1230' : '#1260C0');
    if (btn) {
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      btn.title = dark ? 'Light mode' : 'Dark mode';
    }
  }
  function apply(t, persist) {
    root.setAttribute('data-theme', t);
    if (persist) save(t);
    paint();
    try { window.dispatchEvent(new CustomEvent('naibi:theme', { detail: t })); } catch (e) {}
  }
  function mount() {
    var s = saved();
    if (s) root.setAttribute('data-theme', s);
    var host = document.querySelector('.hdr .wrap') || document.querySelector('.top .wrap');
    if (host && !document.getElementById('themeBtn')) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'themeBtn'; btn.className = 'theme-btn';
      btn.innerHTML = SUN + MOON;
      var menu = host.querySelector('.menu-btn') || host.querySelector('.nav');
      if (menu) host.insertBefore(btn, menu); else host.appendChild(btn);
      btn.addEventListener('click', function () { apply(cur() === 'dark' ? 'light' : 'dark', true); });
    }
    paint();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
  window.addEventListener('storage', function (e) { if (e.key === KEY && (e.newValue === 'dark' || e.newValue === 'light')) apply(e.newValue, false); });
})();
