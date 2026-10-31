// =====================================================================
//  AdminPanel.jsx
//  Panel de administración de licencias. Componente independiente: no
//  depende de la pizarra. Se monta en su propia ruta/dirección.
//
//  Protección (dos capas):
//   1. Inicio de sesión con Supabase Auth (correo + contraseña).
//   2. Las políticas RLS de la base de datos (ver licenses.sql): aunque
//      alguien modifique este código en su navegador, Supabase solo
//      devuelve o permite cambiar licencias si el usuario está en la
//      tabla "admins". La seguridad real está en la base de datos.
//
//  Uso:
//    // En App.jsx, FUERA del LicenseGuard (el admin no debe quedar bloqueado):
//    if (window.location.hash === '#licencias') return <AdminPanel supabase={supabase} />;
//    return <LicenseGuard supabase={supabase}><Pizarra /></LicenseGuard>;
//
//    Se abre en:  https://tu-pizarra/#licencias
// =====================================================================
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays, createLicense, deleteLicense, effectiveState, fetchIsAdmin, formatDate,
  formatDateTime, listLicenses, todayCaracas, updateLicense,
} from './licenseService';
import './license.css';

const STATE_LABEL = { active: 'Activa', suspended: 'Suspendida', expired: 'Vencida' };

// ---------------------------------------------------------------------
//  Inicio de sesión
// ---------------------------------------------------------------------
function LoginForm({ supabase }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) setError('Correo o contraseña incorrectos.');
    setBusy(false);   // si entró bien, onAuthStateChange actualiza la pantalla
  };

  return (
    <form className="lic-card lic-login" onSubmit={submit}>
      <h1>Administración de licencias</h1>
      <label htmlFor="lic-email">Correo</label>
      <input id="lic-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      <label htmlFor="lic-pass">Contraseña</label>
      <input id="lic-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      {error ? <p className="lic-error" role="alert">{error}</p> : null}
      <button type="submit" className="lic-btn" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Formulario: nueva agencia
// ---------------------------------------------------------------------
function CreateForm({ onCreate }) {
  const [name, setName] = useState('');
  const [vence, setVence] = useState(() => addDays(todayCaracas(), 30));   // por defecto: 30 días
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await onCreate({ agency_name: name, vence_el: vence, notes });
      setName('');
      setNotes('');
      setVence(addDays(todayCaracas(), 30));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <form className="lic-card lic-create" onSubmit={submit}>
      <h2>Nueva agencia</h2>
      <div className="lic-grid">
        <label>Nombre de la agencia
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
        </label>
        <label>Vence el
          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </label>
        <label>Notas (opcional)
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={200} placeholder="Contacto, plan, pago…" />
        </label>
      </div>
      {error ? <p className="lic-error" role="alert">{error}</p> : null}
      <button type="submit" className="lic-btn" disabled={busy || !name.trim()}>{busy ? 'Creando…' : 'Crear y generar clave'}</button>
    </form>
  );
}

// ---------------------------------------------------------------------
//  Una fila de la tabla (una agencia)
// ---------------------------------------------------------------------
function LicenseRow({ lic, today, onPatch, onDelete }) {
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const state = effectiveState(lic, today);
  const isOn = lic.status === 'active';

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(lic.license_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* si el navegador no deja copiar, la clave ya está visible para seleccionarla */ }
  };

  // Extender: suma 30 días desde la fecha de corte actual (o desde hoy si ya pasó o no tiene).
  const extend30 = () => {
    const base = lic.vence_el && lic.vence_el > today ? lic.vence_el : today;
    onPatch(lic.id, { vence_el: addDays(base, 30) });
  };

  // Borrado en dos pasos dentro de la propia pantalla (sin window.confirm).
  const askDelete = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    onDelete(lic.id);
  };

  return (
    <tr className={`lic-row lic-row--${state}`}>
      <td data-label="Agencia">
        <strong>{lic.agency_name}</strong>
        {lic.notes ? <div className="lic-muted">{lic.notes}</div> : null}
      </td>
      <td data-label="Clave">
        <code className="lic-key">{lic.license_key}</code>
        <button type="button" className="lic-btn lic-btn--ghost" onClick={copyKey}>{copied ? 'Copiada' : 'Copiar'}</button>
      </td>
      <td data-label="Estado">
        {/* Interruptor activo / suspendido: un clic. */}
        <button
          type="button"
          role="switch"
          aria-checked={isOn}
          aria-label={`${isOn ? 'Suspender' : 'Activar'} ${lic.agency_name}`}
          className={`lic-switch ${isOn ? 'is-on' : ''}`}
          onClick={() => onPatch(lic.id, { status: isOn ? 'suspended' : 'active' })}
        >
          <span className="lic-switch__knob" />
        </button>
        <span className={`lic-badge lic-badge--${state}`}>{STATE_LABEL[state]}</span>
      </td>
      <td data-label="Vence el">
        <input
          type="date"
          className="lic-date"
          value={lic.vence_el || ''}
          onChange={(e) => onPatch(lic.id, { vence_el: e.target.value || null })}
          aria-label={`Fecha de corte de ${lic.agency_name}`}
        />
        <div className="lic-muted">{formatDate(lic.vence_el)}</div>
      </td>
      <td data-label="Última conexión">{formatDateTime(lic.last_check_at)}</td>
      <td data-label="Acciones" className="lic-actions">
        <button type="button" className="lic-btn lic-btn--ghost" onClick={extend30}>+30 días</button>
        <button type="button" className={`lic-btn lic-btn--danger ${confirming ? 'is-armed' : ''}`} onClick={askDelete}>
          {confirming ? '¿Seguro?' : 'Eliminar'}
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------
//  Panel principal
// ---------------------------------------------------------------------
export default function AdminPanel({ supabase }) {
  const [session, setSession] = useState(undefined);   // undefined = cargando, null = sin sesión
  const [isAdmin, setIsAdmin] = useState(null);        // null = comprobando
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const today = todayCaracas();

  // --- Sesión de Supabase Auth ---
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setSession(data.session ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null));
    return () => { alive = false; sub?.subscription?.unsubscribe(); };
  }, [supabase]);

  // --- ¿Es administrador? (la tabla admins solo deja ver la propia fila) ---
  useEffect(() => {
    if (!session) { setIsAdmin(null); setRows([]); return; }
    let alive = true;
    fetchIsAdmin(supabase, session.user.id)
      .then((ok) => { if (alive) setIsAdmin(ok); })
      .catch(() => { if (alive) setIsAdmin(false); });
    return () => { alive = false; };
  }, [supabase, session]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setRows(await listLicenses(supabase)); }
    catch (err) { setError(err.message); }
    setLoading(false);
  }, [supabase]);

  useEffect(() => { if (isAdmin) reload(); }, [isAdmin, reload]);

  // --- Acciones ---
  const handleCreate = async (data) => {
    const created = await createLicense(supabase, data);   // si falla, el formulario muestra el error
    setRows((prev) => [created, ...prev]);
  };

  // Cambio con respuesta inmediata: se muestra al instante y se revierte si Supabase lo rechaza.
  const handlePatch = async (id, patch) => {
    const before = rows;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    try {
      const saved = await updateLicense(supabase, id, patch);
      setRows((prev) => prev.map((r) => (r.id === id ? saved : r)));
    } catch (err) {
      setRows(before);
      setError(`No se pudo guardar el cambio: ${err.message}`);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteLicense(supabase, id);
      setRows((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(`No se pudo eliminar: ${err.message}`);
    }
  };

  const stats = useMemo(() => {
    const s = { active: 0, suspended: 0, expired: 0 };
    rows.forEach((r) => { s[effectiveState(r, today)] += 1; });
    return s;
  }, [rows, today]);

  // --- Pantallas según el estado ---
  if (session === undefined) return <main className="lic-admin"><p role="status">Cargando…</p></main>;
  if (!session) return <main className="lic-admin"><LoginForm supabase={supabase} /></main>;
  if (isAdmin === null) return <main className="lic-admin"><p role="status">Comprobando permisos…</p></main>;
  if (isAdmin === false) {
    return (
      <main className="lic-admin">
        <div className="lic-card">
          <h1>Sin permisos</h1>
          <p>Este usuario no es administrador. Agréguelo a la tabla <code>admins</code> (ver licenses.sql, paso 4).</p>
          <button type="button" className="lic-btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </main>
    );
  }

  return (
    <main className="lic-admin">
      <header className="lic-admin__head">
        <h1>Licencias de agencias</h1>
        <div>
          <button type="button" className="lic-btn lic-btn--ghost" onClick={reload} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
          <button type="button" className="lic-btn lic-btn--ghost" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </header>

      <p className="lic-stats">
        <span className="lic-badge lic-badge--active">{stats.active} activas</span>
        <span className="lic-badge lic-badge--suspended">{stats.suspended} suspendidas</span>
        <span className="lic-badge lic-badge--expired">{stats.expired} vencidas</span>
      </p>

      {error ? <p className="lic-error" role="alert">{error}</p> : null}

      <CreateForm onCreate={handleCreate} />

      <div className="lic-card lic-table-wrap">
        <table className="lic-table">
          <thead>
            <tr><th>Agencia</th><th>Clave</th><th>Estado</th><th>Vence el</th><th>Última conexión</th><th>Acciones</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="lic-muted">{loading ? 'Cargando…' : 'Todavía no hay agencias. Cree la primera arriba.'}</td></tr>
            ) : rows.map((lic) => (
              <LicenseRow key={lic.id} lic={lic} today={today} onPatch={handlePatch} onDelete={handleDelete} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="lic-muted">
        Una pantalla suspendida o vencida se bloquea sola en menos de un minuto. El interruptor apaga la licencia al instante; la fecha la apaga al terminar ese día (hora de Caracas).
      </p>
    </main>
  );
}
