# Publicidad emergente (pop-up) para la pizarra

Mandas una foto por WhatsApp → llega a un webhook → se guarda en Supabase →
la pizarra la muestra encima, durante unos segundos, cada cierto tiempo.

```
WhatsApp ─► Make.com / Evolution API ─► Edge Function (publicidad-webhook)
                                          ├─► Storage: bucket "publicidad" (la foto)
                                          └─► Tabla anuncios_publicidad (la URL)
                                                    │  Realtime
                                                    ▼
                                   <PublicidadPopup /> en la pizarra
```

Archivos:

| Archivo | Para qué |
|---|---|
| `supabase/publicidad.sql` | Tabla, seguridad, Realtime y bucket |
| `src/publicidad/PublicidadPopup.jsx` | El pop-up (React + Tailwind) |
| `supabase/functions/publicidad-webhook/index.ts` | El webhook que recibe la foto |

---

## 1. Base de datos y Storage

**Tabla:** Supabase → **SQL Editor** → New query → pega todo `supabase/publicidad.sql` → **Run**.
Crea `anuncios_publicidad` con: `id`, `imagen_url`, `activo` (true), `duracion_segundos` (10),
`intervalo_minutos` (5) y `created_at`. Se puede ejecutar varias veces sin problema.

**Bucket público `publicidad`:** el mismo SQL ya lo crea (público, máx. 5 MB, solo JPG/PNG/WEBP/GIF).
Si prefieres hacerlo a mano:

1. Supabase → **Storage** → **New bucket**.
2. Name: `publicidad`.
3. Activa **Public bucket**.
4. (Recomendado) en *Additional configuration*: tamaño máximo `5 MB` y tipos permitidos `image/jpeg, image/png, image/webp, image/gif`.
5. **Save**. No agregues políticas de subida: solo el webhook sube (con la clave `service_role`).

Comprobar: Storage debe mostrar `publicidad` con la etiqueta **Public**, y Database → Replication
(o Realtime) debe listar `anuncios_publicidad`.

> Seguridad: desde el navegador la tabla es **solo lectura**. Nadie puede publicar ni borrar anuncios
> con la clave `anon`; solo el webhook.

## 2. El componente `PublicidadPopup.jsx`

Copia `src/publicidad/PublicidadPopup.jsx` a tu proyecto (usa `src/lib/supabaseClient.js`, el mismo
cliente del sistema de licencias; si el tuyo está en otra ruta, cambia la línea `import { supabase } ...`).

- Lee los anuncios con `activo = true` y escucha cambios en tiempo real (más una consulta de respaldo cada 2 min).
- Ciclo: a los 5 s de abrir la pizarra sale la primera imagen; se ve `duracion_segundos`, se oculta,
  espera `intervalo_minutos` y vuelve.
- Con varias imágenes activas rota una por una (la más antigua primero). Cada imagen usa su propia duración e intervalo.
- Fondo oscuro semitransparente (`bg-black/70`), centrada, `z-50`. Un clic sobre el fondo la cierra antes de tiempo.
- Solo acepta URLs `http(s)`.
- Requiere **Tailwind CSS** en el proyecto.

## 3. El webhook (Edge Function)

**a) Crea una clave secreta** (la usará tu puente de WhatsApp para identificarse):

```
openssl rand -hex 32
```

**b) Súbela como secreto:** Supabase → **Edge Functions** → **Secrets** → `WEBHOOK_SECRET` = esa clave.
(`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya los inyecta Supabase solo.)

**c) Despliega la función.**
Con la CLI de Supabase (desde la carpeta del proyecto):

```
supabase functions deploy publicidad-webhook --no-verify-jwt
```

O desde el panel: Edge Functions → **Deploy a new function** → nombre `publicidad-webhook` → pega
`index.ts` → desactiva **Verify JWT** (el webhook se protege con su propia clave `x-webhook-secret`).

URL resultante: `https://TU-PROYECTO.supabase.co/functions/v1/publicidad-webhook`

**d) Pruébala:**

```
curl -X POST "https://TU-PROYECTO.supabase.co/functions/v1/publicidad-webhook" \
  -H "x-webhook-secret: TU_CLAVE" \
  -F "texto=promo de prueba" \
  -F "file=@foto.jpg"
```

Debe responder `{"ok":true,"id":"...","imagen_url":"https://...","desactivados":0}`.

**Cómo se comporta**

| Envías | Resultado |
|---|---|
| Foto (con o sin texto) | Se sube y queda activa **sumándose** a las anteriores |
| Foto con la palabra `borrar` en el texto | Se guarda la nueva y se **desactivan** (`activo = false`) todas las anteriores |
| Solo el texto `borrar` (sin foto) | Se desactivan todos los anuncios |

La palabra se detecta sola, en mayúsculas o minúsculas y con signos (`Borrar`, `¡BORRAR!`); `borrarlo` no cuenta.
Los anuncios desactivados **no se eliminan** de la tabla ni del bucket (queda el historial).
Opcional: envía `duracion_segundos` (2–120) e `intervalo_minutos` (1–240) junto a la foto.

**Formas de enviar la foto** (todas con el encabezado `x-webhook-secret`):

- **multipart/form-data:** campos `file` (la imagen) y `texto`.
- **JSON:** `{ "texto": "...", "image_base64": "..." }`
- **JSON con enlace:** `{ "texto": "...", "image_url": "https://..." }` (solo `https`, máx. 5 MB, sin redirecciones; se bloquean direcciones internas).
- **JSON de Evolution API:** lee `data.message.base64` y el pie de foto (`imageMessage.caption`).

Se valida el tipo **real** de la imagen (JPG, PNG, WEBP o GIF, máx. 5 MB). SVG y otros archivos se rechazan.

**Make.com:** módulo *HTTP → Make a request*: método POST, URL de la función, encabezado
`x-webhook-secret`, tipo de cuerpo `multipart/form-data` con el campo `texto` (el mensaje) y el campo
`file` de tipo *File* (la imagen que entrega el módulo de WhatsApp).

**Evolution API:** apunta su webhook de mensajes a la URL de la función, agrega el encabezado
`x-webhook-secret` y activa que el webhook incluya la imagen en base64.

> Importante: no probé estos puentes con un WhatsApp real. El webhook sí está probado con los formatos
> de arriba; si tu puente envía otra estructura, dime cómo llega y lo adapto.

## 4. Integración mínima

En tu archivo principal (por ejemplo `src/App.jsx`):

```jsx
import PublicidadPopup from './publicidad/PublicidadPopup';
```

y, dentro del `return`, **una sola línea** (en cualquier parte, queda superpuesta):

```jsx
<PublicidadPopup />
```
