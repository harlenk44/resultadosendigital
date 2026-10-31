# Sistema de licencias para la Pizarra Animaltec

Activa o suspende pantallas de clientes según su pago, con Supabase.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `supabase/licenses.sql` | Tablas, políticas de seguridad y la función `check_license`. Se ejecuta una vez en Supabase. |
| `src/lib/supabaseClient.js` | Cliente de Supabase (lee las variables de entorno). |
| `src/license/licenseService.js` | Toda la comunicación con Supabase y utilidades (fechas, claves). Sin React. |
| `src/license/useLicenseCheck.js` | Hook que consulta la licencia, repite la consulta y decide qué hacer sin internet. |
| `src/license/LicenseGuard.jsx` | Envuelve la pizarra; si no hay licencia activa, la oculta y muestra el bloqueo. |
| `src/license/AdminPanel.jsx` | Panel de administración independiente. |
| `src/license/license.css` | Estilos (clases `lic-*`, no chocan con tu app). |
| `src/App.example.jsx` | Ejemplo de cómo conectarlo. Es el único cambio en tu archivo principal. |

## Instalación (10 minutos)

1. **Supabase**: crea un proyecto en supabase.com (el plan gratuito basta).
2. **Base de datos**: en *SQL Editor* pega y ejecuta `supabase/licenses.sql`.
3. **Tu usuario administrador**:
   - *Authentication > Users > Add user* (tu correo y una contraseña fuerte).
   - Copia el UUID del usuario.
   - En el SQL Editor ejecuta: `insert into public.admins (user_id) values ('TU-UUID');`
4. **Variables de entorno** (archivo `.env`, o *Secrets* en Google AI Studio):
   - `VITE_SUPABASE_URL` = la URL del proyecto
   - `VITE_SUPABASE_ANON_KEY` = la clave **anon public** (*Project Settings > API*). **Nunca** pongas la `service_role` en el navegador.
5. **Dependencia**: `npm i @supabase/supabase-js`
6. **Copia** la carpeta `src/license` y `src/lib/supabaseClient.js` a tu proyecto, y aplica `App.example.jsx` en tu archivo principal.

## Cómo se usa

1. Abre `https://tu-pizarra/#licencias`, inicia sesión y crea la agencia en **Nueva agencia**. Se genera su clave (`AGN-XXXX-XXXX-XXXX-XXXX`).
2. En la pantalla del cliente, abre una sola vez `https://tu-pizarra/?licencia=AGN-XXXX-XXXX-XXXX-XXXX`. La clave queda guardada en ese dispositivo y se quita de la barra de direcciones. También puede escribirla en la pantalla de activación.
3. Cuando el cliente no pague, apaga el **interruptor** de su fila. Su pantalla se bloquea sola en menos de un minuto.
4. **+30 días** extiende la fecha de corte al registrar un pago.

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
| Pantalla de cliente (`anon`) | Nada: ni leer ni escribir | Nada | **Sí**: solo recibe el veredicto de su propia clave |
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

- **Es un bloqueo del lado del navegador.** Una persona técnica podría modificar el código en su equipo y saltarse la pantalla de bloqueo. Detiene el uso normal y la reventa casual. Si más adelante quieres un control más fuerte, los datos de la pizarra (resultados) tendrían que pedirse a Supabase solo con una licencia activa, validando la clave en las políticas de esa tabla.
- **El panel de administración sí está protegido de verdad**: aunque alguien lo modifique en su navegador, Supabase solo entrega o cambia datos si el usuario está en `admins`.
- Usa una contraseña fuerte para tu usuario administrador y activa la verificación en dos pasos de tu cuenta de Supabase.

## Pruebas realizadas

- **SQL (PostgreSQL 16 real)**: veredictos active / suspended / expired / not_found, vence hoy, `anon` sin acceso a las tablas, usuario normal rechazado, administrador con acceso completo.
- **Componentes (navegador real, Supabase simulado)**: 29 pruebas, entre ellas el bloqueo exacto a pantalla completa, la pizarra fuera del DOM, la tolerancia sin internet, el bloqueo y desbloqueo con la pizarra abierta, la activación por URL, y el toggle, creación, +30 días, borrado y reversión del panel.
- **No probado**: la conexión contra un proyecto de Supabase real (no tengo acceso a uno desde aquí). Tras el paso 3, prueba iniciar sesión en `#licencias` y crear una agencia.
