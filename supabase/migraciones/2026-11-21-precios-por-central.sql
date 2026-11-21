-- Precios por central: un carrusel por central, direccion y dia (o semana).
-- '' = el ranking general de todas las centrales (los carruseles de antes).
alter table precios_carruseles add column if not exists central text not null default '';
drop index if exists precios_carruseles_account_id_periodo_direccion_referencia_key;
alter table precios_carruseles drop constraint if exists precios_carruseles_account_id_periodo_direccion_referencia_key;
create unique index if not exists precios_carruseles_unico_idx on precios_carruseles (account_id, periodo, direccion, referencia, central);

-- Las centrales que salen, en orden (slugs de Sandia). Vacio = el ranking general.
alter table precios_ajustes add column if not exists centrales text[] not null default '{}';

-- Indice Agro: Corabastos, CMA (Medellin), Cavasa (Cali) y Centroabastos (Bucaramanga); laminas fijas.
update precios_ajustes
set centrales = array['corabastos', 'cma', 'cavasa', 'centroabastos'], animado = false
where account_id = '7a775bdf-50e0-4467-ace4-20f4ef444f44';
