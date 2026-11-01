// =====================================================================
//  App.jsx  ·  Servicio de resultados en vivo (todo en uno)
//
//  Direcciones:
//    /                  Pizarra de la agencia (necesita licencia activa). Solo lectura.
//    /#pantalla         La misma, abierta directo en la vista de televisor.
//    /#licencias        Panel del administrador: licencias, peticiones, agencias.
//    /#pizarra-admin    Pizarra del administrador: carga resultados, horarios,
//                       triples, logos y banners. Pide sesión de administrador.
//
//  Quién ve qué:
//    · Tú (administrador) cargas los resultados UNA vez.
//    · Todas las agencias con licencia activa los ven al instante.
//    · La publicidad que envías por WhatsApp sale en todas las pantallas.
// =====================================================================
import React, { useEffect, useState } from 'react';
import { supabase } from './lib/supabaseClient';
import LicenseGuard from './license/LicenseGuard';
import AdminPanel from './license/AdminPanel';
import PizarraFrame from './pizarra/PizarraFrame';
import AdminGate from './pizarra/AdminGate';

export default function App() {
  const [route, setRoute] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Estas dos van FUERA del guard: el administrador nunca debe quedar bloqueado por una licencia.
  if (route === '#licencias') return <AdminPanel supabase={supabase} />;
  if (route === '#pizarra-admin') {
    return (
      <AdminGate supabase={supabase}>
        <PizarraFrame supabase={supabase} canWrite />
      </AdminGate>
    );
  }

  // Pantalla de una agencia: sin licencia activa la pizarra ni siquiera se monta.
  return (
    <LicenseGuard supabase={supabase}>
      <PizarraFrame supabase={supabase} canWrite={false} />
    </LicenseGuard>
  );
}
