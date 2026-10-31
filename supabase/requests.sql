-- =====================================================================
--  PETICIONES DE ACTIVACIÓN  -  Pizarra Animaltec
--  Ejecutar DESPUÉS de licenses.sql:  Supabase > SQL Editor > New query > Run
--  (se puede ejecutar varias veces sin problema)
--
--  Cómo funciona (nadie teclea nada):
--    1. El cliente abre la pizarra en su TV o navegador y pulsa "Enviar petición".
--    2. A ti te aparece en el panel, en "Peticiones pendientes".
--    3. Tú pulsas "Aceptar", le pones el nombre de la agencia y el tiempo de
--       duración. Se crea la licencia y la pantalla arranca sola en segundos.
--
--  Seguridad:
--   * Cada pantalla genera un token secreto largo que solo ella conoce; con
--     él pregunta por el estado de SU petición y recibe SU clave una sola vez.
--   * Aceptar, rechazar y ver la lista es solo para administradores
--     (las funciones comprueban is_admin() dentro de la base de datos).
--   * Las peticiones no aceptadas se borran solas a los 7 días y hay un tope
--     de 200 pendientes para que nadie llene la tabla.
-- =====================================================================

-- Limpieza de la versión anterior (vinculación por código), si se había instalado.
drop function if exists public.request_pairing();
drop function if exists public.poll_pairing(text);
drop function if exists public.link_pairing(text, uuid);
drop table if exists public.pairings;

create table if not exists public.activation_requests (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique
                check (token ~ '^[A-Za-z0-9_-]{24,64}$'),        -- secreto de la pantalla (nunca se muestra)
  label       text not null,                                       -- referencia corta para el admin, p. ej. K7M-4QX
  note        text check (note is null or char_length(note) <= 80),    -- "quién soy" (opcional, lo escribe el cliente)
  device      text check (device is null or char_length(device) <= 200), -- navegador / tipo de pantalla
  status      text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  license_id  uuid references public.licenses (id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

alter table public.activation_requests enable row level security;
drop policy if exists requests_admin_select on public.activation_requests;
drop policy if exists requests_admin_delete on public.activation_requests;
create policy requests_admin_select on public.activation_requests
  for select to authenticated using (public.is_admin());
create policy requests_admin_delete on public.activation_requests
  for delete to authenticated using (public.is_admin());

-- La pantalla (anon) no toca la tabla; solo usa las funciones de abajo.
-- El admin lee y borra directo; aceptar y rechazar pasan por funciones.
revoke all on public.activation_requests from anon, authenticated;
grant select, delete on public.activation_requests to authenticated;


-- ---------------------------------------------------------------------
-- 0) Utilidad interna: clave de licencia aleatoria AGN-XXXX-XXXX-XXXX-XXXX
--    (no se concede a nadie; solo la usan las funciones de abajo)
-- ---------------------------------------------------------------------
create or replace function public.gen_license_key()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 símbolos, sin 0/O ni 1/I
  v_chars text := '';
  v_bytes bytea;
  i int;
begin
  -- Los bytes 0 a 5 de un uuid v4 son 100 % aleatorios; 3 uuids dan 18 bytes, usamos 16.
  for i in 0..15 loop
    if i % 6 = 0 then v_bytes := uuid_send(gen_random_uuid()); end if;
    v_chars := v_chars || substr(v_alphabet, (get_byte(v_bytes, i % 6) % 32) + 1, 1);
  end loop;
  return 'AGN-' || substr(v_chars, 1, 4) || '-' || substr(v_chars, 5, 4) || '-' || substr(v_chars, 9, 4) || '-' || substr(v_chars, 13, 4);
end $$;
-- Supabase da EXECUTE a anon por defecto: se quita explícitamente.
revoke all on function public.gen_license_key() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 1) La pantalla envía su petición (el botón "Enviar petición").
--    Es repetible: si ese token ya envió, devuelve el estado actual.
--    status: 'pending' | 'approved' | 'rejected' | 'invalid'
-- ---------------------------------------------------------------------
create or replace function public.submit_activation_request(p_token text, p_note text default null, p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_token text := btrim(coalesce(p_token, ''));
  r       public.activation_requests%rowtype;
  v_label text;
  v_bytes bytea;
  v_try   int := 0;
begin
  if v_token !~ '^[A-Za-z0-9_-]{24,64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;

  -- Limpieza: lo que nadie atendió en 7 días se borra.
  delete from public.activation_requests
   where coalesce(decided_at, created_at) < now() - interval '7 days';

  select * into r from public.activation_requests where token = v_token;
  if found then
    return jsonb_build_object('status', r.status, 'label', r.label);
  end if;

  if (select count(*) from public.activation_requests where status = 'pending') >= 200 then
    raise exception 'Demasiadas peticiones pendientes, intente más tarde' using errcode = 'P0001';
  end if;

  loop   -- referencia corta XXX-XXX, sin repetir entre las pendientes
    v_bytes := uuid_send(gen_random_uuid());
    v_label := '';
    for i in 0..5 loop
      v_label := v_label || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    v_label := substr(v_label, 1, 3) || '-' || substr(v_label, 4, 3);
    v_try := v_try + 1;
    exit when v_try > 5 or not exists (select 1 from public.activation_requests where label = v_label and status = 'pending');
  end loop;

  insert into public.activation_requests (token, label, note, device)
  values (v_token, v_label,
          nullif(left(btrim(coalesce(p_note, '')), 80), ''),
          nullif(left(btrim(coalesce(p_device, '')), 200), ''));
  return jsonb_build_object('status', 'pending', 'label', v_label);
end $$;

revoke all on function public.submit_activation_request(text, text, text) from public;
grant execute on function public.submit_activation_request(text, text, text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2) La pantalla pregunta cada pocos segundos: ¿ya me aceptaron?
--    status: 'none' (no existe: pedir de nuevo) | 'pending' | 'rejected' | 'approved' (trae la clave, una sola vez)
-- ---------------------------------------------------------------------
create or replace function public.poll_activation_request(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.activation_requests%rowtype;
  lic public.licenses%rowtype;
begin
  select * into r from public.activation_requests where token = btrim(coalesce(p_token, ''));
  if not found then return jsonb_build_object('status', 'none'); end if;

  if r.status in ('pending', 'rejected') then
    return jsonb_build_object('status', r.status, 'label', r.label);
  end if;

  -- aprobada: entregar la clave y borrar la petición (un solo uso)
  delete from public.activation_requests where id = r.id;
  select * into lic from public.licenses where id = r.license_id;
  if not found then return jsonb_build_object('status', 'none'); end if;   -- la licencia se borró mientras tanto
  return jsonb_build_object('status', 'approved', 'license_key', lic.license_key, 'agency_name', lic.agency_name);
end $$;

revoke all on function public.poll_activation_request(text) from public;
grant execute on function public.poll_activation_request(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3) ADMIN: aceptar una petición.
--    - Agencia nueva: pasa p_agency_name y p_vence_el (p_license_id = null).
--    - Agencia que ya existe (otra pantalla de la misma agencia): pasa p_license_id.
--    ok=false, reason: 'not_found' | 'already_decided' | 'name_required' | 'license_not_found'
-- ---------------------------------------------------------------------
create or replace function public.approve_activation_request(
  p_request_id uuid, p_agency_name text default null, p_vence_el date default null,
  p_notes text default null, p_license_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r   public.activation_requests%rowtype;
  lic public.licenses%rowtype;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into r from public.activation_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'already_decided'); end if;

  if p_license_id is not null then
    select * into lic from public.licenses where id = p_license_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'license_not_found'); end if;
  else
    if btrim(coalesce(p_agency_name, '')) = '' then
      return jsonb_build_object('ok', false, 'reason', 'name_required');
    end if;
    insert into public.licenses (license_key, agency_name, status, vence_el, notes)
    values (public.gen_license_key(), btrim(p_agency_name), 'active', p_vence_el, nullif(btrim(coalesce(p_notes, '')), ''))
    returning * into lic;
  end if;

  update public.activation_requests set status = 'approved', license_id = lic.id, decided_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'license_id', lic.id, 'agency_name', lic.agency_name, 'vence_el', lic.vence_el);
end $$;

revoke all on function public.approve_activation_request(uuid, text, date, text, uuid) from public, anon;
grant execute on function public.approve_activation_request(uuid, text, date, text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4) ADMIN: rechazar una petición (la pantalla verá "rechazada").
-- ---------------------------------------------------------------------
create or replace function public.reject_activation_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  update public.activation_requests set status = 'rejected', decided_at = now()
   where id = p_request_id and status = 'pending';
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.reject_activation_request(uuid) from public, anon;
grant execute on function public.reject_activation_request(uuid) to authenticated;
