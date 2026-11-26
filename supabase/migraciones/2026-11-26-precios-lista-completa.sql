-- Precios: un solo carrusel por central y dia, con todos los productos.
-- Antes habia dos (los que subieron y los que bajaron); los nuevos van con
-- direccion 'todos'. Los viejos se quedan como estan.
alter table public.precios_carruseles drop constraint if exists precios_carruseles_direccion_check;
alter table public.precios_carruseles add constraint precios_carruseles_direccion_check
  check (direccion in ('subieron', 'bajaron', 'todos'));
