-- NA'IBI update: service prices, descriptions, delete service. Safe to run twice.
alter table public.services add column if not exists price_ngn int check (price_ngn is null or price_ngn between 0 and 100000000);
alter table public.services add column if not exists price_from boolean not null default false;
alter table public.services add column if not exists short text;
alter table public.services add column if not exists details text;
alter table public.services add column if not exists icon text;
-- save a service with price and text.
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
-- delete a service (only when it has no bookings).
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

revoke execute on function public.admin_delete_service(text) from public, anon;
grant execute on function public.admin_delete_service(text) to authenticated;
-- the website reads services and prices from here.
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
