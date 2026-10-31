-- =====================================================================
--  VINCULACIÓN POR CÓDIGO CORTO  -  Pizarra Animaltec
--  Ejecutar DESPUÉS de licenses.sql:  Supabase > SQL Editor > New query > Run
--  (se puede ejecutar varias veces sin problema)
--
--  Para qué sirve: en un Smart TV escribir una clave de 19 caracteres con el
--  control remoto es una tortura. Con esto:
--    1. La pantalla pide un código corto y lo muestra en grande:  K7M-4QX
--    2. El administrador escribe ese código en su panel y elige la agencia.
--    3. La pantalla recibe su clave sola y arranca. Nadie teclea nada en el TV.
--
--  Seguridad:
--   * Los códigos duran 15 minutos y se usan una sola vez (al entregar la
--     clave, la fila se borra).
--   * Solo un administrador puede vincular (link_pairing comprueba is_admin()).
--   * La pantalla (anon) solo puede pedir un código y preguntar por el suyo;
--     no puede leer la tabla ni las claves de otras agencias.
--   * Se limitan a 500 códigos pendientes para que nadie llene la tabla.
-- =====================================================================

create table if not exists public.pairings (
  code        text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  license_id  uuid references public.licenses (id) on delete cascade,   -- NULL = esperando que el admin la vincule
  created_at  timestamptz not null default now()
);

-- Sin políticas: nadie accede directamente a la tabla. Todo pasa por las funciones de abajo.
alter table public.pairings enable row level security;
revoke all on public.pairings from anon, authenticated;


-- ---------------------------------------------------------------------
-- 1) La pantalla pide un código nuevo.  Devuelve p. ej. 'K7M4QX'
-- ---------------------------------------------------------------------
create or replace function public.request_pairing()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 símbolos, sin 0/O ni 1/I
  v_bytes bytea;
  v_code  text;
  v_try   int := 0;
begin
  delete from public.pairings where created_at < now() - interval '15 minutes';
  if (select count(*) from public.pairings) >= 500 then
    raise exception 'Demasiadas solicitudes pendientes, intente en unos minutos' using errcode = 'P0001';
  end if;

  loop
    -- Los bytes 0 a 5 de un uuid v4 son 100 % aleatorios; 256 es múltiplo de 32, así que no hay sesgo.
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    begin
      insert into public.pairings (code) values (v_code);
      return v_code;
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 5 then raise; end if;
    end;
  end loop;
end $$;

revoke all on function public.request_pairing() from public;
grant execute on function public.request_pairing() to anon, authenticated;


-- ---------------------------------------------------------------------
-- 2) La pantalla pregunta cada pocos segundos: ¿ya me vincularon?
--    status: 'waiting' (sigue esperando) | 'linked' (trae la clave) | 'expired'
-- ---------------------------------------------------------------------
create or replace function public.poll_pairing(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p   public.pairings%rowtype;
  lic public.licenses%rowtype;
begin
  select * into p from public.pairings where code = upper(btrim(coalesce(p_code, '')));
  if not found or p.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('status', 'expired');
  end if;
  if p.license_id is null then
    return jsonb_build_object('status', 'waiting');
  end if;

  select * into lic from public.licenses where id = p.license_id;
  delete from public.pairings where code = p.code;                    -- un solo uso
  return jsonb_build_object('status', 'linked', 'license_key', lic.license_key, 'agency_name', lic.agency_name);
end $$;

revoke all on function public.poll_pairing(text) from public;
grant execute on function public.poll_pairing(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 3) El administrador vincula el código que ve en el TV con una agencia.
--    ok=false, reason: 'not_found' (no existe o ya venció) | 'already_linked' | 'license_not_found'
-- ---------------------------------------------------------------------
create or replace function public.link_pairing(p_code text, p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p   public.pairings%rowtype;
  lic public.licenses%rowtype;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into p from public.pairings
   where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))   -- acepta "k7m-4qx"
     and created_at >= now() - interval '15 minutes'
   for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if p.license_id is not null then return jsonb_build_object('ok', false, 'reason', 'already_linked'); end if;

  select * into lic from public.licenses where id = p_license_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'license_not_found'); end if;

  update public.pairings set license_id = lic.id where code = p.code;
  return jsonb_build_object('ok', true, 'agency_name', lic.agency_name);
end $$;

revoke all on function public.link_pairing(text, uuid) from public;
grant execute on function public.link_pairing(text, uuid) to authenticated;
