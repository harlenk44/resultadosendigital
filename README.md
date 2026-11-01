# Resultados en vivo · Pizarra Animaltec para alquilar

Una sola página web para **alquilar el servicio de resultados en vivo** a agencias:

- **Pizarra** de animalitos y de triples, que alterna sola en pantalla completa.
- **Licencias**: cada agencia necesita una licencia activa; tú la activas, la renuevas o la suspendes.
- **Publicidad emergente**: las fotos que mandas desde tu WhatsApp salen en todas las pantallas.

```
        TÚ (administrador)                              AGENCIAS (con licencia)
  ┌──────────────────────────┐                    ┌───────────────────────────┐
  │ /#licencias   licencias  │                    │ /            pizarra      │
  │ /#pizarra-admin  carga   │ ── Supabase ────►  │ /#pantalla   modo TV      │
  │   resultados y ajustes   │   (tiempo real)    │ solo LECTURA, en vivo     │
  │ WhatsApp ► webhook ► foto│                    │ + pop-up de publicidad    │
  └──────────────────────────┘                    └───────────────────────────┘
```

**Quién hace qué:** tú cargas los resultados **una sola vez**; todas las agencias con licencia activa los ven al instante.
Las agencias no pueden cargar ni cambiar nada (Supabase lo impide, no solo la pantalla).

## Direcciones

| Dirección | Para quién | Qué muestra |
|---|---|---|
| `https://tu-sitio/` | Agencia | Pizarra en solo lectura. Sin licencia activa muestra el bloqueo (o el botón **Enviar petición**). |
| `https://tu-sitio/#pantalla` | Televisor de la agencia | La misma pizarra, abierta directo en la vista de televisor. |
| `https://tu-sitio/#licencias` | Tú | Panel: licencias, peticiones, agencias. Pide tu usuario y contraseña. |
| `https://tu-sitio/#pizarra-admin` | Tú | Pizarra con permiso de escritura: resultados, horarios, triples, logos y banners. |

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `supabase/licenses.sql` | Licencias, administradores y la función `check_license`. **Se ejecuta primero.** |
| `supabase/requests.sql` | Peticiones de activación («Enviar petición»). |
| `supabase/pizarra.sql` | Tabla compartida de la pizarra: resultados, triples, horarios, logos y banners. Lectura para todos, escritura solo administrador. |
| `supabase/publicidad.sql` | Tabla `anuncios_publicidad` y bucket público `publicidad`. |
| `supabase/functions/publicidad-webhook/index.ts` | Webhook que recibe la foto desde WhatsApp. Ver `PUBLICIDAD.md`. |
| `src/App.jsx` | Une todo: rutas, licencia, pizarra y publicidad. |
| `src/pizarra/` | La pizarra (`pizarra.html`), su conector con Supabase (`frameAdapter.raw.js`), el contenedor `PizarraFrame.jsx` y la puerta de administrador `AdminGate.jsx`. |
| `src/publicidad/PublicidadPopup.jsx` | El pop-up de publicidad (ya está dentro de `PizarraFrame`). |
| `src/license/` | Licencias: `LicenseGuard`, `AdminPanel`, servicio y estilos. |
| `src/lib/supabaseClient.js` | Cliente de Supabase (lee las variables de entorno). |

## Puesta en marcha

1. **Supabase**: crea un proyecto en supabase.com (el plan gratuito basta).
2. **Base de datos**: en *SQL Editor* ejecuta, **en este orden**, un archivo a la vez:
   `licenses.sql` → `requests.sql` → `pizarra.sql` → `publicidad.sql`.
3. **Tu usuario administrador**:
   - *Authentication > Users > Add user* (tu correo y una contraseña fuerte).
   - Copia el UUID del usuario y ejecuta: `insert into public.admins (user_id) values ('TU-UUID');`
4. **Variables de entorno** (archivo `.env`, o *Secrets* en Google AI Studio):
   - `VITE_SUPABASE_URL` = la URL del proyecto
   - `VITE_SUPABASE_ANON_KEY` = la clave **anon public** (*Project Settings > API*). **Nunca** pongas la `service_role` en el navegador.
5. **Instala y arranca**: `npm install` y `npm run dev` (para publicarlo: `npm run build`).
6. **WhatsApp**: sigue `PUBLICIDAD.md` (clave secreta, desplegar la función, conectar tu puente).
7. **Primera prueba**:
   1. Abre `/#licencias`, inicia sesión y revisa que el panel carga.
   2. Pulsa **Abrir pizarra (cargar resultados)** y carga un resultado.
   3. En otra pestaña o en tu TV abre `/`: pulsa **Enviar petición**, acéptala desde el panel y comprueba que la pizarra muestra el resultado.

## Cómo alquilas el servicio

1. La agencia abre la dirección en su TV o navegador y pulsa **Enviar petición**.
2. Tú la aceptas en `/#licencias` con el nombre de la agencia y la duración (7, 15, 30, 60, 90 días, sin vencimiento o una fecha). La pantalla arranca sola en unos segundos.
3. Si no paga: apagas el interruptor de su fila y su pantalla se bloquea sola en menos de un minuto. **+30 días** renueva al recibir un pago.
4. Tú cargas los resultados en `/#pizarra-admin`. Todas las pantallas activas los ven en vivo.
5. Mandas un flyer por WhatsApp y sale como pop-up en todas las pantallas. Con la palabra `borrar` reemplaza los anteriores.

### Los resultados son globales
Los resultados, los horarios y la configuración de triples los define el administrador y son **los mismos para todas las agencias**.
Cada agencia sí puede personalizar **en su propio equipo** el tamaño, los colores y el tema (botón *Personalizar*); eso no afecta a las demás.

## Licencias: detalle

1. Abre `https://tu-sitio/#licencias`, inicia sesión y crea la agencia en **Nueva agencia**. Se genera su clave (`AGN-XXXX-XXXX-XXXX-XXXX`).
2. **Activar la pantalla del cliente** (elige la forma que le quede más cómoda):

   | Dispositivo | Forma | Pasos |
   |---|---|---|
   | **Smart TV o cualquier navegador** (recomendada) | **Enviar petición** | El cliente abre la pizarra y pulsa **Enviar petición** (en el TV basta el botón OK del control remoto; puede escribir su nombre, es opcional). A ti te aparece en **Peticiones pendientes** con su referencia (`K7M-4QX`), el tipo de pantalla (Smart TV, celular, computador) y la hora. Escribes el **nombre de la agencia**, eliges la **duración** (7, 15, 30, 60, 90 días, sin vencimiento o una fecha) y pulsas **Aceptar y activar**. En unos 3 segundos la pantalla arranca sola. |
   | Misma agencia, otro televisor | **Agencia existente** | En la petición elige la agencia en el selector: la pantalla usa su misma clave y fecha de corte. |
   | Cliente lejos o sin pantalla a mano | **Enlace de activación** | En la fila de la agencia pulsa **Copiar enlace** y envíaselo por WhatsApp. Al abrirlo, la pantalla queda activada en ese navegador. |
   | Cualquiera | Clave escrita | Botón **Tengo una clave** en la pantalla de activación. |

   Consejo para el TV: guarda la dirección de la pizarra como página de inicio o favorito del navegador del televisor, así la escribes una sola vez.
3. Cuando el cliente no pague, apaga el **interruptor** de su fila. Su pantalla se bloquea sola en menos de un minuto.
4. **+30 días** extiende la fecha de corte al registrar un pago.

### Cómo funcionan las peticiones

- Cada pantalla genera un **token secreto** de 32 caracteres que guarda en su navegador. Con él pregunta por el estado de *su* petición y recibe *su* clave **una sola vez** (al entregarla, la petición se borra). Si el TV se apaga o se recarga, sigue esperando la misma petición.
- El administrador no ve ese token: la lista solo muestra una referencia corta, el tipo de pantalla, la nota y la hora.
- Solo un administrador puede ver la lista, aceptar o rechazar (las funciones comprueban `is_admin()` dentro de la base de datos).
- La bandeja del panel se actualiza sola cada 10 segundos.
- Las peticiones sin atender se borran a los 7 días y hay un tope de 200 pendientes.
- Si la pantalla ya tenía una clave inválida (`not_found`), también puede cambiar a «Enviar petición».
- Una petición no es una licencia: **nada se activa hasta que tú la aceptas**.

## Estructura de la tabla `licenses`

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | uuid | Identificador interno. |
| `license_key` | text, único | Clave secreta de la pantalla (16 a 64 caracteres). |
| `agency_name` | text | Nombre de la agencia. |
| `status` | text | `active` o `suspended`. Es el interruptor manual. |
| `vence_el` | date | Fecha de corte: último día válido. Vacía = no vence. |
| `notes` | text | Notas internas (pago, contacto). |
| `last_check_at` | timestamptz | Última vez que la pantalla consultó (como máximo 1 vez cada 5 min). |
| `created_at`, `updated_at` | timestamptz | Control interno. |

Una licencia **permite** el acceso solo si `status = 'active'` **y** (`vence_el` es vacía **o** no ha pasado). La fecha se compara con el calendario de Caracas, no con UTC.

La tabla `admins` (`user_id`) lista quién puede administrar.

## Políticas de lectura y escritura (Row Level Security)

| Quién | `licenses` | `admins` | `check_license(clave)` |
|---|---|---|---|
| Pantalla de cliente (`anon`) | Nada: ni leer ni escribir | Nada | **Sí**: solo recibe el veredicto de su propia clave. También `submit_activation_request` y `poll_activation_request` (su propia petición) |
| Usuario con sesión que no es admin | Nada (ve 0 filas, no puede insertar) | Nada | Sí |
| Administrador | Leer, crear, editar, borrar | Solo ve su propia fila | Sí |

La pantalla del cliente nunca puede listar la tabla, así que nadie puede ver las claves de otras agencias. Nadie puede hacerse administrador desde la app: solo se agrega a mano en el SQL Editor.

## Qué pasa si se cae el internet

Una pizarra en un televisor no debe apagarse porque parpadeó el internet.

| Situación | Resultado |
|---|---|
| El servidor responde "suspendida" o "vencida" | Se bloquea de inmediato, siempre |
| Sin internet, último veredicto "activa" de hace menos de 72 h | Sigue funcionando y muestra un aviso pequeño |
| Sin internet por más de 72 h, o nunca verificó | Se bloquea ("No se pudo verificar la licencia") |
| Sin internet y el último veredicto fue "suspendida" | Sigue bloqueada |

Las horas de tolerancia (`graceHours`) y el intervalo de consulta (`pollMs`, 60 s) son propiedades de `<LicenseGuard>`.

## Límites que conviene conocer

- **El bloqueo por licencia es del lado del navegador.** Una persona técnica podría modificar el código en su equipo y saltarse la pantalla de bloqueo. Detiene el uso normal y la reventa casual.
- **Los resultados de la pizarra son legibles con la clave pública.** Para que la pizarra funcione en cualquier TV, la tabla `pizarra_datos` se puede leer sin iniciar sesión. Quien conozca la dirección de Supabase y su clave pública podría leer los resultados sin licencia. Escribir sí está protegido de verdad: solo administradores. Si algún día quieres cerrar la lectura, los resultados tendrían que pedirse solo con una licencia válida (con otra función en la base de datos y sin tiempo real directo).
- **El panel de administración sí está protegido de verdad**: aunque alguien lo modifique en su navegador, Supabase solo entrega o cambia datos si el usuario está en `admins`.
- **La publicidad de WhatsApp** solo la puede crear quien conozca la clave secreta del webhook. Guárdala como secreto y no la compartas.
- Usa una contraseña fuerte para tu usuario administrador y activa la verificación en dos pasos de tu cuenta de Supabase.

## Pruebas realizadas

- **SQL (PostgreSQL 16 real)**: veredictos active / suspended / expired / not_found, vence hoy, `anon` sin acceso a las tablas, usuario normal rechazado, administrador con acceso completo.
- **Componentes (navegador real, Supabase simulado)**: 62 pruebas en total, entre ellas el bloqueo exacto a pantalla completa, la pizarra fuera del DOM, la tolerancia sin internet, el bloqueo y desbloqueo con la pizarra abierta, la activación por URL, y el toggle, creación, +30 días, borrado y reversión del panel.
- **Peticiones de activación**: SQL en PostgreSQL 16 real (enviar, reenviar sin duplicar, pendiente/aceptada/rechazada, la clave se entrega una sola vez y funciona en `check_license`, agencia existente sin crear otra, `anon` y usuario normal no pueden ver, aceptar ni rechazar, tope de 200, limpieza a los 7 días, migración desde la versión por código) y pruebas de componentes (el botón y el foco para el control remoto, no envía nada solo, recarga con petición guardada, rechazada, cancelar, sin internet al enviar y mientras espera; la bandeja con duración, fecha de corte exacta, agencia existente, rechazo en dos pasos y errores claros).
- **No probado**: la conexión contra un proyecto de Supabase real (no tengo acceso a uno desde aquí). Tras el paso 3, prueba iniciar sesión en `#licencias` y crear una agencia.
- **Proyecto unido (pizarra + licencias + publicidad)**:
  - SQL de `pizarra.sql` en PostgreSQL 16 real: lectura para `anon`, escritura solo del administrador (insertar, actualizar y borrar rechazados para otros), colecciones, identificadores y tamaño validados, repetible.
  - Navegador real con Supabase simulado, dos pestañas (administrador y agencia): 25 pruebas. Licencia suspendida (bloqueo y la pizarra ni se monta); `#pizarra-admin` sin sesión; el administrador carga un animalito y un triple y quedan en `pizarra_datos`; la agencia los ve, no ve botones de administración, no puede abrir el selector, y un intento de escribir es rechazado; **un resultado nuevo llega en vivo a la agencia sin recargar**; pantalla completa sobre el contenedor (así el pop-up se ve en el TV); el pop-up aparece, se cierra con un clic, un cartel nuevo sale pronto y al desactivar todos desaparece; `#pantalla` abre la vista de televisor; sin errores de JavaScript.
  - Pop-up por separado (reloj acelerado): 16 pruebas. Webhook: 31 pruebas.
- **No probado**:
  - La conexión contra un proyecto de Supabase real (no tengo acceso a uno desde aquí).
  - Ningún puente de WhatsApp real (Make.com o Evolution API).
  - El `npm run build` final con Vite: en el entorno donde lo preparé no se podían instalar paquetes, así que lo probé con otro empaquetador. Si `npm run build` da algún error al instalarlo, avísame con el texto del error.
