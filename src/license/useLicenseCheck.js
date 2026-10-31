// =====================================================================
//  useLicenseCheck.js
//  Hook reutilizable: consulta el estado de la licencia, lo repite cada
//  cierto tiempo y decide qué hacer si se cae el internet.
//
//  Uso:
//    const lic = useLicenseCheck({ supabase, licenseKey });
//    lic.status  -> 'checking' | 'active' | 'blocked' | 'unreachable' | 'no_key'
//
//  Significado de cada estado:
//    checking     primera consulta en curso, aún sin veredicto
//    active       licencia al día: se puede mostrar la pizarra
//    blocked      suspendida, vencida o clave inexistente: BLOQUEAR
//    unreachable  no se pudo consultar y no hay respaldo válido: BLOQUEAR
//    no_key       esta pantalla todavía no tiene clave
//
//  Qué pasa si se cae el internet (decisión de diseño):
//   Una pizarra en un televisor NO debe apagarse porque parpadeó el internet.
//   Por eso se guarda el último veredicto "activo" y se sigue mostrando hasta
//   `graceHours` horas (72 por defecto) sin poder confirmar. Pasado ese tiempo,
//   o si la última respuesta fue "suspendida", se bloquea. Un veredicto
//   "suspendida" del servidor se aplica siempre, de inmediato.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkLicense, normalizeKey } from './licenseService';

const CACHE_KEY = 'pizarra.license.cache';
const HOUR_MS = 3600 * 1000;

// ---- Respaldo local del último veredicto (solo de la clave actual) ----
function readCache(key) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY));
    return c && c.key === key ? c : null;
  } catch {
    return null;
  }
}
function writeCache(key, verdict) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ key, allowed: verdict.allowed, reason: verdict.reason, agencyName: verdict.agency_name ?? null, venceEl: verdict.vence_el ?? null, at: Date.now() }));
  } catch { /* sin almacenamiento: se funciona igual, pero sin tolerancia a cortes */ }
}

// ---- Estados ----
const NO_KEY = { status: 'no_key', reason: null, agencyName: null, venceEl: null, offline: false };

function fromVerdict(v) {
  return {
    status: v.allowed ? 'active' : 'blocked',
    reason: v.reason,                         // 'active' | 'suspended' | 'expired' | 'not_found'
    agencyName: v.agency_name ?? v.agencyName ?? null,
    venceEl: v.vence_el ?? v.venceEl ?? null,
    offline: false,
  };
}

/** Estado inicial: usa el respaldo para no mostrar parpadeos al abrir la página. */
function initialState(key, graceMs) {
  if (!key) return NO_KEY;
  const c = readCache(key);
  if (c) {
    if (!c.allowed) return { ...fromVerdict(c), status: 'blocked' };           // ya estaba bloqueada: no mostrar contenido ni un instante
    if (Date.now() - c.at < graceMs) return { ...fromVerdict(c), offline: false }; // mostrar ya, y confirmar en segundo plano
  }
  return { status: 'checking', reason: null, agencyName: null, venceEl: null, offline: false };
}

const sameState = (a, b) => a.status === b.status && a.reason === b.reason && a.offline === b.offline && a.agencyName === b.agencyName && a.venceEl === b.venceEl;

/**
 * @param {object} opts
 * @param {object} opts.supabase    Cliente de Supabase.
 * @param {string} opts.licenseKey  Clave de la pantalla ('' si aún no hay).
 * @param {number} [opts.pollMs]    Cada cuánto volver a consultar (60 s por defecto).
 *                                  Es el tiempo máximo que tarda en bloquearse una pantalla ya abierta.
 * @param {number} [opts.graceHours] Horas que se tolera la falta de internet (72 por defecto).
 */
export function useLicenseCheck({ supabase, licenseKey, pollMs = 60_000, graceHours = 72 }) {
  const key = normalizeKey(licenseKey);
  const graceMs = graceHours * HOUR_MS;
  const [state, setState] = useState(() => initialState(key, graceMs));
  const ticket = useRef(0);   // evita que una respuesta vieja pise a una más nueva

  const verify = useCallback(async () => {
    if (!key) return;
    const mine = ++ticket.current;
    let next;
    try {
      const verdict = await checkLicense(supabase, key);   // veredicto REAL del servidor
      writeCache(key, verdict);
      next = fromVerdict(verdict);
    } catch {
      // No se pudo consultar. Esto NO es "suspendida": se usa el último veredicto guardado.
      const c = readCache(key);
      if (c && !c.allowed) next = fromVerdict(c);                                   // seguía bloqueada
      else if (c && Date.now() - c.at < graceMs) next = { ...fromVerdict(c), offline: true }; // tolerancia
      else next = { status: 'unreachable', reason: null, agencyName: null, venceEl: null, offline: false };
    }
    if (mine !== ticket.current) return;                    // llegó tarde: se descarta
    setState((prev) => (sameState(prev, next) ? prev : next)); // sin cambios = sin re-render
  }, [supabase, key, graceMs]);

  // Cuando cambia la clave (p. ej. la activan), se reinicia el estado y se consulta de inmediato.
  useEffect(() => {
    setState(initialState(key, graceMs));
    verify();
    return () => { ticket.current++; };    // al desmontar, se descartan respuestas pendientes
  }, [key, graceMs, verify]);

  // Consulta periódica + al volver el internet + al volver a la pestaña.
  useEffect(() => {
    if (!key) return undefined;
    const timer = setInterval(verify, pollMs);
    const onVisible = () => { if (!document.hidden) verify(); };
    window.addEventListener('online', verify);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', verify);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, pollMs, verify]);

  return { ...state, recheck: verify };
}
