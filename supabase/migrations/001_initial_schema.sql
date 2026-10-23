-- Studio Mariana: execute no SQL Editor de um projeto Supabase novo.
begin;

create extension if not exists btree_gist with schema extensions;

create table public.services (
  id text primary key,
  name text not null unique check (char_length(name) between 2 and 80),
  duration_minutes integer not null check (duration_minutes between 15 and 480 and duration_minutes % 15 = 0),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  sort_order smallint not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  professional_id smallint not null default 1 check (professional_id = 1),
  service_id text not null references public.services(id) on update restrict on delete restrict,
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  customer_phone text not null check (customer_phone ~ '^\+?[0-9]{10,15}$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointments_no_active_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'confirmed')
);

create index appointments_service_id_idx on public.appointments(service_id);
create index appointments_starts_at_idx on public.appointments(starts_at) where status = 'confirmed';
create index appointments_status_idx on public.appointments(status);

insert into public.services (id, name, duration_minutes, price_cents, sort_order) values
  ('corte-feminino', 'Corte feminino', 60, 7000, 1),
  ('escova', 'Escova', 45, 5000, 2),
  ('coloracao', 'Coloração', 120, 18000, 3)
on conflict (id) do update set
  name = excluded.name,
  duration_minutes = excluded.duration_minutes,
  price_cents = excluded.price_cents,
  sort_order = excluded.sort_order;

alter table public.services enable row level security;
alter table public.services force row level security;
alter table public.appointments enable row level security;
alter table public.appointments force row level security;

revoke all on table public.services from public, anon, authenticated;
revoke all on table public.appointments from public, anon, authenticated;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table app_private.rate_limits (
  client_hash text not null check (char_length(client_hash) = 64),
  bucket text not null check (char_length(bucket) between 1 and 30),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (client_hash, bucket)
);

revoke all on table app_private.rate_limits from public, anon, authenticated;

create or replace function public.consume_api_rate_limit(
  p_client_hash text,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $$
declare
  v_count integer;
begin
  if char_length(p_client_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into app_private.rate_limits as limits (client_hash, bucket, window_started_at, request_count)
  values (p_client_hash, left(p_bucket, 30), clock_timestamp(), 1)
  on conflict (client_hash, bucket) do update
    set window_started_at = case
          when limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then clock_timestamp()
          else limits.window_started_at
        end,
        request_count = case
          when limits.window_started_at <= clock_timestamp() - make_interval(secs => p_window_seconds) then 1
          else limits.request_count + 1
        end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

create or replace function public.create_appointment(
  p_service_id text,
  p_customer_name text,
  p_customer_phone text,
  p_starts_at timestamptz
) returns table (id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_service public.services%rowtype;
  v_ends_at timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_start_minutes integer;
  v_end_minutes integer;
begin
  select * into v_service from public.services where services.id = p_service_id and active = true;
  if not found then raise exception using errcode = 'P0002', message = 'SERVICE_NOT_FOUND'; end if;
  if char_length(trim(p_customer_name)) not between 2 and 80 or p_customer_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception using errcode = '22023', message = 'INVALID_CUSTOMER_DATA';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_service.duration_minutes);
  v_local_start := p_starts_at at time zone 'America/Sao_Paulo';
  v_local_end := v_ends_at at time zone 'America/Sao_Paulo';
  v_start_minutes := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_end_minutes := extract(hour from v_local_end)::integer * 60 + extract(minute from v_local_end)::integer;

  if extract(dow from v_local_start) = 0
    or extract(second from v_local_start) <> 0
    or (v_start_minutes % 15) <> 0
    or p_starts_at < clock_timestamp() + interval '1 hour'
    or p_starts_at > clock_timestamp() + interval '30 days 23 hours 59 minutes'
    or v_local_start::date <> v_local_end::date
    or not ((v_start_minutes >= 540 and v_end_minutes <= 720) or (v_start_minutes >= 780 and v_end_minutes <= 1080)) then
    raise exception using errcode = '22023', message = 'INVALID_APPOINTMENT_TIME';
  end if;

  return query
    insert into public.appointments (service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_service.id, trim(p_customer_name), p_customer_phone, p_starts_at, v_ends_at)
    returning appointments.id, appointments.starts_at, appointments.ends_at;
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'APPOINTMENT_CONFLICT';
end;
$$;

revoke all on function public.consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_appointment(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.create_appointment(text, text, text, timestamptz) to service_role;

commit;
