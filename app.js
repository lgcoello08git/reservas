// Motor (Google Apps Script). No es secreto: sin email autorizado y código no devuelve nada.
const MOTOR = 'https://script.google.com/macros/s/AKfycbwAc8n-dL2pH4oAlnUs1-JIZIphojfV5zoxsXSyJ01BcxWTyr4lTSpMWcV4PN8XoMCnLQ/exec';
const PLATS = ['Booking', 'Airbnb', 'Vrbo'];
const DSEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DSEM_L = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

let D = null, tab = 'proximas', filtro = 'todos', mes = null, mesOc = null, diaSel = null, ocupado = false, sinConexion = false;
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
function clase(r) { if (r.tipo === 'Bloqueo') return 'p-Bloqueo'; return PLATS.indexOf(r.plat) >= 0 ? 'p-' + r.plat : 'p-Otra'; }
function etiqueta(r) { return r.tipo === 'Bloqueo' ? 'Bloqueado · ' + r.plat : r.plat; }
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
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('ver'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('ver'), 4200); }
function msgError(e) { const m = e && e.message ? e.message : String(e || 'Error'); return /failed to fetch|load failed|networkerror/i.test(m) ? 'Sin conexión' : m; }
function abrirHoja(html) { $('#hoja').innerHTML = '<div class="asa"></div>' + html; $('#velo').hidden = false; document.body.classList.add('bloq'); }
function cerrarHoja() { $('#velo').hidden = true; document.body.classList.remove('bloq'); }

/* ---------- Entrar con email y código ---------- */
function pantallaEntrar(email) {
  $('#cabecera').hidden = true; $('#pestanas').hidden = true;
  $('#chips').innerHTML = ''; $('#avisos').innerHTML = '';
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
  if (tab === 'proximas') renderProximas(); else if (tab === 'ocupacion') renderOcupacion(); else renderCalendario();
}

function renderAvisos() {
  const h = [];
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
  const malas = D.fuentes.filter(f => f.tieneUrl && !f.ok && f.error && !f.provisional);
  if (malas.length) h.push('<div class="aviso mal"><b>No se puede leer ' + (malas.length === 1 ? 'un calendario' : malas.length + ' calendarios') + '</b>' + malas.map(f => esc(f.plat + ' · ' + f.apt)).join('<br>') + '<br><span style="color:var(--muted)">Sus reservas pueden no estar al día.</span></div>');
  const faltan = D.fuentes.filter(f => !f.tieneUrl);
  if (faltan.length && D.admin) h.push('<div class="aviso"><b>Faltan ' + faltan.length + ' calendarios por conectar</b><button class="btn" style="margin-top:8px;width:100%" data-accion="calendarios">Conectar calendarios</button></div>');
  $('#avisos').innerHTML = h.join('');
}

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
  return '<button class="card ' + clase(r) + (enChoque(r.id) ? ' choque' : '') + '" data-id="' + esc(r.id) + '">' +
    '<div class="card-top"><span class="pill">' + esc(r.tipo === 'Bloqueo' ? '🔒 ' + r.plat : r.plat) + '</span><span class="apt" data-corto="' + esc(nombreCorto(r.apt)) + '">' + esc(r.apt) + '</span>' +
    ((r.nueva || tag) ? '<span class="tags">' + (r.nueva ? '<span class="tag nueva">Nueva</span>' : '') + (tag ? '<span class="tag">' + esc(tag) + '</span>' : '') + '</span>' : '') + '</div>' +
    (dud ? '<div class="fechas">Hasta ' + esc(fCorta(r.salida)) + ' <span class="n">· entró hoy o antes</span></div>'
      : '<div class="fechas">' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + ' <span class="n">· ' + nTxt(noches(r.entrada, r.salida)) + '</span></div>') +
    (datos.length ? '<div class="quien">' + datos.join(' · ') + '</div>' : '') +
    (r.notas ? '<div class="nota">📝 ' + esc(r.notas) + '</div>' : '') +
    (enChoque(r.id) ? '<div class="alerta-txt" style="color:var(--bad)">🚨 Doble reserva: coincide con otra</div>' : '') +
    '</button>';
}

function renderProximas() {
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
  let h = '';
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
  h += '<div class="leyenda">' + PLATS.map(x => '<span class="p-' + x + '"><i></i>' + x + '</span>').join('') + '<span class="p-Bloqueo"><i></i>Bloqueado</span></div>';
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
  const q = r.tipo === 'Bloqueo' ? 'Fechas cerradas' : (r.nombre || 'Reserva');
  return '<button class="mini ' + clase(r) + '" data-id="' + esc(r.id) + '"><span class="pill">' + esc(etiqueta(r)) + '</span>' +
    '<span class="q">' + esc(q) + '<small>' + esc(txt) + ' · ' + esc(fCorta(r.entrada)) + ' → ' + esc(fCorta(r.salida)) + '</small></span></button>';
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
    '<div class="dato"><span>Plataforma</span><b>' + esc(r.plat) + '</b></div>' +
    (r.nombre ? '<div class="dato"><span>Huésped</span><b>' + esc(r.nombre) + '</b></div>' : '') +
    (r.tel4 ? '<div class="dato"><span>Teléfono</span><b>acaba en ' + esc(r.tel4) + '</b></div>' : '') +
    (r.codigo ? '<div class="dato"><span>Código</span><b>' + esc(r.codigo) + '</b></div>' : '') +
    '</div>';
  if (enChoque(r.id)) h += '<div class="aviso" style="margin-top:12px"><b>⚠️ Se solapa con otra reserva</b>Revísalo en las plataformas.</div>';
  if (r.dudoso) h += '<div class="hint">' + esc(r.plat) + ' no enseña las noches que ya han pasado, y la app vio esta reserva por primera vez cuando ya estaba empezada: puede que entrara antes. Las fechas exactas están en ' + esc(r.plat) + '.</div>';
  if (r.plat === 'Booking') h += '<div class="hint">Booking no comparte el nombre del huésped por calendario: los datos están en la app de Booking.</div>';
  // Nota privada: se guarda en el motor, nunca en la plataforma
  const quien = r.notaPor ? (r.notaPor === SES.email ? 'ti' : r.notaPor) : '';
  h += '<label class="campo">📝 Nota privada (solo la veis vosotros)<textarea id="n-texto" maxlength="1000" placeholder="Ej.: llegan a las 23h, traen cuna, ya pagado…">' + esc(r.notas || '') + '</textarea></label>' +
    (r.notaFecha ? '<div class="hint">Escrita por ' + esc(quien) + ' el ' + esc(r.notaFecha.slice(8, 10) + '/' + r.notaFecha.slice(5, 7) + ' a las ' + r.notaFecha.slice(11, 16)) + '</div>' : '') +
    '<div class="enlaces">' + (SR ? '<button class="btn" id="n-dictar">🎤 Dictar</button>' : '') + '<button class="btn" id="n-guardar">Guardar nota</button></div>' +
    (SR ? '' : '<div class="hint">Para dictar, toca el micrófono del teclado.</div>') +
    '<div class="msg" id="n-msg"></div>';
  h += '<div class="acciones">' + (r.enlace ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(r.enlace) + '">Ver en ' + esc(r.plat) + '</a>' : '') + '<button class="btn prim" id="f-cerrar">Cerrar</button></div>';
  abrirHoja(h);
  const ta = $('#n-texto'), original = r.notas || '';
  const guardarNota = async () => {
    pararDictado();
    const b = $('#n-guardar'); b.disabled = true; b.textContent = 'Guardando…';
    try { D = await api('nota', { id: r.id, texto: ta.value }); guardar('nv-datos', D); render(); toast(ta.value.trim() ? 'Nota guardada' : 'Nota borrada'); abrirReserva(r.id); }
    catch (e) { $('#n-msg').innerHTML = '<div class="aviso mal">' + esc(msgError(e)) + '</div>'; b.disabled = false; b.textContent = 'Guardar nota'; }
  };
  $('#n-guardar').onclick = guardarNota;
  if (SR) $('#n-dictar').onclick = () => dictar(ta, $('#n-dictar'));
  $('#f-cerrar').onclick = () => {
    pararDictado();
    if (ta.value.trim() !== original.trim()) {
      const b = $('#f-cerrar');
      if (!b.dataset.seguro) { b.dataset.seguro = '1'; b.textContent = 'Cerrar sin guardar la nota'; $('#n-msg').innerHTML = '<div class="aviso">Has cambiado la nota y no la has guardado.</div>'; return; }
    }
    cerrarHoja();
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
  if (!mesOc) mesOc = D.hoy.slice(0, 7);
  const p = mesOc.split('-').map(Number);
  const primero = mesOc + '-01', dias = new Date(Date.UTC(p[0], p[1], 0)).getUTCDate();
  const desdeDatos = sumar(D.hoy, -45);   // antes de esto la app ya no guarda reservas
  const apts = filtro === 'todos' ? D.apartamentos : [filtro];
  let h = '<div class="mes"><button class="icon-btn" data-mesoc="-1" aria-label="Mes anterior"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M15 5l-7 7 7 7"/></svg></button>' +
    '<h2>' + MES_L[p[1] - 1] + ' ' + p[0] + '</h2>' +
    '<button class="icon-btn" data-mesoc="1" aria-label="Mes siguiente"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M9 5l7 7-7 7"/></svg></button></div>';
  const tot = { ocup: 0, total: 0 };
  apts.forEach(a => {
    const porPlat = {}, reservasPlat = {};
    let ocup = 0, bloq = 0, sinDatos = 0;
    for (let i = 0; i < dias; i++) {
      const d = sumar(primero, i);
      if (d < desdeDatos) { sinDatos++; continue; }
      const aqui = D.reservas.filter(r => r.apt === a && r.entrada <= d && d < r.salida);
      const real = aqui.find(r => r.tipo !== 'Bloqueo');
      if (real) { ocup++; porPlat[real.plat] = (porPlat[real.plat] || 0) + 1; }
      else if (aqui.length) bloq++;
    }
    D.reservas.forEach(r => { if (r.apt === a && r.tipo !== 'Bloqueo' && r.entrada < sumar(primero, dias) && r.salida > primero) reservasPlat[r.plat] = (reservasPlat[r.plat] || 0) + 1; });
    const base = dias - sinDatos, libres = base - ocup - bloq;
    const pct = base ? Math.round(ocup * 100 / base) : 0;
    tot.ocup += ocup; tot.total += base;
    h += '<div class="detalle ocup"><div class="ocup-top"><h3>' + esc(a) + '</h3><span class="pct">' + (base ? pct + '%' : '—') + '</span></div>' +
      '<div class="hint" style="margin:0 0 8px">' + ocup + ' de ' + base + ' noches ocupadas' + (sinDatos ? ' (sin datos de los primeros ' + sinDatos + ' días)' : '') + '</div>' +
      '<div class="barra-ocup">' + PLATS.concat(['Otra']).filter(x => porPlat[x]).map(x => '<i class="p-' + x + '" style="width:' + (porPlat[x] * 100 / (base || 1)) + '%"></i>').join('') +
      (bloq ? '<i class="p-Bloqueo" style="width:' + (bloq * 100 / (base || 1)) + '%"></i>' : '') + '</div>' +
      Object.keys(porPlat).map(x => '<div class="dato ' + (PLATS.indexOf(x) >= 0 ? 'p-' + x : 'p-Otra') + '"><span><i class="punto"></i>' + esc(x) + '</span><b>' + nTxt(porPlat[x]) + ' · ' + reservasPlat[x] + (reservasPlat[x] === 1 ? ' reserva' : ' reservas') + '</b></div>').join('') +
      (bloq ? '<div class="dato p-Bloqueo"><span><i class="punto"></i>Bloqueadas</span><b>' + nTxt(bloq) + '</b></div>' : '') +
      '<div class="dato"><span><i class="punto" style="background:var(--line)"></i>Libres</span><b>' + nTxt(libres) + '</b></div></div>';
  });
  if (apts.length > 1 && tot.total) h += '<div class="hint" style="text-align:center">Los dos apartamentos: <b>' + Math.round(tot.ocup * 100 / tot.total) + '%</b> de ocupación</div>';
  if (mesOc >= D.hoy.slice(0, 7)) h += '<div class="hint" style="text-align:center">Cuenta lo reservado hasta hoy; puede subir con nuevas reservas.</div>';
  $('#vista').innerHTML = h;
}

/* ---------- Menú ---------- */
function abrirMenu() {
  let h = '<h2>Menú</h2><div class="hint">Has entrado como <b>' + esc(SES.email) + '</b></div><div class="menu-lista">';
  if (SES.admin) h += '<button class="btn" id="m-cal">Calendarios de las plataformas</button><button class="btn" id="m-disp">Dispositivos conectados</button><button class="btn" id="m-reg">Registro de actividad</button>';
  h += '<button class="btn peligro" id="m-salir">Cerrar sesión en este móvil</button><button class="btn prim" id="m-cerrar">Volver</button></div><div class="msg" id="m-msg"></div>';
  abrirHoja(h);
  if (SES.admin) { $('#m-cal').onclick = abrirCalendarios; $('#m-disp').onclick = abrirDispositivos; $('#m-reg').onclick = () => abrirRegistro(); }
  $('#m-cerrar').onclick = cerrarHoja;
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
  calendario_mal: ['⚠️', 'Un calendario no se puede leer (aviso enviado)'],
  calendario_ok: ['✅', 'Calendario arreglado'],
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
    const alerta = /fallo|bloqueado|no_autorizado|expulsado|token_invalido|sin_permiso|peticion_rara|limite|caducado$|calendario_mal/.test(x.k);
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

/* ---------- Eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  const ac = t.closest('[data-accion]');
  if (ac) { if (ac.dataset.accion === 'recargar') cargar(); else if (ac.dataset.accion === 'calendarios') abrirCalendarios(); return; }
  if (t.closest('.hoja') && !t.closest('[data-id]')) return;
  const tb = t.closest('.tabs button'); if (tb) { tab = tb.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const ch = t.closest('[data-filtro]'); if (ch) { filtro = ch.dataset.filtro; render(); return; }
  const mo = t.closest('[data-mesoc]');
  if (mo) { const p = mesOc.split('-').map(Number); mesOc = new Date(Date.UTC(p[0], p[1] - 1 + Number(mo.dataset.mesoc), 1)).toISOString().slice(0, 7); render(); return; }
  const mb = t.closest('[data-mes]');
  if (mb) { const p = mes.split('-').map(Number); const d = new Date(Date.UTC(p[0], p[1] - 1 + Number(mb.dataset.mes), 1)); mes = d.toISOString().slice(0, 7); diaSel = null; render(); return; }
  const di = t.closest('[data-dia]'); if (di) { diaSel = di.dataset.dia; if (diaSel.slice(0, 7) !== mes) mes = diaSel.slice(0, 7); render(); return; }
  const re = t.closest('[data-id]'); if (re) abrirReserva(re.dataset.id);
});
$('#velo').addEventListener('click', e => { if (e.target.id === 'velo') cerrarHoja(); });
$('#btnSync').onclick = sincronizar;
$('#btnMenu').onclick = abrirMenu;

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
