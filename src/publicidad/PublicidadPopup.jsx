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
//
//  Uso:  <PublicidadPopup />   (una sola vez, en el archivo principal)
//  Requiere Tailwind CSS y el cliente de src/lib/supabaseClient.js.
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

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
    let temporizador;

    const mostrar = () => {
      const lista = anunciosRef.current;
      if (!lista.length) { setActual(null); return; }
      const anuncio = lista[indiceRef.current % lista.length];
      indiceRef.current += 1;
      setActual(anuncio);
      temporizador = setTimeout(() => {
        setActual(null);
        temporizador = setTimeout(mostrar, anuncio.intervalo_minutos * 60 * 1000);
      }, anuncio.duracion_segundos * 1000);
    };

    temporizador = setTimeout(mostrar, PRIMER_AVISO_MS);
    return () => clearTimeout(temporizador);
  }, [hayAnuncios]);

  // ---- 3) Desvanecido de entrada ----
  useEffect(() => {
    setEntra(false);
    if (!actual) return undefined;
    const f = requestAnimationFrame(() => setEntra(true));
    return () => cancelAnimationFrame(f);
  }, [actual]);

  if (!actual) return null;

  return (
    <div
      role="dialog"
      aria-label="Publicidad"
      onClick={() => setActual(null)}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 transition-opacity duration-500 ${
        entra ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <img
        src={actual.imagen_url}
        alt="Publicidad"
        onError={() => setActual(null)}
        className="max-h-[90vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
      />
    </div>
  );
}
