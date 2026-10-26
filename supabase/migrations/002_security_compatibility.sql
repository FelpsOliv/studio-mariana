-- Atualização incremental para instalações que já executaram uma versão de 001.
-- Não remove tabelas, serviços ou reservas. Em caso de conflito histórico, a
-- criação da constraint de exclusão falha e a transação inteira é revertida.
begin;

create extension if not exists btree_gist with schema extensions;
create schema if not exists app_private;

-- Esta configuração afeta somente objetos FUTUROS criados pelo papel postgres.
-- Ela não corrige objetos existentes nem objetos criados por outro owner; por
-- isso esta migração também aplica REVOKE explícito a todos os objetos atuais.
-- Migrações futuras devem continuar revogando/concedendo privilégios por objeto.
alter default privileges for role postgres in schema app_private
  revoke execute on functions from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema app_private
  revoke all on tables from public, anon, authenticated, service_role;

create table if not exists app_private.rate_limits (
  client_hash text not null check (char_length(client_hash) = 64),
  bucket text not null check (char_length(bucket) between 1 and 30),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (client_hash, bucket)
);

-- Linha singleton usada para coordenar a limpeza sem fazer uma varredura a
-- cada chamada pública. Nenhum dado de cliente é armazenado nesta tabela.
create table if not exists app_private.rate_limit_maintenance (
  singleton boolean primary key default true check (singleton),
  last_cleanup_at timestamptz not null default '-infinity'::timestamptz
);

insert into app_private.rate_limit_maintenance (singleton)
values (true)
on conflict (singleton) do nothing;

create index if not exists rate_limits_window_started_at_idx
  on app_private.rate_limits(window_started_at);
create index if not exists appointments_service_id_idx
  on public.appointments(service_id);
create index if not exists appointments_starts_at_idx
  on public.appointments(starts_at) where status = 'confirmed';
create index if not exists appointments_status_idx
  on public.appointments(status);

-- Garante a barreira atômica caso uma versão muito antiga não a possua.
do $migration$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.appointments'::pg_catalog.regclass
      and conname = 'appointments_no_active_overlap'
  ) then
    execute $sql$
      alter table public.appointments
      add constraint appointments_no_active_overlap exclude using gist (
        professional_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status = 'confirmed')
    $sql$;
  end if;
end;
$migration$;

alter table public.services enable row level security;
alter table public.services force row level security;
alter table public.appointments enable row level security;
alter table public.appointments force row level security;
alter table app_private.rate_limits enable row level security;
alter table app_private.rate_limits force row level security;
alter table app_private.rate_limit_maintenance enable row level security;
alter table app_private.rate_limit_maintenance force row level security;

drop policy if exists studio_services_service_role_select on public.services;
create policy studio_services_service_role_select
  on public.services for select to service_role
  using (true);

drop policy if exists studio_appointments_service_role_select on public.appointments;
create policy studio_appointments_service_role_select
  on public.appointments for select to service_role
  using (true);

drop policy if exists studio_appointments_service_role_insert on public.appointments;
create policy studio_appointments_service_role_insert
  on public.appointments for insert to service_role
  with check (true);

drop policy if exists studio_rate_limits_service_role_all on app_private.rate_limits;
create policy studio_rate_limits_service_role_all
  on app_private.rate_limits for all to service_role
  using (true)
  with check (true);

drop policy if exists studio_rate_limit_maintenance_service_role_all on app_private.rate_limit_maintenance;
create policy studio_rate_limit_maintenance_service_role_all
  on app_private.rate_limit_maintenance for all to service_role
  using (true)
  with check (true);

create or replace function app_private.consume_api_rate_limit(
  p_client_hash text,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_count integer;
  v_run_cleanup boolean;
begin
  if p_client_hash is null
    or p_bucket is null
    or p_limit is null
    or p_window_seconds is null
    or p_client_hash !~ '^[0-9a-f]{64}$'
    or char_length(p_bucket) not between 1 and 30
    or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400 then
    return false;
  end if;

  -- Só uma transação por hora vence este UPDATE. A exclusão é limitada a mil
  -- linhas para manter o custo previsível mesmo após longos períodos sem uso.
  update app_private.rate_limit_maintenance
  set last_cleanup_at = pg_catalog.clock_timestamp()
  where singleton = true
    and last_cleanup_at <= pg_catalog.clock_timestamp() - interval '1 hour'
  returning true into v_run_cleanup;

  if coalesce(v_run_cleanup, false) then
    delete from app_private.rate_limits as stale
    where stale.ctid in (
      select candidate.ctid
      from app_private.rate_limits as candidate
      where candidate.window_started_at < pg_catalog.clock_timestamp() - interval '7 days'
      order by candidate.window_started_at
      limit 1000
    );
  end if;

  insert into app_private.rate_limits as limits (client_hash, bucket, window_started_at, request_count)
  values (p_client_hash, p_bucket, pg_catalog.clock_timestamp(), 1)
  on conflict (client_hash, bucket) do update
    set window_started_at = case
          when limits.window_started_at <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_window_seconds) then pg_catalog.clock_timestamp()
          else limits.window_started_at
        end,
        request_count = case
          when limits.window_started_at <= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_window_seconds) then 1
          else limits.request_count + 1
        end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

create or replace function app_private.create_appointment(
  p_service_id text,
  p_customer_name text,
  p_customer_phone text,
  p_starts_at timestamptz
) returns table (id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_service public.services%rowtype;
  v_ends_at timestamptz;
  v_local_start timestamp;
  v_local_end timestamp;
  v_start_minutes integer;
  v_end_minutes integer;
  v_today date;
begin
  select * into v_service
  from public.services as selected_service
  where selected_service.id = p_service_id and selected_service.active = true;
  if not found then raise exception using errcode = 'P0002', message = 'SERVICE_NOT_FOUND'; end if;
  if p_customer_name is null
    or p_customer_phone is null
    or p_starts_at is null
    or pg_catalog.char_length(pg_catalog.btrim(p_customer_name)) not between 2 and 80
    or p_customer_phone !~ '^\+?[0-9]{10,15}$' then
    raise exception using errcode = '22023', message = 'INVALID_CUSTOMER_DATA';
  end if;

  v_ends_at := p_starts_at + pg_catalog.make_interval(mins => v_service.duration_minutes);
  v_local_start := p_starts_at at time zone 'America/Sao_Paulo';
  v_local_end := v_ends_at at time zone 'America/Sao_Paulo';
  v_today := (pg_catalog.clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  v_start_minutes := extract(hour from v_local_start)::integer * 60 + extract(minute from v_local_start)::integer;
  v_end_minutes := extract(hour from v_local_end)::integer * 60 + extract(minute from v_local_end)::integer;

  if extract(dow from v_local_start) = 0
    or extract(second from v_local_start) <> 0
    or (v_start_minutes % 15) <> 0
    or p_starts_at < pg_catalog.clock_timestamp() + interval '1 hour'
    or v_local_start::date < v_today
    or v_local_start::date > v_today + 30
    or v_local_start::date <> v_local_end::date
    or not ((v_start_minutes >= 540 and v_end_minutes <= 720) or (v_start_minutes >= 780 and v_end_minutes <= 1080)) then
    raise exception using errcode = '22023', message = 'INVALID_APPOINTMENT_TIME';
  end if;

  return query
    insert into public.appointments as created_appointment (service_id, customer_name, customer_phone, starts_at, ends_at)
    values (v_service.id, pg_catalog.btrim(p_customer_name), p_customer_phone, p_starts_at, v_ends_at)
    returning created_appointment.id, created_appointment.starts_at, created_appointment.ends_at;
exception
  when exclusion_violation then
    raise exception using errcode = '23P01', message = 'APPOINTMENT_CONFLICT';
end;
$$;

-- Neutraliza RPCs antigas no schema public sem remover dependências existentes.
do $migration$
begin
  if pg_catalog.to_regprocedure('public.consume_api_rate_limit(text,text,integer,integer)') is not null then
    execute 'revoke all on function public.consume_api_rate_limit(text, text, integer, integer) from public, anon, authenticated, service_role';
  end if;
  if pg_catalog.to_regprocedure('public.create_appointment(text,text,text,timestamptz)') is not null then
    execute 'revoke all on function public.create_appointment(text, text, text, timestamptz) from public, anon, authenticated, service_role';
  end if;
end;
$migration$;

revoke all on table public.services from public, anon, authenticated, service_role;
revoke all on table public.appointments from public, anon, authenticated, service_role;
revoke all on schema app_private from public, anon, authenticated, service_role;
revoke all on all tables in schema app_private from public, anon, authenticated, service_role;
revoke all on all functions in schema app_private from public, anon, authenticated, service_role;

grant usage on schema app_private to service_role;
grant select on table public.services to service_role;
grant select, insert on table public.appointments to service_role;
grant select, insert, update, delete on table app_private.rate_limits to service_role;
grant select, update on table app_private.rate_limit_maintenance to service_role;
grant execute on function app_private.consume_api_rate_limit(text, text, integer, integer) to service_role;
grant execute on function app_private.create_appointment(text, text, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
