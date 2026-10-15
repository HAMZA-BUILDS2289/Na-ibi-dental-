/* Patient pages: book online + check my booking. No sign-in for patients. */
(function () {
  'use strict';
  var U = NB.u, esc = U.esc, app = document.getElementById('app');
  var S = { tab: location.hash === '#mine' ? 'mine' : 'book', info: null, err: null, loading: true,
    svc: null, days: null, daysLoading: false, date: null, slots: null, slotsLoading: false, time: null,
    name: '', phone: '', complaint: '', busy: false, formErr: '', done: null,
    mPhone: '', mRef: '', mRes: undefined, mBusy: false, mErr: '' };
  var WA = '2348106977321', PHONE = '0810 697 7321';

  function toast(m) { var t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 4200); }
  function today() { return S.info ? S.info.today : U.iso(new Date()); }
  function svcById(id) { return (S.info.services || []).filter(function (s) { return s.id === id; })[0]; }

  function offline() {
    var msg = 'Hello NAIBI Dental Clinic, I want to book an appointment.';
    return '<div class="hero"><h1>Book an appointment</h1><p>Online booking is being set up. For now, message us on WhatsApp or call and we will find you a time.</p></div>' +
      '<div class="row"><a class="btn wa" href="https://wa.me/' + WA + '?text=' + encodeURIComponent(msg) + '" target="_blank" rel="noopener">Book on WhatsApp</a><a class="btn" href="tel:+2348106977321">Call ' + PHONE + '</a></div>';
  }

  function tabs() {
    return '<div class="tabs" role="tablist"><button class="' + (S.tab === 'book' ? 'on' : '') + '" data-a="tab" data-t="book">Book a visit</button><button class="' + (S.tab === 'mine' ? 'on' : '') + '" data-a="tab" data-t="mine">My booking</button></div>';
  }

  function viewBook() {
    if (S.done) {
      var a = S.done;
      var share = 'Hello NAIBI Dental Clinic, I booked online. Ref ' + a.ref + ': ' + a.service_name + ', ' + U.fmtDL(a.day) + ' at ' + U.fmtT(a.start_min) + '. Name: ' + S.name + '.';
      return '<div class="box done"><div class="big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></div>' +
        '<h2>' + (a.status === 'confirmed' ? 'Appointment confirmed' : 'Request received') + '</h2>' +
        '<p class="muted" style="margin:6px 0 14px">' + (a.status === 'confirmed' ? 'Your time is reserved.' : 'The clinic will confirm shortly. Your time is held for you.') + '</p>' +
        '<p class="ref">' + esc(a.ref) + '</p><p class="small muted">Keep this reference. You need it with your phone number to check your booking.</p>' +
        '<p style="margin:14px 0"><b>' + esc(a.service_name) + '</b><br>' + U.fmtDL(a.day) + ' at ' + U.fmtT(a.start_min) + '<br>With ' + esc(a.dentist_name) + '</p>' +
        '<div class="row" style="justify-content:center"><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/' + WA + '?text=' + encodeURIComponent(share) + '">Tell the clinic on WhatsApp</a><button class="btn" data-a="again">Book another</button></div></div>';
    }
    var h = '<div class="hero"><h1>Book an appointment</h1><p>Choose a service and a time that is really free. No account or password needed.</p></div>' + tabs();
    h += '<div class="box"><h3><span class="stepno">1</span>Choose a service</h3><div style="display:grid;gap:8px;margin-top:12px">' +
      S.info.services.map(function (s) {
        return '<button class="opt' + (S.svc === s.id ? ' on' : '') + '" data-a="svc" data-id="' + esc(s.id) + '"><span><b>' + esc(s.name) + '</b><span class="muted small">about ' + s.duration_min + ' min</span></span>' + (s.price_ngn == null ? '' : '<span class="optpr">' + (s.price_from ? 'From ' : '') + '\u20A6' + Number(s.price_ngn).toLocaleString('en-NG') + '</span>') + '</button>';
      }).join('') + '</div></div>';
    if (S.svc) {
      h += '<div class="box"><h3><span class="stepno">2</span>Pick a date and time</h3>';
      if (S.daysLoading) h += '<p class="muted" style="margin-top:10px">Checking free days...</p>';
      else if (S.days && !S.days.length) h += '<div class="notice warn" style="margin-top:12px">No free times in the next few weeks for this service. Please call ' + PHONE + '.</div>';
      else if (S.days) {
        h += '<p class="muted small" style="margin:8px 0">Only days with a free time can be chosen.</p><div class="chips">' +
          S.days.map(function (d) {
            var p = U.parse(d);
            return '<button class="chip' + (S.date === d ? ' on' : '') + '" data-a="date" data-d="' + d + '"><small>' + p.toLocaleDateString('en-GB', { weekday: 'short' }) + '</small><b>' + p.getDate() + '</b><small>' + p.toLocaleDateString('en-GB', { month: 'short' }) + '</small></button>';
          }).join('') + '</div>';
        if (S.date) {
          if (S.slotsLoading) h += '<p class="muted" style="margin-top:12px">Loading times...</p>';
          else if (S.slots) {
            h += '<p style="margin:14px 0 8px"><b>' + U.fmtDL(S.date) + '</b> · ' + S.slots.length + ' free time' + (S.slots.length === 1 ? '' : 's') + '</p>' +
              (S.slots.length ? '<div class="slots">' + S.slots.map(function (m) { return '<button class="slot' + (S.time === m ? ' on' : '') + '" data-a="time" data-m="' + m + '">' + U.fmtT(m) + '</button>'; }).join('') + '</div>' : '<div class="notice warn">That day just filled up. Please choose another day.</div>');
          }
        }
      }
      h += '</div>';
    }
    if (S.svc && S.date && S.time != null) {
      h += '<div class="box"><h3><span class="stepno">3</span>Your details</h3><div style="margin-top:12px">' +
        '<div class="field"><label for="f-name">Full name</label><input id="f-name" data-in="name" value="' + esc(S.name) + '" autocomplete="name" maxlength="80"></div>' +
        '<div class="field"><label for="f-phone">Phone number</label><input id="f-phone" data-in="phone" value="' + esc(S.phone) + '" inputmode="tel" autocomplete="tel" placeholder="0810 000 0000"></div>' +
        '<div class="field"><label for="f-comp">What is the problem? (optional)</label><textarea id="f-comp" data-in="complaint" maxlength="500" placeholder="Example: pain in my lower left tooth for 3 days">' + esc(S.complaint) + '</textarea></div>' +
        (S.formErr ? '<div class="notice bad" role="alert">' + esc(S.formErr) + '</div>' : '') +
        '<p class="muted small" style="margin-bottom:12px">We keep your details only to manage your care and to contact you about this appointment.</p>' +
        '<button class="btn primary" data-a="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Booking...' : 'Confirm booking') + '</button></div></div>';
    }
    return h;
  }

  function viewMine() {
    var r = S.mRes, h = '<div class="hero"><h1>Check my booking</h1><p>Enter the phone number you booked with and your reference (it starts with NB-).</p></div>' + tabs();
    h += '<div class="box"><div class="field"><label for="m-phone">Phone number</label><input id="m-phone" data-in="mPhone" value="' + esc(S.mPhone) + '" inputmode="tel" autocomplete="tel"></div>' +
      '<div class="field"><label for="m-ref">Reference</label><input id="m-ref" data-in="mRef" value="' + esc(S.mRef) + '" placeholder="NB-XXXXXXXX" autocapitalize="characters"></div>' +
      (S.mErr ? '<div class="notice bad">' + esc(S.mErr) + '</div>' : '') +
      '<button class="btn primary" data-a="find"' + (S.mBusy ? ' disabled' : '') + '>Find my booking</button></div>';
    if (r === null) h += '<div class="notice warn">We could not find a booking with that phone number and reference. Check both and try again, or call ' + PHONE + '.</div>';
    if (r) {
      h += '<div class="box"><div class="row" style="justify-content:space-between"><h3>' + esc(r.service_name) + '</h3><span class="pill ' + r.status + '">' + r.status.replace('_', ' ') + '</span></div>' +
        '<p style="margin-top:8px"><b>' + U.fmtDL(r.day) + '</b> at ' + U.fmtT(r.start_min) + ' to ' + U.fmtT(r.start_min + r.dur_min) + '</p>' +
        '<p class="muted">With ' + esc(r.dentist_name) + ' · Ref ' + esc(r.ref) + '</p>' +
        '<p class="muted small" style="margin-top:8px">To change or cancel, please call or message the clinic.</p>' +
        '<div class="row" style="margin-top:12px"><a class="btn" href="tel:+2348106977321">Call ' + PHONE + '</a><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/' + WA + '?text=' + encodeURIComponent('Hello NAIBI Dental Clinic, about my booking ' + r.ref + '.') + '">WhatsApp</a></div></div>';
    }
    return h;
  }

  function render() {
    var y = window.scrollY;
    if (!NB.configured()) app.innerHTML = offline();
    else if (S.loading) app.innerHTML = '<div class="hero"><h1>Book an appointment</h1><p>Loading...</p></div>';
    else if (S.err) app.innerHTML = '<div class="hero"><h1>Book an appointment</h1></div><div class="notice bad">' + esc(S.err) + '</div>' + offline();
    else app.innerHTML = S.tab === 'mine' ? viewMine() : viewBook();
    window.scrollTo(0, y);
  }

  function loadDays() {
    S.daysLoading = true; S.days = null; S.date = null; S.slots = null; S.time = null; render();
    NB.rpc('available_days', { p_service: S.svc, p_from: today(), p_count: Math.min(S.info.clinic.max_days + 1, 45) }).then(function (d) {
      S.days = d || []; S.daysLoading = false; render();
    }, function (e) { S.daysLoading = false; S.days = []; toast(e.message); render(); });
  }
  function loadSlots() {
    S.slotsLoading = true; S.slots = null; S.time = null; render();
    var d = S.date;
    NB.rpc('available_slots', { p_service: S.svc, p_day: d }).then(function (s) {
      if (S.date !== d) return; S.slots = s || []; S.slotsLoading = false; render();
    }, function (e) { S.slotsLoading = false; S.slots = []; toast(e.message); render(); });
  }

  var A = {
    tab: function (t) { S.tab = t.dataset.t; history.replaceState(null, '', S.tab === 'mine' ? '#mine' : location.pathname); render(); },
    svc: function (t) { S.svc = t.dataset.id; S.formErr = ''; loadDays(); },
    date: function (t) { S.date = t.dataset.d; loadSlots(); },
    time: function (t) { S.time = Number(t.dataset.m); render(); },
    again: function () { S.done = null; S.svc = null; S.days = null; S.date = null; S.slots = null; S.time = null; S.complaint = ''; render(); },
    submit: function () {
      if (S.busy) return;
      if (S.name.trim().length < 2) { S.formErr = 'Please enter your full name.'; return render(); }
      if (S.phone.replace(/\D/g, '').length < 10) { S.formErr = 'Please enter a valid phone number (at least 10 digits).'; return render(); }
      S.busy = true; S.formErr = ''; render();
      NB.rpc('book_appointment', { p_service: S.svc, p_day: S.date, p_start: S.time, p_name: S.name, p_phone: S.phone, p_complaint: S.complaint || null }).then(function (r) {
        S.busy = false; S.done = r; render(); window.scrollTo(0, 0);
      }, function (e) {
        S.busy = false; S.formErr = e.message;
        if (e.code === 'slot_taken') { S.time = null; loadSlots(); toast(e.message); } else render();
      });
    },
    find: function () {
      if (S.mPhone.replace(/\D/g, '').length < 10 || S.mRef.trim().length < 5) { S.mErr = 'Enter your phone number and your reference.'; return render(); }
      S.mErr = ''; S.mBusy = true; render();
      NB.rpc('my_booking', { p_phone: S.mPhone, p_ref: S.mRef }).then(function (r) { S.mBusy = false; S.mRes = r || null; render(); }, function (e) { S.mBusy = false; S.mErr = e.message; render(); });
    }
  };
  document.addEventListener('click', function (e) { var t = e.target.closest('[data-a]'); if (t && A[t.dataset.a]) A[t.dataset.a](t); });
  document.addEventListener('input', function (e) { var t = e.target; if (t.dataset && t.dataset.in) S[t.dataset.in] = t.value; });
  window.addEventListener('hashchange', function () { S.tab = location.hash === '#mine' ? 'mine' : 'book'; render(); });
  window.__book = S;

  if (!NB.configured()) { render(); return; }
  render();
  NB.rpc('public_info', {}).then(function (info) {
    S.info = info; S.loading = false;
    if (!info.services.length) S.err = 'No services are available yet.';
    var q = new URLSearchParams(location.search).get('service');
    render();
    if (q && svcById(q)) { S.svc = q; loadDays(); }
  }, function (e) { S.loading = false; S.err = e.message; render(); });
})();
