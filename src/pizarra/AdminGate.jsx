// =====================================================================
//  AdminGate.jsx
//  Deja pasar solo a un administrador con sesión iniciada. Es la puerta de
//  la pizarra en modo escritura (#pizarra-admin). La seguridad real está en
//  la base de datos (RLS): aunque alguien saltara esta puerta, Supabase
//  rechaza cualquier escritura que no venga de un administrador.
// =====================================================================
import React, { useEffect, useState } from 'react';
import { fetchIsAdmin } from '../license/licenseService';
import './pizarra.css';

export default function AdminGate({ supabase, children }) {
  const [estado, setEstado] = useState('cargando'); // cargando | admin | no

  useEffect(() => {
    let vivo = true;
    async function revisar(session) {
      if (!session) { if (vivo) setEstado('no'); return; }
      try { const ok = await fetchIsAdmin(supabase, session.user.id); if (vivo) setEstado(ok ? 'admin' : 'no'); }
      catch { if (vivo) setEstado('no'); }
    }
    supabase.auth.getSession().then(({ data }) => revisar(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => revisar(s));
    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, [supabase]);

  if (estado === 'cargando') return <div className="pz-gate">Comprobando acceso…</div>;
  if (estado === 'no') {
    return (
      <div className="pz-gate">
        <p>Para cargar resultados entra primero como administrador.</p>
        <a href="#licencias">Iniciar sesión en el panel de administración</a>
      </div>
    );
  }
  return (
    <>
      {children}
      <a className="pz-chip" href="#licencias">← Panel de licencias</a>
    </>
  );
}
