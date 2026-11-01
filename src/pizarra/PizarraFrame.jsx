// =====================================================================
//  PizarraFrame.jsx
//  Muestra la Pizarra Animaltec (animalitos + triples) con los datos
//  compartidos de Supabase, y encima la publicidad emergente.
//
//   canWrite = false  ->  agencia: solo ve los resultados (modo lectura)
//   canWrite = true   ->  administrador: puede cargar resultados, horarios,
//                         triples, logos y banners (Supabase lo valida con RLS)
//
//  La pizarra vive en un iframe propio: así sus estilos no chocan con los de
//  la página (licencias, panel) y funciona igual que la versión original.
//  El contenedor (.pz-shell) es el que pasa a pantalla completa, para que el
//  pop-up de publicidad también se vea en el televisor.
// =====================================================================
import React, { useEffect, useMemo, useRef } from 'react';
import pizarraHtml from './pizarra.html?raw';
import adaptador from './frameAdapter.raw.js?raw';
import PublicidadPopup from '../publicidad/PublicidadPopup';
import './pizarra.css';

function armarDocumento(hash, silencioso) {
  const ajustes = `window.__PZ_HASH=${JSON.stringify(hash)};window.__PZ_QUIET=${silencioso ? 'true' : 'false'};`;
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<style>html,body{margin:0}img{max-width:100%}[hidden]{display:none!important}body{font:14px -apple-system,BlinkMacSystemFont,sans-serif}</style>' +
    `<script>${ajustes}</script>` +
    `<script>${adaptador.replace(/<\/script/gi, '<\\/script')}</script>` +
    '</head><body>' + pizarraHtml.replace(/<\/body>|<\/html>/gi, '') + '</body></html>'
  );
}

export default function PizarraFrame({ supabase, canWrite = false }) {
  const shell = useRef(null);

  // La página puede abrirse en una vista concreta: /#pantalla (televisor), #semanal, #triples...
  const documento = useMemo(() => armarDocumento(window.location.hash, !canWrite), [canWrite]);

  // El iframe lee esto al arrancar, por eso se deja listo antes de que cargue.
  useMemo(() => {
    window.__pizarraCtx = { supabase, canWrite: () => canWrite };
    window.__pizarraFullscreen = () => (shell.current && shell.current.requestFullscreen ? shell.current.requestFullscreen() : Promise.reject(new Error('sin pantalla completa')));
  }, [supabase, canWrite]);

  useEffect(() => () => { delete window.__pizarraCtx; delete window.__pizarraFullscreen; }, []);

  return (
    <div className="pz-shell" ref={shell}>
      <iframe className="pz-frame" title="Pizarra Animaltec" srcDoc={documento} />
      <PublicidadPopup />
    </div>
  );
}
