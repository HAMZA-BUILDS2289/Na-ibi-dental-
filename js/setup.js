/* Setup check: tells you exactly which step is done and which is not. */
(function () {
  'use strict';
  var esc = NB.u.esc, app = document.getElementById('app');
  var R = { cfg: null, reach: null, db: null, admin: null, dentist: null, api: null, health: null, sql1: '', sql2: '' };

  function row(state, title, text) {
    return '<div class="st ' + state + '"><span class="ico">' + (state === 'ok' ? '&#10003;' : state === 'bad' ? '!' : '&middot;') + '</span><div><b>' + title + '</b><div class="muted small">' + text + '</div></div></div>';
  }
  function render() {
    var h = '<h1 style="font-size:2.3rem;margin-bottom:6px">Setup check</h1><p class="muted" style="margin-bottom:16px">Green ticks mean that step is done. Fix the first red one, then press “Check again”.</p><div class="status-list">';
    h += row(R.cfg ? 'ok' : 'bad', '1. Website knows your Supabase project', R.cfg ? 'js/config.js has your project URL and key.' : 'Open <code>js/config.js</code> in GitHub and paste your Project URL and the anon public key. Then wait for Vercel to redeploy (about a minute).');
    h += row(R.reach === null ? 'wait' : R.reach ? 'ok' : 'bad', '2. Supabase project is reachable', R.reach === null ? 'Waiting for step 1.' : R.reach ? 'Connected.' : 'Could not reach the project. Check the URL, and that the project is not paused (Supabase dashboard > Restore project).');
    h += row(R.db === null ? 'wait' : R.db ? 'ok' : 'bad', '3. Database tables and rules installed', R.db === null ? 'Waiting for step 2.' : R.db ? 'Installed (' + (R.health ? R.health.services : 0) + ' services found).' : 'Not installed yet. Copy <code>1-setup.sql</code> below, paste it in Supabase > SQL Editor > New query, and press Run.');
    h += row(R.admin === null ? 'wait' : R.admin ? 'ok' : 'bad', '4. First admin exists', R.admin === null ? 'Waiting for step 3.' : R.admin ? 'An admin account is ready. Sign in at <a href="staff.html">Staff login</a>.' : 'Create your login in Supabase > Authentication > Users > Add user, then run <code>2-first-admin.sql</code> (copy it below, edit the email and name first).');
    h += row(R.dentist === null ? 'wait' : R.dentist ? 'ok' : 'bad', '5. At least one dentist exists (so patients can see times)', R.dentist === null ? 'Waiting for step 4.' : R.dentist ? 'Dentists found. Booking will show free times.' : 'Sign in as admin, open Staff and rosters, and create a dentist account. Patients see no times until a dentist with a roster exists.');
    h += row(R.api === null ? 'wait' : R.api === 'ok' ? 'ok' : 'bad', '6. Staff-accounts service on Vercel', R.api === 'ok' ? 'Running with its keys.' : R.api === 'nokeys' ? 'Deployed, but the keys are missing. In Vercel > Settings > Environment Variables add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then redeploy.' : R.api === null ? 'Checking...' : 'Not found. This must be deployed on Vercel (the /api folder). It does not run from a plain file host.');
    h += '</div><div class="row" style="margin:16px 0"><button class="btn primary" data-a="again">Check again</button><a class="btn" href="book.html">Try patient booking</a><a class="btn" href="staff.html">Staff login</a></div>';
    h += '<div class="box"><b>SQL to paste into Supabase</b><p class="muted small" style="margin:4px 0 10px">Supabase dashboard > SQL Editor > New query > paste > Run. Run file 1 first, then file 2.</p>' +
      '<div class="row" style="margin-bottom:10px"><button class="btn small primary" data-a="copy" data-k="sql1">Copy 1-setup.sql</button><button class="btn small" data-a="copy" data-k="sql2">Copy 2-first-admin.sql</button></div>' +
      '<details><summary class="small muted" style="cursor:pointer">Show 2-first-admin.sql</summary><pre class="sql">' + esc(R.sql2 || 'loading...') + '</pre></details></div>';
    app.innerHTML = h;
  }
  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3000); }

  function check() {
    R.cfg = NB.configured(); R.reach = R.db = R.admin = R.dentist = R.health = null; R.api = null; render();
    fetch('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ping' }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function (j) { R.api = j.configured ? 'ok' : 'nokeys'; render(); }, function () { R.api = 'missing'; render(); });
    if (!R.cfg) { render(); return; }
    fetch(NB.base() + '/auth/v1/health', { headers: { apikey: window.NAIBI.SUPABASE_ANON_KEY } })
      .then(function (r) { R.reach = r.ok || r.status === 401 || r.status === 403; }, function () { R.reach = false; })
      .then(function () {
        render(); if (!R.reach) return;
        return NB.rpc('health', {}).then(function (j) { R.db = !!(j && j.ok); R.health = j; R.admin = j.admins > 0; R.dentist = j.dentists > 0; }, function () { R.db = false; R.admin = false; R.dentist = false; });
      }).then(render);
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-a]'); if (!t) return;
    if (t.dataset.a === 'again') check();
    if (t.dataset.a === 'copy') { var txt = R[t.dataset.k]; if (!txt) return toast('Still loading, try again.'); (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Copied. Now paste it into Supabase > SQL Editor.'); }, function () { toast('Could not copy automatically. Open the file db/' + (t.dataset.k === 'sql1' ? '1-setup.sql' : '2-first-admin.sql') + ' in GitHub and copy from there.'); }); }
  });
  fetch('db/1-setup.sql').then(function (r) { return r.text(); }).then(function (t) { R.sql1 = t; });
  fetch('db/2-first-admin.sql').then(function (r) { return r.text(); }).then(function (t) { R.sql2 = t; render(); });
  check();
})();
