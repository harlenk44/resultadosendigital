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
  resolveLicenseKey, saveLicenseKey, normalizeKey, formatDate, formatCode, requestPairing, pollPairing,
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
        <p className="lic-lock__msg">{message}</p>
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
 * Código de vinculación en grande. La pantalla lo pide sola, lo muestra y pregunta cada
 * pocos segundos si el administrador ya lo vinculó; al lograrlo entrega la clave (onLinked).
 * Si el código vence (15 min), pide otro sin que nadie toque nada.
 */
function PairingCode({ supabase, onLinked, pollMs = 3000 }) {
  const [code, setCode] = useState('');
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer;
    let current = '';
    const fresh = async () => {
      try { current = await requestPairing(supabase); if (alive) { setCode(current); setOffline(false); } }
      catch { current = ''; if (alive) { setCode(''); setOffline(true); } }
    };
    const tick = async () => {
      if (!alive) return;
      if (!current) await fresh();
      else {
        try {
          const r = await pollPairing(supabase, current);
          if (!alive) return;
          if (r.status === 'linked' && r.license_key) { onLinked(r.license_key); return; }
          if (r.status === 'expired') { current = ''; await fresh(); }
          else setOffline(false);
        } catch { if (alive) setOffline(true); }
      }
      if (alive) timer = setTimeout(tick, pollMs);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [supabase, onLinked, pollMs]);

  return (
    <div className="lic-pair" role="status" aria-live="polite">
      <div className="lic-pair__code" aria-label={code ? `Código ${code.split('').join(' ')}` : 'Generando código'}>
        {code ? formatCode(code) : '···-···'}
      </div>
      <p className="lic-lock__detail">
        {offline ? 'Sin conexión a internet. Reintentando…' : 'Esta pantalla se activará sola cuando su proveedor ingrese este código.'}
      </p>
    </div>
  );
}

/** Pantalla de activación: por código (recomendado, sin teclear) o escribiendo la clave. */
function ActivationScreen({ supabase, onActivate, pairPollMs, title, message, error, startManual = false }) {
  const [manual, setManual] = useState(startManual);
  return (
    <LockScreen title={title} message={manual ? 'Escriba la clave de licencia que le entregó su proveedor.' : message}>
      {manual ? <ActivationForm onSubmit={onActivate} error={error} /> : <PairingCode supabase={supabase} onLinked={onActivate} pollMs={pairPollMs} />}
      <button type="button" className="lic-btn lic-btn--ghost" onClick={() => setManual((m) => !m)}>
        {manual ? 'Vincular con código' : 'Tengo una clave'}
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
 * @param {number} [props.pairPollMs]  Cada cuánto la pantalla pregunta si ya la vincularon (3000 ms).
 * @param {React.ReactNode} props.children  La pizarra.
 */
export default function LicenseGuard({ supabase, licenseKey, pollMs, graceHours, pairPollMs, children }) {
  // La clave puede venir por prop, por la dirección o por lo guardado; si no hay, se pide.
  const [key, setKey] = useState(() => normalizeKey(licenseKey) || resolveLicenseKey());
  const lic = useLicenseCheck({ supabase, licenseKey: key, pollMs, graceHours });

  const activate = useCallback((value) => {
    saveLicenseKey(value);
    setKey(normalizeKey(value));
  }, []);

  // 1) Pantalla sin clave: muestra un código para que el proveedor la vincule (o permite teclear la clave).
  if (lic.status === 'no_key') {
    return (
      <ActivationScreen
        supabase={supabase}
        onActivate={activate}
        pairPollMs={pairPollMs}
        title="Pantalla sin activar"
        message="Pida a su proveedor que vincule esta pantalla con este código:"
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
          pairPollMs={pairPollMs}
          title="Licencia no válida"
          message="La clave no existe o fue eliminada. Pida a su proveedor que vincule esta pantalla con este código:"
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
