-- =====================================================================
--  SISTEMA DE LICENCIAS / ALQUILER  -  Pizarra Animaltec
--  Ejecutar completo en: Supabase > SQL Editor > New query > Run
--
--  Modelo de seguridad (resumen):
--   * Las pantallas de los clientes usan la clave "anon" y SOLO pueden
--     llamar a la función check_license(clave). No pueden leer la tabla,
--     así que nadie puede listar las claves de otros clientes.
--   * El panel de administración usa un usuario de Supabase Auth que esté
--     en la tabla "admins". Solo ese usuario puede leer/crear/editar/borrar
--     licencias (Row Level Security).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) TABLAS
-- ---------------------------------------------------------------------

-- Una fila por agencia/cliente.
create table if not exists public.licenses (
  id            uuid primary key default gen_random_uuid(),
  license_key   text not null unique
                  check (char_length(license_key) between 16 and 64),   -- clave secreta que va en la pantalla del cliente
  agency_name   text not null
                  check (char_length(trim(agency_name)) > 0),           -- nombre de la agencia
  status        text not null default 'active'
                  check (status in ('active', 'suspended')),            -- interruptor manual: activo / suspendido
  vence_el      date,                                                   -- fecha de corte (último día válido). NULL = sin vencimiento
  notes         text,                                                   -- notas internas (pago, contacto, etc.)
  last_check_at timestamptz,                                            -- última vez que la pantalla consultó (referencia visual)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Quién puede administrar. Solo se llena desde el SQL Editor (paso 4).
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- updated_at se actualiza solo cuando cambian datos de negocio.
-- (check_license solo toca last_check_at, así que NO dispara este trigger.)
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists licenses_touch on public.licenses;
create trigger licenses_touch
  before update of agency_name, status, vence_el, notes on public.licenses
  for each row execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 2) POLÍTICAS DE SEGURIDAD (Row Level Security)
-- ---------------------------------------------------------------------

-- ¿El usuario que hace la petición es administrador?
-- SECURITY DEFINER: puede leer "admins" aunque el usuario no tenga permiso directo.
create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

alter table public.licenses enable row level security;
alter table public.admins   enable row level security;

-- licenses: solo administradores, para todo.
drop policy if exists licenses_admin_select on public.licenses;
drop policy if exists licenses_admin_insert on public.licenses;
drop policy if exists licenses_admin_update on public.licenses;
drop policy if exists licenses_admin_delete on public.licenses;

create policy licenses_admin_select on public.licenses
  for select to authenticated using (public.is_admin());
create policy licenses_admin_insert on public.licenses
  for insert to authenticated with check (public.is_admin());
create policy licenses_admin_update on public.licenses
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy licenses_admin_delete on public.licenses
  for delete to authenticated using (public.is_admin());

-- admins: cada usuario solo puede ver su propia fila (así el panel sabe si es admin).
-- No hay políticas de escritura: nadie puede hacerse admin desde la app.
drop policy if exists admins_self_select on public.admins;
create policy admins_self_select on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Refuerzo: el rol anónimo no tiene ningún permiso sobre las tablas.
revoke all on public.licenses from anon;
revoke all on public.admins   from anon;
grant select, insert, update, delete on public.licenses to authenticated;
grant select on public.admins to authenticated;


-- ---------------------------------------------------------------------
-- 3) FUNCIÓN PÚBLICA QUE USAN LAS PANTALLAS: check_license(clave)
--    Devuelve solo el veredicto de ESA clave, nunca la tabla.
--    reason: 'active' | 'suspended' | 'expired' | 'not_found'
-- ---------------------------------------------------------------------
create or replace function public.check_license(p_key text)
returns jsonb
language plpgsql
security definer                      -- se ejecuta con permisos del dueño, saltando RLS
set search_path = public
as $$
declare
  lic     public.licenses%rowtype;
  -- La fecha de corte se evalúa con el calendario de Venezuela, no con UTC.
  v_today date := (now() at time zone 'America/Caracas')::date;
  v_reason  text;
  v_allowed boolean;
begin
  if p_key is null or char_length(p_key) not between 16 and 64 then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  select * into lic from public.licenses where license_key = p_key;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'not_found');
  end if;

  if lic.status <> 'active' then
    v_reason := 'suspended';  v_allowed := false;
  elsif lic.vence_el is not null and lic.vence_el < v_today then
    v_reason := 'expired';    v_allowed := false;
  else
    v_reason := 'active';     v_allowed := true;
  end if;

  -- Marca de "última conexión", como máximo una vez cada 5 minutos por licencia.
  update public.licenses
     set last_check_at = now()
   where id = lic.id
     and (last_check_at is null or last_check_at < now() - interval '5 minutes');

  return jsonb_build_object(
    'allowed',     v_allowed,
    'reason',      v_reason,
    'agency_name', lic.agency_name,
    'vence_el',    lic.vence_el
  );
end $$;

revoke all on function public.check_license(text) from public;
grant execute on function public.check_license(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4) HAZTE ADMINISTRADOR  (hacerlo UNA vez, a mano)
--    a) Supabase > Authentication > Users > Add user (email + contraseña).
--    b) Copia el UUID de ese usuario.
--    c) Descomenta, pega el UUID y ejecuta:
-- ---------------------------------------------------------------------
-- insert into public.admins (user_id) values ('PEGA-AQUI-EL-UUID-DE-TU-USUARIO');


-- ---------------------------------------------------------------------
-- 5) (OPCIONAL) Licencia de ejemplo para probar. La clave real la genera
--    el panel de administración; esta es solo para una prueba rápida.
-- ---------------------------------------------------------------------
-- insert into public.licenses (license_key, agency_name, vence_el)
-- values ('AGN-TEST-AAAA-BBBB-CCCC', 'Agencia de prueba', current_date + 30);
