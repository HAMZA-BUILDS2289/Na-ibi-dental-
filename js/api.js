/* Tiny client for Supabase: sign-in + calling database functions. No libraries needed. */
(function () {
  'use strict';
  var C = window.NAIBI || {};
  var LS = 'naibi-session-v1';

  function configured() {
    return !!(C.SUPABASE_URL && /^https?:\/\/[^ ]+\.[^ ]+/.test(C.SUPABASE_URL) && C.SUPABASE_ANON_KEY && C.SUPABASE_ANON_KEY.length > 30 && C.SUPABASE_URL.indexOf('PASTE') < 0);
  }
  function base() { return String(C.SUPABASE_URL || '').replace(/\/+$/, ''); }

  var session = null;
  try { session = JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) {}
  function saveSession(s) {
    session = s;
    try { if (s) localStorage.setItem(LS, JSON.stringify(s)); else localStorage.removeItem(LS); } catch (e) {}
  }

  var FRIENDLY = {
    slot_taken: 'That time was just taken. Please pick another time.',
    too_many: 'This phone number already has the maximum number of open bookings. Please call the clinic.',
    bad_name: 'Please enter your full name.',
    bad_phone: 'Please enter a valid phone number.',
    bad_service: 'That service is not available.',
    bad_price: 'The price must be a whole number of naira, or empty.',
    service_in_use: 'This service already has bookings, so it cannot be deleted. Switch it off instead and it will disappear from the website.',
    bad_status: 'That status is not valid.',
    not_allowed: 'Your role does not allow this action.',
    not_found: 'That record was not found.',
    not_done: 'You can leave a review once your treatment is finished.',
    bad_rating: 'Please choose a star rating from 1 to 5.',
    already_reviewed: 'You have already reviewed this visit. Thank you!',
    wrong_day: 'This booking is not for today, so it cannot be checked in. Reschedule it first if the patient came on a different day.',
    not_valid: 'This booking was cancelled or marked as a no-show, so it cannot be checked in.',
    last_admin: 'You cannot deactivate yourself or the last admin.',
    network: 'No internet connection. Please check your network and try again.',
    not_signed_in: 'Please sign in again.',
    'Invalid login credentials': 'Wrong email or password.',
    'Email not confirmed': 'This account is not confirmed yet. Ask the admin.',
    'User is banned': 'This account has been deactivated.'
  };
  function friendly(code) { return FRIENDLY[code] || code || 'Something went wrong. Please try again.'; }

  function fail(code, status, body) {
    var e = new Error(friendly(code)); e.code = code; e.status = status || 0; e.body = body || null; return e;
  }
  function request(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          var code = (j && (j.message || j.msg || j.error_description || j.error)) || ('HTTP ' + r.status);
          throw fail(code, r.status, j);
        }
        return j;
      });
    }, function () { throw fail('network'); });
  }
  function headers(token) {
    var h = { 'apikey': C.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
    var t = token || (/^eyJ/.test(C.SUPABASE_ANON_KEY) ? C.SUPABASE_ANON_KEY : null);
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  function setFromAuth(j) {
    saveSession({
      access_token: j.access_token, refresh_token: j.refresh_token,
      expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
      user: j.user ? { id: j.user.id, email: j.user.email } : (session && session.user) || null
    });
    return session;
  }
  function refresh() {
    if (!session || !session.refresh_token) return Promise.reject(fail('not_signed_in'));
    return request(base() + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', headers: headers(), body: JSON.stringify({ refresh_token: session.refresh_token })
    }).then(setFromAuth, function (e) { if (e.status === 400 || e.status === 401) saveSession(null); throw e; });
  }
  function fresh() {
    if (!session) return Promise.reject(fail('not_signed_in'));
    if (session.expires_at * 1000 - Date.now() > 60000) return Promise.resolve(session);
    return refresh();
  }

  function rpc(name, args, authed) {
    var go = function (tk) {
      return request(base() + '/rest/v1/rpc/' + name, { method: 'POST', headers: headers(tk), body: JSON.stringify(args || {}) });
    };
    if (!authed) return go(null);
    return fresh().then(function (s) {
      return go(s.access_token).catch(function (e) {
        if (e.status === 401) return refresh().then(function (s2) { return go(s2.access_token); });
        throw e;
      });
    });
  }

  function login(email, password) {
    return request(base() + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: headers(), body: JSON.stringify({ email: String(email).trim(), password: password })
    }).then(setFromAuth);
  }
  function logout() {
    var s = session; saveSession(null);
    if (s) fetch(base() + '/auth/v1/logout', { method: 'POST', headers: headers(s.access_token) }).catch(function () {});
    return Promise.resolve();
  }
  function changePassword(pw) {
    return fresh().then(function (s) {
      return request(base() + '/auth/v1/user', { method: 'PUT', headers: headers(s.access_token), body: JSON.stringify({ password: pw }) });
    });
  }
  function staffApi(action, payload) {
    return fresh().then(function (s) {
      return fetch('/api/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.access_token },
        body: JSON.stringify(Object.assign({ action: action }, payload || {}))
      }).then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var msg = (j && j.error) || ('HTTP ' + r.status);
            if (r.status === 404) msg = 'The staff-accounts service is not deployed yet. Deploy this project on Vercel (see the setup guide).';
            var e = new Error(friendlyApi(msg)); e.code = msg; e.status = r.status; throw e;
          }
          return j;
        });
      }, function () { throw fail('network'); });
    });
  }
  function friendlyApi(c) {
    var m = {
      not_configured: 'The server is missing its Supabase keys. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel > Settings > Environment Variables, then redeploy.',
      unauthorized: 'Please sign in again.', forbidden: 'Only an admin can do this.',
      email_exists: 'An account with that email already exists.', weak_password: 'Password must be at least 8 characters.',
      bad_input: 'Please check the details and try again.'
    };
    return m[c] || c;
  }

  /* ---------- small helpers shared by the pages ---------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return iso(d); }
  function fmtT(m) { var h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + ':' + pad(mm) + ' ' + (h >= 12 ? 'PM' : 'AM'); }
  function fmtD(s) { return parse(s).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtDL(s) { return parse(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function tm(s) { var p = String(s).split(':').map(Number); return p[0] * 60 + p[1]; }
  function hhmm(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function intl(phone) { var d = String(phone || '').replace(/\D/g, ''); if (d.indexOf('234') === 0) return d; if (d.charAt(0) === '0') return '234' + d.slice(1); return d; }
  function initials(n) { return String(n || '?').replace(/^(Dr\.?|Hajiya|Alhaji|Mr\.?|Mrs\.?|Mal\.?)\s+/i, '').split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase(); }

  window.NB = {
    configured: configured, base: base, rpc: rpc, login: login, logout: logout, changePassword: changePassword,
    staffApi: staffApi, refresh: refresh, friendly: friendly,
    session: function () { return session; }, signedIn: function () { return !!session; },
    u: { pad: pad, iso: iso, parse: parse, addDays: addDays, fmtT: fmtT, fmtD: fmtD, fmtDL: fmtDL, tm: tm, hhmm: hhmm, esc: esc, intl: intl, initials: initials }
  };
})();
