// =====================================================================
//  PublicidadPopup.jsx  ·  Publicidad emergente de la pizarra
//
//  Componente aislado: no usa ni cambia nada del resto de la pizarra.
//  Qué hace:
//   • Lee de la tabla anuncios_publicidad las imágenes con activo = true.
//   • Escucha cambios en tiempo real (Supabase Realtime): si mandas una foto
//     nueva desde el teléfono, aparece en el siguiente ciclo sin recargar.
//   • Ciclo: espera "intervalo_minutos" -> muestra la imagen
//     "duracion_segundos" -> la oculta -> espera de nuevo...
//   • Con varias imágenes activas rota de una en una, en cada ciclo.
//     Cada imagen usa SU duración e intervalo.
//   • Un cartel recién enviado sale a los pocos segundos (no espera el ciclo).
//
//  Uso:  <PublicidadPopup />   (una sola vez, en el archivo principal)
//  No necesita Tailwind: sus estilos están en publicidad.css.
//  Usa el cliente de src/lib/supabaseClient.js.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import './publicidad.css';

const TABLA = 'anuncios_publicidad';
// Tras abrir la pizarra, la primera imagen sale a los pocos segundos
// (no esperamos el intervalo completo), así se ve que funciona.
const PRIMER_AVISO_MS = 5000;
// Respaldo por si Realtime se cae (WiFi de la TV, etc.): vuelve a consultar.
const REFRESCO_MS = 2 * 60 * 1000;

const limitar = (n, min, max, porDefecto) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : porDefecto;
};

/** Solo http(s): evita que una fila rara en la tabla inyecte otro tipo de URL. */
const urlValida = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

export default function PublicidadPopup() {
  const [actual, setActual] = useState(null);   // anuncio que se ve ahora (o null)
  const [entra, setEntra] = useState(false);    // para el desvanecido
  const [hayAnuncios, setHayAnuncios] = useState(false);
  const anunciosRef = useRef([]);               // lista vigente (sin re-renderizar)
  const indiceRef = useRef(0);                  // siguiente imagen a mostrar
  const conocidosRef = useRef(new Set());       // ids ya vistos (para detectar un cartel nuevo)
  const cargadoRef = useRef(false);             // ya hubo una primera carga
  const prioridadRef = useRef(null);            // cartel recién enviado: sale pronto
  const faseRef = useRef('espera');             // 'espera' | 'muestra'
  const temporizadorRef = useRef(null);
  const mostrarRef = useRef(null);

  // ---- 1) Cargar anuncios activos + escuchar cambios en tiempo real ----
  useEffect(() => {
    let vivo = true;

    async function cargar() {
      const { data, error } = await supabase
        .from(TABLA)
        .select('id, imagen_url, duracion_segundos, intervalo_minutos, created_at')
        .eq('activo', true)
        .order('created_at', { ascending: true });
      if (!vivo || error) return;               // si falla, se conserva la lista anterior
      const lista = (data || [])
        .filter((a) => urlValida(a.imagen_url))
        .map((a) => ({
          id: a.id,
          imagen_url: a.imagen_url,
          duracion_segundos: limitar(a.duracion_segundos, 2, 120, 10),
          intervalo_minutos: limitar(a.intervalo_minutos, 1, 240, 5),
        }));
      lista.forEach((a) => { const im = new Image(); im.src = a.imagen_url; }); // precarga
      // Un cartel nuevo (el que acabas de mandar por WhatsApp) no espera al siguiente
      // ciclo de varios minutos: sale a los pocos segundos y luego sigue la rotación normal.
      const nuevos = lista.filter((a) => !conocidosRef.current.has(a.id));
      lista.forEach((a) => conocidosRef.current.add(a.id));
      if (cargadoRef.current && nuevos.length) {
        prioridadRef.current = nuevos[nuevos.length - 1].id;
        if (faseRef.current === 'espera' && mostrarRef.current) {
          clearTimeout(temporizadorRef.current);
          temporizadorRef.current = setTimeout(mostrarRef.current, PRIMER_AVISO_MS);
        }
      }
      cargadoRef.current = true;
      anunciosRef.current = lista;
      setHayAnuncios(lista.length > 0);
    }

    cargar();
    const canal = supabase
      .channel('publicidad-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLA }, cargar)
      .subscribe();
    const respaldo = setInterval(cargar, REFRESCO_MS);

    return () => {
      vivo = false;
      clearInterval(respaldo);
      supabase.removeChannel(canal);
    };
  }, []);

  // ---- 2) Ciclo: esperar -> mostrar -> ocultar -> esperar ... ----
  // Solo depende de "hayAnuncios": al agregar/quitar imágenes el ciclo sigue
  // sin reiniciarse; solo arranca/para cuando pasa de 0 a 1+ anuncios o al revés.
  useEffect(() => {
    if (!hayAnuncios) { setActual(null); return undefined; }

    const mostrar = () => {
      const lista = anunciosRef.current;
      if (!lista.length) { setActual(null); return; }
      let anuncio = null;
      if (prioridadRef.current) {                       // primero el cartel recién enviado
        anuncio = lista.find((a) => a.id === prioridadRef.current) || null;
        prioridadRef.current = null;
      }
      if (!anuncio) {                                   // si no, rotación: uno por ciclo
        anuncio = lista[indiceRef.current % lista.length];
        indiceRef.current += 1;
      }
      faseRef.current = 'muestra';
      setActual(anuncio);
      temporizadorRef.current = setTimeout(() => {
        setActual(null);
        faseRef.current = 'espera';
        // si llegó un cartel nuevo mientras este se veía, el siguiente sale pronto
        const espera = prioridadRef.current ? PRIMER_AVISO_MS : anuncio.intervalo_minutos * 60 * 1000;
        temporizadorRef.current = setTimeout(mostrar, espera);
      }, anuncio.duracion_segundos * 1000);
    };

    faseRef.current = 'espera';
    mostrarRef.current = mostrar;
    temporizadorRef.current = setTimeout(mostrar, PRIMER_AVISO_MS);
    return () => { clearTimeout(temporizadorRef.current); mostrarRef.current = null; };
  }, [hayAnuncios]);

  // ---- 3) Desvanecido de entrada ----
  useEffect(() => {
    setEntra(false);
    if (!actual) return undefined;
    const f = requestAnimationFrame(() => setEntra(true));
    return () => cancelAnimationFrame(f);
  }, [actual]);

  // Cerrar antes de tiempo (clic, o imagen que no carga): se pasa de una vez a la espera.
  const cerrar = () => {
    if (actual && faseRef.current === 'muestra' && mostrarRef.current) {
      clearTimeout(temporizadorRef.current);
      faseRef.current = 'espera';
      const espera = prioridadRef.current ? PRIMER_AVISO_MS : actual.intervalo_minutos * 60 * 1000;
      temporizadorRef.current = setTimeout(mostrarRef.current, espera);
    }
    setActual(null);
  };

  if (!actual) return null;

  return (
    <div
      role="dialog"
      aria-label="Publicidad"
      onClick={cerrar}
      className={`pub-overlay${entra ? ' pub-in' : ''}`}
    >
      <img
        src={actual.imagen_url}
        alt="Publicidad"
        onError={cerrar}
        className="pub-img"
      />
    </div>
  );
}
