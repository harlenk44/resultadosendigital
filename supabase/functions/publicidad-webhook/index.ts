// =====================================================================
//  publicidad-webhook  ·  Edge Function de Supabase
//
//  Recibe una foto desde tu WhatsApp (por Make.com, Evolution API, etc.),
//  la sube al bucket "publicidad" y la registra en anuncios_publicidad.
//  Si el mensaje contiene la palabra "borrar", desactiva los anuncios
//  anteriores para que quede solo el nuevo.
//
//  Seguridad: exige el encabezado  x-webhook-secret  con tu clave secreta
//  (secreto WEBHOOK_SECRET). Sin ella responde 401. Usa la clave
//  service_role (que Supabase ya inyecta en el servidor): jamás sale al navegador.
//
//  Formas de enviar la foto (cualquiera sirve):
//   A) multipart/form-data: campo "file" (la imagen) y "texto" (el mensaje)
//   B) JSON: { "texto": "borrar", "image_base64": "...", }
//   C) JSON: { "texto": "...", "image_url": "https://..." }
//   D) JSON de Evolution API (data.message.base64 / imageMessage.caption)
//  Opcionales: "duracion_segundos" (2-120) e "intervalo_minutos" (1-240).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'publicidad';
const TABLA = 'anuncios_publicidad';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB (igual que el límite del bucket)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---------- seguridad ----------
async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
/** Comparación en tiempo constante (compara los hashes, no los textos). */
async function secretoValido(recibido: string | null, esperado: string | undefined) {
  if (!esperado || esperado.length < 16 || !recibido) return false;
  const a = await sha256(recibido), b = await sha256(esperado);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------- imagen ----------
type Tipo = { mime: string; ext: string };
/** Detecta el tipo real mirando los primeros bytes (no confía en lo que diga el remitente). */
function detectarTipo(b: Uint8Array): Tipo | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { mime: 'image/gif', ext: 'gif' };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

function desdeBase64(s: string): Uint8Array | null {
  const limpio = s.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!limpio || limpio.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) return null;
  try {
    const bin = atob(limpio);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/** Bloquea direcciones internas escritas a mano (localhost, 10.x, 192.168.x, etc.). */
function hostPermitido(host: string) {
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (h.startsWith('[') || h.includes(':')) return false;                       // IPv6 literal
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

async function descargar(urlTexto: string): Promise<Uint8Array | null> {
  let u: URL;
  try { u = new URL(urlTexto); } catch { return null; }
  if (u.protocol !== 'https:' || !hostPermitido(u.hostname)) return null;
  const r = await fetch(u, { redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!r.ok || !r.body) return null;
  const largo = Number(r.headers.get('content-length') || 0);
  if (largo > MAX_BYTES) return null;
  const partes: Uint8Array[] = [];
  let total = 0;
  const lector = r.body.getReader();
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) { await lector.cancel(); return null; }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.length; }
  return out;
}

// ---------- lectura del pedido ----------
type Pedido = { texto: string; bytes: Uint8Array | null; imageUrl: string | null; dur?: unknown; inter?: unknown; errorImg?: string };

// deno-lint-ignore no-explicit-any
function primero(o: any, claves: string[]) {
  for (const k of claves) if (o && typeof o[k] === 'string' && o[k]) return o[k] as string;
  return '';
}

async function leerPedido(req: Request): Promise<Pedido> {
  const tipo = req.headers.get('content-type') || '';
  const p: Pedido = { texto: '', bytes: null, imageUrl: null };

  if (tipo.includes('multipart/form-data')) {
    const f = await req.formData();
    p.texto = String(f.get('texto') ?? f.get('message') ?? f.get('caption') ?? f.get('text') ?? '');
    const arch = f.get('file') ?? f.get('imagen') ?? f.get('image');
    if (arch instanceof File && arch.size > 0) {
      if (arch.size > MAX_BYTES) p.errorImg = 'La imagen supera 5 MB.';
      else p.bytes = new Uint8Array(await arch.arrayBuffer());
    }
    const u = f.get('image_url');
    if (!p.bytes && typeof u === 'string' && u) p.imageUrl = u;
    p.dur = f.get('duracion_segundos'); p.inter = f.get('intervalo_minutos');
    return p;
  }

  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return p; }
  const msg = b?.data?.message ?? b?.message ?? {};            // formato Evolution API
  p.texto = primero(b, ['texto', 'caption', 'text', 'body', 'mensaje']) ||
    (typeof b?.message === 'string' ? b.message : '') ||
    primero(msg, ['caption', 'conversation']) ||
    primero(msg.imageMessage, ['caption']) ||
    primero(b?.data, ['caption', 'text']);
  const b64 = primero(b, ['image_base64', 'base64', 'imagen_base64']) || primero(msg, ['base64']) || primero(b?.data, ['base64']);
  if (b64) {
    p.bytes = desdeBase64(b64);
    if (!p.bytes) p.errorImg = 'Imagen base64 inválida o mayor de 5 MB.';
  } else {
    p.imageUrl = primero(b, ['image_url', 'imagen_url', 'url']) || null;
  }
  p.dur = b?.duracion_segundos; p.inter = b?.intervalo_minutos;
  return p;
}

const entero = (v: unknown, min: number, max: number) => {
  const n = Math.round(Number(v));
  return v !== undefined && v !== null && v !== '' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

// ---------- el webhook ----------
export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ ok: false, error: 'Usa POST.' }, 405);

  if (!(await secretoValido(req.headers.get('x-webhook-secret'), Deno.env.get('WEBHOOK_SECRET')))) {
    return json({ ok: false, error: 'No autorizado.' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const clave = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !clave) return json({ ok: false, error: 'Servidor mal configurado.' }, 500);
  const supabase = createClient(url, clave, { auth: { persistSession: false } });

  const p = await leerPedido(req);
  const borrar = /(^|[^\p{L}])borrar([^\p{L}]|$)/iu.test(p.texto);

  if (p.errorImg) return json({ ok: false, error: p.errorImg }, 400);

  let bytes = p.bytes;
  if (!bytes && p.imageUrl) {
    try { bytes = await descargar(p.imageUrl); } catch { bytes = null; }
    if (!bytes) return json({ ok: false, error: 'No se pudo descargar la imagen (usa https y menos de 5 MB).' }, 400);
  }

  // Solo "borrar" sin foto: apaga todo lo activo.
  if (!bytes) {
    if (!borrar) return json({ ok: false, error: 'No llegó ninguna imagen.' }, 400);
    const { data, error } = await supabase.from(TABLA).update({ activo: false }).eq('activo', true).select('id');
    if (error) return json({ ok: false, error: 'No se pudo desactivar.' }, 500);
    return json({ ok: true, desactivados: data?.length ?? 0 });
  }

  if (bytes.length > MAX_BYTES) return json({ ok: false, error: 'La imagen supera 5 MB.' }, 400);
  const tipo = detectarTipo(bytes);
  if (!tipo) return json({ ok: false, error: 'Solo se aceptan JPG, PNG, WEBP o GIF.' }, 415);

  // 1) subir al bucket
  const ruta = `anuncio-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${tipo.ext}`;
  const sube = await supabase.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo.mime, upsert: false });
  if (sube.error) return json({ ok: false, error: 'No se pudo subir la imagen.' }, 500);
  const imagen_url = supabase.storage.from(BUCKET).getPublicUrl(ruta).data.publicUrl;

  // 2) registrar el anuncio
  const fila: Record<string, unknown> = { imagen_url, activo: true };
  const dur = entero(p.dur, 2, 120), inter = entero(p.inter, 1, 240);
  if (dur !== undefined) fila.duracion_segundos = dur;
  if (inter !== undefined) fila.intervalo_minutos = inter;
  const ins = await supabase.from(TABLA).insert(fila).select('id').single();
  if (ins.error || !ins.data) {
    await supabase.storage.from(BUCKET).remove([ruta]);   // no dejar fotos huérfanas
    return json({ ok: false, error: 'No se pudo registrar el anuncio.' }, 500);
  }

  // 3) "borrar": desactivar los anteriores (primero se inserta el nuevo, así nunca queda vacío)
  let desactivados = 0;
  if (borrar) {
    const des = await supabase.from(TABLA).update({ activo: false }).eq('activo', true).neq('id', ins.data.id).select('id');
    if (des.error) return json({ ok: true, id: ins.data.id, imagen_url, aviso: 'Se guardó, pero no se pudieron desactivar los anteriores.' });
    desactivados = des.data?.length ?? 0;
  }
  return json({ ok: true, id: ins.data.id, imagen_url, desactivados });
}

Deno.serve(handler);
