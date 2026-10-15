-- NA'IBI: remove all test data. Keeps services, clinic settings, closed dates and YOUR admin login.

-- Safety check: stops here if your admin account is missing, so nobody gets wiped by mistake.
do $$
begin
  if not exists (select 1 from public.staff where lower(email) = 'awwalhamza2289@gmail.com' and role = 'admin') then
    raise exception 'Admin awwalhamza2289@gmail.com not found. Nothing was deleted.';
  end if;
end $$;

-- 1) test bookings and their messages
delete from public.messages;
delete from public.appointments;
delete from public.audit_log;

-- 2) test staff logins (their rosters and leave go with them)
delete from auth.users
where id in (select id from public.staff where lower(email) <> 'awwalhamza2289@gmail.com');

-- 3) result: should show 0, 0, 1
select
  (select count(*) from public.appointments) as bookings_left,
  (select count(*) from public.messages) as messages_left,
  (select count(*) from public.staff) as staff_left;
