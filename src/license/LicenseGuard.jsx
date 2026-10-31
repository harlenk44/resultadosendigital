// =====================================================================
//  LicenseGuard.jsx
//  Envuelve la pizarra. Si la licencia no está activa, NO renderiza la
//  pizarra (sus componentes ni siquiera se montan) y muestra un bloqueo
//  a pantalla completa. No contiene lógica de red: eso vive en
//  useLicenseCheck.js y licenseService.js.
//
//  Uso (en el archivo principal, por ejemplo App.jsx):
//
//    <LicenseGuard supabase={supabase}>
//      <Pizarra />            // tu pizarra tal cual, sin cambios
//    </LicenseGuard>
// =====================================================================
import React, { useCallback, useEffect, useState } from 'react';
import { useLicenseCheck } from './useLicenseCheck';
import {
  resolveLicenseKey, saveLicenseKey, normalizeKey, formatDate, newRequestToken, readRequestToken,
  saveRequestToken, clearRequestToken, submitRequest, pollRequest,
} from './licenseService';
import './license.css';

// Texto exacto pedido para el bloqueo. Cámbialo aquí si quieres otro.
export const SUSPENDED_MESSAGE =
  'Servicio suspendido por administración. Contacte al proveedor para reactivar la pantalla';

/** Capa de bloqueo a pantalla completa (por encima de todo). */
function LockScreen({ title, message, detail, children }) {
  return (
    <div className="lic-lock" role="alertdialog" aria-modal="true" aria-live="assertive" aria-label={title}>
      <div className="lic-lock__box">
        <div className="lic-lock__icon" aria-hidden="true">🔒</div>
        <h1 className="lic-lock__title">{title}</h1>
        {message ? <p className="lic-lock__msg">{message}</p> : null}
        {detail ? <p className="lic-lock__detail">{detail}</p> : null}
        {children}
      </div>
    </div>
  );
}

/** Formulario para escribir la clave en una pantalla nueva. */
function ActivationForm({ onSubmit, error }) {
  const [value, setValue] = useState('');
  return (
    <form
      className="lic-activate"
      onSubmit={(e) => {
        e.preventDefault();
        if (normalizeKey(value)) onSubmit(value);
      }}
    >
      <label htmlFor="lic-key-input">Clave de licencia</label>
      <input
        id="lic-key-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="AGN-XXXX-XXXX-XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
      />
      {error ? <p className="lic-activate__error">{error}</p> : null}
      <button type="submit" className="lic-btn">Activar pantalla</button>
    </form>
  );
}

/**
 * Botón "Enviar petición". El cliente solo pulsa un botón (en un TV: OK con el control remoto);
 * el administrador la acepta en su panel con nombre y duración, y esta pantalla arranca sola.
 *
 * El token secreto de la petición se guarda en el navegador: si el TV se recarga o se apaga,
 * sigue esperando la misma petición en vez de crear otra.
 */
function RequestPanel({ supabase, onApproved, onBusy, pollMs = 3000 }) {
  // phase: 'checking' (había una petición guardada) | 'idle' | 'sending' | 'waiting' | 'rejected'
  const [phase, setPhase] = useState(() => (readRequestToken() ? 'checking' : 'idle'));
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  // Avisa a la pantalla de activación para que oculte su texto de arriba mientras se espera.
  useEffect(() => { onBusy?.(phase === 'checking' || phase === 'waiting' || phase === 'rejected'); }, [phase, onBusy]);

  // Mientras haya una petición guardada: preguntar cada pocos segundos.
  const watching = phase === 'checking' || phase === 'waiting';
  useEffect(() => {
    if (!watching) return undefined;
    let alive = true;
    let timer;
    const tick = async () => {
      const token = readRequestToken();
      if (!token) { if (alive) setPhase('idle'); return; }
      try {
        const r = await pollRequest(supabase, token);
        if (!alive) return;
        setOffline(false);
        if (r.status === 'approved' && r.license_key) { clearRequestToken(); onApproved(r.license_key); return; }
        if (r.status === 'rejected') { setPhase('rejected'); return; }
        if (r.status === 'none') { clearRequestToken(); setPhase('idle'); return; }
        if (r.label) setLabel(r.label);
        setPhase('waiting');
      } catch {
        if (alive) { setOffline(true); setPhase((p) => (p === 'checking' ? 'waiting' : p)); }
      }
      if (alive) timer = setTimeout(tick, pollMs);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [watching, supabase, onApproved, pollMs]);

  const send = async (e) => {
    e?.preventDefault();
    setError('');
    setPhase('sending');
    const token = newRequestToken();
    try {
      const r = await submitRequest(supabase, { token, note });
      saveRequestToken(token);
      setLabel(r.label || '');
      setPhase('waiting');
    } catch {
      setError('No se pudo enviar la petición. Revise la conexión a internet e inténtelo de nuevo.');
      setPhase('idle');
    }
  };
  const again = () => { clearRequestToken(); setLabel(''); setError(''); setPhase('idle'); };

  if (phase === 'waiting' || phase === 'checking') {
    return (
      <div className="lic-request" role="status" aria-live="polite">
        <p className="lic-lock__msg"><strong>Petición enviada.</strong> Su proveedor la revisará y esta pantalla se activará sola.</p>
        {label ? <div className="lic-pair__code lic-pair__code--sm" aria-label={`Referencia ${label}`}>{label}</div> : null}
        <p className="lic-lock__detail">{offline ? 'Sin conexión a internet. Reintentando…' : 'No cierre esta página. Esperando aprobación…'}</p>
        <button type="button" className="lic-btn lic-btn--ghost" onClick={again}>Cancelar petición</button>
      </div>
    );
  }
  if (phase === 'rejected') {
    return (
      <div className="lic-request" role="status">
        <p className="lic-lock__msg">Su petición no fue aceptada. Contacte a su proveedor.</p>
        <button type="button" className="lic-btn" onClick={again} autoFocus>Enviar otra petición</button>
      </div>
    );
  }
  return (
    <form className="lic-request" onSubmit={send}>
      <label htmlFor="lic-req-note" className="lic-muted">Su nombre o referencia (opcional)</label>
      <input id="lic-req-note" type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Ej.: Agencia Centro" autoComplete="off" />
      {error ? <p className="lic-activate__error" role="alert">{error}</p> : null}
      <button type="submit" className="lic-btn lic-btn--big" disabled={phase === 'sending'} autoFocus>
        {phase === 'sending' ? 'Enviando…' : 'Enviar petición'}
      </button>
    </form>
  );
}

/** Pantalla de activación: enviar petición (recomendado, sin teclear claves) o escribir la clave. */
function ActivationScreen({ supabase, onActivate, requestPollMs, title, message, error, startManual = false }) {
  const [manual, setManual] = useState(startManual);
  const [busy, setBusy] = useState(false);   // true mientras hay una petición en espera
  return (
    <LockScreen title={title} message={manual ? 'Escriba la clave de licencia que le entregó su proveedor.' : (busy ? null : message)}>
      {manual ? <ActivationForm onSubmit={onActivate} error={error} /> : <RequestPanel supabase={supabase} onApproved={onActivate} onBusy={setBusy} pollMs={requestPollMs} />}
      <button type="button" className="lic-btn lic-btn--ghost" onClick={() => setManual((m) => !m)}>
        {manual ? 'Enviar petición en su lugar' : 'Tengo una clave'}
      </button>
    </LockScreen>
  );
}

/**
 * @param {object} props
 * @param {object} props.supabase      Cliente de Supabase.
 * @param {string} [props.licenseKey]  Clave fija (opcional). Si no se da, se toma de
 *                                     ?licencia=... o de la que quedó guardada en el dispositivo.
 * @param {number} [props.pollMs]      Cada cuánto se vuelve a consultar (60 000 ms por defecto).
 * @param {number} [props.graceHours]  Horas de tolerancia sin internet (72 por defecto).
 * @param {number} [props.requestPollMs] Cada cuánto la pantalla pregunta si ya aceptaron su petición (3000 ms).
 * @param {React.ReactNode} props.children  La pizarra.
 */
export default function LicenseGuard({ supabase, licenseKey, pollMs, graceHours, requestPollMs, children }) {
  // La clave puede venir por prop, por la dirección o por lo guardado; si no hay, se pide.
  const [key, setKey] = useState(() => normalizeKey(licenseKey) || resolveLicenseKey());
  const lic = useLicenseCheck({ supabase, licenseKey: key, pollMs, graceHours });

  const activate = useCallback((value) => {
    saveLicenseKey(value);
    setKey(normalizeKey(value));
  }, []);

  // 1) Pantalla sin clave: botón "Enviar petición" para que el proveedor la active (o permite teclear la clave).
  if (lic.status === 'no_key') {
    return (
      <ActivationScreen
        supabase={supabase}
        onActivate={activate}
        requestPollMs={requestPollMs}
        title="Pantalla sin activar"
        message="Pulse el botón para pedir la activación a su proveedor."
      />
    );
  }

  // 2) Primera consulta: no mostrar la pizarra hasta tener veredicto.
  if (lic.status === 'checking') {
    return <div className="lic-splash" role="status">Verificando licencia…</div>;
  }

  // 3) Bloqueada por el servidor (suspendida, vencida o clave inexistente).
  if (lic.status === 'blocked') {
    if (lic.reason === 'not_found') {
      return (
        <ActivationScreen
          supabase={supabase}
          onActivate={activate}
          requestPollMs={requestPollMs}
          title="Licencia no válida"
          message="La clave no existe o fue eliminada. Puede pedir una nueva activación a su proveedor:"
          error="Verifique la clave e inténtelo de nuevo."
          startManual
        />
      );
    }
    return (
      <LockScreen
        title="Pantalla bloqueada"
        message={SUSPENDED_MESSAGE}
        detail={lic.reason === 'expired' ? `La licencia venció el ${formatDate(lic.venceEl)}.` : null}
      />
    );
  }

  // 4) No se pudo verificar y no hay respaldo válido (nunca verificó, o pasó la tolerancia).
  if (lic.status === 'unreachable') {
    return (
      <LockScreen
        title="No se pudo verificar la licencia"
        message="Revise la conexión a internet de esta pantalla. Se reintentará automáticamente."
      >
        <button type="button" className="lic-btn" onClick={lic.recheck}>Reintentar ahora</button>
      </LockScreen>
    );
  }

  // 5) Licencia al día: la pizarra, sin tocar. Si está en tolerancia sin internet, aviso discreto.
  return (
    <>
      {children}
      {lic.offline ? <div className="lic-offline" role="status">Sin conexión: licencia en tolerancia</div> : null}
    </>
  );
}
