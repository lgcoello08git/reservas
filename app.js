// Motor (Google Apps Script). No es secreto: sin email autorizado y código no devuelve nada.
const MOTOR = 'https://script.google.com/macros/s/AKfycbwAc8n-dL2pH4oAlnUs1-JIZIphojfV5zoxsXSyJ01BcxWTyr4lTSpMWcV4PN8XoMCnLQ/exec';
const PLATS = ['Booking', 'Airbnb', 'Vrbo'];
const DSEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DSEM_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let D = null, hojaId = null, busqueda = '', tab = 'proximas', filtro = 'todos', mes = null, mesOc = null, diaSel = null, ocupado = false, sinConexion = false;
const $ = s => document.querySelector(s);

/* ---------- Almacén local (puede fallar en modo privado) ---------- */
function leer(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* nada */ } }
function borrar(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }
let SES = leer('nv-sesion');

/* Copia de la sesión en IndexedDB: en iPhone (app en pantalla de inicio) localStorage a veces se pierde al cerrar la app. */
function idb(modo, fn) {
  return new Promise(ok => {
    try {
      const rq = indexedDB.open('nv', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onerror = () => ok(null);
      rq.onsuccess = () => {
        try {
          const tx = rq.result.transaction('kv', modo), st = tx.objectStore('kv');
          const r = fn(st);
          tx.oncomplete = () => ok(r && 'result' in r ? r.result : null);
          tx.onerror = tx.onabort = () => ok(null);
        } catch (e) { ok(null); }
      };
    } catch (e) { ok(null); }
  });
}
function guardarSesion(s) { guardar('nv-sesion', s); return idb('readwrite', st => st.put(s, 'sesion')); }
function borrarSesion() { borrar('nv-sesion'); return idb('readwrite', st => st.delete('sesion')); }
function leerSesionIdb() { return idb('readonly', st => st.get('sesion')); }

/* ---------- Motor ---------- */
async function llamar(cuerpo) {
  const r = await fetch(MOTOR, { method: 'POST', redirect: 'follow', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo) });
  if (!r.ok) throw new Error('El servidor respondió ' + r.status);
  return r.json();
}
async function api(accion, extra) {
  if (!SES) throw new Error('sesion');
  const j = await llamar(Object.assign({ accion, token: SES.token, dispositivo: nombreDispositivo() }, extra || {}));
  if (j.error === 'sesion') { salirLocal(); throw new Error('sesion'); }
  if (j.error) throw new Error(j.mensaje || 'Error del servidor');
  return j;
}

/* ---------- Utilidades ---------- */
function sumar(ymd, n) { const p = ymd.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function noches(a, b) { const x = a.split('-').map(Number), y = b.split('-').map(Number); return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 864e5); }
function dow(ymd) { const p = ymd.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay(); }
function fCorta(ymd) { const p = ymd.split('-').map(Number); return DSEM[dow(ymd)] + ' ' + p[2] + ' ' + MES[p[1] - 1]; }
function fLarga(ymd) { const p = ymd.split('-').map(Number); return DSEM_L[dow(ymd)] + ' ' + p[2] + ' de ' + MES_L[p[1] - 1]; }
function fDia(ymd) { const p = ymd.split('-').map(Number); return p[2] + ' ' + MES[p[1] - 1]; }
/* En pantallas estrechas, si el nombre del apartamento no cabe en la primera línea se usa el corto */
const NOMBRES_CORTOS = { 'Vistas a la Catedral': 'Catedral', 'Patio Toledano': 'Patio' };
function nombreCorto(apt) { return NOMBRES_CORTOS[apt] || apt; }
function ajustarNombres() {
  document.querySelectorAll('.card .apt[data-corto]').forEach(a => {
    if (a.scrollWidth > a.clientWidth + 1 && a.dataset.corto !== a.textContent) a.textContent = a.dataset.corto;
  });
}
let anchoAntes = window.innerWidth;
window.addEventListener('resize', () => { if (window.innerWidth !== anchoAntes) { anchoAntes = window.innerWidth; if (D && SES) render(); } });
function nTxt(n) { return n + (n === 1 ? ' noche' : ' noches'); }
function hoyLocal() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// No es una reserva: bloqueo de la plataforma, fechas de Booking cerradas a mano o reserva cancelada según el correo
function esCierre(r) { return r.tipo === 'Bloqueo' || r.marca === 'cerrado' || !!r.cancelCorreo; }
// Cierre de Booking que aún no se sabe qué es (el motor lo aclara con los correos; ver r.aclarar)
function sinAclarar(r) { return !!r.aclarar && !r.marca && !r.cancelCorreo; }
function autoMarca(r) { return !r.marcaPor || r.marcaPor.indexOf('auto') === 0 || r.marcaPor === 'correo de Smartbox' || (r.marcaPor === 'reparación' && r.marca === 'cerrado'); }
function clase(r) { if (esCierre(r)) return 'p-Bloqueo'; if (r.marca === 'externa') return 'p-Directa'; if (r.marca === 'smartbox') return 'p-Smartbox'; return PLATS.indexOf(r.plat) >= 0 ? 'p-' + r.plat : 'p-Otra'; }
// Canal que se muestra: una reserva externa deja de ser «Booking»
function canal(r) { return r.marca === 'externa' ? 'Externa' : r.marca === 'smartbox' ? 'Smartbox' : r.plat; }
function claseCanal(x) { return x === 'Externa' ? 'p-Directa' : x === 'Smartbox' ? 'p-Smartbox' : PLATS.indexOf(x) >= 0 ? 'p-' + x : 'p-Otra'; }
function etiqueta(r) { return r.cancelCorreo ? 'Cancelada · ' + canal(r) : r.marca === 'cerrado' ? 'Cerrado' : r.marca === 'externa' ? 'Reserva externa' : r.marca === 'smartbox' ? 'Smartbox' : r.tipo === 'Bloqueo' ? 'Bloqueado · ' + r.plat : sinAclarar(r) ? 'Booking · por confirmar' : r.plat; }
function pillTxt(r) { return r.cancelCorreo ? '❌ Cancelada' : r.marca === 'cerrado' ? '🔒 Cerrado' : r.marca === 'externa' ? 'Externa' : r.marca === 'smartbox' ? '🎁 Smartbox' : esCierre(r) ? '🔒 ' + r.plat : sinAclarar(r) ? '⏳ Booking' : r.plat; }
// Booking no distingue en su calendario entre una reserva y unas fechas cerradas a mano
function porAclarar(r) { return r.plat === 'Booking' && r.tipo !== 'Bloqueo' && !r.marca && !r.cancelCorreo; }
function enChoque(id) { return D.solapes.some(p => p[0] === id || p[1] === id); }
function hace(s) {
  if (!s) return 'Aún no se ha comprobado';
  const t = new Date(s.replace(' ', 'T')).getTime();
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (min < 1) return 'Comprobado ahora mismo';
  if (min < 60) return 'Comprobado hace ' + min + ' min';
  const h = Math.round(min / 60);
  return h < 24 ? 'Comprobado hace ' + h + ' h' : 'Comprobado el ' + s.slice(8, 10) + '/' + s.slice(5, 7);
}
let toastT = null;
// Con «idDeshacer», el aviso lleva un botón «Deshacer» unos segundos (el motor guarda lo último que ha cambiado cada móvil)
function toast(m, idDeshacer) {
  const t = $('#toast');
  t.innerHTML = '<span>' + esc(m) + '</span>' + (idDeshacer ? '<button type="button" id="toast-deshacer">Deshacer</button>' : '');
  t.classList.add('ver'); t.classList.toggle('con-boton', !!idDeshacer);
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('ver', 'con-boton'), idDeshacer ? 8000 : 4200);
  if (idDeshacer) $('#toast-deshacer').onclick = e => { e.stopPropagation(); deshacer(idDeshacer); };
}
async function deshacer(id) {
  const t = $('#toast'); clearTimeout(toastT);
  t.innerHTML = '<span>Deshaciendo…</span>'; t.classList.remove('con-boton');
  try {
    D = await api('deshacer', { id }); guardar('nv-datos', D); render(); toast('Deshecho: está como antes');
    if (!$('#velo').hidden && hojaId === id) abrirReserva(id);
  } catch (e) { toast(msgError(e)); }
}
function msgError(e) { const m = e && e.message ? e.message : String(e || 'Error'); return /failed to fetch|load failed|networkerror/i.test(m) ? 'Sin conexión' : m; }
function abrirHoja(html) { hojaId = null; $('#hoja').innerHTML = '<div class="asa"></div>' + html; $('#velo').hidden = false; document.body.classList.add('bloq'); }
function cerrarHoja() { $('#velo').hidden = true; document.body.classList.remove('bloq'); }

/* ---------- Entrar con email y código ---------- */
function pantallaEntrar(email) {
  $('#cabecera').hidden = true; $('#pestanas').hidden = true;
  $('#chips').innerHTML = ''; $('#avisos').innerHTML = ''; $('#buscador').hidden = true; $('#buscar').value = ''; busqueda = '';
  $('#vista').innerHTML = '<div class="login"><h2>Reservas Nuncio Viejo</h2>' +
    '<p>Escribe tu email. Si tienes acceso, te llegará un código de 6 cifras.</p>' +
    '<label class="campo">Email<input id="l-email" type="email" inputmode="email" autocomplete="email" value="' + esc(email || '') + '"></label>' +
    '<div class="msg" id="l-msg"></div>' +
    '<div class="acciones"><button class="btn prim" id="l-pedir">Enviarme el código</button></div></div>';
  $('#l-pedir').onclick = pedirCodigo;
  $('#l-email').onkeydown = e => { if (e.key === 'Enter') pedirCodigo(); };
}
async function pedirCodigo() {
  const email = $('#l-email').value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('#l-msg').innerHTML = '<div class="aviso mal">Escribe un email válido.</div>'; return; }
  const b = $('#l-pedir'); b.disabled = true; b.textContent = 'Enviando…';
  try {
    const j = await llamar({ accion: 'pedirCodigo', email, dispositivo: nombreDispositivo() });
    if (j.error) throw new Error(j.mensaje);
    pantallaCodigo(email);
  } catch (e) { $('#l-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Enviarme el código'; }
}
function pantallaCodigo(email) {
  $('#vista').innerHTML = '<div class="login"><h2>Revisa tu correo</h2>' +
    '<p>Si <b>' + esc(email) + '</b> tiene acceso, le habrá llegado un código de 6 cifras (mira también en correo no deseado).</p>' +
    '<label class="campo">Código<input id="l-codigo" class="codigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label>' +
    '<div class="msg" id="l-msg"></div>' +
    '<div class="acciones"><button class="btn" id="l-volver">Volver</button><button class="btn prim" id="l-entrar">Entrar</button></div></div>';
  $('#l-codigo').focus();
  $('#l-volver').onclick = () => pantallaEntrar(email);
  const entrar = async () => {
    const codigo = $('#l-codigo').value.replace(/\D/g, '');
    if (codigo.length !== 6) { $('#l-msg').innerHTML = '<div class="aviso mal">El código tiene 6 cifras.</div>'; return; }
    const b = $('#l-entrar'); b.disabled = true; b.textContent = 'Entrando…';
    try {
      const j = await llamar({ accion: 'entrar', email, codigo, dispositivo: nombreDispositivo() });
      if (j.error) throw new Error(j.mensaje);
      SES = { token: j.token, email: j.email, admin: !!j.admin };
      await guardarSesion(SES);
      iniciar();
    } catch (e) { $('#l-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Entrar'; }
  };
  $('#l-entrar').onclick = entrar;
  $('#l-codigo').oninput = e => { if (e.target.value.replace(/\D/g, '').length === 6) entrar(); };
}
function salirLocal() { const email = SES && SES.email; SES = null; D = null; REG = null; borrarSesion(); borrar('nv-datos'); cerrarHoja(); pantallaEntrar(email); }

function nombreDispositivo() {
  const ua = navigator.userAgent || '';
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Otro';
  const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const nav = app ? 'app instalada' : /EdgA?\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'navegador';
  return so + ' · ' + nav;
}

/* Restos del bloqueo con Face ID (retirado): se limpian al abrir. */
function limpiarBloqueoAntiguo() { borrar('nv-bloqueo'); idb('readwrite', st => st.delete('bloqueo')); }

/* ---------- Carga ---------- */
async function cargar(silencioso) {
  if (!SES) return;
  try {
    D = await api('datos');
    sinConexion = false;
    guardar('nv-datos', D);
    render();
  } catch (e) {
    if (msgError(e) === 'sesion') return;
    const copia = leer('nv-datos');
    if (copia) { D = copia; sinConexion = true; render(); if (!silencioso) toast('Sin conexión: se muestran los últimos datos'); }
    else if (!silencioso) $('#vista').innerHTML = '<div class="vacio-lista"><b>No se pudieron cargar las reservas</b>' + esc(msgError(e)) + '<p><button class="btn" data-accion="recargar">Reintentar</button></p></div>';
  }
}
async function sincronizar() {
  if (ocupado || !SES) return;
  ocupado = true;
  const b = $('#btnSync'); b.classList.add('girando'); $('#sub').textContent = 'Comprobando Booking, Airbnb y Vrbo…';
  try { D = await api('sincronizar'); sinConexion = false; guardar('nv-datos', D); render(); toast('Reservas al día'); }
  catch (e) { if (msgError(e) !== 'sesion') { toast(msgError(e)); if (D) render(); } }
  finally { ocupado = false; b.classList.remove('girando'); }
}

/* ---------- Pintar ---------- */
function render() {
  if (!D) return;
  D.hoy = hoyLocal();
  $('#cabecera').hidden = false; $('#pestanas').hidden = false;
  $('#sub').innerHTML = esc(hace(D.ultimaSync)) + (sinConexion ? ' · <span class="offline">sin conexión</span>' : '');
  renderAvisos();
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const ch = ['todos'].concat(D.apartamentos);
  if (ch.indexOf(filtro) < 0) filtro = 'todos';
  $('#chips').innerHTML = ch.map(a => '<button class="chip' + (a === filtro ? ' on' : '') + '" data-filtro="' + esc(a) + '">' + (a === 'todos' ? 'Los dos' : esc(a)) + '</button>').join('');
  $('#buscador').hidden = tab !== 'proximas';
  if (tab === 'proximas') renderProximas(); else if (tab === 'ocupacion') renderOcupacion(); else if (tab === 'facturas') renderFacturas(); else renderCalendario();
  ofrecerTutorial();
}

/* Horas desde un «aaaa-mm-dd hh:mm:ss» del motor (0 si no hay fecha) y cómo decirlo */
function horasDesde(s) { return s ? (Date.now() - new Date(s.replace(' ', 'T')).getTime()) / 36e5 : 0; }
function desdeTxt(s) { const d = s.slice(0, 10); return (d === hoyLocal() ? 'las ' : 'el ' + fDia(d) + ' a las ') + s.slice(11, 16); }

function renderAvisos() {
  const h = [];
  // El motor no ha podido leer las plataformas hace rato: lo que se ve puede ser viejo
  if (!sinConexion && horasDesde(D.ultimaSync) >= 1) h.push('<div class="aviso mal"><b>⚠️ Puede que no esté al día</b>La app no ha podido comprobar Booking, Airbnb y Vrbo desde ' + esc(desdeTxt(D.ultimaSync)) +
    '. Toca ↻ para probar ahora' + (D.admin ? '. Si sigue igual, mira «Ejecuciones» del motor en script.google.com.' : '. Si sigue igual, avisa al administrador.') + '</div>');
  // El lector de correos no da señales (solo lo ve el administrador, que es quien puede arreglarlo)
  if (D.admin && horasDesde(D.correosVivo) >= 3) h.push('<div class="aviso"><b>El lector de correos no da señales</b>Desde ' + esc(desdeTxt(D.correosVivo)) +
    '. Los cierres nuevos de Booking se quedan «Esperando el correo». Mira «Ejecuciones» del motor de facturas (cuenta del negocio).</div>');
  const porId = {}; D.reservas.forEach(r => { porId[r.id] = r; });
  D.solapes.forEach(p => {
    const a = porId[p[0]], b = porId[p[1]];
    if (!a || !b) return;
    // Noches que se pisan (el día que uno sale y otro entra no cuenta)
    const ini = a.entrada > b.entrada ? a.entrada : b.entrada, fin = a.salida < b.salida ? a.salida : b.salida;
    const n = noches(ini, fin), falta = noches(D.hoy, ini);
    const cuando = falta <= 0 ? 'Es ya: ¡hoy hay dos reservas!' : falta === 1 ? 'Empieza mañana' : 'Empieza en ' + falta + ' días';
    const linea = r => '<button class="mini ' + clase(r) + '" data-id="' + esc(r.id) + '" style="margin-top:6px"><span class="pill">' + esc(etiqueta(r)) + '</span><span class="q">' + (r.dudoso ? 'Hasta ' + esc(fCorta(r.salida)) : esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida))) + '<small>' + esc(r.nombre || (r.tipo === 'Bloqueo' ? 'Fechas cerradas' : 'Reserva')) + '</small></span></button>';
    h.push('<div class="aviso mal"><b>🚨 Doble reserva · ' + esc(a.apt) + '</b>' +
      'Coinciden ' + (n === 1 ? 'la noche del ' + esc(fCorta(ini)) : n + ' noches: del ' + esc(fCorta(ini)) + ' al ' + esc(fCorta(fin))) + '. ' + esc(cuando) + '.' +
      linea(a) + linea(b) +
      '<div style="margin-top:8px;color:var(--muted);font-size:14px">Entra en las plataformas y cancela o mueve una de las dos cuanto antes.</div></div>');
  });
  // Partes de viajeros que ya deberían estar hechos (entraron antes de hoy)
  const atrasados = D.reservas.filter(r => r.partePend && r.entrada < D.hoy).sort((a, b) => a.entrada.localeCompare(b.entrada));
  if (atrasados.length) h.push('<div class="aviso"><b>📋 ' + (atrasados.length === 1 ? 'Un parte de viajeros sin hacer' : atrasados.length + ' partes de viajeros sin hacer') + '</b>' +
    'Son obligatorios en SES.Hospedajes en las 24 h siguientes a la entrada. Cuando esté hecho, márcalo en la reserva.' + atrasados.map(r => miniTarjeta(r, 'Entró')).join('') + '</div>');
  const malas = D.fuentes.filter(f => f.tieneUrl && !f.ok && f.error && !f.provisional);
  if (malas.length) h.push('<div class="aviso mal"><b>No se puede leer ' + (malas.length === 1 ? 'un calendario' : malas.length + ' calendarios') + '</b>' + malas.map(f => esc(f.plat + ' · ' + f.apt)).join('<br>') + '<br><span style="color:var(--muted)">Sus reservas pueden no estar al día.</span></div>');
  const faltan = D.fuentes.filter(f => !f.tieneUrl);
  if (faltan.length && D.admin) h.push('<div class="aviso"><b>Faltan ' + faltan.length + ' calendarios por conectar</b><button class="btn" style="margin-top:8px;width:100%" data-accion="calendarios">Conectar calendarios</button></div>');
  $('#avisos').innerHTML = h.join('');
}

/* El día que entra esta reserva sale otra del mismo apartamento: la limpieza tiene que caber entre medias */
function diaDeCambio(r) { return !esCierre(r) && D.reservas.some(x => x !== r && x.apt === r.apt && x.salida === r.entrada && !esCierre(x)); }

function tarjeta(r) {
  const hoy = D.hoy, man = sumar(hoy, 1);
  let tag = '';
  const dud = r.dudoso && r.entrada <= hoy;   // la plataforma no enseña cuándo entró
  if (dud) tag = r.salida === hoy ? 'Sale hoy' : r.salida === man ? 'Sale mañana' : 'Sale ' + fDia(r.salida);
  else if (r.entrada === hoy) tag = 'Entra hoy';
  else if (r.salida === hoy) tag = 'Sale hoy';
  else if (r.entrada === man) tag = 'Entra mañana';
  else if (r.salida === man) tag = 'Sale mañana';
  else if (r.entrada < hoy && r.salida > hoy) tag = 'Sale ' + fDia(r.salida);
  else { const n = noches(hoy, r.entrada); if (n <= 30) tag = 'En ' + n + ' días'; }
  const datos = [];
  if (r.nombre) datos.push(esc(r.nombre));
  if (r.tel4) datos.push('📞 …' + esc(r.tel4));
  if (r.numPlat && !esCierre(r)) datos.push('nº ' + esc(r.numPlat));
  return '<button class="card ' + clase(r) + (enChoque(r.id) ? ' choque' : '') + '" data-id="' + esc(r.id) + '">' +
    '<div class="card-top"><span class="pill">' + esc(pillTxt(r)) + '</span><span class="apt" data-corto="' + esc(nombreCorto(r.apt)) + '">' + esc(r.apt) + '</span>' +
    ((r.nueva || tag) ? '<span class="tags">' + (r.nueva ? '<span class="tag nueva">Nueva</span>' : '') + (tag ? '<span class="tag">' + esc(tag) + '</span>' : '') + '</span>' : '') + '</div>' +
    (dud ? '<div class="fechas">Hasta ' + esc(fCorta(r.salida)) + ' <span class="n">· entró hoy o antes</span></div>'
      : '<div class="fechas">' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + ' <span class="n">· ' + nTxt(noches(r.entrada, r.salida)) + '</span></div>') +
    (datos.length ? '<div class="quien">' + datos.join(' · ') + '</div>' : '') +
    (r.notas ? '<div class="nota">📝 ' + esc(r.notas) + '</div>' : '') +
    (diaDeCambio(r) && r.entrada >= hoy ? '<div class="quien" style="font-size:13px">🔄 Día de cambio: ese día sale otro huésped</div>' : '') +
    (r.partePend ? '<div class="quien" style="font-size:13px;color:var(--warn);font-weight:700">📋 Parte de viajeros pendiente</div>' : '') +
    (r.cancelCorreo ? '<div class="quien vacio" style="font-size:13px;color:var(--bad)">Cancelada (aviso del ' + esc(fDia(r.cancelCorreo)) + '). Si no hay nadie, abre las fechas.</div>'
      : r.marca === 'cerrado' ? '<div class="quien vacio" style="font-size:13px">Fechas cerradas a mano (no es reserva)</div>'
      : r.aclarar === 'ambiguo' && !r.marca ? '<div class="quien vacio" style="font-size:13px">¿Reserva o cerrado? Tócala para aclararlo</div>'
      : (r.aclarar === 'antiguo' || r.aclarar === 'quitada') && !r.marca ? '<div class="quien vacio" style="font-size:13px">Sin aclarar: ¿reserva o cerrado?</div>'
      : r.aclarar === 'pendiente' && !r.marca ? '<div class="quien vacio" style="font-size:13px">Esperando el correo de Booking</div>' : '') +
    (enChoque(r.id) ? '<div class="alerta-txt" style="color:var(--bad)">🚨 Doble reserva: coincide con otra</div>' : '') +
    '</button>';
}

/* Buscar por huésped, nº de reserva, código, teléfono o nota (en todas las reservas guardadas, también las pasadas) */
function sinAcentos(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function coincide(r, q) {
  const t = sinAcentos(q).trim(), dig = q.replace(/\D/g, '');
  if (sinAcentos([r.nombre, r.numPlat, r.codigo, r.notas, r.factura].join(' ')).indexOf(t) >= 0) return true;
  return dig.length >= 4 && [r.tel, r.numPlat, r.codigo, r.tel4].some(x => String(x || '').replace(/\D/g, '').indexOf(dig) >= 0);
}
function renderBusqueda() {
  const q = busqueda.trim();
  const rs = D.reservas.filter(r => (filtro === 'todos' || r.apt === filtro) && coincide(r, q)).sort((a, b) => b.entrada.localeCompare(a.entrada)).slice(0, 50);
  $('#vista').innerHTML = rs.length
    ? '<div class="grupo">' + rs.length + (rs.length === 1 ? ' resultado' : ' resultados') + '</div>' + rs.map(tarjeta).join('')
    : '<div class="vacio-lista"><b>Nada con «' + esc(q) + '»</b>Busca por nombre del huésped, nº de reserva, teléfono o lo escrito en una nota.</div>';
  ajustarNombres();
}

/* Lo que hay que hacer hoy: limpiar lo que queda libre, recibir a los que llegan y su parte de viajeros */
function tareasDeHoy(rs) {
  const hoy = D.hoy, t = [];
  const reales = rs.filter(r => !esCierre(r) && !sinAclarar(r));
  reales.forEach(r => {
    if (r.salida !== hoy) return;
    const entra = reales.find(x => x !== r && x.apt === r.apt && x.entrada === hoy && !x.dudoso);
    t.push({ r, k: 'limpio', hecho: !!r.limpio, txt: '🧹 Limpiar ' + r.apt,
      sub: (r.nombre ? 'Sale ' + r.nombre : 'Salen los huéspedes') + (entra ? ' · hoy entra ' + (entra.nombre || 'otro huésped') : '') });
  });
  reales.forEach(r => {
    if (r.entrada !== hoy || r.dudoso) return;
    t.push({ r, k: 'recibido', hecho: !!r.recibido, txt: '🔑 Recibir a ' + (r.nombre || 'los huéspedes'), sub: r.apt });
    if (r.llevaParte) t.push({ r, k: 'parte', hecho: !!r.parte, txt: '📋 Parte de viajeros' + (r.nombre ? ' de ' + r.nombre : ''), sub: 'En SES.Hospedajes · ' + r.apt });
  });
  return t;
}
function bloqueTareas(rs) {
  const t = tareasDeHoy(rs);
  if (!t.length) return '';
  const hechas = t.filter(x => x.hecho).length;
  return '<div class="grupo">Para hoy · ' + (hechas === t.length ? '✅ todo hecho' : hechas + ' de ' + t.length + ' hecho') + '</div>' +
    t.map(x => '<button class="tarea' + (x.hecho ? ' hecha' : '') + '" data-tarea="' + x.k + '" data-tid="' + esc(x.r.id) + '" aria-pressed="' + x.hecho + '">' +
      '<span class="caja" aria-hidden="true">✓</span><span class="t"><span class="tt">' + esc(x.txt) + '</span><small>' + esc(x.sub) + '</small></span></button>').join('');
}
async function marcarTarea(b) {
  const r = D.reservas.find(x => x.id === b.dataset.tid), k = b.dataset.tarea;
  if (!r || b.disabled) return;
  const hecho = !r[k];
  b.disabled = true; b.classList.toggle('hecha', hecho);   // se ve marcada al momento; si falla, vuelve como estaba
  try {
    D = await api(k === 'parte' ? 'parte' : 'tarea', k === 'parte' ? { id: r.id, hecho } : { id: r.id, tarea: k, hecho });
    guardar('nv-datos', D); render();
    toast(hecho ? '✅ Marcado como hecho' : 'Desmarcado', r.id);
  } catch (e) { toast(msgError(e)); render(); }
}

function renderProximas() {
  if (busqueda.trim().length >= 2) { renderBusqueda(); return; }
  const hoy = D.hoy, man = sumar(hoy, 1), sem = sumar(hoy, 7);
  const rs = D.reservas.filter(r => r.salida >= hoy && (filtro === 'todos' || r.apt === filtro))
    .sort((a, b) => (a.entrada + a.apt).localeCompare(b.entrada + b.apt));
  const grupos = [
    ['Hoy', rs.filter(r => (r.entrada === hoy && !r.dudoso) || r.salida === hoy)],
    ['Ahora alojados', rs.filter(r => (r.entrada < hoy || (r.dudoso && r.entrada === hoy)) && r.salida > hoy)],
    ['Mañana', rs.filter(r => r.entrada === man)],
    ['Próximos 7 días', rs.filter(r => r.entrada > man && r.entrada <= sem)],
    ['Más adelante', rs.filter(r => r.entrada > sem)],
  ];
  let h = bloqueTareas(rs);
  grupos.forEach(g => { if (g[1].length) h += '<div class="grupo">' + g[0] + '</div>' + g[1].map(tarjeta).join(''); });
  $('#vista').innerHTML = h || '<div class="vacio-lista"><b>No hay reservas próximas</b>Cuando entre una en Booking, Airbnb o Vrbo aparecerá aquí.</div>';
  ajustarNombres();
}

function renderCalendario() {
  if (!mes) mes = D.hoy.slice(0, 7);
  const p = mes.split('-').map(Number);
  const primero = mes + '-01';
  const desfase = (dow(primero) + 6) % 7;
  const diasMes = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  const semanas = Math.ceil((desfase + diasMes) / 7);
  const inicio = sumar(primero, -desfase);
  const apts = filtro === 'todos' ? D.apartamentos : [filtro];
  const ocup = {}; apts.forEach(a => { ocup[a] = {}; });
  D.reservas.forEach(r => { if (!ocup[r.apt]) return; for (let d = r.entrada; d < r.salida; d = sumar(d, 1)) if (!ocup[r.apt][d]) ocup[r.apt][d] = r; });
  if (!diaSel || diaSel.slice(0, 7) !== mes) diaSel = D.hoy.slice(0, 7) === mes ? D.hoy : primero;

  let h = '<div class="mes"><button class="icon-btn" data-mes="-1" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
    '<h2>' + MES_L[p[1] - 1] + ' ' + p[0] + '</h2>' +
    '<button class="icon-btn" data-mes="1" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></button></div>';
  h += '<div class="leyenda">' + PLATS.map(x => '<span class="p-' + x + '"><i></i>' + x + '</span>').join('') + '<span class="p-Directa"><i></i>Externa</span><span class="p-Smartbox"><i></i>Smartbox</span><span class="p-Bloqueo"><i></i>Cerrado</span></div>';
  if (apts.length > 1) h += '<div class="carriles">Cada día: ' + apts.map((a, i) => (i === 0 ? 'arriba ' : 'abajo ') + '<b>' + esc(a) + '</b>').join(' · ') + '</div>';
  // Noches con doble reserva (por apartamento)
  const choque = {};
  const porId = {}; D.reservas.forEach(r => { porId[r.id] = r; });
  D.solapes.forEach(p => {
    const a = porId[p[0]], b = porId[p[1]]; if (!a || !b) return;
    const ini = a.entrada > b.entrada ? a.entrada : b.entrada, fin = a.salida < b.salida ? a.salida : b.salida;
    for (let n = ini; n < fin; n = sumar(n, 1)) choque[a.apt + '|' + n] = true;
  });
  h += '<div class="grid">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => '<div class="dsem">' + x + '</div>').join('');
  for (let i = 0; i < semanas * 7; i++) {
    const d = sumar(inicio, i);
    const cls = ['dia'];
    if (d.slice(0, 7) !== mes) cls.push('fuera');
    if (i % 7 >= 5) cls.push('finde');
    if (d === D.hoy) cls.push('hoy');
    if (d === diaSel) cls.push('sel');
    if (apts.some(a => choque[a + '|' + d])) cls.push('conflicto');
    h += '<button class="' + cls.join(' ') + '" data-dia="' + d + '"><span class="num">' + Number(d.slice(8)) + '</span>';
    apts.forEach(a => {
      const r = ocup[a][d];
      h += '<span class="carril">' + (r ? '<i class="barra ' + clase(r) + (r.entrada === d && !r.dudoso ? ' ini' : '') + (sumar(d, 1) === r.salida ? ' fin' : '') + '"></i>' : '') + '</span>';
    });
    h += '</button>';
  }
  h += '</div>';

  const fl = fLarga(diaSel);
  h += '<div class="detalle"><h3>' + fl.charAt(0).toUpperCase() + fl.slice(1) + '</h3>';
  apts.forEach(a => {
    const r = ocup[a][diaSel];
    const sale = D.reservas.find(x => x.apt === a && x.salida === diaSel);
    h += '<div class="dfila"><div class="dapt">' + esc(a) + '</div>';
    if (sale && (!r || r.id !== sale.id)) h += miniTarjeta(sale, 'Sale');
    if (choque[a + '|' + diaSel]) h += '<div class="alerta-txt" style="color:var(--bad)">🚨 Doble reserva esta noche</div>';
    if (r) h += miniTarjeta(r, r.entrada === diaSel && !r.dudoso ? 'Entra' : 'Ocupado');
    if (!r) h += '<div class="libre" style="margin-top:4px">Libre esta noche</div>';
    h += '</div>';
  });
  h += '</div>';
  $('#vista').innerHTML = h;
}

function miniTarjeta(r, txt) {
  const q = esCierre(r) ? 'Fechas cerradas' : (r.nombre || 'Reserva');
  return '<button class="mini ' + clase(r) + '" data-id="' + esc(r.id) + '"><span class="pill">' + esc(etiqueta(r)) + '</span>' +
    '<span class="q">' + esc(q) + '<small>' + esc(txt) + ' · ' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + '</small></span></button>';
}

/* Por qué la app dice lo que dice de un cierre de Booking */
function explicaBooking(r) {
  const m = r.marcaPor || '';
  if (r.marca && !autoMarca(r)) return 'El calendario de Booking marca igual una reserva y unas fechas cerradas a mano. Esto lo marcó una persona.';
  if (m === 'auto:correo de Booking') return '✉️ Llegó el correo de Booking «Nueva reserva»' + (r.numPlat ? ' (nº ' + esc(r.numPlat) + ')' : '') + ' para esta fecha: es una reserva de Booking.';
  if (m === 'auto:correo de Smartbox' || m === 'correo de Smartbox') return '✉️ Llegó el correo de Smartbox con estas fechas: es una reserva de Smartbox.';
  if (m === 'reparación') return 'Salía rayado en las capturas del calendario de Booking: cerrado a mano (o una reserva de otra plataforma).';
  if (m === 'auto:sin correo') return 'No llegó ningún correo de reserva de Booking ni de Smartbox para estas fechas: son fechas cerradas a mano.';
  if (r.aclarar === 'pendiente') return '⏳ Acaba de aparecer en el calendario de Booking. Si en unas horas no llega el correo de «Nueva reserva», la app lo dará por cerrado a mano.';
  if (r.aclarar === 'ambiguo') {
    const a = r.ambiguo || '';
    if (/^Smartbox \d/.test(a)) return '❓ Hay un correo de Smartbox para estas fechas (' + esc(a.replace(/^Smartbox /, '')) + '), pero no dice de qué apartamento es y están cerradas en los dos. Márcalo como «Es de Smartbox» en el que sea.';
    if (/^Booking [\d, /]+$/.test(a)) return '❓ Hay un correo de reserva de Booking para este día (' + esc(a) + '), pero Booking no dice de qué apartamento es y hay cierres en los dos. Míralo en Booking y márcalo.';
    return '❓ ' + esc(a) + ' La app no lo puede saber sola: míralo en Booking y márcalo.';
  }
  if (r.aclarar === 'quitada') return 'Se quitó la marca a mano, así que la app ya no lo decide sola. Márcalo cuando sepas qué es.';
  if (r.aclarar === 'antiguo') return 'Es de antes de que los avisos de Booking llegaran al correo del negocio, así que la app no puede saber qué es. Míralo en Booking (amarillo = reserva, rayado = cerrado) y márcalo.';
  return 'El calendario de Booking marca igual una reserva y unas fechas cerradas a mano. Si no es lo que dice la app, márcalo aquí.';
}

/* ---------- Detalle de una reserva (solo consulta) ---------- */
function abrirReserva(id) {
  const r = D.reservas.find(x => x.id === id);
  if (!r) return;
  const n = noches(r.entrada, r.salida);
  let h = '<div class="hoja-top ' + clase(r) + '"><span class="pill">' + esc(etiqueta(r)) + '</span><span class="apt">' + esc(r.apt) + '</span></div>' +
    '<h2>' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + '</h2>' +
    '<div class="detalle" style="margin-top:12px">' +
    (r.dudoso && r.entrada <= D.hoy
      ? '<div class="dato"><span>Entrada</span><b>' + esc(fLarga(r.entrada)) + ' o antes</b></div>'
      : '<div class="dato"><span>Entrada</span><b>' + esc(fLarga(r.entrada)) + '</b></div>') +
    '<div class="dato"><span>Salida</span><b>' + esc(fLarga(r.salida)) + '</b></div>' +
    '<div class="dato"><span>Noches</span><b>' + (r.dudoso ? 'al menos ' + n : n) + '</b></div>' +
    (r.cancelCorreo ? '<div class="dato"><span>Qué es</span><b>Reserva cancelada (aviso del ' + esc(fDia(r.cancelCorreo)) + ')</b></div>'
      : r.marca === 'cerrado' ? '<div class="dato"><span>Qué es</span><b>Fechas cerradas a mano</b></div>'
      : r.marca === 'externa' ? '<div class="dato"><span>Qué es</span><b>Reserva externa (no es de Booking)</b></div>'
      : r.marca === 'smartbox' ? '<div class="dato"><span>Qué es</span><b>Reserva de Smartbox (cerrada en Booking)</b></div>'
      : '<div class="dato"><span>Plataforma</span><b>' + esc(r.plat) + '</b></div>') +
    (r.nombre ? '<div class="dato"><span>Huésped</span><b>' + esc(r.nombre) + '</b></div>' : '') +
    (r.tel ? '<div class="dato"><span>Teléfono</span><b>' + esc(r.tel) + '</b></div>'
      : r.tel4 ? '<div class="dato"><span>Teléfono</span><b>acaba en ' + esc(r.tel4) + '</b></div>' : '') +
    (r.codigo ? '<div class="dato"><span>Código</span><b>' + esc(r.codigo) + '</b></div>' : '') +
    (r.numPlat && r.numPlat !== r.codigo ? '<div class="dato"><span>Nº de reserva</span><b>' + esc(r.numPlat) + '</b></div>' : '') +
    (r.factura ? '<div class="dato"><span>Factura</span><b>' + esc(r.factura) + (r.facturaEnv ? ' · enviada' : ' · sin enviar') + '</b></div>' : '') +
    '</div>';
  // Llamar o escribir al huésped (el teléfono viene del correo o se escribe aquí)
  if (!esCierre(r)) {
    h += r.tel
      ? '<div class="enlaces"><a class="btn" href="tel:' + esc(r.tel) + '">📞 Llamar</a><a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(r.tel.replace(/\D/g, '')) + '">💬 WhatsApp</a><button class="btn" id="t-editar" aria-label="Cambiar el teléfono">✏️</button></div>'
      : '<div class="enlaces"><button class="btn" id="t-editar">📞 Añadir el teléfono del huésped</button></div>';
    h += '<div id="t-form" hidden><label class="campo">Teléfono del huésped<input id="t-tel" inputmode="tel" autocomplete="off" value="' + esc(r.tel || '') + '"></label>' +
      '<div class="hint">Con el prefijo del país, por ejemplo +34 600 123 456.' + (r.tel4 && !r.tel ? ' Acaba en ' + esc(r.tel4) + '; el número completo está en la app de ' + esc(r.plat) + '.' : r.plat === 'Booking' && !r.tel ? ' Booking no lo manda: está en la app de Booking.' : '') + '</div>' +
      '<div class="enlaces"><button class="btn" id="t-guardar">Guardar teléfono</button></div><div class="msg" id="t-msg"></div></div>';
  }
  if (!esCierre(r) && !r.dudoso && r.entrada >= D.hoy) h += '<div class="enlaces"><button class="btn" id="b-abrir">👋 Mensaje de bienvenida</button></div>';
  if (diaDeCambio(r)) h += '<div class="hint">🔄 <b>Día de cambio:</b> el día que entra sale otro huésped de este apartamento. La limpieza tiene que caber entre la salida y la entrada.</div>';
  // Parte de viajeros (SES.Hospedajes): la app solo recuerda que está pendiente
  if (r.llevaParte) {
    const quienP = r.partePor ? (r.partePor === SES.email ? 'ti' : r.partePor) : '';
    h += '<div class="detalle" style="margin-top:12px"><h3>📋 Parte de viajeros</h3>' +
      (r.parte
        ? '<div class="hint" style="margin-top:0">✅ Hecho (lo marcó ' + esc(quienP) + ' el ' + esc(r.parte.slice(8, 10) + '/' + r.parte.slice(5, 7) + ' a las ' + r.parte.slice(11, 16)) + ').</div><div class="enlaces"><button class="btn" id="p-boton">↩️ No está hecho</button></div>'
        : '<div class="hint" style="margin-top:0">' + (r.entrada > D.hoy ? 'Se hace en SES.Hospedajes cuando lleguen: en las 24 h siguientes a la entrada.' : '<b style="color:var(--warn)">Pendiente.</b> Hay que hacerlo en SES.Hospedajes en las 24 h siguientes a la entrada.') + ' Cuando esté hecho, márcalo aquí.</div>' +
          '<div class="enlaces"><button class="btn prim" id="p-boton">✅ Parte hecho</button></div>') +
      '<div class="msg" id="p-msg"></div></div>';
  }
  if (enChoque(r.id)) h += '<div class="aviso" style="margin-top:12px"><b>⚠️ Se solapa con otra reserva</b>Revísalo en las plataformas.</div>';
  if (r.cancelCorreo) h += '<div class="aviso" style="margin-top:12px"><b>❌ Cancelada</b>' + esc(canal(r)) + ' avisó por correo de que esta reserva se ha cancelado, pero el calendario aún tiene esas fechas cerradas. Si no va a venir nadie, ábrelas en ' + esc(canal(r) === 'Smartbox' ? 'Booking (y en Airbnb si también las cerraste)' : r.plat) + '.</div>';
  if (r.dudoso) h += '<div class="hint">' + esc(r.plat) + ' no enseña las noches que ya han pasado, y la app vio esta reserva por primera vez cuando ya estaba empezada: puede que entrara antes. Las fechas exactas están en ' + esc(r.plat) + '.</div>';
  if (r.plat === 'Booking' && r.tipo !== 'Bloqueo') {
    const quienM = r.marcaPor ? (r.marcaPor === SES.email ? 'ti' : r.marcaPor) : '';
    h += '<div class="detalle" style="margin-top:12px"><h3>¿Qué es esto?</h3>' +
      '<div class="hint" style="margin-top:0">' + explicaBooking(r) + '</div>' +
      '<div class="seg"><button class="' + (r.marca === 'reserva' ? 'on' : '') + '" data-marca="reserva">✅ Es una reserva de Booking</button><button class="' + (r.marca === 'externa' ? 'on' : '') + '" data-marca="externa">📞 Es una reserva externa</button><button class="' + (r.marca === 'smartbox' ? 'on' : '') + '" data-marca="smartbox">🎁 Es de Smartbox</button><button class="' + (r.marca === 'cerrado' ? 'on' : '') + '" data-marca="cerrado">🔒 Lo cerré yo</button></div>' +
      (r.marca && !autoMarca(r) ? '<div class="hint">Marcado por ' + esc(quienM) + '. Toca otra vez para quitarlo.</div>' : '') +
      (r.marca && autoMarca(r) ? '<div class="hint">Lo ha decidido la app. Si no es así, toca el botón correcto: lo que marques tú manda siempre.</div>' : '') +
      (noches(r.entrada, r.salida) > 1
        ? '<div class="hint" style="margin-top:14px"><b>¿Son dos cosas seguidas?</b> Booking junta en un bloque una reserva y unos días cerrados. Elige dónde empieza la segunda parte y sepáralas; luego marca cada una.</div>' +
          '<div class="enlaces"><select id="s-dia" class="btn" style="flex:2 1 60%">' +
          (() => { let o = ''; for (let dd = sumar(r.entrada, 1); dd < r.salida; dd = sumar(dd, 1)) o += '<option value="' + dd + '">Separar el ' + esc(fCorta(dd)) + '</option>'; return o; })() +
          '</select><button class="btn" id="s-separar" style="flex:1 1 30%">Separar</button></div>'
        : '') +
      '<div class="msg" id="m-marca"></div></div>';
  }
  if (r.plat === 'Booking' && r.marca === 'reserva' && !r.nombre) h += '<div class="hint">Booking no manda el nombre del huésped ni por calendario ni por correo: está en la app de Booking' + (r.numPlat ? ' (reserva nº ' + esc(r.numPlat) + ')' : '') + '.</div>';
  // Nota privada: se guarda en el motor, nunca en la plataforma
  const quien = r.notaPor ? (r.notaPor === SES.email ? 'ti' : r.notaPor) : '';
  h += '<label class="campo">📝 Nota privada (solo la veis vosotros)<textarea id="n-texto" maxlength="1000" placeholder="Ej.: llegan a las 23h, traen cuna, ya pagado…">' + esc(r.notas || '') + '</textarea></label>' +
    (r.notaFecha ? '<div class="hint">Escrita por ' + esc(quien) + ' el ' + esc(r.notaFecha.slice(8, 10) + '/' + r.notaFecha.slice(5, 7) + ' a las ' + r.notaFecha.slice(11, 16)) + '</div>' : '') +
    '<div class="enlaces">' + (SR ? '<button class="btn" id="n-dictar">🎤 Dictar</button>' : '') + '<button class="btn" id="n-guardar">Guardar nota</button></div>' +
    (SR ? '' : '<div class="hint">Para dictar, toca el micrófono del teclado.</div>') +
    '<div class="msg" id="n-msg"></div>';
  if (llevaFactura(r)) h += '<div class="enlaces"><button class="btn" data-factura="' + esc(r.id) + '">🧾 ' + (r.factura ? 'Factura ' + esc(r.factura) : 'Hacer la factura') + '</button></div>';
  h += '<div class="acciones">' + (r.enlace ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(r.enlace) + '">Ver en ' + esc(r.plat) + '</a>' : '') + '<button class="btn prim" id="f-cerrar">Cerrar</button></div>';
  abrirHoja(h);
  hojaId = r.id;
  const ta = $('#n-texto'), original = r.notas || '';
  if ($('#b-abrir')) $('#b-abrir').onclick = () => { if (avisoNotaSinGuardar()) return; pararDictado(); abrirBienvenida(r.id); };
  const guardarNota = async () => {
    pararDictado();
    const b = $('#n-guardar'); b.disabled = true; b.textContent = 'Guardando…';
    try { D = await api('nota', { id: r.id, texto: ta.value }); guardar('nv-datos', D); render(); toast(ta.value.trim() ? 'Nota guardada' : 'Nota borrada', r.id); abrirReserva(r.id); }
    catch (e) { $('#n-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Guardar nota'; }
  };
  $('#n-guardar').onclick = guardarNota;
  if ($('#t-editar')) $('#t-editar').onclick = () => { $('#t-form').hidden = !$('#t-form').hidden; if (!$('#t-form').hidden) $('#t-tel').focus(); };
  if ($('#t-guardar')) $('#t-guardar').onclick = async () => {
    const b = $('#t-guardar'); b.disabled = true; b.textContent = 'Guardando…';
    try { D = await api('telefono', { id: r.id, tel: $('#t-tel').value }); guardar('nv-datos', D); render(); toast($('#t-tel').value.trim() ? 'Teléfono guardado' : 'Teléfono borrado', r.id); abrirReserva(r.id); }
    catch (e) { $('#t-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Guardar teléfono'; }
  };
  if ($('#p-boton')) $('#p-boton').onclick = async () => {
    const b = $('#p-boton'); b.disabled = true;
    try { D = await api('parte', { id: r.id, hecho: !r.parte }); guardar('nv-datos', D); render(); toast(r.parte ? 'Parte desmarcado' : 'Parte marcado como hecho', r.id); abrirReserva(r.id); }
    catch (e) { $('#p-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; }
  };
  if ($('#s-separar')) $('#s-separar').onclick = async () => {
    const b = $('#s-separar'), dia = $('#s-dia').value;
    b.disabled = true; b.textContent = 'Separando…';
    try { D = await api('separar', { id: r.id, dia }); guardar('nv-datos', D); render(); toast('Separado: ahora marca cada parte'); const p1 = D.reservas.find(x => x.apt === r.apt && x.plat === r.plat && x.salida === dia && x.entrada === r.entrada); if (p1) abrirReserva(p1.id); else cerrarHoja(); }
    catch (e) { $('#m-marca').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Separar'; }
  };
  document.querySelectorAll('[data-marca]').forEach(b => {
    b.onclick = async () => {
      const marca = r.marca === b.dataset.marca ? '' : b.dataset.marca;
      document.querySelectorAll('[data-marca]').forEach(x => { x.disabled = true; });
      try { D = await api('marcar', { id: r.id, marca }); guardar('nv-datos', D); render(); toast(marca === 'cerrado' ? 'Marcado: fechas cerradas a mano' : marca === 'externa' ? 'Marcado: reserva externa' : marca === 'smartbox' ? 'Marcado: reserva de Smartbox' : marca === 'reserva' ? 'Marcado: reserva de Booking' : 'Marca quitada', r.id); abrirReserva(r.id); }
      catch (e) { $('#m-marca').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; document.querySelectorAll('[data-marca]').forEach(x => { x.disabled = false; }); }
    };
  });
  if (SR) $('#n-dictar').onclick = () => dictar(ta, $('#n-dictar'));
  // Antes de dejar la reserva con la nota cambiada y sin guardar, se avisa una vez
  let avisado = false;
  const avisoNotaSinGuardar = () => {
    if (avisado || ta.value.trim() === original.trim()) return false;
    avisado = true; $('#n-msg').innerHTML = '<div class="aviso">Has cambiado la nota y no la has guardado. Toca otra vez para salir sin guardarla.</div>';
    $('#f-cerrar').textContent = 'Cerrar sin guardar la nota'; ta.scrollIntoView({ block: 'center' });
    return true;
  };
  $('#f-cerrar').onclick = () => { pararDictado(); if (avisoNotaSinGuardar()) return; cerrarHoja(); };
}

/* ---------- Mensaje de bienvenida (v22) ----------
 * Los datos de cada apartamento se escriben en español (menú › Mensaje de bienvenida); el motor traduce
 * el texto libre y aquí se monta el mensaje en el idioma del huésped, con las frases fijas ya traducidas. */
const NEGOCIO = 'Apartamentos Nuncio Viejo';
const IDIOMAS = { es: ['Español', 'es-ES'], en: ['English', 'en-GB'], fr: ['Français', 'fr-FR'], de: ['Deutsch', 'de-DE'], it: ['Italiano', 'it-IT'], pt: ['Português', 'pt-PT'], nl: ['Nederlands', 'nl-NL'] };
const FRASES = {
  es: { hola: 'Hola, {n}:', holaSin: 'Hola:', gracias: '¡Gracias por reservar en {neg}! Le esperamos el {fecha} en el apartamento {apt}.', dir: '📍 Dirección: ', mapa: '🗺️ Cómo llegar: ',
    entrada: '🕒 Entrada a partir de las {h}.', salida: '🚪 Salida el {fecha}, antes de las {h}.', salidaSin: '🚪 Salida el {fecha}.', wifi: 'Wifi', clave: 'Contraseña', fin: 'Para cualquier cosa, escríbanos por aquí. ¡Buen viaje!' },
  en: { hola: 'Hello {n},', holaSin: 'Hello,', gracias: 'Thank you for booking with {neg}! We look forward to welcoming you on {fecha} at the {apt} apartment.', dir: '📍 Address: ', mapa: '🗺️ How to get there: ',
    entrada: '🕒 Check-in from {h}.', salida: '🚪 Check-out on {fecha}, by {h}.', salidaSin: '🚪 Check-out on {fecha}.', wifi: 'Wi-Fi', clave: 'Password', fin: 'If you need anything, just message us here. Have a good trip!' },
  fr: { hola: 'Bonjour {n},', holaSin: 'Bonjour,', gracias: 'Merci d’avoir réservé chez {neg} ! Nous vous attendons le {fecha} dans l’appartement {apt}.', dir: '📍 Adresse : ', mapa: '🗺️ Itinéraire : ',
    entrada: '🕒 Arrivée à partir de {h}.', salida: '🚪 Départ le {fecha}, avant {h}.', salidaSin: '🚪 Départ le {fecha}.', wifi: 'Wi-Fi', clave: 'Mot de passe', fin: 'Pour toute question, écrivez-nous ici. Bon voyage !' },
  de: { hola: 'Hallo {n},', holaSin: 'Hallo,', gracias: 'Vielen Dank für Ihre Buchung bei {neg}! Wir erwarten Sie am {fecha} in der Wohnung {apt}.', dir: '📍 Adresse: ', mapa: '🗺️ Anfahrt: ',
    entrada: '🕒 Check-in ab {h}.', salida: '🚪 Check-out am {fecha} bis {h}.', salidaSin: '🚪 Check-out am {fecha}.', wifi: 'WLAN', clave: 'Passwort', fin: 'Wenn Sie etwas brauchen, schreiben Sie uns einfach hier. Gute Reise!' },
  it: { hola: 'Buongiorno {n},', holaSin: 'Buongiorno,', gracias: 'Grazie per aver prenotato presso {neg}! La aspettiamo {fecha} nell’appartamento {apt}.', dir: '📍 Indirizzo: ', mapa: '🗺️ Come arrivare: ',
    entrada: '🕒 Check-in dalle {h}.', salida: '🚪 Check-out {fecha}, entro le {h}.', salidaSin: '🚪 Check-out {fecha}.', wifi: 'Wi-Fi', clave: 'Password', fin: 'Per qualsiasi cosa, ci scriva qui. Buon viaggio!' },
  pt: { hola: 'Olá, {n}!', holaSin: 'Olá!', gracias: 'Obrigado por reservar no {neg}! Esperamos por si no dia {fecha}, no apartamento {apt}.', dir: '📍 Morada: ', mapa: '🗺️ Como chegar: ',
    entrada: '🕒 Check-in a partir das {h}.', salida: '🚪 Check-out no dia {fecha}, até às {h}.', salidaSin: '🚪 Check-out no dia {fecha}.', wifi: 'Wi-Fi', clave: 'Palavra-passe', fin: 'Para qualquer coisa, escreva-nos por aqui. Boa viagem!' },
  nl: { hola: 'Hallo {n},', holaSin: 'Hallo,', gracias: 'Bedankt voor uw boeking bij {neg}! We verwachten u op {fecha} in appartement {apt}.', dir: '📍 Adres: ', mapa: '🗺️ Route: ',
    entrada: '🕒 Inchecken vanaf {h}.', salida: '🚪 Uitchecken op {fecha}, vóór {h}.', salidaSin: '🚪 Uitchecken op {fecha}.', wifi: 'Wifi', clave: 'Wachtwoord', fin: 'Heeft u iets nodig? Stuur ons hier gerust een bericht. Goede reis!' },
};
// Idioma probable por el prefijo del teléfono (se puede cambiar con un toque)
const PREFIJOS = { es: ['34', '52', '54', '56', '57', '51', '58', '53', '591', '593', '595', '598', '502', '503', '504', '505', '506', '507', '1809', '1829', '1849'],
  fr: ['33', '352', '377'], de: ['49', '43', '41', '423'], it: ['39', '378'], pt: ['351', '55'], nl: ['31', '32'] };
function idiomaDe(tel) {
  const t = String(tel || '').replace(/\D/g, '');
  if (!t) return 'es';
  let mejor = 'en', largo = 0;
  Object.keys(PREFIJOS).forEach(l => PREFIJOS[l].forEach(p => { if (t.indexOf(p) === 0 && p.length > largo) { mejor = l; largo = p.length; } }));
  return mejor;
}
function fechaEn(ymd, l) {
  try { return new Intl.DateTimeFormat(IDIOMAS[l][1], { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(ymd + 'T12:00:00Z')); }
  catch (e) { return fLarga(ymd); }
}
function rellenar(s, o) { return s.replace(/\{(\w+)\}/g, (x, k) => (o[k] == null ? '' : o[k])); }
/** El mensaje en el idioma «l» y qué partes han tenido que ir en español (no se pudieron traducir) */
function mensajeBienvenida(r, l) {
  const F = FRASES[l] || FRASES.es, b = (D.bienvenida || {})[r.apt] || {}, tr = (b.tr || {})[l] || {}, sinTraducir = [];
  const libre = k => { if (!b[k]) return ''; if (l === 'es' || tr[k]) return l === 'es' ? b[k] : tr[k]; sinTraducir.push(k); return b[k]; };
  const nom = String(r.nombre || '').trim().split(/\s+/)[0];
  const L = [nom ? rellenar(F.hola, { n: nom }) : F.holaSin, '', rellenar(F.gracias, { neg: NEGOCIO, fecha: fechaEn(r.entrada, l), apt: r.apt }), ''];
  if (b.direccion) L.push(F.dir + b.direccion);
  if (b.mapa) L.push(F.mapa + b.mapa);
  if (b.entrada) L.push(rellenar(F.entrada, { h: b.entrada }));
  L.push(rellenar(b.salida ? F.salida : F.salidaSin, { fecha: fechaEn(r.salida, l), h: b.salida }));
  const llaves = libre('llaves'); if (llaves) L.push('🔑 ' + llaves);
  if (b.wifi || b.clave) L.push('📶 ' + F.wifi + (b.wifi ? ': ' + b.wifi : '') + (b.clave ? ' · ' + F.clave + ': ' + b.clave : ''));
  const extra = libre('extra'); if (extra) L.push('ℹ️ ' + extra);
  L.push('', F.fin, '', NEGOCIO);
  return { texto: L.join('\n'), sinTraducir };
}
function bienvenidaVacia(apt) { const b = (D.bienvenida || {})[apt] || {}; return !b.direccion && !b.llaves && !b.wifi && !b.entrada; }

function abrirBienvenida(id, idioma) {
  const r = D.reservas.find(x => x.id === id);
  if (!r) return;
  const l = idioma || idiomaDe(r.tel), m = mensajeBienvenida(r, l);
  const num = r.tel ? r.tel.replace(/\D/g, '') : '';
  const enlaceWa = txt => 'https://wa.me/' + num + '?text=' + encodeURIComponent(txt);
  let h = '<h2>👋 Mensaje de bienvenida</h2><div class="hint">' + esc((r.nombre || 'Huésped') + ' · ' + r.apt + ' · entra el ' + fCorta(r.entrada)) + '</div>' +
    (bienvenidaVacia(r.apt) ? '<div class="aviso"><b>Faltan los datos de ' + esc(r.apt) + '</b>Escribe una vez la dirección, la hora de entrada, el wifi y cómo se entra: luego sale solo en cada mensaje.<button class="btn" style="margin-top:8px;width:100%" id="b-editar2">✏️ Escribirlos ahora</button></div>' : '') +
    '<div class="hint">Idioma del mensaje:</div><div class="idiomas">' +
    Object.keys(IDIOMAS).map(k => '<button class="chip' + (k === l ? ' on' : '') + '" data-idioma="' + k + '">' + esc(IDIOMAS[k][0]) + '</button>').join('') + '</div>' +
    '<label class="campo">Puedes cambiar lo que quieras antes de enviarlo<textarea id="b-texto" rows="14">' + esc(m.texto) + '</textarea></label>' +
    (m.sinTraducir.length ? '<div class="hint">⚠️ ' + (m.sinTraducir.length === 2 ? 'Cómo entrar y «algo más» van' : m.sinTraducir[0] === 'llaves' ? 'Cómo entrar va' : '«Algo más» va') + ' en español: no se pudo traducir. Vuelve a guardar los datos del apartamento para intentarlo otra vez.</div>' : '') +
    '<div class="enlaces">' + (num ? '<a class="btn prim" id="b-wa" target="_blank" rel="noopener" href="' + esc(enlaceWa(m.texto)) + '">💬 Enviar por WhatsApp</a>' : '') + '<button class="btn" id="b-copiar">📋 Copiar</button></div>' +
    (num ? '' : '<div class="hint">' + (r.plat === 'Booking' || r.plat === 'Airbnb' || r.plat === 'Vrbo' ? 'No hay teléfono: cópialo y pégalo en el chat de ' + esc(r.plat) + ' con el huésped.' : 'No hay teléfono: cópialo y pégalo donde habléis con el huésped.') + '</div>') +
    '<div class="acciones"><button class="btn" id="b-editar">✏️ Datos del apartamento</button><button class="btn prim" id="b-volver">Volver</button></div>';
  abrirHoja(h);
  const ta = $('#b-texto');
  ta.oninput = () => { if ($('#b-wa')) $('#b-wa').href = enlaceWa(ta.value); };
  document.querySelectorAll('[data-idioma]').forEach(b => { b.onclick = () => abrirBienvenida(id, b.dataset.idioma); });
  $('#b-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast('Copiado: ahora pégalo en el chat'); }
    catch (e) { ta.focus(); ta.select(); toast('Mantén el dedo sobre el texto y elige «Copiar»'); }
  };
  $('#b-editar').onclick = () => abrirDatosBienvenida(id);
  if ($('#b-editar2')) $('#b-editar2').onclick = () => abrirDatosBienvenida(id);
  $('#b-volver').onclick = () => abrirReserva(id);
}

const CAMPOS_BIENV = [
  ['direccion', 'Dirección', 'Ej.: Calle del Nuncio Viejo 1, 2º A, Toledo', 200],
  ['mapa', 'Enlace de Google Maps (si quieres)', 'https://maps.app.goo.gl/…', 300],
  ['entrada', 'Hora de entrada', '16:00', 20],
  ['salida', 'Hora de salida', '11:00', 20],
  ['wifi', 'Nombre del wifi', '', 80],
  ['clave', 'Contraseña del wifi', '', 80],
  ['llaves', 'Cómo se entra y las llaves', 'Ej.: La llave está en la caja de la puerta; el código es el 1234.', 600, true],
  ['extra', 'Algo más (si quieres)', 'Ej.: Hay aparcamiento público en la calle de al lado.', 600, true],
];
/** Los datos de cada apartamento para el mensaje (lo ve cualquiera con la app; la contraseña del wifi incluida) */
function abrirDatosBienvenida(volverA) {
  const B = D.bienvenida || {};
  let h = '<h2>👋 Datos para la bienvenida</h2><div class="hint">Escríbelo en español: al guardar se traduce solo a los otros idiomas. Lo que dejes vacío no sale en el mensaje.</div>';
  D.apartamentos.forEach((apt, i) => {
    const b = B[apt] || {};
    h += '<div class="detalle" style="margin-top:12px"><h3>' + esc(apt) + '</h3>' +
      CAMPOS_BIENV.map(c => '<label class="campo">' + esc(c[1]) + (c[4]
        ? '<textarea data-bi="' + i + '" data-k="' + c[0] + '" maxlength="' + c[3] + '" placeholder="' + esc(c[2]) + '">' + esc(b[c[0]] || '') + '</textarea>'
        : '<input data-bi="' + i + '" data-k="' + c[0] + '" maxlength="' + c[3] + '" autocomplete="off"' + (c[0] === 'mapa' ? ' inputmode="url"' : '') + ' placeholder="' + esc(c[2]) + '" value="' + esc(b[c[0]] || '') + '">') + '</label>').join('') +
      '</div>';
  });
  h += '<div class="msg" id="bd-msg"></div><div class="acciones"><button class="btn" id="bd-volver">Volver</button><button class="btn prim" id="bd-guardar">Guardar</button></div>';
  abrirHoja(h);
  const volver = () => (volverA ? abrirBienvenida(volverA) : cerrarHoja());
  $('#bd-volver').onclick = volver;
  $('#bd-guardar').onclick = async () => {
    const datos = {};
    D.apartamentos.forEach((apt, i) => { datos[apt] = {}; document.querySelectorAll('[data-bi="' + i + '"]').forEach(el => { datos[apt][el.dataset.k] = el.value; }); });
    const b = $('#bd-guardar'); b.disabled = true; b.textContent = 'Guardando y traduciendo…';
    try { D = await api('bienvenida', { datos }); guardar('nv-datos', D); toast('Datos de la bienvenida guardados'); volver(); }
    catch (e) { $('#bd-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Guardar'; }
  };
}

/* ---------- Dictado por voz (lo transcribe el propio móvil) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let rec = null;
function pararDictado() { if (rec) { try { rec.stop(); } catch (e) { /* nada */ } } }
function dictar(ta, btn) {
  if (rec) { pararDictado(); return; }
  const base = ta.value.trim() ? ta.value.trim() + ' ' : '';
  let r;
  try { r = new SR(); } catch (e) { toast('Este móvil no permite dictar aquí: usa el micrófono del teclado'); return; }
  rec = r;
  r.lang = 'es-ES'; r.continuous = true; r.interimResults = true;
  r.onresult = e => {
    let fin = '', prov = '';
    for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else prov += t; }
    let txt = (fin + prov).replace(/\s+/g, ' ').trim();
    if (txt && !base) txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    ta.value = (base + txt).slice(0, 1000);
  };
  r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Sin permiso para el micrófono: actívalo en los ajustes del móvil'); else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('No se pudo dictar (' + e.error + ')'); };
  r.onend = () => { rec = null; btn.textContent = '🎤 Dictar'; btn.classList.remove('grabando'); };
  try { r.start(); btn.textContent = '⏹ Parar'; btn.classList.add('grabando'); } catch (e) { rec = null; toast('No se pudo empezar a dictar'); }
}

/* ---------- Ocupación del mes ---------- */
function renderOcupacion() {
  // La ocupación se cuenta desde que los datos son fiables (lo marca el motor por apartamento)
  const desdeDe = a => { const x = (D.datosDesde || {})[a] || D.hoy; const lim = sumar(D.hoy, -400); return x > lim ? x : lim; };
  if (!mesOc) { const ini = D.apartamentos.map(desdeDe).sort()[0] || D.hoy; mesOc = (ini > D.hoy ? ini : D.hoy).slice(0, 7); }
  const p = mesOc.split('-').map(Number);
  const primero = mesOc + '-01', dias = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  const apts = filtro === 'todos' ? D.apartamentos : [filtro];
  let h = '<div class="mes"><button class="icon-btn" data-mesoc="-1" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
    '<h2>' + MES_L[p[1] - 1] + ' ' + p[0] + '</h2>' +
    '<button class="icon-btn" data-mesoc="1" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></button></div>';
  const tot = { ocup: 0, total: 0 };
  apts.forEach(a => {
    const desdeDatos = desdeDe(a);
    const porPlat = {}, reservasPlat = {};
    let ocup = 0, bloq = 0, sinDatos = 0, dudas = 0;
    for (let i = 0; i < dias; i++) {
      const d = sumar(primero, i);
      if (d < desdeDatos) { sinDatos++; continue; }
      const aqui = D.reservas.filter(r => r.apt === a && r.entrada <= d && d < r.salida);
      const real = aqui.find(r => !esCierre(r) && !sinAclarar(r));
      if (real) { ocup++; porPlat[canal(real)] = (porPlat[canal(real)] || 0) + 1; }
      else if (aqui.some(sinAclarar)) dudas++;
      else if (aqui.length) bloq++;
    }
    const iniCuenta = desdeDatos > primero ? desdeDatos : primero;
    D.reservas.forEach(r => { if (r.apt === a && !esCierre(r) && !sinAclarar(r) && r.entrada < sumar(primero, dias) && r.salida > iniCuenta) reservasPlat[canal(r)] = (reservasPlat[canal(r)] || 0) + 1; });
    const base = dias - sinDatos, libres = base - ocup - bloq - dudas;
    const pct = base ? Math.round(ocup * 100 / base) : 0;
    tot.ocup += ocup; tot.total += base;
    if (!base) {
      h += '<div class="detalle ocup"><div class="ocup-top"><h3>' + esc(a) + '</h3><span class="pct">—</span></div>' +
        '<div class="hint" style="margin:0">La ocupación se cuenta desde el ' + esc(fLarga(desdeDatos).replace(/^\S+ /, '')) + '.</div></div>';
      return;
    }
    h += '<div class="detalle ocup"><div class="ocup-top"><h3>' + esc(a) + '</h3><span class="pct">' + pct + '%</span></div>' +
      '<div class="hint" style="margin:0 0 8px">' + ocup + ' de ' + base + ' noches ocupadas' + (sinDatos ? ' · <b>contando desde el ' + esc(fDia(desdeDatos)) + '</b>' : '') + '</div>' +
      '<div class="barra-ocup">' + PLATS.concat(['Smartbox', 'Externa']).filter(x => porPlat[x]).map(x => '<i class="' + claseCanal(x) + '" style="width:' + (porPlat[x] * 100 / (base || 1)) + '%"></i>').join('') +
      (bloq ? '<i class="p-Bloqueo" style="width:' + (bloq * 100 / (base || 1)) + '%"></i>' : '') + '</div>' +
      Object.keys(porPlat).map(x => '<div class="dato ' + claseCanal(x) + '"><span><i class="punto"></i>' + esc(x) + '</span><b>' + nTxt(porPlat[x]) + ' · ' + reservasPlat[x] + (reservasPlat[x] === 1 ? ' reserva' : ' reservas') + '</b></div>').join('') +
      (bloq ? '<div class="dato p-Bloqueo"><span><i class="punto"></i>Bloqueadas</span><b>' + nTxt(bloq) + '</b></div>' : '') +
      (dudas ? '<div class="dato"><span><i class="punto" style="background:repeating-linear-gradient(45deg,var(--line),var(--line) 3px,transparent 3px,transparent 6px);border:1px solid var(--line)"></i>Booking sin aclarar</span><b>' + nTxt(dudas) + '</b></div>' : '') +
      '<div class="dato"><span><i class="punto" style="background:var(--line)"></i>Libres</span><b>' + nTxt(libres) + '</b></div></div>';
  });
  if (apts.length > 1 && tot.total) h += '<div class="hint" style="text-align:center">Los dos apartamentos: <b>' + Math.round(tot.ocup * 100 / tot.total) + '%</b> de ocupación</div>';
  if (mesOc >= D.hoy.slice(0, 7)) h += '<div class="hint" style="text-align:center">Cuenta lo reservado hasta hoy; puede subir con nuevas reservas.</div>';
  $('#vista').innerHTML = h;
}


/* ---------- Facturas ----------
 * Desde el 1/12/2026 cada estancia lleva factura con IVA del 10 %. La hace el motor de facturas
 * (cuenta del negocio); aquí se completa lo que falte y se envía el PDF por WhatsApp. */
const FACTURAS_DESDE = '2026-12-01';
const LIMITE_SIMPLIFICADA = 400;
const PDFS = {};   // PDF ya descargados en esta sesión: id → {pdf, archivo}
function llevaFactura(r) { return !esCierre(r) && r.salida > FACTURAS_DESDE && r.salida <= D.hoy; }
function eur(x) { const [a, b] = Number(x || 0).toFixed(2).split('.'); return a.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + b + ' €'; }
function trimestre(ymd) { return ymd.slice(0, 4) + '-T' + Math.ceil(Number(ymd.slice(5, 7)) / 3); }
const NOMBRE_TRIM = { 1: 'enero–marzo', 2: 'abril–junio', 3: 'julio–septiembre', 4: 'octubre–diciembre' };

function tarjetaFactura(r) {
  const estado = !r.factura ? (r.importe ? 'Por hacer' : 'Falta el importe') : r.facturaEnv ? 'Enviada' : 'Por enviar';
  return '<button class="card ' + clase(r) + '" data-factura="' + esc(r.id) + '">' +
    '<div class="card-top"><span class="pill">' + esc(canal(r)) + '</span><span class="apt" data-corto="' + esc(nombreCorto(r.apt)) + '">' + esc(r.apt) + '</span>' +
    '<span class="tags"><span class="tag' + (r.factura ? '' : ' nueva') + '">' + esc(estado) + '</span></span></div>' +
    '<div class="fechas">' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + ' <span class="n">· ' + nTxt(noches(r.entrada, r.salida)) + '</span></div>' +
    '<div class="quien">' + [r.nombre ? esc(r.nombre) : '', r.factura ? esc(r.factura) + ' · ' + eur(totalVigente(r)) + ((r.rectifs || []).length ? ' (rectificada)' : '') : r.importe ? eur(r.importe) : ''].filter(String).join(' · ') + '</div>' +
    '</button>';
}
/* Total de la factura después de sus rectificativas */
function totalVigente(r) { const l = r.rectifs || []; return l.length ? Number(l[l.length - 1].tn) : Number(r.facturaTotal || 0); }

function renderFacturas() {
  const rs = D.reservas.filter(r => llevaFactura(r) && (filtro === 'todos' || r.apt === filtro))
    .sort((a, b) => b.salida.localeCompare(a.salida));
  // IVA del trimestre: facturas y rectificativas con fecha en él (una rectificativa cuenta en su trimestre, con su diferencia)
  const t = trimestre(D.hoy), delTrim = [];
  D.reservas.forEach(r => {
    if (r.factura && r.facturaFecha && trimestre(r.facturaFecha) === t) delTrim.push([Number(r.facturaCuota || 0), Number(r.facturaTotal || 0)]);
    (r.rectifs || []).forEach(x => { if (x.f && trimestre(x.f) === t) delTrim.push([Number(x.c || 0), Number(x.t || 0)]); });
  });
  const cuota = delTrim.reduce((s, x) => s + x[0], 0), total = delTrim.reduce((s, x) => s + x[1], 0);
  let h = '<button class="btn tuto-ayuda-fila" data-accion="tuto" data-tema="facturas">❓ ¿Cómo se hacen las facturas?</button>' +
    '<div class="aviso" style="background:var(--card);border-left-color:var(--accent)"><b>IVA de este trimestre (' + NOMBRE_TRIM[t.slice(-1)] + ')</b>' +
    eur(cuota) + ' de IVA en ' + delTrim.length + (delTrim.length === 1 ? ' factura' : ' facturas') + ' (' + eur(total) + ' cobrados)' +
    '<div class="hint" style="margin-bottom:0">El IVA de las comisiones y los gastos se resta en el libro de facturas, en «Resumen IVA».</div></div>';
  const grupos = [
    ['Por hacer', rs.filter(r => !r.factura)],
    ['Por enviar', rs.filter(r => r.factura && !r.facturaEnv)],
    ['Enviadas', rs.filter(r => r.factura && r.facturaEnv).slice(0, 30)],
  ];
  grupos.forEach(g => { if (g[1].length) h += '<div class="grupo">' + g[0] + '</div>' + g[1].map(tarjetaFactura).join(''); });
  if (!rs.length) h += '<div class="vacio-lista"><b>No hay facturas pendientes</b>' + (D.hoy <= FACTURAS_DESDE
    ? 'Las facturas empiezan con las estancias que terminan después del 1 de diciembre de 2026.'
    : 'Cuando termine una estancia, aparecerá aquí para hacer y enviar su factura.') + '</div>';
  $('#vista').innerHTML = h;
  ajustarNombres();
}

function ayudaImporte(r) {
  if (r.marca === 'externa') return 'Lo que te pagó el huésped por el alojamiento.';
  if (r.marca === 'smartbox') return 'De Smartbox: el «Precio de la experiencia» de su correo de reserva (no lo que te ingresan, que ya lleva quitada la comisión).';
  if (r.plat === 'Booking') return 'Booking no lo manda por correo: en la extranet → Reservas → esta reserva' + (r.numPlat ? ' (nº ' + esc(r.numPlat) + ')' : '') + ', el precio total que paga el huésped.';
  if (r.plat === 'Airbnb') return 'De Airbnb: «Precio de la habitación por X noches» (sin la comisión de Airbnb).';
  if (r.plat === 'Vrbo') return 'De Vrbo: «Importe de la reserva» (sin la tasa de servicio de Vrbo).';
  return 'Lo que pagó el huésped por el alojamiento.';
}

function abrirFactura(id) {
  const r = D.reservas.find(x => x.id === id);
  if (!r) return;
  let h = '<div class="hoja-top ' + clase(r) + '"><span class="pill">' + esc(canal(r)) + '</span><span class="apt">' + esc(r.apt) + '</span></div>' +
    '<h2>🧾 ' + (r.factura ? 'Factura ' + esc(r.factura) : 'Hacer la factura') + '</h2>' +
    '<div class="detalle" style="margin-top:12px">' +
    '<div class="dato"><span>Estancia</span><b>' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + ' · ' + nTxt(noches(r.entrada, r.salida)) + '</b></div>' +
    (r.nombre ? '<div class="dato"><span>Huésped</span><b>' + esc(r.nombre) + '</b></div>' : '') +
    (r.numPlat || r.codigo ? '<div class="dato"><span>Nº reserva</span><b>' + esc(r.numPlat || r.codigo) + '</b></div>' : '') +
    (r.factura ? '<div class="dato"><span>Total</span><b>' + eur(r.facturaTotal) + ' (IVA ' + eur(r.facturaCuota) + ')</b></div>' : '') +
    (r.rectifs || []).map(x => '<div class="dato"><span>Rectificativa</span><b>' + esc(x.n) + ' · ' + (Number(x.t) > 0 ? '+' : '') + eur(x.t) + '</b></div>').join('') +
    ((r.rectifs || []).length ? '<div class="dato"><span>Total correcto</span><b>' + eur(totalVigente(r)) + '</b></div>' : '') +
    '</div>';
  const telV = r.tel || '';
  const telHint = !telV && r.tel4 ? 'Acaba en ' + esc(r.tel4) + '. El número completo está en la app de ' + esc(r.plat) + '.' : 'Con el prefijo del país, por ejemplo +34 600 123 456.';
  if (!r.factura) {
    h += '<label class="campo">Importe que pagó el huésped (IVA incluido)<input id="fa-imp" inputmode="decimal" autocomplete="off" placeholder="Ej.: 255,00" value="' + esc(r.importe ? String(r.importe).replace('.', ',') : '') + '"></label>' +
      '<div class="hint">' + ayudaImporte(r) + '</div>' +
      '<label class="campo">Teléfono del huésped (para WhatsApp)<input id="fa-tel" inputmode="tel" autocomplete="off" value="' + esc(telV) + '"></label>' +
      '<div class="hint">' + telHint + '</div>' +
      '<div id="fa-huesped" hidden><div class="hint" style="margin-top:14px"><b>Más de ' + LIMITE_SIMPLIFICADA + ' €: factura completa.</b> Son los mismos datos que pones en el parte de viajeros (SES.Hospedajes).</div>' +
      '<label class="campo">Nombre y apellidos<input id="fa-nom" autocomplete="off" value="' + esc(r.nombre || '') + '"></label>' +
      '<label class="campo">DNI, NIE o pasaporte<input id="fa-doc" autocomplete="off"></label>' +
      '<label class="campo">Domicilio (calle, número, ciudad, código postal)<textarea id="fa-dom" style="min-height:64px"></textarea></label>' +
      '<label class="campo">País<input id="fa-pais" autocomplete="off" placeholder="España"></label></div>' +
      '<div class="msg" id="fa-msg"></div>' +
      '<div class="acciones"><button class="btn" id="fa-volver">Cerrar</button><button class="btn prim" id="fa-hacer">Hacer factura</button></div>' +
      '<button class="btn tuto-ayuda-fila" style="margin-top:12px" data-accion="tuto" data-tema="facturas">❓ Ayuda con las facturas</button>';
  } else {
    const wa = telV ? 'https://wa.me/' + telV.replace(/\D/g, '') + '?text=' + encodeURIComponent('Hola' + (r.nombre ? ' ' + r.nombre.split(' ')[0] : '') + ', gracias por alojarse en Apartamentos Nuncio Viejo. Le envío la factura de su estancia.\nHello, thank you for staying with us. Here is your invoice.') : '';
    h += (telV ? '' : '<label class="campo">Teléfono del huésped (para WhatsApp)<input id="fa-tel" inputmode="tel" autocomplete="off"></label><div class="hint">' + telHint + '</div><div class="enlaces"><button class="btn" id="fa-guardatel">Guardar teléfono</button></div>') +
      '<div class="menu-lista" style="margin-top:14px">' +
      (wa ? '<a class="btn" id="fa-chat" target="_blank" rel="noopener" href="' + esc(wa) + '">1 · Abrir chat de WhatsApp</a>' : '') +
      '<button class="btn prim" id="fa-enviar">' + (wa ? '2 · ' : '') + 'Enviar la factura (PDF)</button>' +
      '<button class="btn" id="fa-marca">' + (r.facturaEnv ? '↩️ No está enviada' : '✅ Ya la he enviado') + '</button>' +
      (r.rectifs || []).map(x => '<button class="btn" data-rpdf="' + esc(x.n) + '">📄 Enviar la rectificativa ' + esc(x.n) + ' (PDF)</button>').join('') +
      '<button class="btn" id="fa-rect">✏️ Corregir o anular esta factura</button></div>' +
      (wa ? '<div class="hint">Primero abre el chat y manda el mensaje; después «Enviar la factura» y elige WhatsApp y el chat del huésped (saldrá el primero).</div>' : '') +
      '<div class="msg" id="fa-msg"></div>' +
      '<div class="acciones"><button class="btn" id="fa-volver">Cerrar</button></div>' +
      '<button class="btn tuto-ayuda-fila" style="margin-top:12px" data-accion="tuto" data-tema="facturas">❓ Ayuda con las facturas</button>';
  }
  abrirHoja(h);
  const err = e => { $('#fa-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; };
  $('#fa-volver').onclick = cerrarHoja;
  if (!r.factura) {
    const imp = $('#fa-imp'), bloque = $('#fa-huesped');
    const numImp = () => Number(imp.value.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
    const ver = () => { bloque.hidden = !(numImp() > LIMITE_SIMPLIFICADA); };
    imp.oninput = ver; ver();
    $('#fa-hacer').onclick = async () => {
      const b = $('#fa-hacer'); b.disabled = true; b.textContent = 'Haciendo factura…'; $('#fa-msg').innerHTML = '';
      try {
        const extra = { id: r.id, importe: imp.value, tel: $('#fa-tel').value };
        if (!bloque.hidden) Object.assign(extra, { nombre: $('#fa-nom').value, doc: $('#fa-doc').value, domicilio: $('#fa-dom').value, pais: $('#fa-pais').value });
        const j = await api('facturar', extra);
        PDFS[r.id] = { pdf: j.pdf, archivo: j.archivo };
        if (j.datos) { D = j.datos; guardar('nv-datos', D); render(); }
        toast('Factura ' + j.numero + ' hecha');
        abrirFactura(r.id);
      } catch (e) { err(e); b.disabled = false; b.textContent = 'Hacer factura'; }
    };
    return;
  }
  if ($('#fa-guardatel')) $('#fa-guardatel').onclick = async () => {
    const b = $('#fa-guardatel'); b.disabled = true;
    try { const j = await api('facturar', { id: r.id, tel: $('#fa-tel').value }); PDFS[r.id] = { pdf: j.pdf, archivo: j.archivo }; if (j.datos) { D = j.datos; guardar('nv-datos', D); render(); } abrirFactura(r.id); }
    catch (e) { err(e); b.disabled = false; }
  };
  $('#fa-marca').onclick = async () => {
    const b = $('#fa-marca'); b.disabled = true;
    try { D = await api('facturaEnviada', { id: r.id, enviada: !r.facturaEnv }); guardar('nv-datos', D); render(); abrirFactura(r.id); }
    catch (e) { err(e); b.disabled = false; }
  };
  // Comparte el PDF (la factura o una rectificativa) con el menú del móvil; si no se puede, lo descarga
  const enviarPdf = async (b, numero) => {
    const k = numero || r.id, txt = b.textContent; b.disabled = true; b.textContent = 'Preparando el PDF…';
    try {
      if (!PDFS[k]) { const j = await api('pdfFactura', numero ? { id: r.id, numero } : { id: r.id }); PDFS[k] = { pdf: j.pdf, archivo: j.archivo }; }
      const bin = atob(PDFS[k].pdf), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const nombre = (numero ? 'Factura rectificativa ' : 'Factura ') + PDFS[k].archivo;
      const file = new File([bytes], nombre, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: nombre });
        if (!numero && !r.facturaEnv) { D = await api('facturaEnviada', { id: r.id, enviada: true }); guardar('nv-datos', D); render(); toast('Factura enviada'); }
        abrirFactura(r.id);
      } else {
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
        toast('PDF descargado: adjúntalo en WhatsApp');
        b.disabled = false; b.textContent = txt;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') { b.disabled = false; b.textContent = txt; return; }   // canceló el menú de compartir
      err(e); b.disabled = false; b.textContent = txt;
    }
  };
  $('#fa-enviar').onclick = () => enviarPdf($('#fa-enviar'));
  document.querySelectorAll('[data-rpdf]').forEach(b => { b.onclick = () => enviarPdf(b, b.dataset.rpdf); });
  $('#fa-rect').onclick = () => abrirRectificar(r);
}

/* ---------- Factura rectificativa ----------
 * Una factura hecha no se cambia: se hace otra («rectificativa», serie aparte) que dice qué corrige y por qué. */
const MOTIVOS_RECT = ['Devolución de todo el importe (anulación)', 'Devolución de una parte del importe', 'El importe estaba mal', 'Los datos del huésped estaban mal'];
function abrirRectificar(r) {
  const vig = totalVigente(r);
  const h = '<div class="hoja-top ' + clase(r) + '"><span class="pill">' + esc(canal(r)) + '</span><span class="apt">' + esc(r.apt) + '</span></div>' +
    '<h2>✏️ Corregir la factura ' + esc(r.factura) + '</h2>' +
    '<div class="hint">Una factura ya hecha no se cambia: se hace una <b>factura rectificativa</b> (serie aparte) que dice qué se corrige y por qué. Después hay que enviársela al huésped, como la factura.</div>' +
    '<label class="campo">Motivo<select id="re-mot"><option value="" selected disabled>Elige el motivo…</option>' + MOTIVOS_RECT.map((m, i) => '<option value="' + i + '">' + esc(m) + '</option>').join('') + '</select></label>' +
    '<label class="campo">Total correcto de la factura (IVA incluido)<input id="re-tot" inputmode="decimal" autocomplete="off" value="' + esc(String(vig).replace('.', ',')) + '"></label>' +
    '<div class="hint">Ahora la factura es de ' + eur(vig) + '. Si se devuelve todo, pon 0.</div>' +
    '<div id="re-huesped" hidden><div class="hint" style="margin-top:14px"><b>Datos del huésped.</b> Lo que dejes vacío se queda como en la factura. Si la factura pasa de ' + LIMITE_SIMPLIFICADA + ' €, hacen falta el nombre, el documento y el domicilio.</div>' +
    '<label class="campo">Nombre y apellidos<input id="re-nom" autocomplete="off" value="' + esc(r.nombre || '') + '"></label>' +
    '<label class="campo">DNI, NIE o pasaporte<input id="re-doc" autocomplete="off"></label>' +
    '<label class="campo">Domicilio (calle, número, ciudad, código postal)<textarea id="re-dom" style="min-height:64px"></textarea></label>' +
    '<label class="campo">País<input id="re-pais" autocomplete="off"></label></div>' +
    '<label class="campo">Detalle (opcional, sale en la rectificativa)<input id="re-det" maxlength="120" autocomplete="off" placeholder="Ej.: avería del aire acondicionado"></label>' +
    '<div class="msg" id="re-msg"></div>' +
    '<div class="acciones"><button class="btn" id="re-volver">Volver</button><button class="btn prim" id="re-hacer">Hacer la rectificativa</button></div>';
  abrirHoja(h);
  const mot = $('#re-mot'), tot = $('#re-tot'), hue = $('#re-huesped');
  const numTot = () => Number(tot.value.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  const ver = () => { hue.hidden = !(mot.value === '3' || numTot() > LIMITE_SIMPLIFICADA); };
  mot.onchange = () => { if (mot.value === '0') tot.value = '0'; else if (mot.value === '3') tot.value = String(vig).replace('.', ','); ver(); };
  tot.oninput = ver;
  $('#re-volver').onclick = () => abrirFactura(r.id);
  $('#re-hacer').onclick = async () => {
    if (mot.value === '') { $('#re-msg').innerHTML = '<div class="aviso mal">Elige el motivo.</div>'; return; }
    const b = $('#re-hacer'); b.disabled = true; b.textContent = 'Haciendo la rectificativa…'; $('#re-msg').innerHTML = '';
    try {
      const det = $('#re-det').value.trim();
      const extra = { id: r.id, total: tot.value, motivo: MOTIVOS_RECT[Number(mot.value)] + (det ? ': ' + det : '') };
      if (!hue.hidden) Object.assign(extra, { nombre: $('#re-nom').value, doc: $('#re-doc').value, domicilio: $('#re-dom').value, pais: $('#re-pais').value });
      const j = await api('rectificar', extra);
      PDFS[j.numero] = { pdf: j.pdf, archivo: j.archivo };
      if (j.datos) { D = j.datos; guardar('nv-datos', D); render(); }
      toast('Rectificativa ' + j.numero + ' hecha: ahora envíasela al huésped');
      abrirFactura(r.id);
    } catch (e) { $('#re-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Hacer la rectificativa'; }
  };
}

/* ---------- Menú ---------- */
function abrirMenu() {
  let h = '<h2>Menú</h2><div class="hint">Has entrado como <b>' + esc(SES.email) + '</b></div><div class="menu-lista">';
  if (SES.admin) h += '<button class="btn" id="m-cal">Calendarios de las plataformas</button><button class="btn" id="m-disp">Dispositivos conectados</button><button class="btn" id="m-reg">Registro de actividad</button>';
  h += '<button class="btn" id="m-ayuda">❓ Ayuda: cómo funciona la app</button><button class="btn" id="m-bienv">👋 Mensaje de bienvenida</button><button class="btn peligro" id="m-salir">Cerrar sesión en este móvil</button><button class="btn prim" id="m-cerrar">Volver</button></div><div class="msg" id="m-msg"></div>';
  abrirHoja(h);
  if (SES.admin) { $('#m-cal').onclick = abrirCalendarios; $('#m-disp').onclick = abrirDispositivos; $('#m-reg').onclick = () => abrirRegistro(); }
  $('#m-cerrar').onclick = cerrarHoja;
  $('#m-bienv').onclick = () => abrirDatosBienvenida();
  $('#m-ayuda').onclick = () => { cerrarHoja(); abrirTutorial(); };
  $('#m-salir').onclick = async () => { try { await llamar({ accion: 'salir', token: SES.token }); } catch (e) { /* nada */ } salirLocal(); };
}

/* ---------- Dispositivos conectados (solo administrador) ---------- */
function fFecha(t) { return t ? t.slice(8, 10) + '/' + t.slice(5, 7) + '/' + t.slice(0, 4) + ' ' + t.slice(11, 16) : ''; }
async function abrirDispositivos(lista) {
  if (!Array.isArray(lista)) {
    abrirHoja('<h2>Dispositivos conectados</h2><div class="cargando">Cargando…</div>');
    try { lista = (await api('dispositivos')).dispositivos; } catch (e) { abrirHoja('<h2>Dispositivos conectados</h2><div class="aviso mal">' + esc(msgError(e)) + '</div><div class="acciones"><button class="btn prim" id="d-cerrar">Cerrar</button></div>'); $('#d-cerrar').onclick = cerrarHoja; return; }
  }
  let h = '<h2>Dispositivos conectados</h2><div class="hint">Móviles y navegadores que han entrado con código. Si alguno no lo reconoces, expúlsalo: tendrá que volver a pedir código.</div>';
  lista.forEach(x => {
    h += '<div class="detalle"><div class="dato"><span>Dispositivo</span><b>' + esc(x.dispositivo) + (x.actual ? ' · <span style="color:var(--ok)">este</span>' : '') + '</b></div>' +
      '<div class="dato"><span>Email</span><b>' + esc(x.email) + '</b></div>' +
      '<div class="dato"><span>Entró</span><b>' + esc(fFecha(x.creada)) + '</b></div>' +
      '<div class="dato"><span>Último uso</span><b>' + esc(fFecha(x.uso)) + '</b></div>' +
      (x.actual ? '' : '<button class="btn peligro" style="width:100%;margin-top:8px" data-expulsar="' + esc(x.id) + '">Expulsar</button>') + '</div>';
  });
  h += '<div class="msg" id="d-msg"></div><div class="acciones"><button class="btn prim" id="d-cerrar">Cerrar</button></div>';
  abrirHoja(h);
  $('#d-cerrar').onclick = cerrarHoja;
  document.querySelectorAll('[data-expulsar]').forEach(b => {
    b.onclick = async () => {
      if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.textContent = '¿Seguro? Toca otra vez para expulsar'; return; }
      b.disabled = true; b.textContent = 'Expulsando…';
      try { abrirDispositivos((await api('expulsar', { id: b.dataset.expulsar })).dispositivos); toast('Expulsado'); }
      catch (e) { $('#d-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Expulsar'; }
    };
  });
}

/* ---------- Registro de actividad (solo administrador) ---------- */
const TIPOS_REG = {
  entrada: ['🔑', 'Entró con código'],
  abre: ['📱', 'Abrió la app'],
  salida: ['🚪', 'Cerró sesión'],
  fallo: ['⚠️', 'Código incorrecto'],
  bloqueado: ['⛔', 'Código anulado tras 5 fallos'],
  no_autorizado: ['🚫', 'Pidió código un email sin acceso'],
  no_autorizado_codigo: ['🚫', 'Intentó entrar un email sin acceso'],
  token_invalido: ['🚫', 'Intento con una sesión no válida o caducada'],
  sin_permiso: ['🚫', 'Intentó usar una función de administrador'],
  peticion_rara: ['🚫', 'Petición desconocida al motor'],
  limite: ['⚠️', 'Demasiadas peticiones de código seguidas'],
  caducado: ['⚠️', 'Usó un código caducado'],
  expulsado: ['✖️', 'Expulsado'],
  caducada: ['⌛', 'Sesión caducada por no usarla'],
  todas_cerradas: ['🔒', 'Se cerraron todas las sesiones'],
  nota: ['📝', 'Escribió una nota'],
  nota_borrada: ['📝', 'Borró una nota'],
  factura: ['🧾', 'Hizo una factura'],
  factura_enviada: ['🧾', 'Marcó una factura como enviada'],
  factura_no_enviada: ['🧾', 'Desmarcó una factura como enviada'],
  clave_facturas: ['🚫', 'Intento de pasar datos de facturas sin la clave'],
  calendario_mal: ['⚠️', 'Un calendario no se puede leer (aviso enviado)'],
  calendario_ok: ['✅', 'Calendario arreglado'],
  motor_parado: ['⚠️', 'La app no lee las plataformas (aviso enviado)'],
  motor_ok: ['✅', 'La app vuelve a leer las plataformas'],
  correos_parado: ['⚠️', 'El lector de correos no da señales (aviso enviado)'],
  correos_ok: ['✅', 'El lector de correos vuelve a funcionar'],
  espacio_parado: ['⚠️', 'El motor se está llenando (aviso enviado)'],
  espacio_ok: ['✅', 'Vuelve a haber espacio en el motor'],
  copia: ['💾', 'Copia de seguridad enviada por email'],
  restaurada: ['💾', 'Se recuperó una copia de seguridad'],
  telefono: ['📞', 'Guardó el teléfono de un huésped'],
  telefono_borrado: ['📞', 'Borró el teléfono de un huésped'],
  parte: ['📋', 'Marcó un parte de viajeros como hecho'],
  parte_quitado: ['📋', 'Desmarcó un parte de viajeros'],
  rectificativa: ['🧾', 'Hizo una factura rectificativa'],
  limpieza: ['🧹', 'Marcó una limpieza como hecha'],
  limpieza_quitada: ['🧹', 'Desmarcó una limpieza'],
  recibido: ['🔑', 'Marcó la llegada de un huésped'],
  recibido_quitado: ['🔑', 'Desmarcó la llegada de un huésped'],
  bienvenida: ['👋', 'Cambió los datos del mensaje de bienvenida'],
  deshecho_nota: ['↩️', 'Deshizo el cambio de una nota'],
  deshecho_telefono: ['↩️', 'Deshizo el cambio de un teléfono'],
  deshecho_parte: ['↩️', 'Deshizo lo marcado en un parte de viajeros'],
  deshecho_marca: ['↩️', 'Deshizo una marca de Booking'],
  deshecho_limpio: ['↩️', 'Deshizo lo marcado en una limpieza'],
  deshecho_recibido: ['↩️', 'Deshizo lo marcado en una llegada'],
  marca_cerrado: ['🔒', 'Marcó unas fechas de Booking como cerradas a mano'],
  marca_reserva: ['✅', 'Confirmó una reserva de Booking'],
  marca_externa: ['📞', 'Marcó unas fechas de Booking como reserva externa'],
  marca_smartbox: ['🎁', 'Marcó unas fechas de Booking como reserva de Smartbox'],
  separado: ['✂️', 'Separó un bloque de Booking en dos'],
  marca_quitada: ['↩️', 'Quitó una marca de Booking'],
  auto_reserva: ['✉️', 'Reserva de Booking (por su correo)'],
  auto_smartbox: ['🎁', 'Reserva de Smartbox (por su correo)'],
  auto_cerrado: ['🔒', 'Cerrado a mano (no llegó correo de reserva)'],
  auto_cancelada: ['❌', 'Cancelada (por correo)'],
  auto_ampliada: ['➕', 'Reserva de Booking ampliada (por correo)'],
  auto: ['🤖', 'Cambios automáticos'],
  bloqueado_24h: ['⛔', 'Email bloqueado 24 h por códigos mal escritos (aviso enviado)'],
  limite_dia: ['⚠️', 'Demasiados códigos pedidos hoy'],
  correo_fallo: ['⚠️', 'No se pudo enviar el código por email'],
};
let REG = null, regFiltro = 'todos';
function diaReg(t) {
  const d = t.slice(0, 10), hoy = hoyLocal();
  if (d === hoy) return 'Hoy';
  if (d === sumar(hoy, -1)) return 'Ayer';
  const f = fLarga(d); return f.charAt(0).toUpperCase() + f.slice(1);
}
async function abrirRegistro(recargar) {
  if (!REG || recargar) {
    abrirHoja('<h2>Registro de actividad</h2><div class="cargando">Cargando…</div>');
    try { REG = (await api('registro')).registro; }
    catch (e) { abrirHoja('<h2>Registro de actividad</h2><div class="aviso mal">' + esc(msgError(e)) + '</div><div class="acciones"><button class="btn prim" id="r-cerrar">Cerrar</button></div>'); $('#r-cerrar').onclick = cerrarHoja; REG = null; return; }
  }
  const emails = Array.from(new Set(REG.map(x => x.e).filter(Boolean)));
  const etiquetaFiltro = e => e === 'todos' ? 'Todos' : e === 'intentos' ? '🚫 Intentos' : esc(e);
  if (regFiltro !== 'todos' && regFiltro !== 'intentos' && emails.indexOf(regFiltro) < 0) regFiltro = 'todos';
  let h = '<h2>Registro de actividad</h2><div class="hint">Quién ha entrado y cuándo, y los intentos no autorizados (en rojo). Últimos 90 días. «Abrió la app» se apunta como mucho cada 30 minutos por móvil.</div>';
  const n24 = REG.filter(x => /no_autorizado|token_invalido|sin_permiso|peticion_rara|bloqueado/.test(x.k) && x.t >= sumar(hoyLocal(), -1)).length;
  if (n24) h += '<div class="aviso mal"><b>' + n24 + (n24 === 1 ? ' intento no autorizado' : ' intentos no autorizados') + ' desde ayer</b>Revisa las líneas en rojo.</div>';
  h += '<div class="chips" style="padding-top:6px">' + ['todos', 'intentos'].concat(emails).map(e => '<button class="chip' + (e === regFiltro ? ' on' : '') + '" data-regf="' + esc(e) + '">' + etiquetaFiltro(e) + '</button>').join('') + '</div>';
  const esIntento = x => /fallo|bloqueado|no_autorizado|token_invalido|sin_permiso|peticion_rara|limite|caducado$/.test(x.k);
  const lista = REG.filter(x => regFiltro === 'todos' || (regFiltro === 'intentos' ? esIntento(x) : x.e === regFiltro));
  if (!lista.length) h += '<div class="vacio-lista"><b>Sin actividad</b></div>';
  let dia = '';
  lista.forEach(x => {
    const dd = diaReg(x.t);
    if (dd !== dia) { if (dia) h += '</div>'; h += '<div class="grupo">' + esc(dd) + '</div><div class="detalle" style="margin-top:0;padding:4px 14px">'; dia = dd; }
    const tp = TIPOS_REG[x.k] || ['•', x.k];
    const alerta = /fallo|bloqueado|no_autorizado|expulsado|token_invalido|sin_permiso|peticion_rara|limite|caducado$|calendario_mal|_parado$/.test(x.k);
    h += '<div class="dato" style="align-items:flex-start"><span style="min-width:52px">' + esc(x.t.slice(11, 16)) + '</span><div style="flex:1;min-width:0">' +
      '<b' + (alerta ? ' style="color:var(--bad)"' : '') + '>' + tp[0] + ' ' + esc(tp[1]) + '</b>' +
      '<div style="font-size:14px;color:var(--muted);overflow-wrap:anywhere">' + esc(x.e || 'desconocido') + (x.d ? ' · ' + esc(x.d) : '') + '</div></div></div>';
  });
  if (dia) h += '</div>';
  h += '<div class="acciones"><button class="btn" id="r-act">Actualizar</button><button class="btn prim" id="r-cerrar">Cerrar</button></div>';
  abrirHoja(h);
  $('#r-cerrar').onclick = cerrarHoja;
  $('#r-act').onclick = () => abrirRegistro(true);
  document.querySelectorAll('[data-regf]').forEach(b => { b.onclick = () => { regFiltro = b.dataset.regf; abrirRegistro(); }; });
}

/* ---------- Calendarios (solo administrador) ---------- */
function abrirCalendarios() {
  if (!D || !D.admin) return;
  let h = '<h2>Calendarios</h2><div class="hint">Pega en cada uno el enlace de <b>Exportar calendario</b> de la plataforma. Solo se usan para leer las fechas; no permiten cambiar nada.</div>';
  D.fuentes.forEach((f, i) => {
    const est = !f.tieneUrl ? '<div class="est">Sin conectar</div>'
      : f.ok ? '<div class="est ok">✓ Leído · ' + (f.eventos || 0) + ((f.eventos || 0) === 1 ? ' fecha' : ' fechas') + '</div>'
      : '<div class="est mal">' + esc(f.error || 'Pendiente de comprobar') + '</div>';
    h += '<div class="cal-fila p-' + esc(f.plat) + '"><div class="tit"><span class="pill">' + esc(f.plat) + '</span>' + esc(f.apt) + '</div>' +
      '<input data-i="' + i + '" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://… (.ics)" value="' + esc(f.url || '') + '">' + est + '</div>';
  });
  h += '<div class="msg" id="f-msg"></div><div class="acciones"><button class="btn" id="c-cerrar">Cerrar</button><button class="btn prim" id="c-guardar">Guardar y comprobar</button></div>';
  abrirHoja(h);
  $('#c-cerrar').onclick = cerrarHoja;
  $('#c-guardar').onclick = async () => {
    const fuentes = D.fuentes.map((f, i) => ({ apt: f.apt, plat: f.plat, url: document.querySelector('input[data-i="' + i + '"]').value.trim() }));
    const b = $('#c-guardar'); b.disabled = true; b.textContent = 'Comprobando…';
    try { D = await api('guardarFuentes', { fuentes }); guardar('nv-datos', D); render(); abrirCalendarios(); toast('Guardado'); }
    catch (e) { $('#f-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Guardar y comprobar'; }
  };
}

/* ---------- Instalar como app ---------- */
let avisoInstalar = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  avisoInstalar = e;
  $('#instalar').innerHTML = '<div class="instalar"><p><b>Instala la app</b> para tenerla en la pantalla de inicio.</p><button class="btn prim" id="btnInstalar">Instalar</button></div>';
  $('#btnInstalar').onclick = async () => { avisoInstalar.prompt(); await avisoInstalar.userChoice; avisoInstalar = null; $('#instalar').innerHTML = ''; };
});
window.addEventListener('appinstalled', () => { $('#instalar').innerHTML = ''; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

/* ---------- Ayuda: tutorial paso a paso (v23) ----------
 * Botón «❓ Ayuda» de la cabecera. Temas con pasos cortos, letra grande y un dibujo de la pantalla
 * (con datos inventados) que señala dónde tocar. «🔊 Léemelo» lo lee en voz alta. Incluye una práctica
 * de factura de mentira: no llama al motor, no gasta número y no envía nada.
 * Solo se guarda en este móvil (localStorage «nv-tuto») si ya se ofreció y qué temas se han visto. */
const TUTO_K = 'nv-tuto';
const QUIEN_AYUDA = 'Luis';   // a quién llamar si algo no cuadra
let tuto = null;              // { cap, paso, seguido } mientras está abierta
let tutoOfrecido = false, tutoVoz = false;
const VOZ = window.speechSynthesis && window.SpeechSynthesisUtterance ? window.speechSynthesis : null;

const SVG_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4"/></svg>';
const SVG_MENU = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';

/* Piezas de los dibujos: las mismas clases que la app, pero sin datos de verdad y sin poder tocarse */
const F_ = (si, cls) => (si ? ' tuto-foco' : '') + (cls ? ' ' + cls : '');
const dDemo = (h, cls) => '<div class="tuto-demo' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + h + '</div>';
const dCab = foco => '<div class="top"><div class="tit"><h1>Reservas</h1><p class="sub' + F_(foco === 'sub') + '">Comprobado hace 5 min</p></div>' +
  '<span class="ayuda-btn' + F_(foco === 'ayuda') + '">❓ Ayuda</span><span class="icon-btn' + F_(foco === 'sync') + '">' + SVG_SYNC + '</span>' +
  '<span class="icon-btn' + F_(foco === 'menu') + '">' + SVG_MENU + '</span></div>';
const dTabs = (on, foco) => '<div class="tabs' + F_(foco === 'tabs') + '">' + ['Próximas', 'Calendario', 'Ocupación', 'Facturas']
  .map(t => '<span class="tab' + (t === on ? ' on' : '') + F_(foco === t) + '">' + t + '</span>').join('') + '</div>';
const dChips = foco => '<div class="chips' + F_(foco) + '"><span class="chip on">Los dos</span><span class="chip">Vistas a la Catedral</span><span class="chip">Patio Toledano</span></div>';
const dGrupo = t => '<div class="grupo">' + t + '</div>';
const dCard = o => '<div class="card p-' + (o.p || 'Airbnb') + F_(o.foco) + '"><div class="card-top"><span class="pill' + F_(o.fpill) + '">' + (o.pill || o.p || 'Airbnb') + '</span>' +
  '<span class="apt">' + (o.apt || 'Vistas a la Catedral') + '</span>' + (o.tag ? '<span class="tags"><span class="tag' + (o.tagN ? ' nueva' : '') + F_(o.ftag) + '">' + o.tag + '</span></span>' : '') + '</div>' +
  '<div class="fechas' + F_(o.ffechas) + '">' + (o.f || 'vie 4 dic → dom 6 dic') + ' <span class="n">· ' + (o.n || '2 noches') + '</span></div>' +
  (o.quien ? '<div class="quien' + F_(o.fquien) + '">' + o.quien + '</div>' : '') + (o.extra || '') + '</div>';
const dTarea = (txt, sub, hecha, foco) => '<div class="tarea' + (hecha ? ' hecha' : '') + F_(foco) + '"><span class="caja">✓</span><span class="t"><span class="tt">' + txt + '</span><small>' + sub + '</small></span></div>';
const dAviso = (mal, b, txt, foco) => '<div class="aviso' + (mal ? ' mal' : '') + F_(foco) + '"><b>' + b + '</b>' + txt + '</div>';
const dBtn = (txt, prim, foco) => '<span class="btn' + (prim ? ' prim' : '') + F_(foco) + '">' + txt + '</span>';
const dDato = (k, v, foco) => '<div class="dato' + F_(foco) + '"><span>' + k + '</span><b>' + v + '</b></div>';
const dBuscar = foco => '<div class="buscador"><span class="falso-input' + F_(foco) + '">🔍 Buscar huésped, nº de reserva o teléfono</span></div>';
const dToast = foco => '<div class="tuto-toast' + F_(foco) + '"><span>✅ Marcado como hecho</span><u>Deshacer</u></div>';
const dFicha = (cuerpo, cls) => '<div class="tuto-hoja' + (cls ? ' ' + cls : '') + '">' + cuerpo + '</div>';
const dCampo = (lab, val, foco, ph) => '<div class="campo' + F_(foco) + '">' + lab + '<span class="falso-input' + (val ? '' : ' ph') + '">' + (val || ph || '') + '</span></div>';
const tarjetaEjemplo = (foco) => dCard({ p: 'Airbnb', apt: 'Vistas a la Catedral', tag: 'Entra hoy', f: 'vie 4 dic → dom 6 dic', n: '2 noches', quien: 'María García · 📞 …4567', foco });
const fichaFactura = foco => dFicha('<div class="hoja-top p-Airbnb"><span class="pill">Airbnb</span><span class="apt">Vistas a la Catedral</span></div><h2>🧾 Hacer la factura</h2>' +
  dCampo('Importe que pagó el huésped (IVA incluido)', '255,00', foco === 'imp') +
  (foco === 'imp' ? '<div class="hint">De Airbnb: «Precio de la habitación por X noches» (sin la comisión de Airbnb).</div>' : '') +
  '<div class="acciones">' + dBtn('Cerrar') + dBtn('Hacer factura', true, foco === 'hacer') + '</div>');
const fichaHecha = foco => dFicha('<h2>🧾 Factura NV2026-0001</h2>' +
  '<div class="menu-lista">' + dBtn('1 · Abrir chat de WhatsApp', false, foco === 'chat') + dBtn('2 · Enviar la factura (PDF)', true, foco === 'pdf') +
  dBtn('✅ Ya la he enviado', false, foco === 'marca') + dBtn('✏️ Corregir o anular esta factura', false, foco === 'rect') + '</div>');

/* Los temas. Cada paso: t (título), x (texto, puede llevar <b>), d (dibujo). */
const TEMAS = [
  { id: 'app', ico: '🏠', t: 'Para qué sirve esta app', sub: 'Lo básico, para empezar', pasos: [
    { t: 'Todas las reservas en un solo sitio', x: 'La app mira <b>cada 15 minutos</b> Booking, Airbnb y Vrbo, y junta aquí las reservas de los dos apartamentos.<br>Ya no hace falta entrar en cada página para saber quién viene.',
      d: dDemo(dCab() + dGrupo('Próximos 7 días') + tarjetaEjemplo() + dCard({ p: 'Booking', pill: 'Booking', apt: 'Patio Toledano', tag: 'En 3 días', f: 'lun 7 dic → jue 10 dic', n: '3 noches', quien: 'nº 1234567890' }) +
        dCard({ p: 'Vrbo', pill: 'Vrbo', apt: 'Vistas a la Catedral', tag: 'En 6 días', f: 'jue 10 dic → dom 13 dic', n: '3 noches', quien: 'John Smith · 📞 …9123' })) },
    { t: 'Solo mira: no puedes romper nada', x: 'La app <b>nunca cancela, cambia ni borra</b> nada en Booking, Airbnb o Vrbo.<br>Lo que toques aquí (casillas, notas, marcas) se queda en la app.<br>Para cancelar o mover una reserva hay que hacerlo en la propia plataforma, como siempre.',
      d: dDemo('<div class="tuto-grande">🛡️</div><div class="tuto-centro">Booking · Airbnb · Vrbo<br><b>siguen igual</b> toques lo que toques aquí</div>') },
    { t: 'Para qué te va a servir', x: '<ul class="tuto-lista"><li>Ver quién <b>entra y sale</b> cada día.</li><li>Apuntar lo que ya está hecho: limpieza, llegada, parte de viajeros.</li><li><b>Llamar</b> o escribir por <b>WhatsApp</b> al huésped.</li><li>Mandar el <b>mensaje de bienvenida</b> en su idioma.</li><li>Hacer y enviar las <b>facturas</b>.</li><li>Avisarte si hay un problema, como una doble reserva.</li></ul>' },
    { t: 'Cada mañana, un email', x: 'Todos los días a las <b>8:00</b> te llega un email con el resumen: quién entra, quién sale, quién está alojado, las notas, los partes pendientes y las facturas por hacer.<br>Si solo lees ese email, ya sabes lo importante del día.',
      d: dDemo('<div class="tuto-email"><b>📧 Resumen de hoy · Reservas Nuncio Viejo</b><br>Hoy: entra María García (Vistas a la Catedral)<br>Alojados ahora: Patio Toledano<br>Mañana: sale John Smith<br>🧾 1 factura por hacer</div>') },
    { t: 'Si te equivocas, no pasa nada', x: 'Casi todo lo que marcas se puede <b>deshacer</b>: abajo sale un aviso con «Deshacer» unos segundos.<br>Y nada llega al huésped si tú no lo mandas.<br>Lo único que no se borra son las facturas, y para eso está «Corregir» (lo verás en el tema de Facturas).',
      d: dDemo(dTarea('🧹 Limpiar Vistas a la Catedral', 'Sale María García', true) + dToast(true)) },
  ] },
  { id: 'pantalla', ico: '📋', t: 'La pantalla principal', sub: 'Qué es cada cosa', pasos: [
    { t: 'Arriba del todo', x: '«<b>Comprobado hace 5 min</b>» es la última vez que la app miró las plataformas.<br>Si quieres que mire ahora mismo, toca el botón de las <b>flechas en círculo</b> (↻) y espera unos segundos.',
      d: dDemo(dCab('sync')) },
    { t: 'Los otros botones de arriba', x: '<b>❓ Ayuda</b> abre esto que estás viendo, siempre que lo necesites.<br>El de las <b>tres rayas</b> es el menú: ahí están los datos del mensaje de bienvenida y cerrar la sesión.',
      d: dDemo(dCab('ayuda')) },
    { t: 'Las cuatro pestañas', x: '<b>Próximas</b>: la lista de reservas (es la que más vas a usar).<br><b>Calendario</b>: el mes entero.<br><b>Ocupación</b>: cuánto se ha alquilado.<br><b>Facturas</b>: las facturas por hacer y enviar.<br>Toca una para cambiar.',
      d: dDemo(dTabs('Próximas', 'tabs')) },
    { t: 'Ver un solo apartamento', x: 'Con «<b>Los dos</b>» ves todo. Toca «Vistas a la Catedral» o «Patio Toledano» para ver solo ese apartamento.',
      d: dDemo(dTabs('Próximas') + dChips(true)) },
    { t: 'Cómo se lee una tarjeta', x: 'Cada reserva es una tarjeta:<br>• El <b>color</b> y la etiqueta dicen de dónde viene: <span class="tuto-c p-Booking">Booking</span> <span class="tuto-c p-Airbnb">Airbnb</span> <span class="tuto-c p-Vrbo">Vrbo</span> <span class="tuto-c p-Smartbox">Smartbox</span> <span class="tuto-c p-Directa">Externa</span>.<br>• A la derecha, <b>cuándo</b>: «Entra hoy», «Sale mañana», «En 3 días»…<br>• Debajo, las <b>fechas</b>, las noches y el huésped.',
      d: dDemo(dCard({ p: 'Airbnb', tag: 'Entra hoy', quien: 'María García · 📞 …4567', fpill: true, ftag: true, ffechas: true })) },
    { t: 'Las tarjetas grises', x: 'Las grises con <b>🔒 Cerrado</b> son fechas que cerraste tú a mano. <b>No son reservas</b>: no hay que hacer nada con ellas.',
      d: dDemo(dCard({ p: 'Bloqueo', pill: '🔒 Cerrado', apt: 'Patio Toledano', tag: 'En 5 días', f: 'mié 9 dic → jue 10 dic', n: '1 noche', extra: '<div class="quien vacio" style="font-size:13px">Fechas cerradas a mano (no es reserva)</div>', foco: true })) },
    { t: 'Ordenadas por cuándo', x: 'La lista está en grupos: <b>Hoy</b>, <b>Ahora alojados</b>, <b>Mañana</b>, <b>Próximos 7 días</b> y <b>Más adelante</b>.<br>Lo de arriba es lo más urgente.',
      d: dDemo(dGrupo('<span class="tuto-foco">Hoy</span>') + tarjetaEjemplo() + dGrupo('Ahora alojados') + dCard({ p: 'Booking', pill: 'Booking', apt: 'Patio Toledano', tag: 'Sale mañana', f: 'mar 1 dic → sáb 5 dic', n: '4 noches', quien: 'nº 1234567890' })) },
    { t: 'Buscar una reserva', x: 'Escribe en el <b>buscador</b> el nombre del huésped, el número de reserva o el teléfono. Encuentra también las reservas pasadas.',
      d: dDemo(dBuscar(true) + tarjetaEjemplo()) },
    { t: 'Para ver todo de una reserva', x: '<b>Toca la tarjeta</b>. Se abre su ficha con todos los datos. Lo vemos en el tema «Abrir una reserva».',
      d: dDemo(tarjetaEjemplo(true)) },
  ] },
  { id: 'hoy', ico: '✅', t: 'Lo de cada día: «Para hoy»', sub: 'Limpieza, llegadas y parte de viajeros', pasos: [
    { t: 'Lo que hay que hacer hoy', x: 'Los días que hay algo que hacer, arriba de «Próximas» sale «<b>Para hoy</b>» con una casilla por tarea:<br>🧹 <b>Limpiar</b> el apartamento que queda libre.<br>🔑 <b>Recibir</b> al huésped que llega.<br>📋 Hacer su <b>parte de viajeros</b>.',
      d: dDemo(dGrupo('Para hoy · 0 de 3 hecho') + dTarea('🧹 Limpiar Vistas a la Catedral', 'Sale John Smith · hoy entra María García') + dTarea('🔑 Recibir a María García', 'Vistas a la Catedral') + dTarea('📋 Parte de viajeros de María García', 'En SES.Hospedajes · Vistas a la Catedral')) },
    { t: 'Cuando esté hecho, márcalo', x: 'Toca la casilla: se pone <b>verde</b> y se tacha.<br>Lo ve todo el que tenga la app, así sabemos que está hecho <b>sin tener que llamar</b>.',
      d: dDemo(dGrupo('Para hoy · 1 de 3 hecho') + dTarea('🧹 Limpiar Vistas a la Catedral', 'Sale John Smith · hoy entra María García', true, true) + dTarea('🔑 Recibir a María García', 'Vistas a la Catedral')) },
    { t: '¿Lo marcaste sin querer?', x: 'Abajo sale un aviso con «<b>Deshacer</b>» durante unos segundos: tócalo y queda como estaba.<br>Si ya se ha ido el aviso, vuelve a tocar la casilla y se desmarca.',
      d: dDemo(dTarea('🔑 Recibir a María García', 'Vistas a la Catedral', true) + dToast(true)) },
    { t: 'El parte de viajeros', x: 'Es <b>obligatorio</b>: se hace en la web de <b>SES.Hospedajes</b> en las 24 horas siguientes a la entrada.<br>La app <b>no lo hace por ti</b>: solo te lo recuerda hasta que lo marques como hecho.<br>Si se pasa el día, sale un aviso amarillo arriba.',
      d: dDemo(dAviso(false, '📋 Un parte de viajeros sin hacer', 'Son obligatorios en SES.Hospedajes en las 24 h siguientes a la entrada. Cuando esté hecho, márcalo en la reserva.', true)) },
    { t: 'Días de cambio', x: 'Si en una tarjeta pone «<b>🔄 Día de cambio</b>», ese día sale un huésped y entra otro en el mismo apartamento.<br>La limpieza tiene que caber entre la salida y la entrada.',
      d: dDemo(dCard({ p: 'Airbnb', tag: 'Entra mañana', quien: 'María García', extra: '<div class="quien tuto-foco" style="font-size:13px">🔄 Día de cambio: ese día sale otro huésped</div>' })) },
  ] },
  { id: 'reserva', ico: '📖', t: 'Abrir una reserva', sub: 'Llamar, WhatsApp, bienvenida y notas', pasos: [
    { t: 'La ficha de la reserva', x: 'Al tocar una tarjeta se abre su <b>ficha</b>: entrada, salida, noches, plataforma, huésped, teléfono y número de reserva.',
      d: dDemo(dFicha('<div class="hoja-top p-Airbnb"><span class="pill">Airbnb</span><span class="apt">Vistas a la Catedral</span></div><h2>vie 4 dic → dom 6 dic</h2><div class="detalle tuto-foco">' +
        dDato('Entrada', 'viernes 4 de diciembre') + dDato('Salida', 'domingo 6 de diciembre') + dDato('Noches', '2') + dDato('Huésped', 'María García') + dDato('Teléfono', '+34 600 00 45 67') + '</div>')) },
    { t: 'Llamar o escribir al huésped', x: 'Toca <b>📞 Llamar</b> o <b>💬 WhatsApp</b> y el móvil lo hace solo, sin marcar el número.<br>Booking no manda el teléfono: si lo necesitas, míralo en la app de Booking y escríbelo con «Añadir el teléfono del huésped».',
      d: dDemo(dFicha('<div class="enlaces">' + dBtn('📞 Llamar', false, true) + dBtn('💬 WhatsApp', false, true) + '</div>')) },
    { t: 'El mensaje de bienvenida', x: 'Antes de que lleguen, toca <b>👋 Mensaje de bienvenida</b>: sale ya escrito, <b>en el idioma del huésped</b>, con la dirección, cómo llegar, las horas y el wifi.<br>Luego toca «<b>💬 Enviar por WhatsApp</b>», o «<b>📋 Copiar</b>» para pegarlo en el chat de Booking o Airbnb.',
      d: dDemo(dFicha(dBtn('👋 Mensaje de bienvenida', false, true) + '<div class="tuto-email" style="margin-top:10px">Hello María,<br>Thank you for booking with Apartamentos Nuncio Viejo! …<br>🗺️ How to get there: …</div>')) },
    { t: 'Los datos de la bienvenida', x: 'La dirección, las horas, el wifi y cómo se entra se escriben <b>una sola vez</b>, en español, en el <b>menú</b> (las tres rayas) → «👋 Mensaje de bienvenida». La app los traduce sola.',
      d: dDemo(dCab('menu')) },
    { t: 'Las notas', x: 'Abajo de la ficha hay una <b>nota privada</b>: «llegan a las 23 h», «traen cuna», «ya pagado»…<br>Solo la veis vosotros, <b>nunca el huésped</b>. Puedes escribirla o tocar <b>🎤 Dictar</b> y hablar. Luego toca «Guardar nota».',
      d: dDemo(dFicha(dCampo('📝 Nota privada (solo la veis vosotros)', 'Llegan tarde, sobre las 23 h', true) + '<div class="enlaces">' + dBtn('🎤 Dictar') + dBtn('Guardar nota') + '</div>')) },
    { t: 'Las de Booking: «¿Qué es esto?»', x: 'Booking enseña igual una reserva que unos días cerrados a mano. La app lo averigua sola con los correos de Booking.<br>Si no puede, te lo pregunta: toca lo que sea (<b>reserva de Booking</b>, <b>lo cerré yo</b>, <b>Smartbox</b>…). Lo que marques tú <b>manda siempre</b>.',
      d: dDemo(dFicha('<div class="detalle"><h3>¿Qué es esto?</h3><div class="seg tuto-foco"><span class="segb">✅ Es una reserva de Booking</span><span class="segb">🔒 Lo cerré yo</span><span class="segb">🎁 Es de Smartbox</span><span class="segb">Reserva externa</span></div></div>')) },
    { t: 'Para salir de la ficha', x: 'Toca <b>Cerrar</b> abajo, o toca en la parte oscura de arriba.',
      d: dDemo(dFicha('<div class="acciones">' + dBtn('Ver en Airbnb') + dBtn('Cerrar', true, true) + '</div>')) },
  ] },
  { id: 'cal', ico: '📅', t: 'Calendario y Ocupación', sub: 'Ver el mes entero', pasos: [
    { t: 'El calendario', x: 'Cada apartamento tiene una <b>raya de color</b> por reserva. <b>Toca un día</b> y debajo sale quién hay.<br>Con las flechas de arriba cambias de mes. El día de hoy está marcado con un círculo.',
      d: dDemo('<div class="mes"><span class="icon-btn">‹</span><h2>Diciembre 2026</h2><span class="icon-btn">›</span></div>' + (() => {
        const bar = (cls, p) => '<div class="carril">' + (p ? '<i class="barra ' + p + ' ' + cls + '"></i>' : '') + '</div>';
        let g = '<div class="grid">' + ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(x => '<div class="dsem">' + x + '</div>').join('');
        const a = ['', '', '', 'p-Airbnb', 'p-Airbnb', 'p-Airbnb', ''], b = ['p-Booking', 'p-Booking', 'p-Booking', '', 'p-Vrbo', 'p-Vrbo', 'p-Vrbo'];
        for (let i = 0; i < 7; i++) g += '<div class="dia' + (i > 4 ? ' finde' : '') + (i === 3 ? ' hoy' : '') + (i === 4 ? ' sel tuto-foco' : '') + '"><span class="num">' + (i + 1) + '</span>' +
          bar((a[i] && !a[i - 1] ? 'ini' : '') + (a[i] && !a[i + 1] ? ' fin' : ''), a[i]) + bar((b[i] && !b[i - 1] ? 'ini' : '') + (b[i] && !b[i + 1] ? ' fin' : ''), b[i]) + '</div>';
        return g + '</div>';
      })()) },
    { t: 'La ocupación', x: 'Dice qué parte de las noches del mes se han alquilado en cada apartamento. Es solo para mirar: no hay que hacer nada.',
      d: dDemo('<div class="detalle ocup"><div class="ocup-top"><h3>Vistas a la Catedral</h3><span class="pct tuto-foco">68 %</span></div><div class="barra-ocup"><i class="p-Airbnb" style="width:40%"></i><i class="p-Booking" style="width:28%"></i></div><div class="hint">21 de 31 noches</div></div>') },
  ] },
  { id: 'avisos', ico: '⚠️', t: 'Los avisos de colores', sub: 'Qué significan y qué hacer', pasos: [
    { t: 'Rojo y amarillo', x: 'Los avisos salen <b>arriba del todo</b>.<br><b>Rojo</b>: es importante, míralo cuanto antes.<br><b>Amarillo</b>: algo pendiente, sin prisa.',
      d: dDemo(dAviso(true, 'Aviso rojo', 'Importante: míralo ya.') + dAviso(false, 'Aviso amarillo', 'Pendiente: cuando puedas.')) },
    { t: '🚨 Doble reserva', x: 'Hay <b>dos reservas</b> en el mismo apartamento la misma noche (por ejemplo, una de Booking y otra de Airbnb).<br>Entra en una de las plataformas y <b>cancela o mueve una</b> cuanto antes. Si no sabes cómo, llama a ' + QUIEN_AYUDA + '.',
      d: dDemo(dAviso(true, '🚨 Doble reserva · Patio Toledano', 'Coinciden 2 noches: del sáb 12 dic al lun 14 dic. Empieza en 9 días. Entra en las plataformas y cancela o mueve una de las dos cuanto antes.', true)) },
    { t: '📋 Partes sin hacer', x: 'Alguien entró y su <b>parte de viajeros</b> no está marcado. Hazlo en SES.Hospedajes y márcalo en la reserva (o en «Para hoy»).',
      d: dDemo(dAviso(false, '📋 Un parte de viajeros sin hacer', 'Son obligatorios en SES.Hospedajes en las 24 h siguientes a la entrada. Cuando esté hecho, márcalo en la reserva.', true)) },
    { t: '⚠️ «Puede que no esté al día»', x: 'La app lleva un rato sin poder mirar las plataformas. <b>Toca ↻</b> y espera.<br>Si sigue saliendo, avisa a ' + QUIEN_AYUDA + ', pero tranquilo: Booking, Airbnb y Vrbo siguen funcionando normal.',
      d: dDemo(dAviso(true, '⚠️ Puede que no esté al día', 'La app no ha podido comprobar Booking, Airbnb y Vrbo desde las 9:15. Toca ↻ para probar ahora.', true)) },
    { t: '«¿Reserva o cerrado?»', x: 'Es un bloque de Booking que la app no ha podido aclarar sola. Si pone «<b>Esperando el correo de Booking</b>», es normal: espera unas horas.<br>Si pone «<b>¿Reserva o cerrado? Tócala</b>», ábrela y marca lo que es.',
      d: dDemo(dCard({ p: 'Booking', pill: 'Booking', apt: 'Patio Toledano', tag: 'En 8 días', f: 'sáb 12 dic → lun 14 dic', n: '2 noches', extra: '<div class="quien vacio tuto-foco" style="font-size:13px">¿Reserva o cerrado? Tócala para aclararlo</div>' })) },
    { t: '❌ Cancelada', x: 'La plataforma avisó por correo de que la reserva se <b>canceló</b>, pero las fechas siguen cerradas.<br>Si de verdad no viene nadie, <b>abre esas fechas</b> en la plataforma para poder alquilarlas.',
      d: dDemo(dCard({ p: 'Bloqueo', pill: '❌ Cancelada', apt: 'Vistas a la Catedral', tag: 'En 10 días', f: 'lun 14 dic → mié 16 dic', n: '2 noches', extra: '<div class="quien vacio tuto-foco" style="font-size:13px;color:var(--bad)">Cancelada (aviso del 3 dic). Si no hay nadie, abre las fechas.</div>' })) },
  ] },
  { id: 'facturas', ico: '🧾', t: 'Facturas, paso a paso', sub: 'Cómo se hacen y se envían', pasos: [
    { t: '¿Por qué hay que hacer facturas?', x: 'Desde el <b>1 de diciembre de 2026</b>, las estancias de 30 noches o menos llevan <b>IVA del 10 %</b>, y a cada huésped hay que darle su factura.<br>La buena noticia: <b>la app lo hace casi todo</b>. Tú solo revisas el importe, tocas un botón y la mandas.',
      d: dDemo('<div class="tuto-grande">🧾</div><div class="tuto-centro">Una estancia = <b>una factura</b></div>') },
    { t: 'Lo que la app hace sola', x: '<ul class="tuto-lista"><li>Pone el <b>número</b> de cada factura, seguido y sin saltos.</li><li><b>Calcula el IVA</b>: no tienes que hacer cuentas.</li><li>Hace el <b>PDF</b>.</li><li>La <b>apunta en el libro de facturas</b> y la guarda. No tienes que guardar papeles.</li><li>Te <b>recuerda</b> en el email de la mañana las que faltan.</li></ul>' },
    { t: '¿Cuándo hay que hacerla?', x: 'Cuando termina una estancia (el día que se van), aparece sola en la pestaña <b>Facturas</b>, en «<b>Por hacer</b>».<br>Las fechas cerradas a mano y las reservas canceladas <b>no salen</b>: no llevan factura.',
      d: dDemo(dTabs('Facturas', 'Facturas')) },
    { t: 'La pestaña Facturas', x: 'Tiene tres grupos:<br><b>Por hacer</b>: falta hacer la factura.<br><b>Por enviar</b>: está hecha pero falta mandarla al huésped.<br><b>Enviadas</b>: ya está todo.<br>Arriba sale el IVA del trimestre: es solo para que lo sepas, no tienes que hacer nada con él.',
      d: dDemo(dAviso(false, 'IVA de este trimestre (octubre–diciembre)', '46,36 € de IVA en 2 facturas (510,00 € cobrados)') + dGrupo('<span class="tuto-foco">Por hacer</span>') +
        dCard({ p: 'Airbnb', tag: 'Por hacer', tagN: true, quien: 'María García · 255,00 €' }) + dGrupo('Enviadas') + dCard({ p: 'Vrbo', pill: 'Vrbo', apt: 'Patio Toledano', tag: 'Enviada', f: 'lun 30 nov → jue 3 dic', n: '3 noches', quien: 'John Smith · NV2026-0001 · 255,00 €' })) },
    { t: 'Paso 1: el importe', x: 'Toca la estancia que está «Por hacer». Arriba pone el <b>importe que pagó el huésped, con el IVA incluido</b>.<br>Muchas veces <b>ya viene puesto</b>, porque Airbnb, Vrbo y Smartbox lo mandan por correo. Solo revisa que está bien.',
      d: dDemo(fichaFactura('imp')) },
    { t: '¿De dónde saco el importe?', x: 'Si no viene puesto, debajo de la casilla la app te dice dónde mirar. Resumen:<ul class="tuto-lista"><li><b>Booking</b>: no lo manda por correo. En la extranet → Reservas → esa reserva: el <b>precio total</b> que paga el huésped.</li><li><b>Airbnb</b>: «Precio de la habitación por X noches» (sin la comisión de Airbnb).</li><li><b>Vrbo</b>: «Importe de la reserva» (sin la tasa de servicio).</li><li><b>Smartbox</b>: el «Precio de la experiencia» del correo de la reserva (no lo que te ingresan).</li><li><b>Externa</b>: lo que te pagó el huésped.</li></ul>' },
    { t: 'Si pasa de 400 €', x: 'Cuando el importe pasa de <b>400 €</b>, la factura tiene que llevar los datos del huésped: <b>nombre, DNI o pasaporte, domicilio y país</b>. La app te pide las casillas sola.<br>Son <b>los mismos datos que pones en el parte de viajeros</b>. Hasta 400 € no hace falta nada de esto.',
      d: dDemo(dFicha(dCampo('Importe que pagó el huésped (IVA incluido)', '520,00') + '<div class="hint"><b>Más de 400 €: factura completa.</b> Son los mismos datos que pones en el parte de viajeros (SES.Hospedajes).</div>' +
        dCampo('Nombre y apellidos', 'María García López', true) + dCampo('DNI, NIE o pasaporte', '', true, 'Ej.: 12345678Z'))) },
    { t: 'Paso 2: «Hacer factura»', x: 'Revisa el importe y toca <b>Hacer factura</b>. Se crea al momento, con su número (por ejemplo <b>NV2026-0001</b>).<br>⚠️ Una factura hecha <b>ya no se borra</b> (lo dice la ley). Si te equivocas tiene arreglo, lo vemos en dos pasos.',
      d: dDemo(fichaFactura('hacer')) },
    { t: 'Paso 3: enviarla por WhatsApp', x: 'Dos botones, en orden:<br><b>1 · Abrir chat de WhatsApp</b>: sale el chat con un mensaje ya escrito. Envíalo y vuelve.<br><b>2 · Enviar la factura (PDF)</b>: elige <b>WhatsApp</b> y el chat del huésped.<br>Y ya está: pasa sola a «Enviadas».',
      d: dDemo(fichaHecha('pdf')) },
    { t: 'Si no tienes su teléfono', x: 'Con Booking pasa a menudo. Puedes escribir el teléfono (está en la app de Booking) o tocar <b>Enviar la factura (PDF)</b> y mandarla por correo o por donde habléis.<br>Después toca <b>✅ Ya la he enviado</b> para que la app lo sepa.',
      d: dDemo(fichaHecha('marca')) },
    { t: 'Si te equivocaste o devuelves dinero', x: 'Toca <b>✏️ Corregir o anular esta factura</b>. Elige el motivo y pon el <b>total correcto</b> (si se devuelve todo, pon 0).<br>La app hace una «<b>factura rectificativa</b>» (empieza por NVR) que se manda al huésped igual que la otra.<br>Así se hace bien: <b>nunca se borra</b> una factura.',
      d: dDemo(dFicha('<h2>🧾 Factura NV2026-0001</h2><div class="menu-lista">' + dBtn('✏️ Corregir o anular esta factura', false, true) + '</div>')) },
    { t: 'Lo que todavía tenemos que definir', x: 'Presentar el IVA a Hacienda (el <b>modelo 303</b>, cada tres meses; el primero, en enero de 2027) y apuntar las facturas de las comisiones de Booking, Airbnb y los demás, <b>todavía lo tenemos que definir</b> ' + QUIEN_AYUDA + ' y tú.<br><b>Hay tiempo de sobra.</b> De momento, tú solo haz y envía las facturas.',
      d: dDemo('<div class="tuto-grande">🗓️</div><div class="tuto-centro">Modelo 303: <b>lo vemos más adelante</b></div>') },
    { t: '¿Lo practicamos?', x: 'Puedes hacer una <b>factura de mentira</b>, entera, las veces que quieras.<br>No cuenta, no gasta número y <b>no se envía nada</b> a nadie.',
      practica: true },
  ] },
  { id: 'dudas', ico: '🆘', t: 'Si algo no cuadra', sub: 'Antes de llamar, mira esto', pasos: [
    { t: 'Primero, toca ↻', x: 'Muchas veces es solo que la app aún no había mirado. Toca el botón de las <b>flechas en círculo</b> y espera unos segundos.',
      d: dDemo(dCab('sync')) },
    { t: 'Una reserva nueva tarda un poco', x: 'Una reserva nueva puede tardar hasta <b>15 minutos</b> en salir.<br>El nombre, el teléfono y el importe llegan por correo y pueden tardar <b>hasta una hora</b> más.' },
    { t: 'Cuándo llamar a ' + QUIEN_AYUDA, x: 'Llama si:<ul class="tuto-lista"><li>Sale una <b>🚨 doble reserva</b> y no sabes cómo arreglarla.</li><li>«Puede que no esté al día» no se quita en <b>todo el día</b>.</li><li>Al hacer una factura sale un <b>error</b>.</li></ul>Para lo demás, vuelve a mirar esta ayuda.' },
    { t: 'La ayuda está siempre aquí', x: 'Arriba del todo, el botón <b>❓ Ayuda</b>. Puedes verla todas las veces que quieras.',
      d: dDemo(dCab('ayuda')) },
  ] },
];

/* ---------- Abrir, cerrar y moverse ---------- */
function tutoEstado() { return leer(TUTO_K) || {}; }
function tutoMarcar(k, v) { const e = tutoEstado(); e[k] = v; guardar(TUTO_K, e); }
function abrirTutorial(id) {
  const nuevo = !tuto;
  tuto = { cap: null, paso: 0, seguido: false };
  let el = $('#tuto');
  if (!el) { el = document.createElement('div'); el.id = 'tuto'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); document.body.appendChild(el); }
  el.hidden = false; document.body.classList.add('bloq');
  if (nuevo) { try { history.pushState({ tuto: 1 }, ''); } catch (e) { /* nada */ } }
  if (id && TEMAS.some(t => t.id === id)) tutoIr(id, 0); else tutoIndice();
}
function tutoOcultar() {
  tuto = null; callar();
  const el = $('#tuto'); if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.toggle('bloq', !$('#velo').hidden);
}
function cerrarTutorial() {
  if (history.state && history.state.tuto) history.back();   // el «atrás» del móvil también la cierra
  else tutoOcultar();
}
window.addEventListener('popstate', () => { if (tuto) tutoOcultar(); });

function tutoPintar(html) {
  const el = $('#tuto');
  el.innerHTML = html + '<button class="tuto-mas" id="tu-mas" hidden>👇 Hay más abajo</button>';
  el.scrollTop = 0;
  // Si no cabe todo en la pantalla, se avisa (y con un toque baja)
  const mas = $('#tu-mas');
  const verMas = () => { mas.hidden = el.scrollHeight - el.clientHeight - el.scrollTop < 40; };
  el.onscroll = verMas; verMas();
  mas.onclick = () => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  const x = $('#tu-salir'); if (x) x.onclick = cerrarTutorial;
  const v = $('#tu-voz'); if (v) v.onclick = () => { tutoVoz = !tutoVoz; if (tutoVoz) leerEnVoz(); else callar(); v.textContent = tutoVoz ? '🔇 Callar' : '🔊 Léemelo'; v.classList.toggle('on', tutoVoz); };
}
const barraTuto = () => '<div class="tuto-barra"><button class="btn tuto-salir" id="tu-salir">✕ Salir</button><span class="tuto-hueco"></span>' + botonVoz() + '</div>';
const botonVoz = () => VOZ ? '<button class="btn tuto-voz' + (tutoVoz ? ' on' : '') + '" id="tu-voz">' + (tutoVoz ? '🔇 Callar' : '🔊 Léemelo') + '</button>' : '';

function tutoIndice() {
  callar();
  const hechos = tutoEstado().hechos || {};
  tuto.cap = null;
  let h = barraTuto() + '<div class="tuto-cuerpo"><h2 class="tuto-tit">¿Qué quieres aprender?</h2>' +
    '<p class="tuto-txt" id="tu-txt">Toca un tema. Son pasos cortos, con un dibujo de la pantalla. Puedes salir cuando quieras con «✕ Salir».</p><div class="tuto-temas">';
  TEMAS.forEach((t, i) => {
    h += '<button class="tuto-tema" data-tema="' + t.id + '"><span class="tuto-ico">' + t.ico + '</span><span class="tuto-tt"><b>' + (i + 1) + '. ' + esc(t.t) + '</b><small>' + esc(t.sub) + ' · ' + t.pasos.length + ' pasos</small></span>' +
      (hechos[t.id] ? '<span class="tuto-visto" aria-label="Visto">✅</span>' : '') + '</button>';
  });
  h += '</div><div class="menu-lista" style="margin-top:16px"><button class="btn prim" id="tu-todo">▶ Verlo todo, desde el principio</button><button class="btn" id="tu-prac">🧪 Practicar una factura de mentira</button></div></div>';
  tutoPintar(h);
  document.querySelectorAll('[data-tema]').forEach(b => { b.onclick = () => { tuto.seguido = false; tutoIr(b.dataset.tema, 0); }; });
  $('#tu-todo').onclick = () => { tuto.seguido = true; tutoIr(TEMAS[0].id, 0); };
  $('#tu-prac').onclick = () => practica(0);
  if (tutoVoz) leerEnVoz();
}

function tutoIr(id, paso) {
  const i = TEMAS.findIndex(t => t.id === id), tema = TEMAS[i], p = tema.pasos[paso];
  tuto.cap = id; tuto.paso = paso;
  const n = tema.pasos.length, ult = paso === n - 1;
  const pct = Math.round((paso + 1) / n * 100);
  let h = barraTuto() +
    '<div class="tuto-prog"><div class="tuto-prog-txt"><span class="tuto-donde">' + tema.ico + ' ' + esc(tema.t) + '</span><span class="tuto-paso">Paso ' + (paso + 1) + ' de ' + n + '</span></div><div class="tuto-prog-barra"><i style="width:' + pct + '%"></i></div></div>' +
    '<div class="tuto-cuerpo"><h2 class="tuto-tit">' + esc(p.t) + '</h2><div class="tuto-txt" id="tu-txt">' + p.x + '</div>' + (p.d || '') +
    (p.practica ? '<div class="menu-lista" style="margin-top:14px"><button class="btn prim" id="tu-prac">🧪 Sí, practicar una factura de mentira</button></div>' : '') + '</div>' +
    '<div class="tuto-pie"><div class="tuto-nav"><button class="btn" id="tu-atras">← Atrás</button><button class="btn prim" id="tu-sig">' + (ult ? 'Terminar ✓' : 'Siguiente →') + '</button></div></div>';
  tutoPintar(h);
  $('#tu-atras').onclick = () => { if (paso > 0) tutoIr(id, paso - 1); else tutoIndice(); };
  $('#tu-sig').onclick = () => { if (!ult) tutoIr(id, paso + 1); else tutoFin(i); };
  if ($('#tu-prac')) $('#tu-prac').onclick = () => practica(0);
  if (tutoVoz) leerEnVoz();
}

function tutoFin(i) {
  const tema = TEMAS[i], sig = TEMAS[i + 1];
  const e = tutoEstado(); e.hechos = e.hechos || {}; e.hechos[tema.id] = 1; guardar(TUTO_K, e);
  if (tuto.seguido && sig) { tutoIr(sig.id, 0); return; }
  callar();
  let h = barraTuto() + '<div class="tuto-cuerpo"><div class="tuto-grande">👏</div><h2 class="tuto-tit tuto-centro">¡Muy bien!</h2>' +
    '<p class="tuto-txt tuto-centro" id="tu-txt">Ya has visto «' + esc(tema.t) + '».' + (sig ? '' : ' Era el último tema.') + '</p><div class="menu-lista">' +
    (sig ? '<button class="btn prim" id="tu-sigtema">Siguiente tema: ' + sig.ico + ' ' + esc(sig.t) + '</button>' : '') +
    '<button class="btn" id="tu-indice">Ver todos los temas</button><button class="btn" id="tu-fin">Salir de la ayuda</button></div></div>';
  tutoPintar(h);
  if (sig) $('#tu-sigtema').onclick = () => tutoIr(sig.id, 0);
  $('#tu-indice').onclick = tutoIndice;
  $('#tu-fin').onclick = cerrarTutorial;
}

/* ---------- Leer en voz alta ---------- */
function textoParaVoz(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html).replace(/<li>/g, '<li>. ').replace(/<br\s*\/?>/g, '. ');
  return d.textContent.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\bnº\b/g, 'número').replace(/↻/g, '').replace(/·/g, ',').replace(/\s*\.\s*\./g, '.').replace(/\s+/g, ' ').trim();
}
function leerEnVoz() {
  if (!VOZ) return;
  const tit = document.querySelector('#tuto .tuto-tit'), txt = $('#tu-txt');
  const s = textoParaVoz((tit ? tit.innerHTML + '. ' : '') + (txt ? txt.innerHTML : ''));
  try {
    VOZ.cancel();
    const u = new SpeechSynthesisUtterance(s);
    u.lang = 'es-ES'; u.rate = 0.92;
    const voces = VOZ.getVoices() || [];
    const v = voces.find(x => /^es[-_]ES/i.test(x.lang)) || voces.find(x => /^es/i.test(x.lang));
    if (v) u.voice = v;
    VOZ.speak(u);
  } catch (e) { /* sin voz */ }
}
function callar() { try { if (VOZ) VOZ.cancel(); } catch (e) { /* nada */ } }

/* ---------- Práctica: una factura de mentira (no llama al motor) ---------- */
const PRAC = { imp: '', tel: '+34 600 00 45 67', nom: 'María García', doc: '', dom: '', pais: '', chat: false };
function practica(paso, msg) {
  callar();
  if (paso === 0) Object.assign(PRAC, { imp: '', doc: '', dom: '', pais: '', chat: false });
  const aviso = '<div class="tuto-practica-aviso">🧪 <b>PRÁCTICA</b> · Es de mentira: no cuenta, no gasta número y no se envía nada.</div>';
  const pie = atras => (atras ? '<div class="tuto-pie"><div class="tuto-nav"><button class="btn" id="pr-atras">← Atrás</button></div></div>' : '');
  let h = barraTuto();
  if (paso === 0) {
    h += '<div class="tuto-cuerpo">' + aviso + '<h2 class="tuto-tit">1. Busca la estancia</h2><div class="tuto-txt" id="tu-txt">María se fue ayer. En la pestaña Facturas, su estancia está en «<b>Por hacer</b>».<br><b>Tócala</b> para empezar.</div>' +
      '<div class="tuto-demo tuto-practica">' + dTabs('Facturas') + dGrupo('Por hacer') +
      '<button class="card p-Airbnb tuto-foco" id="pr-card"><div class="card-top"><span class="pill">Airbnb</span><span class="apt">Vistas a la Catedral</span><span class="tags"><span class="tag nueva">Por hacer</span></span></div>' +
      '<div class="fechas">vie 4 dic → dom 6 dic <span class="n">· 2 noches</span></div><div class="quien">María García</div></button></div></div>' + pie(false);
    tutoPintar(h);
    $('#pr-card').onclick = () => practica(1);
  } else if (paso === 1) {
    const grande = numPrac(PRAC.imp) > LIMITE_SIMPLIFICADA;
    h += '<div class="tuto-cuerpo">' + aviso + '<h2 class="tuto-tit">2. Escribe el importe</h2><div class="tuto-txt" id="tu-txt">Escribe lo que pagó María, <b>con el IVA incluido</b>. Por ejemplo: <b>255</b>.<br>Luego toca «<b>Hacer factura</b>».</div>' +
      '<div class="tuto-demo tuto-practica"><div class="tuto-hoja"><div class="hoja-top p-Airbnb"><span class="pill">Airbnb</span><span class="apt">Vistas a la Catedral</span></div><h2>🧾 Hacer la factura</h2>' +
      '<label class="campo">Importe que pagó el huésped (IVA incluido)<input id="pr-imp" inputmode="decimal" autocomplete="off" placeholder="Ej.: 255,00" value="' + esc(PRAC.imp) + '"></label>' +
      '<div class="hint">De Airbnb: «Precio de la habitación por X noches» (sin la comisión de Airbnb).</div>' +
      '<label class="campo">Teléfono del huésped (para WhatsApp)<input id="pr-tel" inputmode="tel" autocomplete="off" value="' + esc(PRAC.tel) + '"></label>' +
      '<div id="pr-grande"' + (grande ? '' : ' hidden') + '><div class="hint" style="margin-top:14px"><b>Más de ' + LIMITE_SIMPLIFICADA + ' €: factura completa.</b> Son los mismos datos que pones en el parte de viajeros (SES.Hospedajes).</div>' +
      '<label class="campo">Nombre y apellidos<input id="pr-nom" autocomplete="off" value="' + esc(PRAC.nom) + '"></label>' +
      '<label class="campo">DNI, NIE o pasaporte<input id="pr-doc" autocomplete="off" value="' + esc(PRAC.doc) + '"></label>' +
      '<label class="campo">Domicilio (calle, número, ciudad, código postal)<textarea id="pr-dom" style="min-height:64px">' + esc(PRAC.dom) + '</textarea></label>' +
      '<label class="campo">País<input id="pr-pais" autocomplete="off" placeholder="España" value="' + esc(PRAC.pais) + '"></label></div>' +
      '<div class="msg" id="pr-msg">' + (msg ? '<div class="aviso mal">' + esc(msg) + '</div>' : '') + '</div>' +
      '<div class="acciones"><button class="btn prim" id="pr-hacer">Hacer factura</button></div></div></div></div>' + pie(true);
    tutoPintar(h);
    const imp = $('#pr-imp');
    imp.oninput = () => { PRAC.imp = imp.value; $('#pr-grande').hidden = !(numPrac(imp.value) > LIMITE_SIMPLIFICADA); };
    $('#pr-atras').onclick = () => practica(0);
    $('#pr-hacer').onclick = () => {
      ['tel', 'nom', 'doc', 'dom', 'pais'].forEach(k => { if ($('#pr-' + k)) PRAC[k] = $('#pr-' + k).value; });
      PRAC.imp = imp.value;
      const v = numPrac(PRAC.imp);
      if (!(v > 0)) return practica(1, 'Escribe el importe, por ejemplo 255 o 255,50.');
      if (v > 50000) return practica(1, 'Ese importe es demasiado alto. Revísalo.');
      if (v > LIMITE_SIMPLIFICADA && (!PRAC.nom.trim() || !PRAC.doc.trim() || !PRAC.dom.trim())) return practica(1, 'Pasa de ' + LIMITE_SIMPLIFICADA + ' €: faltan el nombre, el documento o el domicilio del huésped. Para practicar, invéntatelos.');
      practica(2);
    };
    if (msg) $('#pr-msg').scrollIntoView({ block: 'center' });
    else if (!PRAC.imp) setTimeout(() => { try { imp.focus(); } catch (e) { /* nada */ } }, 50);
  } else if (paso === 2) {
    const total = Math.round(numPrac(PRAC.imp) * 100) / 100, base = Math.round(total / 1.1 * 100) / 100, iva = Math.round((total - base) * 100) / 100;
    h += '<div class="tuto-cuerpo">' + aviso + '<h2 class="tuto-tit">3. ¡Factura hecha! Ahora, a enviarla</h2><div class="tuto-txt" id="tu-txt">La app ha puesto el número y ha calculado el IVA ella sola.<br>Ahora toca los botones <b>en orden</b>: primero el <b>1</b> y después el <b>2</b>.</div>' +
      '<div class="msg" id="pr-msg">' + (msg || '') + '</div><div class="tuto-demo tuto-practica"><div class="tuto-hoja"><div class="hoja-top p-Airbnb"><span class="pill">Airbnb</span><span class="apt">Vistas a la Catedral</span></div><h2>🧾 Factura PRUEBA-0001</h2>' +
      '<div class="detalle">' + dDato('Total', eur(total)) + dDato('Sin IVA', eur(base)) + dDato('IVA (10 %)', eur(iva)) + '</div>' +
      '<div class="menu-lista"><button class="btn' + (PRAC.chat ? '' : ' tuto-foco') + '" id="pr-chat">' + (PRAC.chat ? '✓ ' : '') + '1 · Abrir chat de WhatsApp</button>' +
      '<button class="btn prim' + (PRAC.chat ? ' tuto-foco' : '') + '" id="pr-pdf">2 · Enviar la factura (PDF)</button>' +
      '<button class="btn" id="pr-rect">✏️ Corregir o anular esta factura</button></div></div></div></div>' + pie(false);
    tutoPintar(h);
    $('#pr-chat').onclick = () => { PRAC.chat = true; practica(2, '<div class="aviso">En la de verdad, aquí <strong>se abre WhatsApp</strong> con el chat de María y un mensaje ya escrito. Lo envías y vuelves a la app. Ahora toca el <strong>2</strong>.</div>'); };
    $('#pr-pdf').onclick = () => {
      if (!PRAC.chat) return practica(2, '<div class="aviso">Primero el <strong>1</strong>: abre el chat y manda el mensaje. Así, al enviar la factura, el chat de María sale el primero.</div>');
      practica(3);
    };
    $('#pr-rect').onclick = () => practica(2, '<div class="aviso">Aquí se corrige una factura con un error o una devolución: eliges el motivo y el total correcto, y la app hace una <strong>factura rectificativa</strong> para mandarla igual. En la práctica no hace falta.</div>');
  } else {
    h += '<div class="tuto-cuerpo">' + aviso + '<h2 class="tuto-tit">4. Elige WhatsApp y el chat</h2><div class="tuto-txt" id="tu-txt">En la de verdad, al tocar el 2 sale el <b>menú de compartir</b> del móvil. Toca <b>WhatsApp</b> y luego el chat de María (sale el primero, porque acabas de escribirle).<br>Al volver a la app, la factura ya está en «<b>Enviadas</b>». ¡Y ya está!</div>' +
      '<div class="tuto-demo"><div class="tuto-compartir"><b>Compartir</b><div class="tuto-apps"><span class="tuto-foco"><i>💬</i>WhatsApp</span><span><i>✉️</i>Gmail</span><span><i>📁</i>Drive</span></div></div></div>' +
      '<div class="tuto-txt tuto-resumen"><b>Resumen:</b><br>1. Toca la estancia «Por hacer».<br>2. Revisa el importe y toca «Hacer factura».<br>3. Botón 1 (chat) y botón 2 (factura) → WhatsApp.</div>' +
      '<div class="menu-lista"><button class="btn prim" id="pr-otra">Practicar otra vez</button><button class="btn" id="pr-ayuda">Volver a la ayuda</button><button class="btn" id="pr-salir">Salir</button></div></div>' + pie(false);
    tutoPintar(h);
    $('#pr-otra').onclick = () => practica(0);
    $('#pr-ayuda').onclick = tutoIndice;
    $('#pr-salir').onclick = cerrarTutorial;
  }
  if (tutoVoz) leerEnVoz();
}
function numPrac(s) { return Number(String(s || '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); }

/* La primera vez, la app lo ofrece (una sola vez en cada móvil) */
function ofrecerTutorial() {
  if (tutoOfrecido) return;
  tutoOfrecido = true;
  setTimeout(() => {
    if (tutoEstado().ofrecido || !D || !SES || tuto || !$('#velo').hidden) return;
    tutoMarcar('ofrecido', 1);
    abrirHoja('<h2>👋 Nueva: la ayuda</h2><p class="tuto-txt">Ahora la app tiene una <b>ayuda</b> que te enseña, paso a paso, cómo funciona todo: las reservas, lo de cada día y <b>las facturas</b>.</p>' +
      '<p class="tuto-txt">Son unos minutos, y puedes parar cuando quieras.</p><div class="menu-lista"><button class="btn prim" id="o-si">Sí, enséñame</button><button class="btn" id="o-no">Ahora no</button></div>' +
      '<div class="hint">La tienes siempre en el botón «❓ Ayuda» de arriba.</div>');
    $('#o-si').onclick = () => { cerrarHoja(); abrirTutorial(); };
    $('#o-no').onclick = () => { cerrarHoja(); const b = $('#btnAyuda'); b.classList.add('tuto-foco'); setTimeout(() => b.classList.remove('tuto-foco'), 6000); };
  }, 1500);
}

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('#tuto')) return;   // la ayuda tiene sus propios botones
  const ac = t.closest('[data-accion]');
  if (ac) { if (ac.dataset.accion === 'recargar') cargar(); else if (ac.dataset.accion === 'calendarios') abrirCalendarios(); else if (ac.dataset.accion === 'tuto') abrirTutorial(ac.dataset.tema); return; }
  if (t.closest('.hoja') && !t.closest('[data-id]') && !t.closest('[data-factura]')) return;
  const tb = t.closest('.tabs button'); if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const ch = t.closest('[data-filtro]'); if (ch) { filtro = ch.dataset.filtro; render(); return; }
  const mo = t.closest('[data-mesoc]');
  if (mo) { const p = mesOc.split('-').map(Number); mesOc = new Date(Date.UTC(p[0], p[1] - 1 + Number(mo.dataset.mesoc), 1)).toISOString().slice(0, 7); render(); return; }
  const mb = t.closest('[data-mes]');
  if (mb) { const p = mes.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1 + Number(mb.dataset.mes), 1)); mes = d.toISOString().slice(0, 7); diaSel = null; render(); return; }
  const di = t.closest('[data-dia]'); if (di) { diaSel = di.dataset.dia; if (diaSel.slice(0, 7) !== mes) mes = diaSel.slice(0, 7); render(); return; }
  const fb = t.closest('[data-factura]'); if (fb) { pararDictado(); abrirFactura(fb.dataset.factura); return; }
  const tr = t.closest('[data-tarea]'); if (tr) { marcarTarea(tr); return; }
  const re = t.closest('[data-id]'); if (re) abrirReserva(re.dataset.id);
});
$('#velo').addEventListener('click', e => { if (e.target.id === 'velo') cerrarHoja(); });
$('#btnSync').onclick = sincronizar;
$('#buscar').addEventListener('input', e => { busqueda = e.target.value; if (D && tab === 'proximas') { renderProximas(); window.scrollTo(0, 0); } });
$('#btnMenu').onclick = abrirMenu;
$('#btnAyuda').onclick = () => abrirTutorial();

function iniciar() {
  if (!SES) { pantallaEntrar(''); return; }
  const copia = leer('nv-datos');
  if (copia) { D = copia; render(); } else $('#vista').innerHTML = '<div class="cargando">Cargando reservas…</div>';
  cargar();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && SES && $('#velo').hidden) cargar(true); });
setInterval(() => { if (!document.hidden && SES && $('#velo').hidden) cargar(true); }, 5 * 60 * 1000);
setInterval(() => { if (D && SES && $('#velo').hidden) render(); }, 60 * 1000);
(async () => {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }
  if (!SES) { const s = await leerSesionIdb(); if (s && s.token) { SES = s; guardar('nv-sesion', s); } }
  else guardarSesion(SES);
  limpiarBloqueoAntiguo();
  iniciar();
})();
