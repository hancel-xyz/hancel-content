-- Metricas de lo que publica Hancel en Instagram y Facebook.
--
-- `post_metricas`: una fila por post publicado desde Hancel, con sus ultimas
-- cifras (Meta da totales de por vida; no se guarda historia). La refresca el
-- tick de metricas cada hora mientras el post tenga menos de 60 dias.
--
-- `cuenta_metricas_dia`: lo que Meta solo da por cuenta y por dia, como los
-- toques al link de la biografia de Instagram.

create table if not exists public.post_metricas (
  id             uuid primary key default gen_random_uuid(),
  account_id     uuid not null references public.accounts (id) on delete cascade,
  red            text not null check (red in ('instagram', 'facebook')),
  post_id        text not null,
  origen         text not null check (origen in ('noticia', 'estudio')),
  pieza_id       uuid,
  texto          text,
  enlace         text,
  imagen         text,
  tipo           text,
  publicado_at   timestamptz not null,
  vistas         integer,
  alcance        integer,
  me_gusta       integer,
  comentarios    integer,
  guardados      integer,
  compartidos    integer,
  interacciones  integer,
  actualizado_at timestamptz not null default now(),
  unique (account_id, red, post_id)
);
create index if not exists post_metricas_cuenta_idx on public.post_metricas (account_id, publicado_at desc);
alter table public.post_metricas enable row level security;

create table if not exists public.cuenta_metricas_dia (
  account_id     uuid not null references public.accounts (id) on delete cascade,
  red            text not null default 'instagram',
  dia            date not null,
  toques_link    integer,
  visitas_perfil integer,
  alcance        integer,
  actualizado_at timestamptz not null default now(),
  primary key (account_id, red, dia)
);
alter table public.cuenta_metricas_dia enable row level security;

-- El tick: cada hora, a los 17 minutos (lejos de los :00/:15/:30/:45 de publicacion).
create or replace function public.fire_metricas_tick()
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_url        text;
  v_secret     text;
  v_request_id bigint;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'content_tick_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'ingest_secret';
  if v_url is null or v_secret is null then
    raise warning 'engine-hancel: falta content_tick_url/ingest_secret para el tick de metricas';
    return null;
  end if;
  select net.http_post(
    url := replace(v_url, '/api/content/tick', '/api/metricas/tick'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.fire_metricas_tick() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'engine_hancel_metricas_tick';
  perform cron.schedule('engine_hancel_metricas_tick', '17 * * * *', 'select public.fire_metricas_tick();');
end
$$;
