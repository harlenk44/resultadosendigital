/* =====================================================================
 *  frameAdapter.raw.js
 *  Se ejecuta DENTRO de la pizarra (iframe), antes que su propio código.
 *  Conecta la pizarra con Supabase usando el cliente de la página que la aloja:
 *
 *    window.claude.use('db')    ->  lee y escribe la tabla pizarra_datos
 *    window.claude.use('user')  ->  can('data.write') = ¿es administrador?
 *
 *  Así la pizarra funciona igual que siempre, pero con datos compartidos
 *  entre todas las pantallas. Si la página no ofrece Supabase, la pizarra
 *  arranca en modo local (solo ese navegador), como antes.
 *
 *  Es JavaScript simple (sin import/export): se inserta tal cual en el iframe.
 * ===================================================================== */
(function () {
  'use strict';
  var P = window.parent, ctx = P && P.__pizarraCtx;
  if (!ctx || !ctx.supabase) return;

  var sb = ctx.supabase, TABLA = 'pizarra_datos';
  var oyentes = [], canal = null, respaldo = null, pendiente = null;

  // ---- Errores: "sin permiso" se le avisa a la pizarra con el código que ella ya entiende ----
  function fallo(e) {
    var msg = (e && e.message) || 'error';
    var err = new Error(msg);
    var sinPermiso = e && (e.code === '42501' || e.status === 401 || e.status === 403 || /row-level security|permission denied/i.test(msg));
    err.code = sinPermiso ? 'invalid_argument' : ((e && e.code) || 'unknown');
    return err;
  }
  function exigirAdmin() {
    if (!ctx.canWrite()) { var e = new Error('Sin permiso'); e.code = 'invalid_argument'; throw e; }
  }

  // ---- Tiempo real: un solo canal para toda la tabla; ante cualquier cambio cada oyente vuelve a consultar ----
  function avisar() {
    clearTimeout(pendiente);
    pendiente = setTimeout(function () { oyentes.slice().forEach(function (f) { f(); }); }, 200);
  }
  function abrirCanal() {
    if (canal) return;
    canal = sb.channel('pizarra-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLA }, avisar)
      .subscribe();
    respaldo = setInterval(avisar, 60000);        // por si el WiFi de la TV corta el tiempo real
  }
  function cerrarCanal() {
    if (oyentes.length || !canal) return;
    sb.removeChannel(canal); canal = null; clearInterval(respaldo);
  }
  // consulta() devuelve una promesa de {firma, entregar}; solo se avisa a la pizarra si algo cambió
  function escuchar(consulta, alError) {
    var vivo = true, ultima = null;
    function correr() {
      Promise.resolve().then(consulta).then(function (r) {
        if (!vivo || r.firma === ultima) return;
        ultima = r.firma; r.entregar();
      }).catch(function (e) { if (vivo && alError) { ultima = null; alError(fallo(e)); } });
    }
    oyentes.push(correr); abrirCanal(); correr();
    return function () {
      vivo = false;
      var i = oyentes.indexOf(correr); if (i >= 0) oyentes.splice(i, 1);
      cerrarCanal();
    };
  }
  function sacar(res) { if (res.error) throw res.error; return res.data; }

  // ---- Un documento: coleccion/id ----
  function doc(ruta) {
    var p = String(ruta).split('/'), col = p[0], id = p.slice(1).join('/');
    return {
      set: async function (datos) {
        exigirAdmin();
        var r = await sb.from(TABLA).upsert({ coleccion: col, id: id, datos: datos }, { onConflict: 'coleccion,id' });
        if (r.error) throw fallo(r.error);
      },
      delete: async function () {
        exigirAdmin();
        var r = await sb.from(TABLA).delete().eq('coleccion', col).eq('id', id);
        if (r.error) throw fallo(r.error);
      },
      onSnapshot: function (alCambiar, alError) {
        return escuchar(function () {
          return sb.from(TABLA).select('datos').eq('coleccion', col).eq('id', id).maybeSingle().then(function (res) {
            var fila = sacar(res);
            return {
              firma: fila ? JSON.stringify(fila.datos) : '-',
              entregar: function () { alCambiar({ exists: !!fila, id: id, data: function () { return fila ? fila.datos : undefined; } }); }
            };
          });
        }, alError);
      }
    };
  }

  // ---- Una colección, con where(campo, op, valor) y limit(n) ----
  function coleccion(nombre, filtros, tope) {
    return {
      where: function (campo, op, valor) { return coleccion(nombre, filtros.concat([[campo, op, valor]]), tope); },
      limit: function (n) { return coleccion(nombre, filtros, n); },
      onSnapshot: function (alCambiar, alError) {
        return escuchar(function () {
          var q = sb.from(TABLA).select('id,datos').eq('coleccion', nombre);
          filtros.forEach(function (f) {
            var col = 'datos->>' + f[0];
            q = f[1] === '>=' ? q.gte(col, f[2]) : f[1] === '<=' ? q.lte(col, f[2]) : q.eq(col, f[2]);
          });
          if (tope) q = q.limit(tope);
          return q.then(function (res) {
            var filas = sacar(res) || [];
            return {
              firma: filas.map(function (r) { return r.id + ':' + JSON.stringify(r.datos); }).sort().join('|'),
              entregar: function () {
                alCambiar({ docs: filas.map(function (r) { return { id: r.id, data: function () { return r.datos; } }; }) });
              }
            };
          });
        }, alError);
      }
    };
  }

  var db = { doc: doc, collection: function (n) { return coleccion(n, [], 0); } };
  var user = { can: function () { return Promise.resolve(!!ctx.canWrite()); } };
  window.claude = { use: function (nombre) { return Promise.resolve(nombre === 'db' ? db : nombre === 'user' ? user : null); } };

  // ---- Pantalla completa: se pide para el contenedor de la página (así el pop-up también se ve) ----
  if (typeof P.__pizarraFullscreen === 'function') {
    Element.prototype.requestFullscreen = function () { return P.__pizarraFullscreen(); };
    document.exitFullscreen = function () { return P.document.exitFullscreen ? P.document.exitFullscreen() : Promise.resolve(); };
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: function () { return P.document.fullscreenElement ? document.documentElement : null; } });
    var puente = function () { document.dispatchEvent(new Event('fullscreenchange')); };
    P.document.addEventListener('fullscreenchange', puente);
    window.addEventListener('pagehide', function () { P.document.removeEventListener('fullscreenchange', puente); });
  }
})();
