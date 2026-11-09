-- Metricas del portal (la web de la empresa), leidas por el tick de metricas cada hora con una
-- peticion firmada a `<portal>/api/metricas/resumen`. Hancel solo guarda el resumen: el detalle
-- (cada visita) vive en el portal.

create table if not exists public.portal_metricas_dia (
  account_id         uuid not null references public.accounts (id) on delete cascade,
  dia                date not null,
  visitantes         integer not null default 0,
  nuevos             integer not null default 0,
  sesiones           integer not null default 0,
  vistas             integer not null default 0,
  rebote             numeric not null default 0,
  paginas_por_sesion numeric not null default 0,
  segundos_lectura   integer not null default 0,
  canales            jsonb not null default '{}',
  dispositivos       jsonb not null default '{}',
  paises             jsonb not null default '{}',
  ciudades           jsonb not null default '{}',
  enlaces            jsonb not null default '{}',
  clics              jsonb not null default '{}',
  actualizado_at     timestamptz not null default now(),
  primary key (account_id, dia)
);
alter table public.portal_metricas_dia enable row level security;

create table if not exists public.portal_metricas_noticia (
  account_id        uuid not null references public.accounts (id) on delete cascade,
  dia               date not null,
  noticia_id        uuid not null,
  vistas            integer not null default 0,
  visitantes        integer not null default 0,
  segundos_promedio integer not null default 0,
  segundos_mediana  integer not null default 0,
  scroll_promedio   integer not null default 0,
  lecturas          integer not null default 0,
  desde_enlaces     integer not null default 0,
  clics_portada     integer not null default 0,
  compartidos       integer not null default 0,
  canales           jsonb not null default '{}',
  actualizado_at    timestamptz not null default now(),
  primary key (account_id, dia, noticia_id)
);
alter table public.portal_metricas_noticia enable row level security;

-- Totales de cada noticia desde que se mide (personas distintas: no se pueden sumar por dia).
create table if not exists public.portal_metricas_acumulado (
  account_id        uuid not null references public.accounts (id) on delete cascade,
  noticia_id        uuid not null,
  slug              text,
  titular           text,
  publicada_at      timestamptz,
  vistas            integer not null default 0,
  visitantes        integer not null default 0,
  segundos_promedio integer not null default 0,
  scroll_promedio   integer not null default 0,
  desde_enlaces     integer not null default 0,
  actualizado_at    timestamptz not null default now(),
  primary key (account_id, noticia_id)
);
alter table public.portal_metricas_acumulado enable row level security;

-- Por empresa: personas distintas en ventanas que terminan hoy, y como fue la ultima lectura.
create table if not exists public.portal_metricas_cuenta (
  account_id         uuid primary key references public.accounts (id) on delete cascade,
  visitantes_ventana jsonb not null default '{}',
  leido_at           timestamptz,
  error              text,
  actualizado_at     timestamptz not null default now()
);
alter table public.portal_metricas_cuenta enable row level security;
