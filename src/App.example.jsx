// =====================================================================
//  App.example.jsx  -  ÚNICO cambio que necesita el archivo principal.
//  La pizarra no se toca: solo se envuelve con <LicenseGuard>.
// =====================================================================
import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import LicenseGuard from './license/LicenseGuard';
import AdminPanel from './license/AdminPanel';
import Pizarra from './Pizarra';            // <- tu pizarra actual, sin cambios

export default function App() {
  // El panel de administración vive en  https://tu-pizarra/#licencias
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // El panel va FUERA del guard: así nunca queda bloqueado por una licencia.
  if (route === '#licencias') return <AdminPanel supabase={supabase} />;

  // Todo lo demás es la pizarra del cliente: si la licencia no está activa,
  // el guard NO monta la pizarra y muestra el bloqueo a pantalla completa.
  return (
    <LicenseGuard supabase={supabase}>
      <Pizarra />
    </LicenseGuard>
  );
}
