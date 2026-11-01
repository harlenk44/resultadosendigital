-- =====================================================================
--  pizarra.sql  ·  Datos compartidos de la Pizarra Animaltec
--  Pégalo completo en Supabase > SQL Editor > Run. Se puede repetir.
--  Requiere haber ejecutado antes licenses.sql (usa la función is_admin()).
--
--  Una sola tabla guarda todo lo que la pizarra comparte entre pantallas:
--    results  resultados de animalitos        triples  resultados de triples
--    config   horarios, triples y alternancia logos    logos de cada lotería
--    ads      franjas de publicidad (banners)
--
--  Quién puede qué:
--    · Cualquier pantalla (agencia) LEE.
--    · Solo un administrador (usuario de la tabla admins) ESCRIBE.
--  Es decir: tú cargas los resultados una vez y todas las agencias los ven.
-- =====================================================================

create table if not exists public.pizarra_datos (
  coleccion   text        not null,
  id          text        not null,
  datos       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (coleccion, id),
  constraint pizarra_datos_coleccion_ok check (coleccion in ('results', 'triples', 'config', 'logos', 'ads')),
  constraint pizarra_datos_id_ok        check (id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  constraint pizarra_datos_objeto_ok    check (jsonb_typeof(datos) = 'object'),
  constraint pizarra_datos_tamano_ok    check (octet_length(datos::text) <= 300000)
);

-- Las consultas de la pizarra filtran por colección y por la fecha "d".
create index if not exists pizarra_datos_fecha_idx
  on public.pizarra_datos (coleccion, (datos ->> 'd'));

create or replace function public.pizarra_datos_toca()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists pizarra_datos_toca on public.pizarra_datos;
create trigger pizarra_datos_toca
  before insert or update on public.pizarra_datos
  for each row execute function public.pizarra_datos_toca();

-- Seguridad -------------------------------------------------------------
alter table public.pizarra_datos enable row level security;

drop policy if exists "pizarra_lectura" on public.pizarra_datos;
create policy "pizarra_lectura" on public.pizarra_datos
  for select to anon, authenticated using (true);

drop policy if exists "pizarra_admin_insert" on public.pizarra_datos;
create policy "pizarra_admin_insert" on public.pizarra_datos
  for insert to authenticated with check (public.is_admin());

drop policy if exists "pizarra_admin_update" on public.pizarra_datos;
create policy "pizarra_admin_update" on public.pizarra_datos
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pizarra_admin_delete" on public.pizarra_datos;
create policy "pizarra_admin_delete" on public.pizarra_datos
  for delete to authenticated using (public.is_admin());

revoke all on public.pizarra_datos from anon, authenticated;
grant select on public.pizarra_datos to anon, authenticated;
grant insert, update, delete on public.pizarra_datos to authenticated;

-- Tiempo real: las pantallas se enteran al instante de cada resultado -----
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pizarra_datos'
  ) then
    alter publication supabase_realtime add table public.pizarra_datos;
  end if;
end $$;
