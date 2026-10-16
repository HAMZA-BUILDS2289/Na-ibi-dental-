-- Na'ibi: QR check-in. Safe to run more than once.
alter table public.appointments add column if not exists arrived_at timestamptz;

-- ---------------------------------------------------------------- QR check-in (any signed-in staff)
create or replace function public.staff_lookup(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype;
begin
  perform private.need(array['admin','receptionist','dentist','technician']);
  select * into a from appointments where ref = upper(btrim(coalesce(p_ref, '')));
  if not found then raise exception 'not_found'; end if;
  return private.appt_json(a) || jsonb_build_object('is_today', a.day = private.today());
end $$;

create or replace function public.staff_checkin(p_ref text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a appointments%rowtype; again boolean := false;
begin
  perform private.need(array['admin','receptionist','dentist','technician']);
  select * into a from appointments where ref = upper(btrim(coalesce(p_ref, ''))) for update;
  if not found then raise exception 'not_found'; end if;
  if a.status in ('cancelled','no_show') then raise exception 'not_valid'; end if;
  if a.day <> private.today() then raise exception 'wrong_day'; end if;
  if a.arrived_at is not null then again := true;
  else
    update appointments set arrived_at = now(), updated_at = now(),
      status = case when status = 'pending' then 'confirmed' else status end
    where id = a.id returning * into a;
    perform private.log('checked in', a.ref || ' ' || a.patient_name);
  end if;
  return private.appt_json(a) || jsonb_build_object('already', again);
end $$;

revoke execute on function public.staff_lookup(text), public.staff_checkin(text) from public, anon;
grant execute on function public.staff_lookup(text), public.staff_checkin(text) to authenticated;
