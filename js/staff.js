/* Staff portal: admin, receptionist, dentist, technician. Everything goes through database functions
   that check the signed-in role, so hiding a button here is only for convenience, never for security. */
(function () {
  'use strict';
  var U = NB.u, esc = U.esc, app = document.getElementById('app');
  var DOWN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], ORDER = [1, 2, 3, 4, 5, 6, 0];
  var STATUS_LABEL = { pending: 'pending', confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled', no_show: 'no show' };

  var S = {
    D: null, state: 'boot', loginErr: '', busy: false, tab: null, viewAs: '',
    cal: { view: 'day', date: null, filter: 'all' },
    ap: { status: 'all', range: 'upcoming', q: '' },
    rs: null, arm: null, armReason: '', notes: null,
    book: { svc: '', date: '', slots: null, loading: false, time: null, name: '', phone: '', complaint: '', dentist: '', err: '', done: null, busy: false },
    pat: { q: '', res: null, who: null, busy: false },
    msgF: 'queued', staffSel: null, roster: null, ns: { name: '', email: '', role: 'dentist', title: '', phone: '', password: '' },
    cred: null, leave: { from: '', to: '', reason: '' }, closed: { day: '', reason: '' },
    sd: null, svcD: null, newSvc: { name: '', duration_min: 30, needs_tech: false, active: true, sort: 100, price_ngn: '', price_from: false, short: '', details: '' }, pw: { open: false, v: '' },
    ck: { ref: '', res: null, err: '', busy: false, done: false },
    login: { email: '', password: '' }
  };

  /* ---------- helpers ---------- */
  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4500); }
  function today() { return S.D ? S.D.server.today : U.iso(new Date()); }
  function nowMin() { return S.D ? S.D.server.nowmin : 0; }
  function setPath(path, val) { var p = path.split('.'), o = S; for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = val; }
  function staffById(id) { return S.D.staff.filter(function (s) { return s.id === id; })[0]; }
  function svcById(id) { return S.D.services.filter(function (s) { return s.id === id; })[0]; }
  function sname(id) { var s = id && staffById(id); return s ? s.full_name : '-'; }
  function eff() {
    var me = S.D.me;
    if (me.role === 'admin' && S.viewAs) { var s = staffById(S.viewAs); if (s) return { id: s.id, name: s.full_name, role: s.role, title: s.title, viewing: true }; }
    return { id: me.id, name: me.name, role: me.role, title: me.title, viewing: false };
  }
  function isMgr() { var r = eff().role; return r === 'admin' || r === 'receptionist'; }
  function genPw() {
    var c = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '', a = new Uint32Array(10);
    crypto.getRandomValues(a); for (var i = 0; i < 10; i++) out += c[a[i] % c.length]; return out;
  }
  function pwFor(role) { return role + '-' + genPw().slice(0, 6); }
  function jsonSet(a) { return JSON.parse(JSON.stringify(a)); }

  /* Is this staff member able to work at this time? (mirrors the database rule, used to flag visits that need moving) */
  function works(id, day, a, b) {
    var s = staffById(id); if (!s || !s.active) return false;
    var dow = U.parse(day).getDay();
    var h = S.D.hours.filter(function (x) { return x.staff_id === id && x.dow === dow; })[0];
    if (!h || a < h.start_min || b > h.end_min) return false;
    if (h.break_start != null && a < h.break_end && b > h.break_start) return false;
    if (S.D.leave.some(function (l) { return l.staff_id === id && day >= l.from_date && day <= l.to_date; })) return false;
    return true;
  }
  function isClosed(day) { return S.D.closed.some(function (c) { return c.day === day; }); }
  function attn(a) {
    if (a.status !== 'pending' && a.status !== 'confirmed') return false;
    if (a.day < today()) return false;
    var e = a.start_min + a.dur_min;
    return isClosed(a.day) || !works(a.dentist_id, a.day, a.start_min, e) || (a.tech_id && !works(a.tech_id, a.day, a.start_min, e));
  }
  function myAppts() {
    var e = eff(), all = S.D.appointments;
    if (e.role === 'dentist') return all.filter(function (a) { return a.dentist_id === e.id; });
    if (e.role === 'technician') return all.filter(function (a) { return a.tech_id === e.id; });
    return all;
  }
  function onDay(day, filter) {
    return myAppts().filter(function (a) { return a.day === day && (filter === 'all' || a.dentist_id === filter || a.tech_id === filter); })
      .sort(function (a, b) { return a.start_min - b.start_min; });
  }
  function live(a) { return a.status !== 'cancelled' && a.status !== 'no_show'; }
  function weekStart(d) { return U.addDays(d, -((U.parse(d).getDay() + 6) % 7)); }

  /* ---------- data loading ---------- */
  function load(silent) {
    return NB.rpc('staff_data', {}, true).then(function (D) {
      S.D = D; S.state = 'ready';
      if (!S.cal.date) S.cal.date = D.server.today;
      if (!S.ns.password) S.ns.password = pwFor(S.ns.role);
      if (!S.sd) S.sd = settingsDraft();
      if (!S.svcD) S.svcD = svcDrafts();
      if (!S.staffSel) { var f = D.staff.filter(function (s) { return s.role === 'dentist'; })[0] || D.staff[0]; S.staffSel = f && f.id; }
      render();
      if (pendingRef) { var pr = pendingRef; pendingRef = ''; S.tab = 'checkin'; ckLookup(pr); }
    }, function (e) {
      if (e.code === 'not_allowed') { S.state = 'nostaff'; render(); return; }
      if (e.code === 'not_signed_in' || e.status === 401) { NB.logout(); S.state = 'login'; render(); return; }
      if (!silent) toast(e.message);
      if (S.state === 'boot') { S.state = 'login'; S.loginErr = e.message; render(); }
    });
  }
  function settingsDraft() {
    var c = S.D.settings;
    return { clinic_name: c.clinic_name, phone: c.phone, whatsapp: c.whatsapp, open: U.hhmm(c.open_min), close: U.hhmm(c.close_min),
      slot_step: String(c.slot_step), cutoff_min: c.cutoff_min, max_days: c.max_days, max_open_per_phone: c.max_open_per_phone,
      auto_confirm: c.auto_confirm, channel: c.channel, open_days: c.open_days.slice() };
  }
  function svcDraft(s) { return { name: s.name, duration_min: s.duration_min, needs_tech: s.needs_tech, active: s.active, sort: s.sort, price_ngn: s.price_ngn == null ? '' : String(s.price_ngn), price_from: !!s.price_from, short: s.short || '', details: s.details || '' }; }
  function svcDrafts() { var o = {}; S.D.services.forEach(function (s) { o[s.id] = svcDraft(s); }); return o; }
  function svcBlank() { return { name: '', duration_min: 30, needs_tech: false, active: true, sort: 100, price_ngn: '', price_from: false, short: '', details: '' }; }
  function svcPayload(x, id) { var p = { name: x.name.trim(), duration_min: Number(x.duration_min), needs_tech: !!x.needs_tech, active: !!x.active, sort: Number(x.sort) || 100, price_ngn: String(x.price_ngn).replace(/[^0-9]/g, ''), price_from: !!x.price_from, short: x.short, details: x.details }; if (id) p.id = id; return p; }
  function rosterDraft(id) {
    var rows = {};
    ORDER.forEach(function (d) {
      var h = S.D.hours.filter(function (x) { return x.staff_id === id && x.dow === d; })[0];
      rows[d] = h ? { on: true, start: U.hhmm(h.start_min), end: U.hhmm(h.end_min), bs: h.break_start == null ? '' : U.hhmm(h.break_start), be: h.break_end == null ? '' : U.hhmm(h.break_end) }
        : { on: false, start: '09:00', end: '17:00', bs: '13:00', be: '14:00' };
    });
    return { id: id, rows: rows };
  }

  /* run an action, then refresh */
  function run(p, okMsg, after) {
    if (S.busy) return Promise.resolve();
    S.busy = true;
    return p().then(function (r) {
      S.busy = false; if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      return load(true).then(function () { if (after) { after(r); render(); } return r; });
    }, function (e) { S.busy = false; toast(e.message); load(true); });
  }
  function rpc(name, args) { return NB.rpc(name, args, true); }

  /* ---------- views: login and shell ---------- */
  function vLogin() {
    return '<div class="wrap"><div class="login card"><h1 style="font-size:2.2rem">Staff sign in</h1><p class="muted" style="margin:6px 0 16px">For NA’IBI Dental Clinic staff only. Patients do not need to sign in to book.</p>' +
      (NB.configured() ? '' : '<div class="notice warn">The database is not connected yet. Open <a href="setup.html">the setup check</a>.</div>') +
      '<form data-form="login"><div class="field"><label for="l-email">Email</label><input id="l-email" type="email" data-in="login.email" value="' + esc(S.login.email) + '" autocomplete="username" required></div>' +
      '<div class="field"><label for="l-pw">Password</label><input id="l-pw" type="password" data-in="login.password" value="' + esc(S.login.password) + '" autocomplete="current-password" required></div>' +
      (S.loginErr ? '<div class="notice bad" role="alert">' + esc(S.loginErr) + '</div>' : '') +
      '<button class="btn primary" type="submit" style="width:100%"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Signing in...' : 'Sign in') + '</button></form>' +
      '<p class="muted small" style="margin-top:14px">Forgot your password? Ask the clinic admin to reset it for you.</p></div></div>';
  }
  function vNoStaff() {
    return '<div class="wrap"><div class="login card"><h2>No staff access yet</h2><p class="muted" style="margin:8px 0 14px">You are signed in, but this login has not been set up as a staff account (or it was deactivated). Please ask the admin.</p><button class="btn" data-a="logout">Sign out</button></div></div>';
  }

  function tabsFor(role) {
    if (role === 'admin') return [['today', 'Today'], ['checkin', 'Scan check-in'], ['calendar', 'Calendar'], ['appointments', 'Appointments'], ['book', 'Book for patient'], ['patients', 'Patients'], ['messages', 'Messages'], ['staff', 'Staff and rosters'], ['services', 'Services and prices'], ['settings', 'Settings']];
    if (role === 'receptionist') return [['today', 'Today'], ['checkin', 'Scan check-in'], ['calendar', 'Calendar'], ['appointments', 'Appointments'], ['book', 'Book for patient'], ['patients', 'Patients'], ['messages', 'Messages']];
    if (role === 'dentist') return [['mine', 'My schedule'], ['checkin', 'Scan check-in'], ['calendar', 'Calendar'], ['patients', 'Patients']];
    return [['mine', 'My schedule'], ['checkin', 'Scan check-in'], ['calendar', 'Calendar']];
  }
  function vShell() {
    var e = eff(), me = S.D.me, tabs = tabsFor(e.role);
    if (!S.tab || !tabs.some(function (t) { return t[0] === S.tab; })) S.tab = tabs[0][0];
    var pend = isMgr() ? S.D.appointments.filter(function (a) { return a.status === 'pending' && a.day >= today(); }).length : 0;
    var queued = isMgr() ? S.D.messages.filter(function (m) { return m.status === 'queued'; }).length : 0;
    var body = { today: vToday, checkin: vCheckin, mine: vMine, calendar: vCalendar, appointments: vAppointments, book: vBook, patients: vPatients, messages: vMessages, staff: vStaff, services: vServices, settings: vSettings }[S.tab]();
    var h = '<div class="wrap" style="padding-block:18px 10px"><div class="who"><span class="avatar">' + esc(U.initials(me.name)) + '</span><div><b>' + esc(me.name) + '</b><br><span class="pill role">' + esc(me.role) + '</span> <span class="muted small">' + esc(me.email || '') + '</span></div>' +
      '<span class="row" style="margin-left:auto">';
    if (me.role === 'admin') {
      h += '<label class="small muted" for="viewas">Preview as</label><select id="viewas" data-in="viewAs" data-c="viewas" style="width:auto"><option value="">Myself (admin)</option>' +
        S.D.staff.filter(function (s) { return s.active && s.id !== me.id; }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (S.viewAs === s.id ? ' selected' : '') + '>' + esc(s.full_name) + ' (' + esc(s.role) + ')</option>'; }).join('') + '</select>';
    }
    h += '<button class="btn small" data-a="pwtoggle">Password</button><button class="btn small" data-a="logout">Sign out</button></span></div>';
    if (S.pw.open) h += '<div class="box"><b>Change my password</b><div class="row" style="margin-top:10px"><input type="password" id="newpw" data-in="pw.v" value="' + esc(S.pw.v) + '" autocomplete="new-password" placeholder="At least 8 characters" style="max-width:280px" aria-label="New password"><button class="btn primary small" data-a="pwsave">Save password</button></div></div>';
    if (e.viewing) h += '<div class="notice info">Previewing the portal as <b>' + esc(e.name) + '</b> (' + esc(e.role) + '). This is how their screens look. Your own admin rights still apply to anything you click.</div>';
    h += '<div class="tabs" role="tablist">' + tabs.map(function (t) {
      var dot = t[0] === 'today' && pend ? '<span class="dot" aria-label="' + pend + ' waiting">' + pend + '</span>' : (t[0] === 'messages' && queued ? '<span class="dot">' + queued + '</span>' : '');
      return '<button class="' + (S.tab === t[0] ? 'on' : '') + '" data-a="tab" data-t="' + t[0] + '" role="tab">' + t[1] + dot + '</button>';
    }).join('') + '</div>' + body + '</div>';
    return h;
  }

  /* ---------- appointment card ---------- */
  function waLink(phone, text) { return 'https://wa.me/' + U.intl(phone) + '?text=' + encodeURIComponent(text); }
  function apptCard(a, o) {
    o = o || {};
    var e = eff(), mgr = isMgr(), mine = e.role === 'dentist' && a.dentist_id === e.id, bad = attn(a);
    var h = '<div class="appt ' + a.status + (bad ? ' attn' : '') + '"><div class="head"><span class="time">' + U.fmtD(a.day) + ' · ' + U.fmtT(a.start_min) + ' to ' + U.fmtT(a.start_min + a.dur_min) + '</span><span class="row" style="gap:6px">' +
      (bad ? '<span class="pill attn">needs rescheduling</span>' : '') + (a.arrived_at ? '<span class="pill confirmed">arrived ' + clock(a.arrived_at) + '</span>' : '') + '<span class="pill ' + a.status + '">' + STATUS_LABEL[a.status] + '</span></span></div>' +
      '<div class="meta"><span><b>' + esc(a.patient_name) + '</b> · ' + esc(a.phone) + '</span><span>' + esc(a.service_name) + '</span>' +
      '<span>Problem: ' + esc(a.complaint || '-') + '</span><span>Dentist: <b>' + esc(a.dentist_name) + '</b>' + (a.tech_name ? ' · Technician: <b>' + esc(a.tech_name) + '</b>' : '') + '</span>' +
      '<span class="small">Ref ' + esc(a.ref) + ' · ' + (a.source === 'reception' ? 'booked by reception' : 'booked online') + (a.cancel_reason ? ' · reason: ' + esc(a.cancel_reason) : '') + '</span>' +
      (a.notes ? '<span class="small"><b>Notes:</b> ' + esc(a.notes) + '</span>' : '') + '</div>';
    if (o.readonly) return h + '</div>';
    var act = '';
    if (mgr) {
      if (a.status === 'pending') act += '<button class="btn small primary" data-a="status" data-id="' + a.id + '" data-s="confirmed">Confirm</button>';
      if (a.status === 'pending' || a.status === 'confirmed') act += '<button class="btn small" data-a="rs-open" data-id="' + a.id + '">Reschedule</button><button class="btn small" data-a="remind" data-id="' + a.id + '">Queue reminder</button><a class="btn small wa" target="_blank" rel="noopener" href="' + waLink(a.phone, 'Hello ' + a.patient_name.split(' ')[0] + ', this is NA’IBI Dental Clinic about your appointment ' + a.ref + '.') + '">WhatsApp</a>';
      if (a.status === 'confirmed' && a.day <= today()) act += '<button class="btn small" data-a="status" data-id="' + a.id + '" data-s="completed">Mark completed</button><button class="btn small" data-a="status" data-id="' + a.id + '" data-s="no_show">No-show</button>';
      if (a.status === 'pending' || a.status === 'confirmed') act += '<button class="btn small danger" data-a="arm" data-id="' + a.id + '">Cancel</button>';
      if (a.status === 'cancelled' || a.status === 'no_show') act += '<button class="btn small" data-a="rs-open" data-id="' + a.id + '">Rebook</button>';
    } else if (mine && (a.status === 'confirmed' || a.status === 'pending') && a.day <= today()) {
      act += '<button class="btn small primary" data-a="status" data-id="' + a.id + '" data-s="completed">Mark completed</button><button class="btn small" data-a="status" data-id="' + a.id + '" data-s="no_show">No-show</button>';
    }
    if (mgr || mine) act += '<button class="btn small" data-a="notes-open" data-id="' + a.id + '">Notes</button>';
    if (mgr || e.role === 'dentist') act += '<button class="btn small" data-a="history" data-phone="' + esc(a.phone) + '">Patient history</button>';
    if (act) h += '<div class="actions">' + act + '</div>';
    if (S.arm === a.id) {
      h += '<div class="box" style="margin:4px 0 0;border-color:var(--bad)"><b>Cancel this appointment?</b><p class="muted small" style="margin:4px 0 8px">The time becomes free for other patients right away, and a message is queued for ' + esc(a.patient_name.split(' ')[0]) + '.</p>' +
        '<input data-in="armReason" value="' + esc(S.armReason) + '" placeholder="Reason (optional), e.g. patient called" aria-label="Cancel reason" style="margin-bottom:8px"><div class="actions"><button class="btn small danger armed" data-a="cancel-do" data-id="' + a.id + '">Yes, cancel appointment</button><button class="btn small" data-a="arm-close">Keep it</button></div></div>';
    }
    if (S.notes && S.notes.id === a.id) {
      h += '<div class="box" style="margin:4px 0 0"><b>Visit notes</b><textarea data-in="notes.text" aria-label="Visit notes" style="margin:8px 0">' + esc(S.notes.text) + '</textarea><div class="actions"><button class="btn small primary" data-a="notes-save" data-id="' + a.id + '">Save notes</button><button class="btn small" data-a="notes-close">Close</button></div></div>';
    }
    if (S.rs && S.rs.id === a.id) {
      var r = S.rs;
      h += '<div class="box" style="margin:4px 0 0"><b>Move to a new time</b><p class="muted small" style="margin:2px 0 8px">Only times when the dentist' + (svcById(a.service_id) && svcById(a.service_id).needs_tech ? ' and a technician are' : ' is') + ' free are shown. The same dentist is kept when possible.</p>' +
        '<div class="field"><label for="rs-date">New date</label><input type="date" id="rs-date" data-in="rs.date" data-c="rs-date" min="' + today() + '" value="' + esc(r.date) + '" style="max-width:220px"></div>' +
        (r.loading ? '<p class="muted small">Loading times...</p>' : r.slots ? ('<div class="slots">' + (r.slots.length ? r.slots.map(function (m) { return '<button class="slot' + (r.time === m ? ' on' : '') + '" data-a="rs-time" data-m="' + m + '">' + U.fmtT(m) + '</button>'; }).join('') : '<p class="muted small">No free times that day.</p>') + '</div>') : '') +
        '<div class="actions" style="margin-top:10px"><button class="btn small primary" data-a="rs-save" data-id="' + a.id + '"' + (r.time == null ? ' disabled' : '') + '>Save new time</button><button class="btn small" data-a="rs-close">Close</button></div></div>';
    }
    return h + '</div>';
  }
  function list(arr, empty, o) { return arr.length ? arr.map(function (a) { return apptCard(a, o); }).join('') : '<div class="notice info">' + empty + '</div>'; }
  function byTime(a, b) { return (a.day + U.pad(a.start_min / 60 | 0) + U.pad(a.start_min % 60)).localeCompare(b.day + U.pad(b.start_min / 60 | 0) + U.pad(b.start_min % 60)); }

  /* ---------- tab: today (admin, receptionist) ---------- */
  function stat(n, label) { return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>'; }
  function vToday() {
    var t = today(), all = S.D.appointments;
    var td = all.filter(function (a) { return a.day === t && live(a); }).sort(byTime);
    var pend = all.filter(function (a) { return a.status === 'pending' && a.day >= t && !attn(a); }).sort(byTime);
    var bad = all.filter(attn).sort(byTime);
    var done = td.filter(function (a) { return a.status === 'completed'; }).length;
    var h = '<h2 style="margin-bottom:12px">' + U.fmtDL(t) + '</h2><div class="stats">' + stat(td.length, 'visits today') + stat(done, 'completed today') + stat(all.filter(function (a) { return a.status === 'pending' && a.day >= t; }).length, 'waiting to be confirmed') + stat(bad.length, 'need rescheduling') + '</div>';
    if (bad.length) h += '<div class="notice bad"><b>' + bad.length + ' booked visit' + (bad.length > 1 ? 's' : '') + ' can no longer go ahead</b> (leave, a changed roster or a closed day). Reschedule them below.</div><h3 style="margin:8px 0">Needs rescheduling</h3>' + list(bad, '');
    if (pend.length) h += '<h3 style="margin:14px 0 8px">Waiting for confirmation</h3>' + list(pend.slice(0, 25), '');
    h += '<h3 style="margin:14px 0 8px">Today’s visits</h3>' + list(td, 'No visits booked for today.');
    return h;
  }

  /* ---------- tab: my schedule (dentist, technician) ---------- */
  function vMine() {
    var e = eff(), t = today(), h = '', any = false;
    var hrs = ORDER.map(function (d) {
      var x = S.D.hours.filter(function (r) { return r.staff_id === e.id && r.dow === d; })[0];
      return x ? DOWN[d] + ' ' + U.fmtT(x.start_min) + '-' + U.fmtT(x.end_min) : null;
    }).filter(Boolean);
    var lv = S.D.leave.filter(function (l) { return l.staff_id === e.id; });
    h += '<div class="box"><b>My roster</b><p class="small muted" style="margin-top:6px">' + (hrs.join(' · ') || 'No days set yet. Ask the admin to set your roster.') + '</p>' +
      (lv.length ? '<p class="small muted">Leave: ' + lv.map(function (l) { return U.fmtD(l.from_date) + ' to ' + U.fmtD(l.to_date); }).join(', ') + '</p>' : '') + '</div>';
    var td = onDay(t, 'all').filter(live);
    h += '<div class="stats">' + stat(td.length, 'visits today') + stat(td.filter(function (a) { return a.status === 'completed'; }).length, 'completed') + '</div>';
    for (var i = 0; i < 8; i++) {
      var d = U.addDays(t, i), l = onDay(d, 'all').filter(live);
      if (l.length) { any = true; h += '<h3 style="margin:14px 0 8px">' + (i === 0 ? 'Today · ' : '') + U.fmtDL(d) + '</h3>' + l.map(function (a) { return apptCard(a); }).join(''); }
    }
    if (!any) h += '<div class="notice info">No visits assigned to you in the next 7 days.</div>';
    return h;
  }

  /* ---------- tab: calendar ---------- */
  function vCalendar() {
    var c = S.cal, v = c.view, d = c.date, f = isMgr() ? c.filter : 'all', h = '';
    var title = v === 'day' ? U.fmtDL(d) : v === 'week' ? ('Week of ' + U.fmtD(weekStart(d))) : U.parse(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    h += '<div class="cal-bar"><div class="seg">' + ['day', 'week', 'month'].map(function (x) { return '<button class="' + (v === x ? 'on' : '') + '" data-a="cal-view" data-v="' + x + '">' + x[0].toUpperCase() + x.slice(1) + '</button>'; }).join('') + '</div>' +
      '<button class="btn small" data-a="cal-nav" data-n="-1" aria-label="Previous">&lsaquo;</button><button class="btn small" data-a="cal-today">Today</button><button class="btn small" data-a="cal-nav" data-n="1" aria-label="Next">&rsaquo;</button>';
    if (isMgr()) h += '<select data-in="cal.filter" data-c="rerender" aria-label="Filter by staff"><option value="all">All dentists and technicians</option>' +
      S.D.staff.filter(function (s) { return s.active && (s.role === 'dentist' || s.role === 'technician'); }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (c.filter === s.id ? ' selected' : '') + '>' + esc(s.full_name) + '</option>'; }).join('') + '</select>';
    h += '</div><h2 style="margin-bottom:12px;font-size:1.5rem">' + title + '</h2>';
    if (v === 'day') {
      var dow = U.parse(d).getDay();
      var duty = S.D.staff.filter(function (s) { return s.active && (s.role === 'dentist' || s.role === 'technician') && !S.D.leave.some(function (l) { return l.staff_id === s.id && d >= l.from_date && d <= l.to_date; }) && S.D.hours.some(function (x) { return x.staff_id === s.id && x.dow === dow; }); });
      h += '<div class="box"><b>On duty</b><div class="row" style="margin-top:8px">' + (duty.length && !isClosed(d) ? duty.map(function (s) {
        var x = S.D.hours.filter(function (r) { return r.staff_id === s.id && r.dow === dow; })[0];
        return '<span class="pill role">' + esc(s.full_name) + ' · ' + U.fmtT(x.start_min) + ' to ' + U.fmtT(x.end_min) + '</span>';
      }).join('') : '<span class="muted small">Nobody scheduled</span>') + '</div>' +
        S.D.staff.filter(function (s) { return s.active && S.D.leave.some(function (l) { return l.staff_id === s.id && d >= l.from_date && d <= l.to_date; }); }).map(function (s) { return '<p class="small muted" style="margin-top:6px">' + esc(s.full_name) + ' is on leave.</p>'; }).join('') +
        (isClosed(d) ? '<p class="small muted" style="margin-top:6px">The clinic is closed on this date.</p>' : '') + '</div>';
      h += list(onDay(d, f), 'No visits on this day.');
    } else if (v === 'week') {
      var ws = weekStart(d); h += '<div class="week">';
      for (var i = 0; i < 7; i++) {
        var dd = U.addDays(ws, i), l = onDay(dd, f).filter(live);
        h += '<div class="wcol' + (dd === today() ? ' today' : '') + '"><h4>' + U.fmtD(dd) + '</h4>' + (l.length ? l.map(function (a) { return '<button class="wev ' + a.status + '" data-a="cal-day" data-d="' + dd + '">' + U.fmtT(a.start_min).replace(' ', '') + ' ' + esc(a.patient_name.split(' ')[0]) + '</button>'; }).join('') : '<span class="muted small">-</span>') + '</div>';
      }
      h += '</div>';
    } else {
      var first = U.parse(d); first.setDate(1); var off = (first.getDay() + 6) % 7, st = new Date(first); st.setDate(1 - off);
      h += '<div class="month">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (x) { return '<div class="mh">' + x + '</div>'; }).join('');
      for (var j = 0; j < 42; j++) {
        var cd = new Date(st); cd.setDate(st.getDate() + j); var ci = U.iso(cd), n = onDay(ci, f).filter(live).length;
        h += '<button class="mday' + (cd.getMonth() !== first.getMonth() ? ' out' : '') + (ci === today() ? ' today' : '') + '" data-a="cal-day" data-d="' + ci + '">' + cd.getDate() + (n ? '<i>' + n + '</i>' : '') + '</button>';
      }
      h += '</div>';
    }
    return h;
  }

  /* ---------- tab: appointments ---------- */
  function vAppointments() {
    var p = S.ap, t = today(), q = p.q.toLowerCase();
    var arr = S.D.appointments.filter(function (a) {
      if (p.status === 'attention') { if (!attn(a)) return false; } else if (p.status !== 'all' && a.status !== p.status) return false;
      if (p.range === 'today' && a.day !== t) return false;
      if (p.range === 'upcoming' && a.day < t) return false;
      if (p.range === 'past' && a.day >= t) return false;
      if (q && (a.patient_name + ' ' + a.phone + ' ' + a.ref + ' ' + a.service_name).toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(byTime);
    if (p.range === 'past') arr.reverse();
    var sel = function (key, opts) { return '<select data-in="ap.' + key + '" data-c="rerender" aria-label="' + key + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (p[key] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; };
    return '<div class="cal-bar">' + sel('status', [['all', 'All statuses'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['completed', 'Completed'], ['cancelled', 'Cancelled'], ['no_show', 'No-show'], ['attention', 'Needs rescheduling']]) +
      sel('range', [['upcoming', 'Upcoming'], ['today', 'Today'], ['past', 'Past'], ['all', 'All dates']]) +
      '<input id="q" data-in="ap.q" data-live="1" value="' + esc(p.q) + '" placeholder="Search name, phone or ref" style="max-width:250px" aria-label="Search"></div>' +
      '<p class="muted small" style="margin-bottom:10px">' + arr.length + ' appointment' + (arr.length === 1 ? '' : 's') + ' · showing the last 30 days and the next 90 days</p>' + list(arr.slice(0, 120), 'Nothing matches.');
  }

  /* ---------- tab: book for patient ---------- */
  function vBook() {
    var b = S.book;
    if (b.done) {
      var a = b.done;
      return '<div class="box done"><div class="big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></div><h2>Booked and confirmed</h2><p class="ref" style="margin-top:8px">' + esc(a.ref) + '</p>' +
        '<p style="margin:10px 0"><b>' + esc(a.service_name) + '</b><br>' + U.fmtDL(a.day) + ' at ' + U.fmtT(a.start_min) + '<br>Dentist: <b>' + esc(a.dentist_name) + '</b>' + (a.tech_name ? '<br>Technician: <b>' + esc(a.tech_name) + '</b>' : '') + '</p>' +
        '<div class="row" style="justify-content:center"><a class="btn wa" target="_blank" rel="noopener" href="' + waLink(a.phone, 'Hello ' + a.patient_name.split(' ')[0] + ', your NA’IBI Dental Clinic appointment is confirmed: ' + a.service_name + ', ' + U.fmtDL(a.day) + ' at ' + U.fmtT(a.start_min) + '. Ref ' + a.ref + '.') + '">Send confirmation on WhatsApp</a><button class="btn" data-a="book-again">Book another</button></div></div>';
    }
    var sv = b.svc && svcById(b.svc);
    var dens = sv ? S.D.staff.filter(function (s) { return s.role === 'dentist' && s.active && S.D.hours.some(function (x) { return x.staff_id === s.id; }); }) : [];
    return '<div style="max-width:720px"><div class="box"><h3>Book a visit for a patient</h3><p class="muted small" style="margin:4px 0 12px">Walk-ins and phone calls. These bookings are confirmed straight away.</p>' +
      '<div class="field"><label for="b-svc">Service</label><select id="b-svc" data-in="book.svc" data-c="book-svc"><option value="">Choose a service</option>' + S.D.services.filter(function (s) { return s.active; }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (b.svc === s.id ? ' selected' : '') + '>' + esc(s.name) + ' (' + s.duration_min + ' min)</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="b-date">Date</label><input type="date" id="b-date" data-in="book.date" data-c="book-date" min="' + today() + '" value="' + esc(b.date) + '" style="max-width:220px"></div>' +
      (b.loading ? '<p class="muted small">Loading times...</p>' : b.slots ? '<div class="field"><span class="lbl">Free times</span>' + (b.slots.length ? '<div class="slots">' + b.slots.map(function (m) { return '<button class="slot' + (b.time === m ? ' on' : '') + '" data-a="book-time" data-m="' + m + '">' + U.fmtT(m) + '</button>'; }).join('') + '</div>' : '<div class="notice warn">No free times that day for this service.</div>') + '</div>' : '') +
      (b.time != null ? '<div class="field"><label for="b-den">Preferred dentist (optional)</label><select id="b-den" data-in="book.dentist"><option value="">Any available dentist</option>' + dens.map(function (s) { return '<option value="' + esc(s.id) + '"' + (b.dentist === s.id ? ' selected' : '') + '>' + esc(s.full_name) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="b-name">Patient name</label><input id="b-name" data-in="book.name" value="' + esc(b.name) + '" maxlength="80"></div><div class="field"><label for="b-phone">Phone number</label><input id="b-phone" data-in="book.phone" value="' + esc(b.phone) + '" inputmode="tel"></div>' +
        '<div class="field"><label for="b-comp">Problem (optional)</label><textarea id="b-comp" data-in="book.complaint" maxlength="500">' + esc(b.complaint) + '</textarea></div>' +
        (b.err ? '<div class="notice bad" role="alert">' + esc(b.err) + '</div>' : '') + '<button class="btn primary" data-a="book-submit"' + (b.busy ? ' disabled' : '') + '>Book for patient</button>' : '') + '</div></div>';
  }

  /* ---------- tab: patients ---------- */
  function vPatients() {
    var p = S.pat, h = '<div class="box"><b>Find a patient</b><p class="muted small" style="margin:4px 0 8px">Type a phone number to see every visit, or part of a name to search recent visits.</p><div class="row"><input id="pq" data-in="pat.q" value="' + esc(p.q) + '" placeholder="Phone number or name" style="max-width:300px" aria-label="Phone or name"><button class="btn primary" data-a="pat-search">Search</button></div></div>';
    if (p.res && p.res.names) {
      h += '<div class="box"><b>Patients matching “' + esc(p.q) + '”</b><div style="margin-top:8px">' + (p.res.names.length ? p.res.names.map(function (n) { return '<button class="srow" data-a="history" data-phone="' + esc(n.phone) + '"><span class="avatar">' + esc(U.initials(n.name)) + '</span><span><b>' + esc(n.name) + '</b><br><span class="muted small">' + esc(n.phone) + '</span></span></button>'; }).join('') : '<p class="muted">No recent patient with that name. Try the phone number.</p>') + '</div></div>';
    } else if (p.res) {
      var r = p.res.list, last = r.filter(function (a) { return a.status === 'completed'; })[0];
      h += r.length ? '<div class="box"><div class="who" style="margin:0"><span class="avatar">' + esc(U.initials(r[0].patient_name)) + '</span><div><b>' + esc(r[0].patient_name) + '</b><br><span class="muted">' + esc(r[0].phone) + '</span></div><span class="row" style="margin-left:auto"><span class="pill role">' + r.length + ' visit' + (r.length > 1 ? 's' : '') + '</span>' + (last ? '<span class="pill off">last treated ' + U.fmtD(last.day) + '</span>' : '') + '</span></div></div>' + r.map(function (a) { return apptCard(a, { readonly: true }); }).join('') : '<div class="notice info">No visits found for that number.</div>';
    }
    return h;
  }

  /* ---------- tab: messages ---------- */
  function vMessages() {
    var all = S.D.messages, f = S.msgF, arr = all.filter(function (m) { return f === 'all' || m.status === f; });
    var h = '<div class="notice info"><b>How messages work now.</b> The system writes each patient message for you (booked, confirmed, cancelled, rescheduled, reminder). Tap <b>Open ' + (S.D.settings.channel === 'sms' ? 'SMS' : 'WhatsApp') + '</b> to send it from the clinic phone, then tap <b>Mark sent</b>. Automatic sending is the next phase.</div>' +
      '<div class="cal-bar"><div class="seg">' + [['queued', 'To send'], ['sent', 'Sent'], ['all', 'All']].map(function (x) { return '<button class="' + (f === x[0] ? 'on' : '') + '" data-a="msgf" data-f="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
    h += arr.length ? arr.slice(0, 80).map(function (m) {
      var link = S.D.settings.channel === 'sms' ? 'sms:' + m.to_phone + '?body=' + encodeURIComponent(m.body) : waLink(m.to_phone, m.body);
      return '<div class="msg"><small>' + esc(m.kind) + ' · to ' + esc(m.to_phone) + ' · ' + new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + esc(m.status) + '</small>' + esc(m.body) +
        '<div class="actions" style="margin-top:8px"><a class="btn small wa" target="_blank" rel="noopener" href="' + link + '">Open ' + (S.D.settings.channel === 'sms' ? 'SMS' : 'WhatsApp') + '</a>' + (m.status === 'queued' ? '<button class="btn small" data-a="msg-sent" data-id="' + m.id + '">Mark sent</button>' : '') + '</div></div>';
    }).join('') : '<div class="notice info">Nothing here.</div>';
    return h;
  }

  /* ---------- tab: staff and rosters (admin) ---------- */
  function selectStaff(id) {
    S.staffSel = id; var s = staffById(id); if (!s) return;
    S.roster = rosterDraft(id);
    S.prof = { id: id, name: s.full_name, title: s.title || '', phone: s.phone || '' };
    S.svSel = S.D.staff_services.filter(function (x) { return x.staff_id === id; }).map(function (x) { return x.service_id; });
  }
  function credCard() {
    var c = S.cred; if (!c) return '';
    var url = location.origin + '/staff.html', msg = 'NA’IBI Dental Clinic staff login\nSign in: ' + url + '\nEmail: ' + c.email + '\nPassword: ' + c.password + '\nPlease change your password after signing in.';
    return '<div class="box" style="border-color:var(--ok)"><b>' + esc(c.title) + '</b><p class="muted small" style="margin:4px 0 8px">Copy these now. The password is not shown again. Share it privately.</p>' +
      '<div class="cred">Sign in: ' + esc(url) + '<br>Email: ' + esc(c.email) + '<br>Password: ' + esc(c.password) + '</div><div class="actions" style="margin-top:10px">' +
      '<button class="btn small primary" data-a="copy" data-t="' + esc(msg) + '">Copy details</button>' + (c.phone ? '<a class="btn small wa" target="_blank" rel="noopener" href="' + waLink(c.phone, msg) + '">Send on WhatsApp</a>' : '') +
      '<button class="btn small" data-a="cred-close">Done</button></div></div>';
  }
  function vStaff() {
    var sel = staffById(S.staffSel) || S.D.staff[0];
    if (!sel) return '<div class="notice info">No staff yet.</div>';
    if (!S.roster || S.roster.id !== sel.id) selectStaff(sel.id);
    var n = S.ns;
    var left = S.D.staff.map(function (s) {
      return '<button class="srow' + (s.id === sel.id ? ' on' : '') + '" data-a="staff-sel" data-id="' + esc(s.id) + '"><span class="avatar">' + esc(U.initials(s.full_name)) + '</span><span><b>' + esc(s.full_name) + '</b><br><span class="pill role">' + esc(s.role) + '</span> ' + (s.active ? '' : '<span class="pill off">inactive</span>') + '</span></button>';
    }).join('');
    var add = '<div class="box"><b>Create a staff login</b><p class="muted small" style="margin:4px 0 10px">This makes their account. They sign in at /staff.html with this email and password.</p>' +
      '<div class="field"><label for="ns-name">Full name</label><input id="ns-name" data-in="ns.name" value="' + esc(n.name) + '"></div>' +
      '<div class="field"><label for="ns-email">Email</label><input id="ns-email" type="email" data-in="ns.email" value="' + esc(n.email) + '" autocomplete="off"></div>' +
      '<div class="field"><label for="ns-role">Role</label><select id="ns-role" data-in="ns.role" data-c="ns-role">' + [['dentist', 'Dentist'], ['technician', 'Dental technician'], ['receptionist', 'Receptionist'], ['admin', 'Admin']].map(function (r) { return '<option value="' + r[0] + '"' + (n.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="ns-title">Job title (optional)</label><input id="ns-title" data-in="ns.title" value="' + esc(n.title) + '" placeholder="e.g. Orthodontist"></div>' +
      '<div class="field"><label for="ns-phone">Phone (optional)</label><input id="ns-phone" data-in="ns.phone" value="' + esc(n.phone) + '" inputmode="tel"></div>' +
      '<div class="field"><label for="ns-pw">Starting password</label><input id="ns-pw" data-in="ns.password" value="' + esc(n.password) + '" autocomplete="off"></div>' +
      '<button class="btn primary small" data-a="staff-add"' + (S.busy ? ' disabled' : '') + '>Create account</button></div>';
    var up = S.D.appointments.filter(function (a) { return (a.dentist_id === sel.id || a.tech_id === sel.id) && live(a) && a.day >= today() && a.status !== 'completed'; }).length;
    var ed = '<div class="box"><div class="who" style="margin-bottom:10px"><span class="avatar">' + esc(U.initials(sel.full_name)) + '</span><div><b>' + esc(sel.full_name) + '</b><br><span class="pill role">' + esc(sel.role) + '</span> <span class="muted small">' + esc(sel.email || '') + '</span></div></div>' +
      '<div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"><div class="field"><label for="p-name">Name</label><input id="p-name" data-in="prof.name" value="' + esc(S.prof.name) + '"></div><div class="field"><label for="p-title">Title</label><input id="p-title" data-in="prof.title" value="' + esc(S.prof.title) + '"></div><div class="field"><label for="p-phone">Phone</label><input id="p-phone" data-in="prof.phone" value="' + esc(S.prof.phone) + '"></div></div>' +
      '<div class="actions"><button class="btn small primary" data-a="prof-save">Save details</button><button class="btn small" data-a="pw-reset" data-id="' + esc(sel.id) + '">Reset password</button>' +
      (sel.active ? '<button class="btn small danger' + (S.arm === 'act-' + sel.id ? ' armed' : '') + '" data-a="staff-active" data-id="' + esc(sel.id) + '">' + (S.arm === 'act-' + sel.id ? 'Tap again to deactivate' : 'Deactivate') + '</button>' : '<button class="btn small" data-a="staff-active" data-id="' + esc(sel.id) + '">Reactivate</button>') + '</div>' +
      (sel.active && S.arm === 'act-' + sel.id && up ? '<div class="notice warn" style="margin-top:10px">' + up + ' upcoming visit' + (up > 1 ? 's are' : ' is') + ' booked with ' + esc(sel.full_name) + '. They will be flagged “needs rescheduling”.</div>' : '') + '</div>';
    if (sel.role === 'dentist') {
      ed += '<div class="box"><b>Services this dentist offers</b><p class="muted small" style="margin:2px 0 8px">Patients are only matched to a dentist who offers the service they pick.</p><div class="row">' +
        S.D.services.filter(function (s) { return s.active; }).map(function (s) { return '<label class="check"><input type="checkbox" data-c="sv-toggle" data-svc="' + esc(s.id) + '"' + (S.svSel.indexOf(s.id) > -1 ? ' checked' : '') + '> ' + esc(s.name) + '</label>'; }).join('') + '</div><div class="actions" style="margin-top:8px"><button class="btn small primary" data-a="svc-save">Save services</button></div></div>';
    }
    if (sel.role === 'dentist' || sel.role === 'technician' || sel.role === 'receptionist') {
      ed += '<div class="box"><b>Weekly duty roster</b><p class="muted small" style="margin:2px 0 8px">Booking slots only appear inside these hours and outside the break.</p><div class="tbl"><table><tr><th>Day</th><th>Works</th><th>Start</th><th>End</th><th>Break from</th><th>Break to</th></tr>' +
        ORDER.map(function (d) {
          var r = S.roster.rows[d], inp = function (f) { return '<td><input type="time" data-in="roster.rows.' + d + '.' + f + '" value="' + esc(r[f]) + '" aria-label="' + DOWN[d] + ' ' + f + '"></td>'; };
          return '<tr><td><b>' + DOWN[d] + '</b></td><td><input type="checkbox" data-in="roster.rows.' + d + '.on" data-c="chk"' + (r.on ? ' checked' : '') + ' aria-label="Works ' + DOWN[d] + '"></td>' + inp('start') + inp('end') + inp('bs') + inp('be') + '</tr>';
        }).join('') + '</table></div><div class="actions" style="margin-top:10px"><button class="btn small primary" data-a="roster-save">Save roster</button></div></div>';
      var lv = S.D.leave.filter(function (l) { return l.staff_id === sel.id; });
      ed += '<div class="box"><b>Leave and days off</b>' + (lv.map(function (l) { return '<div class="row" style="margin:6px 0"><span class="pill off">' + U.fmtD(l.from_date) + ' to ' + U.fmtD(l.to_date) + (l.reason ? ' · ' + esc(l.reason) : '') + '</span><button class="btn small" data-a="leave-del" data-id="' + l.id + '">Remove</button></div>'; }).join('') || '<p class="muted small" style="margin-top:6px">No leave booked.</p>') +
        '<div class="row" style="margin-top:10px"><input type="date" data-in="leave.from" value="' + esc(S.leave.from) + '" style="width:auto" aria-label="Leave from"><input type="date" data-in="leave.to" value="' + esc(S.leave.to) + '" style="width:auto" aria-label="Leave to"><input data-in="leave.reason" value="' + esc(S.leave.reason) + '" placeholder="Reason (optional)" style="width:auto" aria-label="Reason"><button class="btn small primary" data-a="leave-add">Add leave</button></div></div>';
    }
    return credCard() + '<div class="cols two"><div>' + left + add + '</div><div>' + ed + '</div></div>';
  }

  /* ---------- tab: scan check-in (all staff) ---------- */
  function clock(iso) { try { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }); } catch (e) { return ''; } }
  function refFrom(text) { var m = /NB-[A-Z0-9]{6,12}/i.exec(String(text || '')); return m ? m[0].toUpperCase() : ''; }
  var pendingRef = refFrom((new URLSearchParams(location.search)).get('checkin'));
  if (pendingRef) { try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  var scan = { stream: null, timer: null, el: null };
  function stopScan() {
    clearInterval(scan.timer); scan.timer = null;
    if (scan.stream) { scan.stream.getTracks().forEach(function (t) { t.stop(); }); scan.stream = null; }
    if (scan.el) { scan.el.remove(); scan.el = null; }
  }
  function ckLookup(raw) {
    var ref = refFrom(raw);
    if (!ref) { S.ck.err = 'That does not look like a booking code. It starts with NB- and has 8 letters or numbers.'; S.ck.res = null; S.ck.done = false; render(); return; }
    S.ck.ref = ref; S.ck.busy = true; S.ck.err = ''; S.ck.done = false; render();
    rpc('staff_lookup', { p_ref: ref }).then(function (r) { S.ck.busy = false; S.ck.res = r; render(); },
      function (e) { S.ck.busy = false; S.ck.res = null; S.ck.err = e.code === 'not_found' ? 'No booking found with that code.' : e.message; render(); });
  }
  function startScan() {
    if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return toast('This phone cannot scan inside the page. Open your normal Camera app, point it at the QR code and tap the link that appears.');
    }
    var det; try { det = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { return toast('Scanning is not available here. Use the Camera app or type the code.'); }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(function (stream) {
      stopScan(); scan.stream = stream;
      var el = document.createElement('div'); el.className = 'scanner';
      el.innerHTML = '<video playsinline muted autoplay></video><div class="scanframe"></div><p>Point the camera at the patient’s QR code</p><button class="btn" type="button">Close</button>';
      document.body.appendChild(el); scan.el = el;
      var v = el.querySelector('video'); v.srcObject = stream; v.play().catch(function () {});
      el.querySelector('button').addEventListener('click', stopScan);
      var busy = false;
      scan.timer = setInterval(function () {
        if (busy || !v.videoWidth) return; busy = true;
        det.detect(v).then(function (codes) {
          busy = false; if (!scan.el) return;
          for (var i = 0; i < codes.length; i++) { var ref = refFrom(codes[i].rawValue); if (ref) { stopScan(); ckLookup(ref); return; } }
        }, function () { busy = false; });
      }, 350);
    }, function () { toast('The camera is blocked. Allow camera access for this site in the browser, or type the code.'); });
  }
  function vCheckin() {
    var c = S.ck, r = c.res;
    var h = '<h2 style="margin-bottom:6px">Scan check-in</h2><p class="muted small" style="margin-bottom:12px">When a patient arrives, scan the QR code on their phone, or type the booking code.</p>' +
      '<div class="box"><div class="actions"><button class="btn primary" data-a="ck-scan">Scan QR code</button></div>' +
      '<p class="small muted" style="margin-top:8px">Tip: you can also scan with the phone’s normal Camera app. Tap the link and this page opens with the booking.</p>' +
      '<div class="field" style="margin-top:12px"><label for="ck-ref">Or type the booking code</label><div class="row"><input id="ck-ref" data-in="ck.ref" value="' + esc(c.ref) + '" placeholder="NB-XXXXXXXX" autocapitalize="characters" autocomplete="off" style="flex:1;min-width:0"><button class="btn" data-a="ck-find"' + (c.busy ? ' disabled' : '') + '>Find</button></div></div></div>';
    if (c.err) h += '<div class="notice bad">' + esc(c.err) + '</div>';
    if (c.busy) h += '<p class="muted">Looking up...</p>';
    if (r) {
      h += apptCard(r, { readonly: true });
      if (c.done) h += '<div class="notice ok"><b>Checked in at ' + clock(r.arrived_at) + '.</b> The patient can now go in.</div>';
      else if (r.status === 'cancelled' || r.status === 'no_show') h += '<div class="notice bad">This booking is ' + (r.status === 'cancelled' ? 'cancelled' : 'marked as a no-show') + ', so it cannot be checked in.</div>';
      else if (r.arrived_at) h += '<div class="notice warn"><b>Already checked in at ' + clock(r.arrived_at) + '.</b> This QR code was used before.</div>';
      else if (!r.is_today) h += '<div class="notice warn"><b>This booking is for ' + U.fmtDL(r.day) + ', not today.</b> Ask the patient, or reschedule it in Appointments.</div>';
      else h += '<div class="actions" style="margin-top:12px"><button class="btn primary" data-a="ck-do"' + (S.busy ? ' disabled' : '') + '>Check in ' + esc(r.patient_name) + '</button></div>';
      h += '<div class="actions" style="margin-top:10px"><button class="btn small" data-a="ck-next">Scan next patient</button></div>';
    }
    return h;
  }

  /* ---------- tab: services and prices (admin) ---------- */
  function naira(n) { return '₦' + Number(n).toLocaleString('en-NG'); }
  function svcFields(base, x, idp) {
    var id = function (k) { return idp + '-' + k; };
    return '<div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:8px">' +
      '<div class="field"><label for="' + id('n') + '">Service name</label><input id="' + id('n') + '" data-in="' + base + '.name" value="' + esc(x.name) + '" maxlength="80"></div>' +
      '<div class="field"><label for="' + id('p') + '">Price in naira</label><input id="' + id('p') + '" inputmode="numeric" data-in="' + base + '.price_ngn" value="' + esc(x.price_ngn) + '" placeholder="e.g. 25000"></div>' +
      '<div class="field"><label for="' + id('d') + '">Time needed (minutes)</label><input id="' + id('d') + '" type="number" min="15" max="480" step="15" data-in="' + base + '.duration_min" value="' + esc(x.duration_min) + '"></div>' +
      '<div class="field"><label for="' + id('o') + '">Order on the website</label><input id="' + id('o') + '" type="number" min="1" max="999" data-in="' + base + '.sort" value="' + esc(x.sort) + '"></div></div>' +
      '<div class="row" style="margin:6px 0 4px"><label class="check"><input type="checkbox" data-in="' + base + '.price_from" data-c="chk"' + (x.price_from ? ' checked' : '') + '> Show as “From” price</label>' +
      '<label class="check"><input type="checkbox" data-in="' + base + '.needs_tech" data-c="chk"' + (x.needs_tech ? ' checked' : '') + '> Needs a technician</label>' +
      '<label class="check"><input type="checkbox" data-in="' + base + '.active" data-c="chk"' + (x.active ? ' checked' : '') + '> Show on website and booking</label></div>' +
      '<div class="field"><label for="' + id('s') + '">Short line (shown in lists)</label><input id="' + id('s') + '" data-in="' + base + '.short" value="' + esc(x.short) + '" maxlength="200" placeholder="Leave empty to use the standard text"></div>' +
      '<div class="field"><label for="' + id('t') + '">About this treatment (shown on its page)</label><textarea id="' + id('t') + '" rows="3" data-in="' + base + '.details" maxlength="2000" placeholder="Leave empty to use the standard text">' + esc(x.details) + '</textarea></div>';
  }
  function vServices() {
    var n = S.newSvc;
    var h = '<div class="box"><b>Add a new service</b><p class="muted small" style="margin:2px 0 4px">It appears on the website and the booking page straight away, and every active dentist offers it until you change that in Staff and rosters. Leave the price empty and patients see “Ask for price”.</p>' +
      svcFields('newSvc', n, 'ns') + '<div class="actions" style="margin-top:10px"><button class="btn primary small" data-a="svc-add">Add service</button></div></div>';
    h += '<p class="muted small" style="margin:14px 2px 6px">' + S.D.services.length + ' service' + (S.D.services.length === 1 ? '' : 's') + '. Change anything, then tap <b>Save</b> on that service.</p>';
    S.D.services.forEach(function (s) {
      var x = S.svcD[s.id] || svcDraft(s), arm = S.arm === 'sdel-' + s.id;
      h += '<div class="box"><div class="row" style="justify-content:space-between"><b>' + esc(s.name) + '</b><span>' +
        (s.active ? '<span class="pill ok">on website</span>' : '<span class="pill off">hidden</span>') + ' <span class="pill role">' + (s.price_ngn == null ? 'ask for price' : (s.price_from ? 'from ' : '') + naira(s.price_ngn)) + '</span></span></div>' +
        svcFields('svcD.' + s.id, x, 'sv-' + s.id) +
        '<div class="actions" style="margin-top:10px"><button class="btn primary small" data-a="svc-row-save" data-id="' + esc(s.id) + '">Save</button>' +
        '<button class="btn small danger' + (arm ? ' armed' : '') + '" data-a="svc-del" data-id="' + esc(s.id) + '">' + (arm ? 'Tap again to delete for good' : 'Delete') + '</button></div></div>';
    });
    return h;
  }

  /* ---------- tab: settings (admin) ---------- */
  function vSettings() {
    var d = S.sd, c = S.D.settings;
    var h = '<div class="box"><b>Clinic and booking rules</b><div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-top:10px">' +
      '<div class="field"><label for="s-name">Clinic name</label><input id="s-name" data-in="sd.clinic_name" value="' + esc(d.clinic_name) + '"></div>' +
      '<div class="field"><label for="s-phone">Phone shown to patients</label><input id="s-phone" data-in="sd.phone" value="' + esc(d.phone) + '"></div>' +
      '<div class="field"><label for="s-wa">WhatsApp number (234...)</label><input id="s-wa" data-in="sd.whatsapp" value="' + esc(d.whatsapp) + '" inputmode="numeric"></div>' +
      '<div class="field"><label for="s-open">Opens</label><input id="s-open" type="time" data-in="sd.open" value="' + esc(d.open) + '"></div>' +
      '<div class="field"><label for="s-close">Closes</label><input id="s-close" type="time" data-in="sd.close" value="' + esc(d.close) + '"></div>' +
      '<div class="field"><label for="s-step">Time between slots</label><select id="s-step" data-in="sd.slot_step">' + ['15', '20', '30', '60'].map(function (x) { return '<option value="' + x + '"' + (d.slot_step === x ? ' selected' : '') + '>' + x + ' minutes</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="s-cut">Same-day cutoff (minutes)</label><input id="s-cut" type="number" min="0" step="15" data-in="sd.cutoff_min" value="' + esc(d.cutoff_min) + '"></div>' +
      '<div class="field"><label for="s-max">Days ahead patients can book</label><input id="s-max" type="number" min="1" max="90" data-in="sd.max_days" value="' + esc(d.max_days) + '"></div>' +
      '<div class="field"><label for="s-lim">Open bookings allowed per phone</label><input id="s-lim" type="number" min="1" max="10" data-in="sd.max_open_per_phone" value="' + esc(d.max_open_per_phone) + '"></div>' +
      '<div class="field"><label for="s-ch">Message channel</label><select id="s-ch" data-in="sd.channel"><option value="whatsapp"' + (d.channel === 'whatsapp' ? ' selected' : '') + '>WhatsApp</option><option value="sms"' + (d.channel === 'sms' ? ' selected' : '') + '>SMS</option></select></div></div>' +
      '<div class="field"><span class="lbl">Open days</span><div class="row">' + [1, 2, 3, 4, 5, 6, 0].map(function (x) { return '<label class="check"><input type="checkbox" data-c="od-toggle" data-d="' + x + '"' + (d.open_days.indexOf(x) > -1 ? ' checked' : '') + '> ' + DOWN[x] + '</label>'; }).join('') + '</div></div>' +
      '<label class="check"><input type="checkbox" data-in="sd.auto_confirm" data-c="chk"' + (d.auto_confirm ? ' checked' : '') + '> Confirm online bookings automatically (otherwise reception confirms each one)</label>' +
      '<div class="actions" style="margin-top:12px"><button class="btn primary small" data-a="settings-save">Save settings</button></div></div>';
    h += '<div class="box"><b>Services and prices</b><p class="muted small" style="margin:2px 0 8px">Treatments, prices and descriptions now have their own tab, <b>Services and prices</b>. Whatever you set there shows on the website and the booking page.</p></div>';
    h += '<div class="box"><b>Closed dates (holidays)</b>' + (S.D.closed.map(function (x) { return '<div class="row" style="margin:6px 0"><span class="pill off">' + U.fmtDL(x.day) + (x.reason ? ' · ' + esc(x.reason) : '') + '</span><button class="btn small" data-a="closed-del" data-day="' + x.day + '">Remove</button></div>'; }).join('') || '<p class="muted small" style="margin-top:6px">No closed dates.</p>') +
      '<div class="row" style="margin-top:10px"><input type="date" data-in="closed.day" value="' + esc(S.closed.day) + '" style="width:auto" aria-label="Closed date"><input data-in="closed.reason" value="' + esc(S.closed.reason) + '" placeholder="Reason (optional)" style="width:auto" aria-label="Reason"><button class="btn small primary" data-a="closed-add">Close this date</button></div></div>';
    h += '<div class="box"><b>Recent activity</b><div style="margin-top:8px">' + (S.D.audit.length ? S.D.audit.slice(0, 40).map(function (g) { return '<div class="msg"><small>' + new Date(g.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) + ' · ' + esc(g.actor_name || 'system') + ' · ' + esc(g.action) + '</small>' + esc(g.detail || '') + '</div>'; }).join('') : '<p class="muted small">Nothing yet.</p>') + '</div></div>';
    return h;
  }

  /* ---------- render ---------- */
  function render() {
    var y = window.scrollY;
    if (S.state === 'boot') app.innerHTML = '<div class="wrap"><p class="muted" style="padding:30px 0">Loading...</p></div>';
    else if (S.state === 'login') app.innerHTML = vLogin();
    else if (S.state === 'nostaff') app.innerHTML = vNoStaff();
    else app.innerHTML = vShell();
    window.scrollTo(0, y);
  }

  /* ---------- actions ---------- */
  function loadRsSlots() {
    var r = S.rs, a = S.D.appointments.filter(function (x) { return x.id === r.id; })[0]; if (!a || !r.date) return;
    r.loading = true; r.slots = null; r.time = null; render();
    rpc('staff_slots', { p_service: a.service_id, p_day: r.date, p_ignore: a.id }).then(function (s) { r.slots = s || []; r.loading = false; render(); }, function (e) { r.loading = false; r.slots = []; toast(e.message); render(); });
  }
  function loadBookSlots() {
    var b = S.book; if (!b.svc || !b.date) { b.slots = null; return; }
    b.loading = true; b.slots = null; b.time = null; render();
    var d = b.date, s = b.svc;
    rpc('staff_slots', { p_service: s, p_day: d }).then(function (x) { if (b.date !== d || b.svc !== s) return; b.slots = x || []; b.loading = false; render(); }, function (e) { b.loading = false; b.slots = []; toast(e.message); render(); });
  }
  function patSearch() {
    var q = S.pat.q.trim(), digits = q.replace(/\D/g, '');
    if (q.length < 2) { toast('Type a phone number or part of a name.'); return; }
    if (digits.length >= 7) {
      S.pat.busy = true;
      rpc('patient_history', { p_phone: q }).then(function (l) { S.pat.busy = false; S.pat.res = { list: l || [] }; render(); }, function (e) { S.pat.busy = false; toast(e.message); });
    } else {
      var seen = {}, names = [];
      S.D.appointments.forEach(function (a) { if (a.patient_name.toLowerCase().indexOf(q.toLowerCase()) > -1 && !seen[a.phone + a.patient_name]) { seen[a.phone + a.patient_name] = 1; names.push({ name: a.patient_name, phone: a.phone }); } });
      S.pat.res = { names: names }; render();
    }
  }
  function hoursFromDraft() {
    var out = [], err = null;
    ORDER.forEach(function (d) {
      var r = S.roster.rows[d]; if (!r.on) return;
      var a = U.tm(r.start || '00:00'), b = U.tm(r.end || '00:00'), bs = r.bs ? U.tm(r.bs) : null, be = r.be ? U.tm(r.be) : null;
      if (!(b > a)) err = DOWN[d] + ': the end time must be after the start time.';
      if ((bs == null) !== (be == null)) err = DOWN[d] + ': set both break times, or leave both empty.';
      if (bs != null && !(be > bs && bs >= a && be <= b)) err = DOWN[d] + ': the break must be inside working hours.';
      out.push({ dow: d, start_min: a, end_min: b, break_start: bs, break_end: be });
    });
    return err ? { err: err } : { hours: out };
  }
  function credFrom(title, s, pw) { return { title: title, email: s.email || s.e, password: pw, phone: s.phone || '' }; }

  var A = {
    logout: function () { NB.logout().then(function () { S.state = 'login'; S.D = null; S.tab = null; S.sd = null; S.svcD = null; S.cred = null; render(); }); },
    tab: function (t) { S.tab = t.dataset.t; S.arm = null; S.rs = null; S.notes = null; if (S.tab === 'settings') { S.sd = settingsDraft(); } if (S.tab === 'services') { S.svcD = svcDrafts(); } if (S.tab === 'staff') selectStaff(S.staffSel); if (S.tab === 'book') S.book = { svc: '', date: '', slots: null, loading: false, time: null, name: '', phone: '', complaint: '', dentist: '', err: '', done: null, busy: false }; render(); },
    pwtoggle: function () { S.pw.open = !S.pw.open; S.pw.v = ''; render(); },
    pwsave: function () {
      if (S.pw.v.length < 8) return toast('Use at least 8 characters.');
      NB.changePassword(S.pw.v).then(function () { S.pw = { open: false, v: '' }; toast('Password changed.'); render(); }, function (e) { toast(e.message); });
    },
    status: function (t) {
      var s = t.dataset.s, msg = { confirmed: 'Confirmed. A message is queued for the patient.', completed: 'Marked completed.', no_show: 'Marked as no-show.' }[s] || 'Updated.';
      run(function () { return rpc('set_appt_status', { p_id: t.dataset.id, p_status: s }); }, msg);
    },
    arm: function (t) { S.arm = t.dataset.id; S.armReason = ''; S.rs = null; render(); },
    'arm-close': function () { S.arm = null; render(); },
    'cancel-do': function (t) { run(function () { return rpc('set_appt_status', { p_id: t.dataset.id, p_status: 'cancelled', p_reason: S.armReason || null }); }, 'Cancelled. The time is free again and a message is queued.', function () { S.arm = null; }); },
    remind: function (t) { run(function () { return rpc('queue_reminder', { p_id: t.dataset.id }); }, 'Reminder queued. Open the Messages tab to send it.'); },
    'rs-open': function (t) { S.rs = { id: t.dataset.id, date: '', slots: null, time: null, loading: false }; S.arm = null; S.notes = null; render(); },
    'rs-close': function () { S.rs = null; render(); },
    'rs-time': function (t) { S.rs.time = Number(t.dataset.m); render(); },
    'rs-save': function (t) { run(function () { return rpc('reschedule_appt', { p_id: t.dataset.id, p_day: S.rs.date, p_start: S.rs.time }); }, 'Rescheduled. A message is queued for the patient.', function () { S.rs = null; }); },
    'notes-open': function (t) { var a = S.D.appointments.filter(function (x) { return x.id === t.dataset.id; })[0]; S.notes = { id: t.dataset.id, text: (a && a.notes) || '' }; S.rs = null; S.arm = null; render(); },
    'notes-close': function () { S.notes = null; render(); },
    'notes-save': function (t) { run(function () { return rpc('set_appt_notes', { p_id: t.dataset.id, p_notes: S.notes.text }); }, 'Notes saved.', function () { S.notes = null; }); },
    history: function (t) { S.tab = 'patients'; S.pat = { q: t.dataset.phone, res: null, busy: false }; render(); patSearch(); },
    'pat-search': function () { patSearch(); },
    'cal-view': function (t) { S.cal.view = t.dataset.v; render(); },
    'cal-nav': function (t) { var n = Number(t.dataset.n), v = S.cal.view; if (v === 'day') S.cal.date = U.addDays(S.cal.date, n); else if (v === 'week') S.cal.date = U.addDays(S.cal.date, 7 * n); else { var d = U.parse(S.cal.date); d.setMonth(d.getMonth() + n, 1); S.cal.date = U.iso(d); } render(); },
    'cal-today': function () { S.cal.date = today(); render(); },
    'cal-day': function (t) { S.cal.date = t.dataset.d; S.cal.view = 'day'; render(); },
    'book-time': function (t) { S.book.time = Number(t.dataset.m); render(); },
    'book-again': function () { S.book = { svc: '', date: '', slots: null, loading: false, time: null, name: '', phone: '', complaint: '', dentist: '', err: '', done: null, busy: false }; render(); },
    'book-submit': function () {
      var b = S.book;
      if (b.name.trim().length < 2) { b.err = 'Enter the patient’s name.'; return render(); }
      if (b.phone.replace(/\D/g, '').length < 10) { b.err = 'Enter a valid phone number.'; return render(); }
      b.err = ''; b.busy = true; render();
      rpc('staff_book', { p_service: b.svc, p_day: b.date, p_start: b.time, p_name: b.name, p_phone: b.phone, p_complaint: b.complaint || null, p_dentist: b.dentist || null }).then(function (r) {
        b.busy = false; b.done = r; load(true).then(render);
      }, function (e) { b.busy = false; b.err = e.message; if (e.code === 'slot_taken') loadBookSlots(); else render(); });
    },
    msgf: function (t) { S.msgF = t.dataset.f; render(); },
    'msg-sent': function (t) { run(function () { return rpc('mark_message_sent', { p_id: Number(t.dataset.id) }); }, 'Marked as sent.'); },
    copy: function (t) { var txt = t.dataset.t; (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast('Copied.'); }, function () { toast('Could not copy. Select the text and copy it by hand.'); }); },
    'cred-close': function () { S.cred = null; render(); },
    'staff-sel': function (t) { S.arm = null; selectStaff(t.dataset.id); render(); },
    'prof-save': function () { var p = S.prof, s = staffById(p.id); run(function () { return rpc('admin_save_staff', { p_id: p.id, p_name: p.name, p_title: p.title, p_phone: p.phone, p_active: s.active }); }, 'Details saved.', function () { selectStaff(p.id); }); },
    'staff-active': function (t) {
      var id = t.dataset.id, s = staffById(id);
      if (s.active && S.arm !== 'act-' + id) { S.arm = 'act-' + id; return render(); }
      S.arm = null;
      var p = s.active
        ? function () { return rpc('admin_save_staff', { p_id: id, p_name: s.full_name, p_title: s.title, p_phone: s.phone, p_active: false }).then(function () { return NB.staffApi('set_ban', { id: id, banned: true }); }); }
        : function () { return NB.staffApi('set_ban', { id: id, banned: false }).then(function () { return rpc('admin_save_staff', { p_id: id, p_name: s.full_name, p_title: s.title, p_phone: s.phone, p_active: true }); }); };
      run(p, s.active ? 'Account deactivated. They can no longer sign in.' : 'Account reactivated.', function () { selectStaff(id); });
    },
    'svc-save': function () { var id = S.staffSel, l = S.svSel.slice(); run(function () { return rpc('admin_set_staff_services', { p_staff: id, p_services: l }); }, 'Services saved.', function () { selectStaff(id); }); },
    'roster-save': function () {
      var r = hoursFromDraft(); if (r.err) return toast(r.err);
      var id = S.staffSel; run(function () { return rpc('admin_set_hours', { p_staff: id, p_hours: r.hours }); }, 'Roster saved. Booking times update straight away.', function () { selectStaff(id); });
    },
    'leave-add': function () {
      var l = S.leave; if (!l.from) return toast('Pick the first day of leave.'); var to = l.to || l.from; if (to < l.from) return toast('The end date is before the start date.');
      var id = S.staffSel; run(function () { return rpc('admin_add_leave', { p_staff: id, p_from: l.from, p_to: to, p_reason: l.reason || null }); },
        function (n) { return n ? 'Leave added. ' + n + ' booked visit' + (n > 1 ? 's' : '') + ' now need rescheduling (see the Today tab).' : 'Leave added. Those days are blocked for booking.'; }, function () { S.leave = { from: '', to: '', reason: '' }; });
    },
    'leave-del': function (t) { run(function () { return rpc('admin_del_leave', { p_id: Number(t.dataset.id) }); }, 'Leave removed.'); },
    'staff-add': function () {
      var n = S.ns;
      if (n.name.trim().length < 2) return toast('Enter the full name.');
      if (!/^\S+@\S+\.\S+$/.test(n.email.trim())) return toast('Enter a valid email address.');
      var pw = n.password || pwFor(n.role); if (pw.length < 8) return toast('The password needs at least 8 characters.');
      run(function () { return NB.staffApi('create', { email: n.email.trim(), password: pw, full_name: n.name.trim(), role: n.role, title: n.title, phone: n.phone }); }, 'Account created.', function (r) {
        S.cred = { title: 'Account created for ' + n.name.trim(), email: n.email.trim().toLowerCase(), password: pw, phone: n.phone };
        S.ns = { name: '', email: '', role: n.role, title: '', phone: '', password: pwFor(n.role) };
        if (r && r.id) selectStaff(r.id);
      });
    },
    'pw-reset': function (t) {
      var s = staffById(t.dataset.id), pw = genPw();
      run(function () { return NB.staffApi('reset_password', { id: s.id, password: pw }); }, 'Password reset.', function () { S.cred = { title: 'New password for ' + s.full_name, email: s.email, password: pw, phone: s.phone || '' }; });
    },
    'settings-save': function () {
      var d = S.sd; if (!d.open_days.length) return toast('Choose at least one open day.');
      var o = U.tm(d.open), c = U.tm(d.close); if (!(c > o)) return toast('Closing time must be after opening time.');
      run(function () { return rpc('admin_save_settings', { p: { clinic_name: d.clinic_name, phone: d.phone, whatsapp: d.whatsapp, open_min: o, close_min: c, slot_step: Number(d.slot_step), cutoff_min: Number(d.cutoff_min), max_days: Number(d.max_days), max_open_per_phone: Number(d.max_open_per_phone), auto_confirm: !!d.auto_confirm, channel: d.channel, open_days: d.open_days } }); }, 'Settings saved.', function () { S.sd = settingsDraft(); });
    },
    'svc-row-save': function (t) { var id = t.dataset.id, x = S.svcD[id]; if (x.name.trim().length < 2) return toast('Give the service a name.'); run(function () { return rpc('admin_save_service', { p: svcPayload(x, id) }); }, 'Service saved. The website shows it now.', function () { S.svcD = svcDrafts(); }); },
    'ck-scan': function () { startScan(); },
    'ck-find': function () { ckLookup(S.ck.ref); },
    'ck-next': function () { S.ck = { ref: '', res: null, err: '', busy: false, done: false }; render(); },
    'ck-do': function () {
      var ref = S.ck.res && S.ck.res.ref; if (!ref || S.busy) return;
      S.busy = true;
      rpc('staff_checkin', { p_ref: ref }).then(function (r) { S.busy = false; S.ck.res = r; S.ck.done = !r.already; toast(r.already ? 'Already checked in earlier.' : 'Checked in.'); load(true); render(); },
        function (e) { S.busy = false; toast(e.message); render(); });
    },
    'svc-add': function () { var x = S.newSvc; if (x.name.trim().length < 2) return toast('Enter the service name.'); run(function () { return rpc('admin_save_service', { p: svcPayload(x) }); }, 'Service added. It shows on the website and the booking page now.', function () { S.newSvc = svcBlank(); S.svcD = svcDrafts(); }); },
    'svc-del': function (t) { var id = t.dataset.id; if (S.arm !== 'sdel-' + id) { S.arm = 'sdel-' + id; return render(); } S.arm = null; run(function () { return rpc('admin_delete_service', { p_id: id }); }, 'Service deleted.', function () { S.svcD = svcDrafts(); }); },
    'closed-add': function () { var c = S.closed; if (!c.day) return toast('Pick a date.'); run(function () { return rpc('admin_add_closed', { p_day: c.day, p_reason: c.reason || null }); }, function (n) { return n ? 'Date closed. ' + n + ' booked visit' + (n > 1 ? 's' : '') + ' now need rescheduling.' : 'Date closed.'; }, function () { S.closed = { day: '', reason: '' }; }); },
    'closed-del': function (t) { run(function () { return rpc('admin_del_closed', { p_day: t.dataset.day }); }, 'Date reopened.'); }
  };
  var C = {
    rerender: function () { return true; },
    chk: function () { return true; },
    viewas: function () { S.tab = null; return true; },
    'rs-date': function () { loadRsSlots(); return false; },
    'book-svc': function () { S.book.dentist = ''; loadBookSlots(); return false; },
    'book-date': function () { loadBookSlots(); return false; },
    'ns-role': function () { S.ns.password = pwFor(S.ns.role); return true; },
    'sv-toggle': function (t) { var i = S.svSel.indexOf(t.dataset.svc); if (t.checked && i < 0) S.svSel.push(t.dataset.svc); if (!t.checked && i > -1) S.svSel.splice(i, 1); return false; },
    'od-toggle': function (t) { var d = Number(t.dataset.d), i = S.sd.open_days.indexOf(d); if (t.checked && i < 0) S.sd.open_days.push(d); if (!t.checked && i > -1) S.sd.open_days.splice(i, 1); return false; }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-a]'); if (!t || !A[t.dataset.a]) return;
    if (t.tagName === 'A') { if (t.dataset.a === 'x') return; }
    A[t.dataset.a](t, e);
  });
  document.addEventListener('submit', function (e) {
    if (e.target.dataset.form !== 'login') return; e.preventDefault();
    if (S.busy) return; S.busy = true; S.loginErr = ''; render();
    NB.login(S.login.email, S.login.password).then(function () { S.busy = false; S.login.password = ''; S.state = 'boot'; render(); return load(); },
      function (e2) { S.busy = false; S.loginErr = e2.message; render(); });
  });
  document.addEventListener('input', function (e) {
    var t = e.target; if (!t.dataset || !t.dataset.in || t.type === 'checkbox' || t.tagName === 'SELECT') return;
    setPath(t.dataset.in, t.type === 'number' && t.value !== '' ? t.value : t.value);
    if (t.dataset.live) { var pos = t.selectionStart; render(); var n = document.getElementById(t.id); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} } }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.dataset) return;
    if (t.dataset.in) setPath(t.dataset.in, t.type === 'checkbox' ? t.checked : t.value);
    var k = t.dataset.c, rerender = false;
    if (k && C[k]) rerender = C[k](t, e);
    if (rerender) render();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'pq') { e.preventDefault(); patSearch(); }
    if (e.key === 'Enter' && e.target.id === 'ck-ref') { e.preventDefault(); ckLookup(S.ck.ref); }
  });

  /* keep the screen fresh without interrupting typing */
  setInterval(function () {
    if (S.state !== 'ready' || S.busy || document.hidden) return;
    var el = document.activeElement; if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (S.cred || scan.el) return;
    load(true);
  }, 30000);

  /* auto sign-out: 3 minutes after the person leaves the site (tab hidden, phone locked, app switched or tab closed) */
  var AWAY_MS = 3 * 60 * 1000, SEEN = 'naibi-seen-v1', awayTimer = null;
  function seen(t) { try { if (t === null) localStorage.removeItem(SEEN); else localStorage.setItem(SEEN, String(t === undefined ? Date.now() : t)); } catch (e) {} }
  function lastSeen() { try { return Number(localStorage.getItem(SEEN)) || 0; } catch (e) { return 0; } }
  function awayOut(msg) {
    clearTimeout(awayTimer); seen(null);
    if (!NB.signedIn()) return;
    NB.logout().then(function () {
      S.state = 'login'; S.D = null; S.tab = null; S.sd = null; S.svcD = null; S.cred = null; S.busy = false;
      render(); toast(msg || 'You were signed out because you were away. Please sign in again.');
    });
  }
  function checkAway() { var t = lastSeen(); if (t && Date.now() - t > AWAY_MS) { awayOut(); return true; } return false; }
  document.addEventListener('visibilitychange', function () {
    clearTimeout(awayTimer);
    if (document.hidden) { seen(); awayTimer = setTimeout(function () { if (document.hidden) awayOut(); }, AWAY_MS); }
    else if (!checkAway()) seen();
  });
  window.addEventListener('pagehide', function () { seen(); });
  setInterval(function () { if (!document.hidden && NB.signedIn()) seen(); }, 10000);

  window.__staff = S;
  checkAway();
  if (!NB.configured()) { S.state = 'login'; render(); }
  else if (NB.signedIn()) { render(); load(); }
  else { S.state = 'login'; render(); }
})();
