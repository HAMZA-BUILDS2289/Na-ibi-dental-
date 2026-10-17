-- Na'ibi workflow 2 of 3: dentists and technicians can reschedule their own bookings. Safe to run twice.
create or replace function public.reschedule_appt(p_id uuid, p_day date, p_start int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r text := private.need(array['admin','receptionist','dentist','technician']);
        a appointments%rowtype; sv services%rowtype; pk uuid[];
begin
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r in ('dentist','technician') and (a.status not in ('pending','confirmed')
     or (a.dentist_id is distinct from auth.uid() and a.tech_id is distinct from auth.uid())) then raise exception 'not_allowed'; end if;
  select * into sv from services where id = a.service_id;
  perform pg_advisory_xact_lock(hashtext('naibi-book-' || p_day::text));
  if not private.slot_open(p_day, p_start, sv.duration_min, false) then raise exception 'slot_taken'; end if;
  pk := private.pick(a.service_id, p_day, p_start, a.id, a.dentist_id, a.tech_id);
  if pk is null then raise exception 'slot_taken'; end if;
  begin
    update appointments set day = p_day, start_min = p_start, dur_min = sv.duration_min,
      dentist_id = pk[1], tech_id = pk[2], arrived_at = null,
      status = case when status in ('cancelled','no_show','pending') then 'confirmed' else status end,
      cancel_reason = null, updated_at = now()
    where id = p_id returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  perform private.queue_msg(a, 'rescheduled');
  perform private.log('reschedule', a.ref || ' to ' || p_day || ' ' || private.fmt_time(p_start));
  return private.appt_json(a);
end $$;

create or replace function public.staff_slots(p_service text, p_day date, p_ignore uuid default null) returns int[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r text := private.need(array['admin','receptionist','dentist','technician']);
        c clinic_settings%rowtype; sv services%rowtype; m int; out int[] := '{}';
begin
  if r in ('dentist','technician') and not exists (select 1 from appointments where id = p_ignore
     and (dentist_id = auth.uid() or tech_id = auth.uid())) then raise exception 'not_allowed'; end if;
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

revoke execute on function public.set_appt_status(uuid, text, text), public.reschedule_appt(uuid, date, int), public.staff_slots(text, date, uuid) from public, anon;
grant execute on function public.set_appt_status(uuid, text, text), public.reschedule_appt(uuid, date, int), public.staff_slots(text, date, uuid) to authenticated;
