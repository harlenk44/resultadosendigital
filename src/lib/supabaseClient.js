// =====================================================================
//  Cliente de Supabase (un único archivo para toda la app).
//
//  Variables de entorno (archivo .env, o los "Secrets" de Google AI Studio):
//    VITE_SUPABASE_URL       = https://xxxxx.supabase.co
//    VITE_SUPABASE_ANON_KEY  = clave "anon public" (Project Settings > API)
//
//  IMPORTANTE: usa SIEMPRE la clave "anon". Nunca pongas la "service_role"
//  en el navegador: saltaría todas las políticas de seguridad.
// =====================================================================
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Mensaje claro en consola si faltan las variables.
  console.error('Falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,       // el admin no tiene que iniciar sesión en cada visita
    autoRefreshToken: true,
  },
});
