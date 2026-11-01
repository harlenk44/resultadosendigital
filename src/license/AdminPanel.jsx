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
  activationLink, addDays, approveRequest, createLicense, deleteLicense, describeDevice, effectiveState, fetchIsAdmin,
  formatDate, formatDateTime, listLicenses, listRequests, rejectRequest, timeAgo, todayCaracas, updateLicense,
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
//  Peticiones pendientes: el cliente pulsó "Enviar petición" en su pantalla.
//  El admin pone nombre y duración y la acepta; la pantalla arranca sola.
// ---------------------------------------------------------------------
const DURATIONS = [7, 15, 30, 60, 90];
const REQ_ERRORS = {
  not_found: 'Esa petición ya no existe (el cliente pudo cancelarla). Actualice la lista.',
  already_decided: 'Esa petición ya fue atendida.',
  name_required: 'Escriba el nombre de la agencia.',
  license_not_found: 'Esa agencia ya no existe. Actualice la lista.',
};

function RequestCard({ req, licenses, onApprove, onReject }) {
  const [existing, setExisting] = useState('');              // '' = agencia nueva
  const [name, setName] = useState(req.note || '');           // lo que escribió el cliente, editable
  const [days, setDays] = useState(30);                       // null = sin vencimiento
  const [vence, setVence] = useState(() => addDays(todayCaracas(), 30));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const pickDays = (d) => { setDays(d); setVence(d == null ? '' : addDays(todayCaracas(), d)); };
  const isNew = !existing;

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await onApprove(req.id, isNew ? { agency_name: name, vence_el: vence || null } : { license_id: existing });
      if (!r.ok) setError(REQ_ERRORS[r.reason] || 'No se pudo aceptar.');
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  const reject = async () => {
    if (!confirming) { setConfirming(true); setTimeout(() => setConfirming(false), 4000); return; }
    setBusy(true);
    try { await onReject(req.id); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <article className="lic-req" aria-label={`Petición ${req.label}`}>
      <div className="lic-req__top">
        <span className="lic-req__label">{req.label}</span>
        <span>{describeDevice(req.device)}</span>
        <span className="lic-muted">{timeAgo(req.created_at)}</span>
        {req.note ? <span className="lic-muted">Dice: «{req.note}»</span> : null}
      </div>
      <div className="lic-grid">
        <label>Agencia
          <select value={existing} onChange={(e) => setExisting(e.target.value)} aria-label="Agencia de la petición">
            <option value="">➕ Agencia nueva</option>
            {licenses.map((l) => <option key={l.id} value={l.id}>{l.agency_name} (otra pantalla)</option>)}
          </select>
        </label>
        {isNew ? (
          <label>Nombre de la agencia
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej.: Agencia Centro" aria-label="Nombre de la agencia nueva" />
          </label>
        ) : null}
      </div>
      {isNew ? (
        <div>
          <div className="lic-chips" role="group" aria-label="Duración">
            <span className="lic-muted">Duración:</span>
            {DURATIONS.map((d) => (
              <button key={d} type="button" className={`lic-chip ${days === d ? 'is-on' : ''}`} aria-pressed={days === d} onClick={() => pickDays(d)}>{d} días</button>
            ))}
            <button type="button" className={`lic-chip ${days == null ? 'is-on' : ''}`} aria-pressed={days == null} onClick={() => pickDays(null)}>Sin vencimiento</button>
            <input type="date" className="lic-date" value={vence} onChange={(e) => { setDays(-1); setVence(e.target.value); }} aria-label="Fecha de corte" />
          </div>
          <div className="lic-muted">{vence ? `Vence el ${formatDate(vence)} (hora de Caracas)` : 'No vencerá: la suspende usted con el interruptor.'}</div>
        </div>
      ) : <p className="lic-muted">Usará la misma clave y fecha de corte que esa agencia. Para cambiar la fecha use «+30 días» en la lista.</p>}
      {error ? <p className="lic-error" role="alert">{error}</p> : null}
      <div className="lic-req__actions">
        <button type="button" className="lic-btn" onClick={accept} disabled={busy || (isNew && !name.trim())}>{busy ? 'Procesando…' : 'Aceptar y activar'}</button>
        <button type="button" className={`lic-btn lic-btn--danger ${confirming ? 'is-armed' : ''}`} onClick={reject} disabled={busy}>{confirming ? '¿Seguro?' : 'Rechazar'}</button>
      </div>
    </article>
  );
}

function RequestsInbox({ requests, licenses, error, notice, onApprove, onReject }) {
  return (
    <section className="lic-card lic-inbox" aria-label="Peticiones pendientes">
      <div className="lic-inbox__head">
        <h2>Peticiones pendientes {requests.length ? <span className="lic-badge lic-badge--expired">{requests.length}</span> : null}</h2>
      </div>
      {notice ? <p className="lic-ok" role="status">{notice}</p> : null}
      {error ? <p className="lic-error" role="alert">{error}</p> : null}
      {requests.length === 0 ? (
        <p className="lic-muted">No hay peticiones. Cuando un cliente pulse «Enviar petición» en su pantalla, aparecerá aquí (esta lista se actualiza sola cada 10 segundos).</p>
      ) : requests.map((r) => (
        <RequestCard key={r.id} req={r} licenses={licenses} onApprove={onApprove} onReject={onReject} />
      ))}
    </section>
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

  const [copiedLink, setCopiedLink] = useState(false);
  const copy = async (text, flag) => {
    try {
      await navigator.clipboard.writeText(text);
      flag(true);
      setTimeout(() => flag(false), 1500);
    } catch { /* si el navegador no deja copiar, la clave ya está visible para seleccionarla */ }
  };
  const copyKey = () => copy(lic.license_key, setCopied);
  const copyLink = () => copy(activationLink(lic.license_key), setCopiedLink);   // para navegadores: se abre y queda activada

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
        <button type="button" className="lic-btn lic-btn--ghost" onClick={copyLink} title="Enlace que activa la pantalla al abrirlo (para navegadores)">{copiedLink ? 'Copiado' : 'Copiar enlace'}</button>
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
  const [requests, setRequests] = useState([]);
  const [reqError, setReqError] = useState('');
  const [notice, setNotice] = useState('');
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

  // Peticiones: se piden aparte para que, si aún no se ejecutó requests.sql, las licencias igual carguen.
  const reloadRequests = useCallback(async () => {
    try { setRequests(await listRequests(supabase)); setReqError(''); }
    catch (err) { setReqError(`No se pudieron cargar las peticiones: ${err.message}. ¿Ya ejecutó supabase/requests.sql?`); }
  }, [supabase]);

  useEffect(() => { if (isAdmin) { reload(); reloadRequests(); } }, [isAdmin, reload, reloadRequests]);

  // La bandeja se actualiza sola cada 10 s para ver las peticiones nuevas.
  useEffect(() => {
    if (!isAdmin) return undefined;
    const t = setInterval(reloadRequests, 10_000);
    return () => clearInterval(t);
  }, [isAdmin, reloadRequests]);

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

  // Aceptar una petición: crea (o reutiliza) la licencia; la pantalla del cliente recoge su clave sola.
  const handleApprove = async (id, data) => {
    const r = await approveRequest(supabase, { id, ...data });
    if (r.ok) {
      setNotice(`Listo: ${r.agency_name} quedó activa${r.vence_el ? ` hasta el ${formatDate(r.vence_el)}` : ' sin fecha de corte'}. La pantalla arranca sola en unos segundos.`);
      await Promise.all([reload(), reloadRequests()]);
    }
    return r;
  };
  const handleReject = async (id) => {
    const r = await rejectRequest(supabase, id);
    if (r.ok) { setNotice('Petición rechazada.'); }
    await reloadRequests();
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
          <a className="lic-btn lic-btn--ghost" href="#pizarra-admin">Abrir pizarra (cargar resultados)</a>
          <button type="button" className="lic-btn lic-btn--ghost" onClick={() => { reload(); reloadRequests(); }} disabled={loading}>{loading ? 'Actualizando…' : 'Actualizar'}</button>
          <button type="button" className="lic-btn lic-btn--ghost" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </header>

      <p className="lic-stats">
        <span className="lic-badge lic-badge--active">{stats.active} activas</span>
        <span className="lic-badge lic-badge--suspended">{stats.suspended} suspendidas</span>
        <span className="lic-badge lic-badge--expired">{stats.expired} vencidas</span>
      </p>

      {error ? <p className="lic-error" role="alert">{error}</p> : null}

      <RequestsInbox requests={requests} licenses={rows} error={reqError} notice={notice} onApprove={handleApprove} onReject={handleReject} />

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
