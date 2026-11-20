-- Puntaje de redes: solo salen en carrusel las notas del portal que llegan al minimo.
-- El portal sigue publicando todas. NULL = sin minimo (salen todas).
alter table generation_config add column if not exists redes_puntaje_minimo smallint check (redes_puntaje_minimo between 1 and 10);

-- El puntaje de cada nota, calculado una vez (ver src/engine/content/puntaje-redes.ts).
alter table news_redacciones
  add column if not exists puntaje_redes smallint,
  add column if not exists puntaje_redes_razon text,
  add column if not exists puntaje_redes_at timestamptz;

-- Indice Agro arranca con minimo 5.
update generation_config set redes_puntaje_minimo = 5 where account_id = '7a775bdf-50e0-4467-ace4-20f4ef444f44';
