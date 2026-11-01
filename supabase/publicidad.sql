-- =====================================================================
--  publicidad.sql  ·  Publicidad emergente (pop-up) de la pizarra
--  Pégalo completo en Supabase > SQL Editor > Run. Se puede repetir.
--
--  Qué crea:
--   1. Tabla anuncios_publicidad
--   2. Seguridad (RLS): la pizarra solo puede LEER. Nadie escribe desde
--      el navegador; solo la Edge Function (con la clave service_role).
--   3. Realtime para que la pizarra se entere de fotos nuevas.
--   4. Bucket público "publicidad" (fotos) con límite de 5 MB y solo imágenes.
-- =====================================================================

-- 1. Tabla ------------------------------------------------------------
create table if not exists public.anuncios_publicidad (
  id                 uuid primary key default gen_random_uuid(),
  imagen_url         text        not null,
  activo             boolean     not null default true,
  duracion_segundos  int         not null default 10 check (duracion_segundos between 2 and 120),
  intervalo_minutos  int         not null default 5  check (intervalo_minutos between 1 and 240),
  created_at         timestamptz not null default now()
);

create index if not exists anuncios_publicidad_activo_idx
  on public.anuncios_publicidad (activo, created_at);

-- 2. Seguridad ----------------------------------------------------------
alter table public.anuncios_publicidad enable row level security;

-- La pizarra (anon) solo puede leer. Se leen TODAS las filas (no solo las
-- activas) a propósito: así Realtime también avisa cuando un anuncio se
-- desactiva ("borrar"). Las fotos están en un bucket público de todos modos.
drop policy if exists "anuncios_lectura_publica" on public.anuncios_publicidad;
create policy "anuncios_lectura_publica"
  on public.anuncios_publicidad
  for select
  to anon, authenticated
  using (true);

-- Sin políticas de insert/update/delete: desde el navegador no se puede
-- escribir. La Edge Function usa service_role, que se salta RLS.
revoke all on public.anuncios_publicidad from anon, authenticated;
grant select on public.anuncios_publicidad to anon, authenticated;

-- 3. Realtime -----------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'anuncios_publicidad'
  ) then
    alter publication supabase_realtime add table public.anuncios_publicidad;
  end if;
end $$;

-- 4. Bucket público "publicidad" ------------------------------------------
-- Público = cualquiera con el enlace puede VER la imagen (necesario para
-- mostrarla en la pizarra). Subir/borrar: solo la Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('publicidad', 'publicidad', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
