-- Pipeline de precios: carruseles diarios y semanales con los productos que mas
-- subieron y bajaron en las centrales de abastos, con los datos de la API de
-- Sandia (usesandia.com). Sin IA: datos -> laminas -> publicacion.
--
-- `precios_carruseles`: un carrusel por (cuenta, periodo, direccion, referencia).
-- La referencia es la fecha del dia de los precios, o el lunes de la semana.
-- El unico es lo que impide publicar dos veces el mismo dia o la misma semana.
--
-- `precios_ajustes`: si la cuenta publica precios y a que horas.

create table if not exists public.precios_carruseles (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references public.accounts (id) on delete cascade,
  periodo           text not null check (periodo in ('dia', 'semana')),
  direccion         text not null check (direccion in ('subieron', 'bajaron')),
  referencia        date not null,
  etapa             text not null default 'listo'
                    check (etapa in ('listo', 'publicando', 'publicado', 'error', 'descartado')),
  datos             jsonb not null,
  imagenes          text[] not null default '{}',
  imagenes_facebook text[] not null default '{}',
  texto_instagram   text,
  texto_facebook    text,
  programado_para   timestamptz not null,
  instagram_id      text,
  facebook_id       text,
  error             text,
  intentos          integer not null default 0,
  publicado_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (account_id, periodo, direccion, referencia)
);
create index if not exists precios_carruseles_cuenta_idx on public.precios_carruseles (account_id, created_at desc);
create index if not exists precios_carruseles_pendientes_idx on public.precios_carruseles (etapa, programado_para);
alter table public.precios_carruseles enable row level security;

create table if not exists public.precios_ajustes (
  account_id     uuid primary key references public.accounts (id) on delete cascade,
  activo         boolean not null default false,
  hora_bajaron   text not null default '13:00',
  hora_subieron  text not null default '13:10',
  link           text not null default 'https://usesandia.com',
  redes          text[] not null default '{instagram,facebook}',
  updated_at     timestamptz not null default now()
);
alter table public.precios_ajustes enable row level security;

-- Las metricas reconocen tambien lo que publica este pipeline.
alter table public.post_metricas drop constraint if exists post_metricas_origen_check;
alter table public.post_metricas add constraint post_metricas_origen_check check (origen in ('noticia', 'estudio', 'precios'));

-- El tick: cada cinco minutos, a los :01 :06 :11... para no chocar con la
-- publicacion del estudio (:00 :05 :10...). Arma el carrusel cuando hay datos
-- nuevos y lo publica a su hora.
create or replace function public.fire_precios_tick()
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
    raise warning 'engine-hancel: falta content_tick_url/ingest_secret para el tick de precios';
    return null;
  end if;
  select net.http_post(
    url := replace(v_url, '/api/content/tick', '/api/precios/tick'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  ) into v_request_id;
  return v_request_id;
end;
$$;

select cron.unschedule('engine_hancel_precios_tick') where exists (select 1 from cron.job where jobname = 'engine_hancel_precios_tick');
select cron.schedule('engine_hancel_precios_tick', '1-59/5 * * * *', 'select public.fire_precios_tick();');
