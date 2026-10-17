-- Na'ibi workflow 1 of 3: treatment status + what dentists and technicians can do. Safe to run twice.
alter table public.appointments add column if not exists arrived_at timestamptz;
alter table public.appointments add column if not exists started_at timestamptz;
alter table public.appointments add column if not exists completed_at timestamptz;
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('pending','confirmed','in_progress','completed','cancelled','no_show'));

create or replace function public.set_appt_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r text := private.need(array['admin','receptionist','dentist','technician']); a appointments%rowtype;
begin
  if p_status not in ('pending','confirmed','in_progress','completed','cancelled','no_show') then raise exception 'bad_status'; end if;
  select * into a from appointments where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r in ('dentist','technician') then
    if a.dentist_id is distinct from auth.uid() and a.tech_id is distinct from auth.uid() then raise exception 'not_allowed'; end if;
    if p_status not in ('confirmed','in_progress','completed','no_show') then raise exception 'not_allowed'; end if;
  end if;
  if p_status = 'in_progress' and a.status not in ('pending','confirmed','in_progress') then raise exception 'bad_status'; end if;
  begin
    update appointments set status = p_status, updated_at = now(),
      started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) when p_status in ('pending','confirmed') then null else started_at end,
      arrived_at = case when p_status = 'in_progress' then coalesce(arrived_at, now()) else arrived_at end,
      completed_at = case when p_status = 'completed' then now() when p_status in ('pending','confirmed','in_progress') then null else completed_at end,
      cancel_reason = case when p_status = 'cancelled' then nullif(left(btrim(coalesce(p_reason, '')), 200), '') else null end
    where id = p_id returning * into a;
  exception when exclusion_violation then raise exception 'slot_taken';
  end;
  if p_status = 'confirmed' then perform private.queue_msg(a, 'confirmed'); end if;
  if p_status = 'cancelled' then perform private.queue_msg(a, 'cancelled'); end if;
  perform private.log(p_status, a.ref || ' ' || a.patient_name);
  return private.appt_json(a);
end $$;
