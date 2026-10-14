-- =====================================================================
-- Make YOUR login the first admin.
-- 1) In Supabase: Authentication > Users > Add user > Create new user.
--    Type your email and a password, and tick "Auto Confirm User".
-- 2) Change the two values below to that same email and your name.
-- 3) Paste this file in SQL Editor and Run.
-- =====================================================================
do $$
declare
  v_email text := 'CHANGE-ME@example.com';   -- <<< your email, exactly as you created it
  v_name  text := 'CHANGE ME';               -- <<< your full name
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(v_email);
  if v_id is null then
    raise exception 'No login found for %. Create it first in Authentication > Users > Add user.', v_email;
  end if;
  insert into public.staff (id, full_name, email, role, title)
  values (v_id, v_name, lower(v_email), 'admin', 'Clinic manager')
  on conflict (id) do update set role = 'admin', active = true, full_name = excluded.full_name;
  raise notice 'Done. % is now an admin. Open /staff.html and sign in.', v_email;
end $$;
