/* Vercel serverless function: creates and manages staff logins.
   Needs two environment variables in Vercel: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
   The service key lives ONLY here on the server, never in the website files. */
const ROLES = ['admin', 'receptionist', 'dentist', 'technician'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}
function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const hdr = (extra) => {
    const h = Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, extra || {});
    if (/^eyJ/.test(KEY) && !h.Authorization) h.Authorization = 'Bearer ' + KEY;
    return h;
  };

  if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' });
  const body = parseBody(req);
  if (body.action === 'ping') return send(res, 200, { ok: true, configured: !!(BASE && KEY) });
  if (!BASE || !KEY) return send(res, 500, { error: 'not_configured' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return send(res, 401, { error: 'unauthorized' });

  try {
    // 1) who is calling?
    const ur = await fetch(BASE + '/auth/v1/user', { headers: hdr({ Authorization: 'Bearer ' + token }) });
    if (!ur.ok) return send(res, 401, { error: 'unauthorized' });
    const caller = await ur.json();
    // 2) must be an active admin
    const sr = await fetch(BASE + '/rest/v1/staff?id=eq.' + encodeURIComponent(caller.id) + '&select=role,active', { headers: hdr() });
    const rows = sr.ok ? await sr.json() : [];
    if (!rows.length || rows[0].role !== 'admin' || !rows[0].active) return send(res, 403, { error: 'forbidden' });

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const name = String(body.full_name || '').trim();
      if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 2 || !ROLES.includes(body.role)) return send(res, 400, { error: 'bad_input' });
      if (password.length < 8) return send(res, 400, { error: 'weak_password' });
      const cr = await fetch(BASE + '/auth/v1/admin/users', {
        method: 'POST', headers: hdr(),
        body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } })
      });
      const cj = await cr.json().catch(() => ({}));
      if (!cr.ok) {
        const code = cj.error_code || cj.code || '';
        if (code === 'email_exists' || /already/i.test(cj.msg || cj.message || '')) return send(res, 409, { error: 'email_exists' });
        if (code === 'weak_password') return send(res, 400, { error: 'weak_password' });
        return send(res, 502, { error: cj.msg || cj.message || 'could not create the login' });
      }
      const pr = await fetch(BASE + '/rest/v1/rpc/create_staff_profile', {
        method: 'POST', headers: hdr(),
        body: JSON.stringify({ p_id: cj.id, p_name: name, p_email: email, p_role: body.role, p_title: body.title || null, p_phone: body.phone || null })
      });
      if (!pr.ok) {
        await fetch(BASE + '/auth/v1/admin/users/' + cj.id, { method: 'DELETE', headers: hdr() }).catch(() => {});
        return send(res, 502, { error: 'The database is not set up yet (run 1-setup.sql in Supabase).' });
      }
      return send(res, 200, { ok: true, id: cj.id });
    }

    if (body.action === 'reset_password' || body.action === 'set_ban') {
      if (!UUID.test(String(body.id || ''))) return send(res, 400, { error: 'bad_input' });
      const tr = await fetch(BASE + '/rest/v1/staff?id=eq.' + body.id + '&select=id', { headers: hdr() });
      const t = tr.ok ? await tr.json() : [];
      if (!t.length) return send(res, 404, { error: 'not found' });
      let patch;
      if (body.action === 'reset_password') {
        if (String(body.password || '').length < 8) return send(res, 400, { error: 'weak_password' });
        patch = { password: String(body.password) };
      } else {
        if (body.banned && body.id === caller.id) return send(res, 400, { error: 'You cannot deactivate yourself.' });
        patch = { ban_duration: body.banned ? '876000h' : 'none' };
      }
      const pr = await fetch(BASE + '/auth/v1/admin/users/' + body.id, { method: 'PUT', headers: hdr(), body: JSON.stringify(patch) });
      if (!pr.ok) { const pj = await pr.json().catch(() => ({})); return send(res, 502, { error: pj.msg || pj.message || 'update failed' }); }
      return send(res, 200, { ok: true });
    }
    return send(res, 400, { error: 'bad_input' });
  } catch (e) {
    return send(res, 500, { error: 'server_error' });
  }
};
