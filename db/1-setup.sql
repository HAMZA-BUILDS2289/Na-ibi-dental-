-- =====================================================================
-- NA'IBI Dental Clinic: booking + staff system database
-- Paste this WHOLE file into Supabase > SQL Editor > New query > Run.
-- It is safe to run again later: it never deletes your data.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;

-- ---------------------------------------------------------------- tables
create table if not exists public.clinic_settings (
  id int primary key default 1 check (id = 1),
  clinic_name text not null default 'NA''IBI Dental Clinic',
  phone text not null default '0810 697 7321',
  whatsapp text not null default '2348106977321',
  open_min int not null default 480,          -- 08:00 (minutes after midnight)
  close_min int not null default 1260,        -- 21:00
  slot_step int not null default 30,
  cutoff_min int not null default 60,         -- no online booking within this many minutes of now
  max_days int not null default 30,           -- how far ahead patients can book
  open_days int[] not null default '{0,1,2,3,4,5,6}',  -- 0 = Sunday
  auto_confirm boolean not null default false,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','sms')),
  max_open_per_phone int not null default 3
);
insert into public.clinic_settings (id) values (1) on conflict do nothing;

create table if not exists public.services (
  id text primary key,
  name text not null,
  duration_min int not null check (duration_min between 15 and 480),
  needs_tech boolean not null default false,
  active boolean not null default true,
  sort int not null default 100,
  price_ngn int check (price_ngn is null or price_ngn between 0 and 100000000),
  price_from boolean not null default false,
  short text,
  details text,
  icon text
);

create table if not exists public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin','receptionist','dentist','technician')),
  title text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_services (
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id text not null references public.services(id) on delete cascade,
  primary key (staff_id, service_id)
);

create table if not exists public.staff_hours (
  staff_id uuid not null references public.staff(id) on delete cascade,
  dow smallint not null check (dow between 0 and 6),
  start_min int not null,
  end_min int not null,
  break_start int,
  break_end int,
  primary key (staff_id, dow),
  check (end_min > start_min),
  check ((break_start is null) = (break_end is null))
);

create table if not exists public.staff_leave (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff(id) on delete cascade,
  from_date date not null,
  to_date date not null,
  reason text,
  check (to_date >= from_date)
);

create table if not exists public.closed_dates (
  day date primary key,
  reason text
);

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  patient_name text not null,
  phone text not null,
  complaint text,
  service_id text not null references public.services(id),
  day date not null,
  start_min int not null,
  dur_min int not null,
  dentist_id uuid not null references public.staff(id),
  tech_id uuid references public.staff(id),
  status text not null default 'pending'
    check (status in ('pending','confirmed','completed','cancelled','no_show')),
  source text not null default 'online' check (source in ('online','reception')),
  notes text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists appointments_day_idx on public.appointments (day);
create index if not exists appointments_phone_idx on public.appointments (phone);

-- The database itself refuses double-booking, even if two people click at the same moment.
do $$ begin
  alter table public.appointments add constraint no_double_dentist
    exclude using gist (dentist_id with =, day with =, int4range(start_min, start_min + dur_min) with &&)
    where (status not in ('cancelled','no_show'));
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table public.appointments add constraint no_double_tech
    exclude using gist (tech_id with =, day with =, int4range(start_min, start_min + dur_min) with &&)
    where (tech_id is not null and status not in ('cancelled','no_show'));
exception when duplicate_object or duplicate_table then null; end $$;

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  appointment_id uuid references public.appointments(id) on delete cascade,
  kind text not null,
  channel text not null,
  to_phone text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued','sent')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  action text not null,
  detail text
);

-- default services (edit later in the admin Settings tab)
insert into public.services (id, name, duration_min, needs_tech, sort) values
  ('checkup',     'Check-up and consultation',    30, false, 10),
  ('scaling',     'Scaling and polishing',        30, false, 20),
  ('whitening',   'Teeth whitening',              60, true,  30),
  ('filling',     'Teeth filling',                60, false, 40),
  ('extraction',  'Tooth extraction',             30, false, 50),
  ('rct',         'Root canal treatment',         90, false, 60),
  ('crown',       'Dental crown',                 60, true,  70),
  ('braces',      'Braces and orthodontics',      60, false, 80),
  ('implant',     'Dental implants',              90, false, 90),
  ('denture',     'Removable partial dentures',   60, true, 100),
  ('xray',        'Dental X-ray',                 30, false, 110)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- helpers (private)
create or replace function private.today() returns date language sql stable as
$$ select (now() at time zone 'Africa/Lagos')::date $$;

create or replace function private.nowmin() returns int language sql stable as
$$ select (extract(hour from (now() at time zone 'Africa/Lagos')) * 60
         + extract(minute from (now() at time zone 'Africa/Lagos')))::int $$;

create or replace function private.norm_phone(p text) returns text language sql immutable as $$
  select case
    when d like '234%' and length(d) = 13 then '0' || substr(d, 4)
    when length(d) = 10 and d !~ '^0' then '0' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function private.role() returns text language sql stable security definer
set search_path = public, pg_temp as
$$ select role from public.staff where id = auth.uid() and active $$;

create or replace function private.need(p_roles text[]) returns text language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare r text := private.role();
begin
  if r is null or not (r = any(p_roles)) then raise exception 'not_allowed'; end if;
  return r;
end $$;

create or replace function private.log(p_action text, p_detail text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into audit_log (actor, actor_name, action, detail)
  values (auth.uid(), (select full_name from staff where id = auth.uid()), p_action, p_detail);
end $$;

create or replace function private.fmt_time(m int) returns text language sql immutable as
$$ select to_char(make_time(m / 60, m % 60, 0), 'FMHH12:MI AM') $$;

create or replace function private.staff_works(p_staff uuid, p_day date, p_a int, p_b int)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from staff_hours h join staff s on s.id = h.staff_id
    where h.staff_id = p_staff and s.active
      and h.dow = extract(dow from p_day)::int
      and p_a >= h.start_min and p_b <= h.end_min
      and not (h.break_start is not null and p_a < h.break_end and p_b > h.break_start)
  ) and not exists (
    select 1 from staff_leave l where l.staff_id = p_staff and p_day between l.from_date and l.to_date
  )
$$;

create or replace function private.staff_busy(p_staff uuid, p_day date, p_a int, p_b int, p_ignore uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from appointments a
    where (a.dentist_id = p_staff or a.tech_id = p_staff)
      and a.day = p_day and a.status not in ('cancelled','no_show')
      and a.id is distinct from p_ignore
      and p_a < a.start_min + a.dur_min and p_b > a.start_min
  )
$$;

create or replace function private.slot_open(p_day date, p_start int, p_dur int, p_public boolean)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype;
begin
  select * into c from clinic_settings where id = 1;
  if p_day < private.today() then return false; end if;
  if p_public and p_day > private.today() + c.max_days then return false; end if;
  if not (extract(dow from p_day)::int = any (c.open_days)) then return false; end if;
  if exists (select 1 from closed_dates where day = p_day) then return false; end if;
  if p_start < c.open_min or p_start + p_dur > c.close_min then return false; end if;
  if (p_start - c.open_min) % c.slot_step <> 0 then return false; end if;
  if p_day = private.today() and p_start < private.nowmin() + (case when p_public then c.cutoff_min else 0 end) then
    return false;
  end if;
  return true;
end $$;

create or replace function private.dentist_ok(p_id uuid, p_service text, p_day date, p_a int, p_b int, p_ignore uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from staff s where s.id = p_id and s.role = 'dentist' and s.active)
     and exists (select 1 from staff_services ss where ss.staff_id = p_id and ss.service_id = p_service)
     and private.staff_works(p_id, p_day, p_a, p_b)
     and not private.staff_busy(p_id, p_day, p_a, p_b, p_ignore)
$$;

create or replace function private.tech_ok(p_id uuid, p_day date, p_a int, p_b int, p_ignore uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from staff s where s.id = p_id and s.role = 'technician' and s.active)
     and private.staff_works(p_id, p_day, p_a, p_b)
     and not private.staff_busy(p_id, p_day, p_a, p_b, p_ignore)
$$;

-- Picks the dentist (and technician when needed). Least busy that day wins. Returns {dentist, tech} or null.
create or replace function private.pick(p_service text, p_day date, p_start int, p_ignore uuid,
                                        p_pref_dentist uuid default null, p_pref_tech uuid default null)
returns uuid[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare sv services%rowtype; e int; d uuid; t uuid;
begin
  select * into sv from services where id = p_service and active;
  if not found then return null; end if;
  e := p_start + sv.duration_min;

  if p_pref_dentist is not null and private.dentist_ok(p_pref_dentist, p_service, p_day, p_start, e, p_ignore) then
    d := p_pref_dentist;
  else
    select s.id into d from staff s
    where private.dentist_ok(s.id, p_service, p_day, p_start, e, p_ignore)
    order by (select count(*) from appointments a
              where a.dentist_id = s.id and a.day = p_day and a.status not in ('cancelled','no_show')),
             s.full_name, s.id
    limit 1;
  end if;
  if d is null then return null; end if;

  if sv.needs_tech then
    if p_pref_tech is not null and private.tech_ok(p_pref_tech, p_day, p_start, e, p_ignore) then
      t := p_pref_tech;
    else
      select s.id into t from staff s
      where private.tech_ok(s.id, p_day, p_start, e, p_ignore)
      order by (select count(*) from appointments a
                where a.tech_id = s.id and a.day = p_day and a.status not in ('cancelled','no_show')),
               s.full_name, s.id
      limit 1;
    end if;
    if t is null then return null; end if;
  end if;
  return array[d, t];
end $$;

create or replace function private.new_ref() returns text language plpgsql as $$
declare r text;
begin
  loop
    r := 'NB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.appointments where ref = r);
  end loop;
  return r;
end $$;

create or replace function private.msg_body(a public.appointments, p_kind text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype; sv text; dn text; first text; w text;
begin
  select * into c from clinic_settings where id = 1;
  select name into sv from services where id = a.service_id;
  select full_name into dn from staff where id = a.dentist_id;
  first := split_part(a.patient_name, ' ', 1);
  w := to_char(a.day, 'FMDay, FMDD FMMonth') || ' at ' || private.fmt_time(a.start_min);
  return case p_kind
    when 'booked' then 'Hello ' || first || ', we received your request for ' || sv || ' on ' || w || '. The clinic will confirm shortly. Ref ' || a.ref || '. ' || c.clinic_name
    when 'confirmed' then 'Hello ' || first || ', your ' || sv || ' appointment is confirmed for ' || w || ' with ' || dn || '. Ref ' || a.ref || '. ' || c.clinic_name
    when 'cancelled' then 'Hello ' || first || ', your appointment on ' || w || ' has been cancelled by the clinic. Please call ' || c.phone || ' to rebook. Ref ' || a.ref
    when 'rescheduled' then 'Hello ' || first || ', your appointment has been moved to ' || w || ' with ' || dn || '. Ref ' || a.ref || '. ' || c.clinic_name
    when 'reminder' then 'Reminder: ' || first || ', you have a ' || sv || ' appointment on ' || w || ' at ' || c.clinic_name || '. Ref ' || a.ref
    else 'Update on your appointment ' || a.ref end;
end $$;

create or replace function private.queue_msg(a public.appointments, p_kind text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare ch text;
begin
  select channel into ch from clinic_settings where id = 1;
  insert into messages (appointment_id, kind, channel, to_phone, body)
  values (a.id, p_kind, ch, a.phone, private.msg_body(a, p_kind));
end $$;

create or replace function private.appt_json(a public.appointments) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select to_jsonb(a) || jsonb_build_object(
    'service_name', (select name from services where id = a.service_id),
    'dentist_name', (select full_name from staff where id = a.dentist_id),
    'tech_name', (select full_name from staff where id = a.tech_id))
$$;

-- ---------------------------------------------------------------- PUBLIC functions (patients, no sign-in)
create or replace function public.health() returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'ok', true, 'version', 1,
    'services', (select count(*) from services where active),
    'dentists', (select count(*) from staff where role = 'dentist' and active),
    'admins', (select count(*) from staff where role = 'admin' and active))
$$;

create or replace function public.public_info() returns jsonb language sql stable security definer
set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'clinic', (select to_jsonb(c) - 'auto_confirm' - 'max_open_per_phone' from clinic_settings c where id = 1),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration_min', duration_min,
                 'price_ngn', price_ngn, 'price_from', price_from, 'short', short, 'details', details, 'icon', icon)
                 order by sort, name), '[]') from services where active),
    'closed', (select coalesce(jsonb_agg(day), '[]') from closed_dates where day >= private.today()),
    'today', private.today(), 'nowmin', private.nowmin())
$$;

create or replace function public.available_slots(p_service text, p_day date) returns int[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype; sv services%rowtype; m int; out int[] := '{}';
begin
  select * into c from clinic_settings where id = 1;
  select * into sv from services where id = p_service and active;
  if not found or p_day is null then return out; end if;
  m := c.open_min;
  while m + sv.duration_min <= c.close_min loop
    if private.slot_open(p_day, m, sv.duration_min, true) and private.pick(p_service, p_day, m, null) is not null then
      out := out || m;
    end if;
    m := m + c.slot_step;
  end loop;
  return out;
end $$;


create or replace function private.has_slot(p_service text, p_day date, p_public boolean)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype; sv services%rowtype; m int;
begin
  select * into c from clinic_settings where id = 1;
  select * into sv from services where id = p_service and active;
  if not found then return false; end if;
  m := c.open_min;
  while m + sv.duration_min <= c.close_min loop
    if private.slot_open(p_day, m, sv.duration_min, p_public) and private.pick(p_service, p_day, m, null) is not null then
      return true;
    end if;
    m := m + c.slot_step;
  end loop;
  return false;
end $$;

-- Which of the next days still have at least one free time (used to grey out full days on the booking page).
create or replace function public.available_days(p_service text, p_from date, p_count int default 21) returns date[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare i int; out date[] := '{}';
begin
  for i in 0 .. least(greatest(p_count, 1), 45) - 1 loop
    if private.has_slot(p_service, p_from + i, true) then out := out || (p_from + i); end if;
  end loop;
  return out;
end $$;

create or replace function public.book_appointment(p_service text, p_day date, p_start int,
                                                   p_name text, p_phone text, p_complaint text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype; sv services%rowtype; ph text; pk uuid[]; a appointments%rowtype; st text;
begin
  select * into c from clinic_settings where id = 1;
  select * into sv from services where id = p_service and active;
  if not found then raise exception 'bad_service'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) < 2 or length(p_name) > 80 then raise exception 'bad_name'; end if;
  ph := private.norm_phone(p_phone);
  if length(ph) < 10 or length(ph) > 14 then raise exception 'bad_phone'; end if;
  p_complaint := left(btrim(coalesce(p_complaint, '')), 500);

  perform pg_advisory_xact_lock(hashtext('naibi-book-' || p_day::text));
  if not private.slot_open(p_day, p_start, sv.duration_min, true) then raise exception 'slot_taken'; end if;
  if (select count(*) from appointments where phone = ph and status in ('pending','confirmed') and day >= private.today())
       >= c.max_open_per_phone then
    raise exception 'too_many';
  end if;
  pk := private.pick(p_service, p_day, p_start, null);
  if pk is null then raise exception 'slot_taken'; end if;

  st := case when c.auto_confirm then 'confirmed' else 'pending' end;
  begin
    insert into appointments (ref, patient_name, phone, complaint, service_id, day, start_min, dur_min,
                              dentist_id, tech_id, status, source)
    values (private.new_ref(), p_name, ph, nullif(p_complaint, ''), p_service, p_day, p_start, sv.duration_min,
            pk[1], pk[2], st, 'online')
    returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  perform private.queue_msg(a, 'booked');
  if st = 'confirmed' then perform private.queue_msg(a, 'confirmed'); end if;
  return jsonb_build_object('ref', a.ref, 'status', a.status, 'day', a.day, 'start_min', a.start_min,
    'dur_min', a.dur_min, 'service_name', sv.name,
    'dentist_name', (select full_name from staff where id = a.dentist_id));
end $$;

create or replace function public.my_booking(p_phone text, p_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ref', a.ref, 'status', a.status, 'day', a.day, 'start_min', a.start_min,
    'dur_min', a.dur_min, 'patient_name', a.patient_name, 'complaint', a.complaint,
    'service_name', (select name from services where id = a.service_id),
    'dentist_name', (select full_name from staff where id = a.dentist_id))
  from appointments a
  where a.ref = upper(btrim(p_ref)) and a.phone = private.norm_phone(p_phone)
$$;

-- ---------------------------------------------------------------- STAFF functions (signed-in only)
create or replace function public.staff_data(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r text := private.need(array['admin','receptionist','dentist','technician']); me staff%rowtype;
begin
  select * into me from staff where id = auth.uid();
  p_from := coalesce(p_from, private.today() - 30);
  p_to := coalesce(p_to, private.today() + 90);
  return jsonb_build_object(
    'me', jsonb_build_object('id', me.id, 'name', me.full_name, 'role', me.role, 'title', me.title, 'email', me.email),
    'settings', (select to_jsonb(c) from clinic_settings c where id = 1),
    'services', (select coalesce(jsonb_agg(to_jsonb(v) order by sort, name), '[]') from services v),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'full_name', s.full_name, 'role', s.role,
                'title', s.title, 'phone', s.phone, 'email', case when r = 'admin' then s.email end,
                'active', s.active) order by s.role, s.full_name), '[]') from staff s),
    'staff_services', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from staff_services x),
    'hours', (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from staff_hours h),
    'leave', (select coalesce(jsonb_agg(to_jsonb(l) order by l.from_date), '[]') from staff_leave l
              where l.to_date >= private.today() - 30),
    'closed', (select coalesce(jsonb_agg(to_jsonb(cd) order by cd.day), '[]') from closed_dates cd where cd.day >= private.today() - 30),
    'appointments', (select coalesce(jsonb_agg(private.appt_json(a) order by a.day, a.start_min), '[]')
                     from appointments a
                     where a.day between p_from and p_to
                       and (r <> 'technician' or a.tech_id = auth.uid())),
    'messages', case when r in ('admin','receptionist') then
                 (select coalesce(jsonb_agg(to_jsonb(m) order by m.id desc), '[]')
                  from (select * from messages order by id desc limit 150) m) else '[]'::jsonb end,
    'audit', case when r = 'admin' then
                 (select coalesce(jsonb_agg(to_jsonb(g) order by g.id desc), '[]')
                  from (select * from audit_log order by id desc limit 60) g) else '[]'::jsonb end,
    'server', jsonb_build_object('today', private.today(), 'nowmin', private.nowmin()));
end $$;

create or replace function public.patient_history(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform private.need(array['admin','receptionist','dentist']);
  return (select coalesce(jsonb_agg(private.appt_json(a) order by a.day desc, a.start_min desc), '[]')
          from appointments a where a.phone = private.norm_phone(p_phone));
end $$;

create or replace function public.staff_slots(p_service text, p_day date, p_ignore uuid default null) returns int[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype; sv services%rowtype; m int; out int[] := '{}'; cur appointments%rowtype;
begin
  perform private.need(array['admin','receptionist']);
  select * into c from clinic_settings where id = 1;
  select * into sv from services where id = p_service and active;
  if not found then return out; end if;
  m := c.open_min;
  while m + sv.duration_min <= c.close_min loop
    if private.slot_open(p_day, m, sv.duration_min, false) and private.pick(p_service, p_day, m, p_ignore) is not null then
      out := out || m;
    end if;
    m := m + c.slot_step;
  end loop;
  return out;
end $$;

create or replace function public.staff_book(p_service text, p_day date, p_start int, p_name text, p_phone text,
                                             p_complaint text default null, p_dentist uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare sv services%rowtype; ph text; pk uuid[]; a appointments%rowtype;
begin
  perform private.need(array['admin','receptionist']);
  select * into sv from services where id = p_service and active;
  if not found then raise exception 'bad_service'; end if;
  p_name := btrim(coalesce(p_name, ''));
  if length(p_name) < 2 or length(p_name) > 80 then raise exception 'bad_name'; end if;
  ph := private.norm_phone(p_phone);
  if length(ph) < 10 or length(ph) > 14 then raise exception 'bad_phone'; end if;
  perform pg_advisory_xact_lock(hashtext('naibi-book-' || p_day::text));
  if not private.slot_open(p_day, p_start, sv.duration_min, false) then raise exception 'slot_taken'; end if;
  pk := private.pick(p_service, p_day, p_start, null, p_dentist);
  if pk is null then raise exception 'slot_taken'; end if;
  begin
    insert into appointments (ref, patient_name, phone, complaint, service_id, day, start_min, dur_min,
                              dentist_id, tech_id, status, source, created_by)
    values (private.new_ref(), p_name, ph, nullif(left(btrim(coalesce(p_complaint, '')), 500), ''), p_service, p_day,
            p_start, sv.duration_min, pk[1], pk[2], 'confirmed', 'reception', auth.uid())
    returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  perform private.queue_msg(a, 'confirmed');
  perform private.log('book', a.ref || ' ' || p_name);
  return private.appt_json(a);
end $$;

create or replace function public.set_appt_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r text := private.need(array['admin','receptionist','dentist']); a appointments%rowtype;
begin
  if p_status not in ('pending','confirmed','completed','cancelled','no_show') then raise exception 'bad_status'; end if;
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r = 'dentist' then
    if a.dentist_id <> auth.uid() or p_status not in ('completed','no_show') then raise exception 'not_allowed'; end if;
  end if;
  begin
    update appointments set status = p_status, updated_at = now(),
      cancel_reason = case when p_status = 'cancelled' then nullif(left(btrim(coalesce(p_reason, '')), 200), '') else null end
    where id = p_id returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  if p_status = 'confirmed' then perform private.queue_msg(a, 'confirmed'); end if;
  if p_status = 'cancelled' then perform private.queue_msg(a, 'cancelled'); end if;
  perform private.log(p_status, a.ref || ' ' || a.patient_name);
  return private.appt_json(a);
end $$;

create or replace function public.reschedule_appt(p_id uuid, p_day date, p_start int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype; sv services%rowtype; pk uuid[];
begin
  perform private.need(array['admin','receptionist']);
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into sv from services where id = a.service_id;
  perform pg_advisory_xact_lock(hashtext('naibi-book-' || p_day::text));
  if not private.slot_open(p_day, p_start, sv.duration_min, false) then raise exception 'slot_taken'; end if;
  pk := private.pick(a.service_id, p_day, p_start, a.id, a.dentist_id, a.tech_id);
  if pk is null then raise exception 'slot_taken'; end if;
  begin
    update appointments set day = p_day, start_min = p_start, dur_min = sv.duration_min,
      dentist_id = pk[1], tech_id = pk[2],
      status = case when status in ('cancelled','no_show','pending') then 'confirmed' else status end,
      cancel_reason = null, updated_at = now()
    where id = p_id returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  perform private.queue_msg(a, 'rescheduled');
  perform private.log('reschedule', a.ref || ' to ' || p_day || ' ' || private.fmt_time(p_start));
  return private.appt_json(a);
end $$;

create or replace function public.set_appt_notes(p_id uuid, p_notes text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r text := private.need(array['admin','receptionist','dentist']); a appointments%rowtype;
begin
  select * into a from appointments where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if r = 'dentist' and a.dentist_id <> auth.uid() then raise exception 'not_allowed'; end if;
  update appointments set notes = nullif(left(btrim(coalesce(p_notes, '')), 2000), ''), updated_at = now() where id = p_id;
end $$;

create or replace function public.queue_reminder(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype;
begin
  perform private.need(array['admin','receptionist']);
  select * into a from appointments where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform private.queue_msg(a, 'reminder');
end $$;

create or replace function public.mark_message_sent(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform private.need(array['admin','receptionist']);
  update messages set status = 'sent', sent_at = now() where id = p_id;
end $$;

-- ---------------------------------------------------------------- ADMIN functions
create or replace function public.admin_save_settings(p jsonb) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform private.need(array['admin']);
  update clinic_settings set
    clinic_name = coalesce(nullif(btrim(p->>'clinic_name'), ''), clinic_name),
    phone = coalesce(nullif(btrim(p->>'phone'), ''), phone),
    whatsapp = coalesce(nullif(btrim(p->>'whatsapp'), ''), whatsapp),
    open_min = coalesce((p->>'open_min')::int, open_min),
    close_min = coalesce((p->>'close_min')::int, close_min),
    slot_step = coalesce((p->>'slot_step')::int, slot_step),
    cutoff_min = coalesce((p->>'cutoff_min')::int, cutoff_min),
    max_days = coalesce((p->>'max_days')::int, max_days),
    auto_confirm = coalesce((p->>'auto_confirm')::boolean, auto_confirm),
    channel = coalesce(p->>'channel', channel),
    max_open_per_phone = coalesce((p->>'max_open_per_phone')::int, max_open_per_phone),
    open_days = coalesce((select array_agg(x::int order by x::int) from jsonb_array_elements_text(p->'open_days') x), open_days)
  where id = 1;
  perform private.log('settings', 'Clinic settings changed');
end $$;

create or replace function public.admin_save_service(p jsonb) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare sid text := nullif(btrim(p->>'id'), '');
        pr int := nullif(btrim(coalesce(p->>'price_ngn', '')), '')::int;
begin
  perform private.need(array['admin']);
  if length(btrim(coalesce(p->>'name', ''))) < 2 then raise exception 'bad_service'; end if;
  if pr is not null and (pr < 0 or pr > 100000000) then raise exception 'bad_price'; end if;
  if sid is null then
    sid := lower(regexp_replace(btrim(p->>'name'), '[^a-zA-Z0-9]+', '-', 'g'));
    sid := trim(both '-' from sid);
    if sid = '' then raise exception 'bad_service'; end if;
    if exists (select 1 from services where id = sid) then sid := sid || '-' || substr(gen_random_uuid()::text, 1, 4); end if;
  end if;
  insert into services (id, name, duration_min, needs_tech, active, sort, price_ngn, price_from, short, details, icon)
  values (sid, btrim(p->>'name'), (p->>'duration_min')::int, coalesce((p->>'needs_tech')::boolean, false),
          coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 100),
          pr, coalesce((p->>'price_from')::boolean, false),
          nullif(left(btrim(coalesce(p->>'short', '')), 200), ''),
          nullif(left(btrim(coalesce(p->>'details', '')), 2000), ''),
          nullif(left(btrim(coalesce(p->>'icon', '')), 20), ''))
  on conflict (id) do update set name = excluded.name, duration_min = excluded.duration_min,
    needs_tech = excluded.needs_tech, active = excluded.active, sort = excluded.sort,
    price_ngn = excluded.price_ngn, price_from = excluded.price_from,
    short = excluded.short, details = excluded.details, icon = excluded.icon;
  -- a new service is offered by every active dentist until the admin changes it
  if not (p ? 'id') then
    insert into staff_services (staff_id, service_id) select id, sid from staff where role = 'dentist' and active
    on conflict do nothing;
  end if;
  perform private.log('service', btrim(p->>'name'));
  return sid;
end $$;

create or replace function public.admin_delete_service(p_id text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare nm text;
begin
  perform private.need(array['admin']);
  select name into nm from services where id = p_id;
  if nm is null then return; end if;
  if exists (select 1 from appointments where service_id = p_id) then raise exception 'service_in_use'; end if;
  delete from services where id = p_id;
  perform private.log('service deleted', nm);
end $$;

create or replace function public.admin_save_staff(p_id uuid, p_name text, p_title text, p_phone text,
                                                   p_active boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare s staff%rowtype;
begin
  perform private.need(array['admin']);
  select * into s from staff where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if not p_active and s.role = 'admin' and (p_id = auth.uid()
       or (select count(*) from staff where role = 'admin' and active and id <> p_id) = 0) then
    raise exception 'last_admin';
  end if;
  update staff set full_name = coalesce(nullif(btrim(p_name), ''), full_name), title = nullif(btrim(p_title), ''),
    phone = nullif(btrim(p_phone), ''), active = p_active where id = p_id;
  perform private.log('staff', s.full_name || case when p_active then ' updated' else ' deactivated' end);
end $$;

create or replace function public.admin_set_staff_services(p_staff uuid, p_services text[]) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform private.need(array['admin']);
  delete from staff_services where staff_id = p_staff;
  insert into staff_services (staff_id, service_id)
    select p_staff, s.id from services s where s.id = any (p_services);
end $$;

create or replace function public.admin_set_hours(p_staff uuid, p_hours jsonb) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare h jsonb;
begin
  perform private.need(array['admin']);
  delete from staff_hours where staff_id = p_staff;
  for h in select * from jsonb_array_elements(p_hours) loop
    insert into staff_hours (staff_id, dow, start_min, end_min, break_start, break_end)
    values (p_staff, (h->>'dow')::int, (h->>'start_min')::int, (h->>'end_min')::int,
            (h->>'break_start')::int, (h->>'break_end')::int);
  end loop;
  perform private.log('roster', (select full_name from staff where id = p_staff) || ' roster saved');
end $$;

create or replace function public.admin_add_leave(p_staff uuid, p_from date, p_to date, p_reason text default null)
returns int language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform private.need(array['admin']);
  insert into staff_leave (staff_id, from_date, to_date, reason) values (p_staff, p_from, p_to, nullif(btrim(p_reason), ''));
  select count(*) into n from appointments
   where (dentist_id = p_staff or tech_id = p_staff) and day between p_from and p_to
     and status in ('pending','confirmed');
  perform private.log('leave', (select full_name from staff where id = p_staff) || ' ' || p_from || ' to ' || p_to);
  return n;   -- how many booked visits now need to be moved
end $$;

create or replace function public.admin_del_leave(p_id bigint) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin perform private.need(array['admin']); delete from staff_leave where id = p_id; end $$;

create or replace function public.admin_add_closed(p_day date, p_reason text default null) returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform private.need(array['admin']);
  insert into closed_dates (day, reason) values (p_day, nullif(btrim(p_reason), '')) on conflict (day) do update set reason = excluded.reason;
  select count(*) into n from appointments where day = p_day and status in ('pending','confirmed');
  perform private.log('closed', p_day::text);
  return n;
end $$;

create or replace function public.admin_del_closed(p_day date) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin perform private.need(array['admin']); delete from closed_dates where day = p_day; end $$;

-- Called ONLY by the server function that creates staff logins (service key). Not reachable from the browser.
create or replace function public.create_staff_profile(p_id uuid, p_name text, p_email text, p_role text,
                                                       p_title text, p_phone text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c clinic_settings%rowtype; d int;
begin
  insert into staff (id, full_name, email, role, title, phone) values (p_id, btrim(p_name), lower(btrim(p_email)), p_role,
    nullif(btrim(p_title), ''), nullif(btrim(p_phone), ''))
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, title = excluded.title,
    phone = excluded.phone, email = excluded.email, active = true;
  if p_role in ('dentist','technician','receptionist') then
    -- starter roster: Monday to Saturday, 09:00 to 17:00 with a 13:00 to 14:00 break. Admin can change it.
    for d in 1..6 loop
      insert into staff_hours (staff_id, dow, start_min, end_min, break_start, break_end)
      values (p_id, d, 540, 1020, 780, 840) on conflict do nothing;
    end loop;
  end if;
  if p_role = 'dentist' then
    insert into staff_services (staff_id, service_id) select p_id, id from services where active on conflict do nothing;
  end if;
  insert into audit_log (actor, actor_name, action, detail) values (null, 'system', 'staff', 'Account created for ' || btrim(p_name) || ' (' || p_role || ')');
end $$;

-- ---------------------------------------------------------------- security (row level security)
alter table public.clinic_settings enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.staff_services enable row level security;
alter table public.staff_hours enable row level security;
alter table public.staff_leave enable row level security;
alter table public.closed_dates enable row level security;
alter table public.appointments enable row level security;
alter table public.messages enable row level security;
alter table public.audit_log enable row level security;

-- Nobody can read or write tables directly from the browser. Everything goes through the functions above,
-- which check who is signed in and what their role allows.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

grant execute on function public.health() to anon, authenticated;
grant execute on function public.public_info() to anon, authenticated;
grant execute on function public.available_slots(text, date) to anon, authenticated;
grant execute on function public.available_days(text, date, int) to anon, authenticated;
grant execute on function public.book_appointment(text, date, int, text, text, text) to anon, authenticated;
grant execute on function public.my_booking(text, text) to anon, authenticated;

grant execute on function public.staff_data(date, date) to authenticated;
grant execute on function public.patient_history(text) to authenticated;
grant execute on function public.staff_slots(text, date, uuid) to authenticated;
grant execute on function public.staff_book(text, date, int, text, text, text, uuid) to authenticated;
grant execute on function public.set_appt_status(uuid, text, text) to authenticated;
grant execute on function public.reschedule_appt(uuid, date, int) to authenticated;
grant execute on function public.set_appt_notes(uuid, text) to authenticated;
grant execute on function public.queue_reminder(uuid) to authenticated;
grant execute on function public.mark_message_sent(bigint) to authenticated;
grant execute on function public.admin_save_settings(jsonb) to authenticated;
grant execute on function public.admin_save_service(jsonb) to authenticated;
grant execute on function public.admin_delete_service(text) to authenticated;
grant execute on function public.admin_save_staff(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.admin_set_staff_services(uuid, text[]) to authenticated;
grant execute on function public.admin_set_hours(uuid, jsonb) to authenticated;
grant execute on function public.admin_add_leave(uuid, date, date, text) to authenticated;
grant execute on function public.admin_del_leave(bigint) to authenticated;
grant execute on function public.admin_add_closed(date, text) to authenticated;
grant execute on function public.admin_del_closed(date) to authenticated;
grant execute on function public.create_staff_profile(uuid, text, text, text, text, text) to service_role;
