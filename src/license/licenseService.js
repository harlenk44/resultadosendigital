// =====================================================================
//  licenseService.js
//  Toda la comunicación con Supabase y las utilidades de licencias.
//  Aquí NO hay React: son funciones puras o async que usan el cliente
//  de Supabase que se les pasa. Así el hook, el guard y el panel quedan
//  livianos, y es fácil probar o cambiar de base de datos después.
// =====================================================================

const KEY_STORAGE = 'pizarra.license.key';
const TZ = 'America/Caracas';

// ---------------------------------------------------------------------
//  Fechas (siempre calendario de Venezuela, como la pizarra)
// ---------------------------------------------------------------------

/** Fecha de hoy en Caracas, formato 'YYYY-MM-DD'. */
export function todayCaracas() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

/** Suma días a una fecha 'YYYY-MM-DD' y devuelve 'YYYY-MM-DD'. */
export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** '2026-11-30' -> '30/11/2026' (sin pasar por Date, para evitar saltos de zona horaria). */
export function formatDate(dateStr) {
  if (!dateStr) return 'Sin vencimiento';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

/** Fecha y hora legible en hora de Caracas. */
export function formatDateTime(iso) {
  if (!iso) return 'Nunca';
  return new Intl.DateTimeFormat('es-VE', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }).format(new Date(iso));
}

// ---------------------------------------------------------------------
//  Clave de licencia
// ---------------------------------------------------------------------

/** Normaliza lo que escribe la persona: sin espacios y en mayúsculas. */
export function normalizeKey(key) {
  return String(key || '').trim().toUpperCase();
}

/**
 * Genera una clave aleatoria tipo AGN-7KQ2-M9XD-4TPA-HW3E.
 * Usa crypto.getRandomValues (aleatorio seguro) y un alfabeto sin letras
 * confusas (sin 0/O, 1/I). 32 símbolos = sin sesgo con bytes de 0 a 255.
 * 16 símbolos de 32 = 80 bits: imposible de adivinar.
 */
export function generateLicenseKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `AGN-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}

/**
 * Obtiene la clave de la pantalla, en este orden:
 *   1. Parámetro de la dirección:  https://tu-pizarra/?licencia=AGN-XXXX-...
 *      (se guarda y se quita de la barra de direcciones)
 *   2. La que quedó guardada en este dispositivo.
 * Devuelve '' si no hay ninguna (el guard mostrará la pantalla de activación).
 */
export function resolveLicenseKey() {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = normalizeKey(params.get('licencia'));
    if (fromUrl) {
      localStorage.setItem(KEY_STORAGE, fromUrl);
      params.delete('licencia');
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
      return fromUrl;
    }
    return normalizeKey(localStorage.getItem(KEY_STORAGE));
  } catch {
    return '';
  }
}

/** Guarda la clave en este dispositivo (la usa la pantalla de activación). */
export function saveLicenseKey(key) {
  try { localStorage.setItem(KEY_STORAGE, normalizeKey(key)); } catch { /* modo privado: se pierde al cerrar */ }
}

// ---------------------------------------------------------------------
//  Verificación (lo que usa la pizarra del cliente)
// ---------------------------------------------------------------------

/**
 * Pregunta a Supabase si la clave está habilitada.
 * Llama a la función SQL check_license (ver licenses.sql).
 *
 * Devuelve: { allowed, reason, agency_name, vence_el }
 *   reason = 'active' | 'suspended' | 'expired' | 'not_found'
 *
 * LANZA un error si no se pudo consultar (sin internet, Supabase caído...).
 * Es clave distinguir eso de "la licencia está suspendida": un fallo de red
 * NO es un veredicto, y el hook decide qué hacer (ver useLicenseCheck.js).
 */
export async function checkLicense(supabase, key) {
  const { data, error } = await supabase.rpc('check_license', { p_key: key });
  if (error) throw new Error(error.message || 'No se pudo verificar la licencia');
  if (!data || typeof data.allowed !== 'boolean') throw new Error('Respuesta inválida del servidor');
  return data;
}

// ---------------------------------------------------------------------
//  Administración (solo funciona con un usuario que esté en "admins";
//  si no, las políticas RLS de Supabase rechazan o devuelven vacío)
// ---------------------------------------------------------------------

function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

/** ¿Este usuario está en la tabla admins? */
export async function fetchIsAdmin(supabase, userId) {
  const { data, error } = await supabase.from('admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return !!data;
}

export async function listLicenses(supabase) {
  return unwrap(await supabase.from('licenses').select('*').order('created_at', { ascending: false }));
}

/** Crea una agencia nueva con una clave generada. */
export async function createLicense(supabase, { agency_name, vence_el, notes }) {
  const row = {
    license_key: generateLicenseKey(),
    agency_name: agency_name.trim(),
    vence_el: vence_el || null,
    notes: notes?.trim() || null,
    status: 'active',
  };
  return unwrap(await supabase.from('licenses').insert(row).select().single());
}

/** Cambia campos de una licencia: { status } o { vence_el } o { notes }... */
export async function updateLicense(supabase, id, patch) {
  return unwrap(await supabase.from('licenses').update(patch).eq('id', id).select().single());
}

export async function deleteLicense(supabase, id) {
  unwrap(await supabase.from('licenses').delete().eq('id', id));
}

/**
 * Estado real de una fila, tal como lo vería la pantalla del cliente:
 *   'suspended' (apagada a mano) | 'expired' (pasó la fecha) | 'active'
 */
export function effectiveState(license, today = todayCaracas()) {
  if (license.status !== 'active') return 'suspended';
  if (license.vence_el && license.vence_el < today) return 'expired';
  return 'active';
}
