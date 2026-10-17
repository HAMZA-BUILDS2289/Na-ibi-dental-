-- Na'ibi workflow 3 of 3: patient reviews + progress on My booking. Safe to run twice.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  author text not null,
  rating int not null check (rating between 1 and 5),
  body text check (body is null or length(body) <= 600),
  service_name text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
revoke all on public.reviews from anon, authenticated;

create or replace function public.submit_review(p_phone text, p_ref text, p_rating int, p_text text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype; nm text;
begin
  select * into a from appointments where ref = upper(btrim(coalesce(p_ref, ''))) and phone = private.norm_phone(p_phone);
  if not found then raise exception 'not_found'; end if;
  if a.status <> 'completed' then raise exception 'not_done'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'bad_rating'; end if;
  if exists (select 1 from reviews where appointment_id = a.id) then raise exception 'already_reviewed'; end if;
  nm := split_part(btrim(a.patient_name), ' ', 1);
  if split_part(btrim(a.patient_name), ' ', 2) <> '' then nm := nm || ' ' || left(split_part(btrim(a.patient_name), ' ', 2), 1) || '.'; end if;
  insert into reviews (appointment_id, author, rating, body, service_name)
  values (a.id, nm, p_rating, nullif(left(btrim(coalesce(p_text, '')), 600), ''), (select name from services where id = a.service_id));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.public_reviews() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'count', (select count(*) from reviews where published),
    'avg', (select round(avg(rating)::numeric, 1) from reviews where published),
    'list', (select coalesce(jsonb_agg(x), '[]') from (select author, rating, body, service_name, created_at
              from reviews where published and body is not null order by created_at desc limit 12) x))
$$;

create or replace function public.admin_reviews() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform private.need(array['admin']);
  return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select v.id, v.author, v.rating, v.body, v.service_name, v.published, v.created_at, a.ref
    from reviews v join appointments a on a.id = v.appointment_id) x);
end $$;

create or replace function public.admin_set_review(p_id uuid, p_published boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  perform private.need(array['admin']);
  update reviews set published = coalesce(p_published, false) where id = p_id;
  perform private.log(case when p_published then 'review shown' else 'review hidden' end, p_id::text);
end $$;

create or replace function public.my_booking(p_phone text, p_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ref', a.ref, 'status', a.status, 'day', a.day, 'start_min', a.start_min,
    'dur_min', a.dur_min, 'patient_name', a.patient_name, 'complaint', a.complaint,
    'arrived_at', a.arrived_at, 'started_at', a.started_at, 'completed_at', a.completed_at,
    'service_name', (select name from services where id = a.service_id),
    'dentist_name', (select full_name from staff where id = a.dentist_id),
    'review', (select jsonb_build_object('rating', v.rating, 'body', v.body) from reviews v where v.appointment_id = a.id))
  from appointments a
  where a.ref = upper(btrim(p_ref)) and a.phone = private.norm_phone(p_phone)
$$;

revoke execute on function public.admin_reviews(), public.admin_set_review(uuid, boolean) from public, anon;
revoke execute on function public.submit_review(text, text, int, text), public.public_reviews() from public;
grant execute on function public.submit_review(text, text, int, text), public.public_reviews() to anon, authenticated;
grant execute on function public.admin_reviews(), public.admin_set_review(uuid, boolean) to authenticated;
grant execute on function public.my_booking(text, text) to anon, authenticated;
