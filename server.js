// Mundo Virtual - servidor multijugador (HTTP + WebSocket). Uso: npm install && npm start
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

// ---- Configuración para publicar en internet (v6.32); todo es opcional y por variables de entorno ----
// PORT (3001) · HOST (todas las interfaces) · DATA_DIR (carpeta de world.json y uploads/; por defecto la del proyecto: en un servidor, un volumen persistente)
// TRUST_PROXY=1 (detrás de nginx/Caddy/Cloudflare: la IP real sale de X-Forwarded-For) · ALLOWED_ORIGINS=https://mundo.ejemplo.com,... (solo esas páginas pueden abrir el WebSocket; vacío = cualquiera)
// MAX_CONN_IP (20): conexiones simultáneas por IP · GET /healthz responde {ok:true} para comprobaciones de salud
const PORT = process.env.PORT || 3001, HOST = process.env.HOST || '0.0.0.0';
const DATA = path.resolve(process.env.DATA_DIR || __dirname), TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || '');
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim().toLowerCase().replace(/\/$/, '')).filter(Boolean);
const MAX_CONN_IP = Math.max(1, parseInt(process.env.MAX_CONN_IP, 10) || 20);
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {}
const FILE = path.join(DATA, 'world.json');
const PUB = path.join(__dirname, 'public');
const UP = path.join(DATA, 'uploads');
// IP del cliente: con TRUST_PROXY se toma la última dirección de X-Forwarded-For (la que añadió tu proxy); sin él, la del socket (así nadie puede falsearla con una cabecera)
function clientIp(req) {
  if (TRUST_PROXY) { const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean); if (xf.length) return xf[xf.length - 1]; }
  return (req.socket && req.socket.remoteAddress) || '?';
}
const connPerIp = new Map();
const MAX_ITEMS = 5000, MAX_PER_USER = 500, MAX_MODELS_PER_USER = 30;
const MIN_SCALE = 0.01, MAX_SCALE = 100;   // v6.29: límite de tamaño único (el cliente usa el mismo rango, en el mismo orden de magnitud que OpenSim: 0,001–256)
const MAX_GLB = 8 * 1024 * 1024, MAX_IMG = 2 * 1024 * 1024, MAX_DIM = 4096, MAX_VERTS = 200000;
const MAX_ASSETS_PER_USER = 40, MAX_BYTES_PER_USER = 60 * 1024 * 1024, MAX_BYTES_TOTAL = 1024 * 1024 * 1024;
try { fs.mkdirSync(UP, { recursive: true }); } catch (e) {}

// ---- Mundo persistente (archivo JSON) ----
let world = { next: 1, items: [] };
try { world = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) {}
if (!world.assets || typeof world.assets !== 'object') world.assets = {};
for (const id of Object.keys(world.assets)) if (!fs.existsSync(path.join(UP, id))) delete world.assets[id];   // archivo desaparecido
// ---- Varios mundos (v5.8): cada mundo tiene sus propios objetos; los archivos subidos son comunes ----
const WTHEMES = new Set(['pradera', 'desierto', 'nieve', 'noche', 'marte']);
const MAX_WORLDS = 50, MAX_WORLDS_PER_USER = 5;
// ---- Parcelas (v6.1): rectángulos con dueño, permiso de construir y máximo de objetos (modelo de fincas/parcelas de OpenSim) ----
const MAX_PARCELS = 100, MAX_PARCELS_PER_USER = 3, P_MIN = 4, P_MAX = 32, P_DEF_MAX = 100;
const inP = (p, x, z) => x >= p.x1 && x < p.x2 && z >= p.z1 && z < p.z2;
const parcelAt = (W, x, z) => (W.parcels || []).find(p => inP(p, x, z));
const countIn = (W, p) => W.items.filter(i => !i.att && inP(p, i.pos[0], i.pos[2])).length;
function canPlace(W, me, pos, oldPos) {   // null si se puede dejar un objeto ahí; si no, el motivo
  const p = parcelAt(W, pos[0], pos[2]);
  if (!p) return null;
  if (oldPos) { const q = parcelAt(W, oldPos[0], oldPos[2]); if (q === p) return null; }   // ya estaba dentro: moverlo no cambia nada
  if (p.build === 'owner' && p.owner !== me.uid) return 'La parcela «' + p.name + '» es de ' + p.ownerName + ': solo su dueño puede construir ahí.';
  if (countIn(W, p) >= p.max) return 'La parcela «' + p.name + '» ya tiene el máximo de ' + p.max + ' objetos.';
  return null;
}
// ---- Inventario personal (v6.0): por jugador, común a todos los mundos ----
const MAX_INV = 200;
if (!world.inv || typeof world.inv !== 'object') world.inv = {};
if (!world.worlds || typeof world.worlds !== 'object') {
  world.worlds = { main: { name: 'Mundo principal', theme: 'pradera', owner: '', ownerName: 'Sistema', created: Date.now(), items: Array.isArray(world.items) ? world.items : [] } };
}
delete world.items;
if (!world.worlds.main) world.worlds.main = { name: 'Mundo principal', theme: 'pradera', owner: '', ownerName: 'Sistema', created: Date.now(), items: [], parcels: [] };
for (const w of Object.values(world.worlds)) { if (!Array.isArray(w.parcels)) w.parcels = []; if (!Array.isArray(w.items)) w.items = []; if (!WTHEMES.has(w.theme)) w.theme = 'pradera'; }
let timer = null;
// Guardado atómico (v5.9): se escribe a un archivo temporal y se renombra, así un corte a mitad no deja world.json roto
function saveNow() { const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(world)); fs.renameSync(tmp, FILE); }
function persist() { clearTimeout(timer); timer = setTimeout(() => { try { saveNow(); } catch (e) { console.error('No se pudo guardar world.json:', e.message); } }, 500); }
for (const sg of ['SIGINT', 'SIGTERM']) process.on(sg, () => { try { saveNow(); } catch (e) {} process.exit(0); });

// ---- Permisos (v5.9), modelo de máscaras de OpenSim: copiar, modificar y transferir ----
// Cada objeto suelto guarda: creator (quien lo hizo), cur (lo que puede hacer SU DUEÑO ACTUAL) y next (lo que podrá hacer el SIGUIENTE dueño).
// Al regalar un objeto, el nuevo dueño recibe como permisos actuales los «next». Nadie puede dar más permisos de los que tiene.
const PK = ['copy', 'mod', 'trans'];
const permAll = () => ({ copy: true, mod: true, trans: true });
const permOf = (p, max) => { const o = {}; for (const k of PK) o[k] = (p && typeof p === 'object' ? !!p[k] : true) && (!max || !!max[k]); return o; };
const PERM_TXT = { copy: 'copiar', mod: 'modificar', trans: 'transferir' };
const coreOf = it => { const c = Object.assign({}, it); for (const k of ['id', 'owner', 'ownerName', 'creator', 'creatorName', 'cur', 'next', 'pos', 'rot', 'att']) delete c[k]; return JSON.stringify(c); };   // lo que cuenta como «modificar»
function fixPerms(it) { if (!it.creator) { it.creator = it.owner || ''; it.creatorName = it.ownerName || ''; } it.cur = permOf(it.cur); it.next = permOf(it.next); }
for (const w of Object.values(world.worlds)) w.items.forEach(fixPerms);
for (const l of Object.values(world.inv)) if (Array.isArray(l)) l.forEach(e => e.item && fixPerms(e.item));

// ---- Validación: solo se acepta lo que el editor sabe crear ----
const TYPES = new Set(['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'plane', 'tetra', 'octa', 'icosa', 'dodeca', 'hemi', 'tube', 'capsule', 'ramp', 'stairs', 'arch', 'prism', 'frustum', 'disc', 'octprism', 'pent', 'ring', 'star', 'heart', 'cross', 'lshape', 'knot', 'spring']);
const MATS = new Set(['mate', 'metal', 'brillo', 'vidrio', 'luz']);
const ATT = new Set(['', 'head', 'hand']);   // dónde se lleva un objeto: mundo, cabeza o mano
const TEX = new Set(['', 'ladrillo', 'madera', 'ajedrez', 'cesped', 'marmol']);
const ID_GLB = /^[0-9a-f]{64}\.glb$/, ID_IMG = /^[0-9a-f]{64}\.(png|jpg|webp)$/;
const texOk = t => TEX.has(t) || (typeof t === 'string' && t.startsWith('u:') && ID_IMG.test(t.slice(2)) && !!world.assets[t.slice(2)]);
// ---- Aspecto del avatar (v5.5): colores, altura y complexión, siempre dentro de límites ----
const HEX = /^#[0-9a-f]{6}$/i;
function cleanLook(l) {
  const o = {};
  if (!l || typeof l !== 'object') return o;
  if (typeof l.color === 'string' && HEX.test(l.color)) o.color = l.color;
  if (l.c2 === '' || (typeof l.c2 === 'string' && HEX.test(l.c2))) o.c2 = l.c2;
  if (Number.isFinite(l.h)) o.h = Math.min(1.25, Math.max(0.8, l.h));
  if (Number.isFinite(l.w)) o.w = Math.min(1.2, Math.max(0.85, l.w));
  return o;
}
// ---- Reglas (v6.2): scripting seguro por datos (evento → acciones), sin código libre ----
// Eventos: touch (tocar), timer (cada N s, mínimo 1), near (alguien se acerca) y start (al empezar). Acciones: move, rot, vis, color, say, tp, reset.
const RULE_EV = new Set(['touch', 'timer', 'near', 'start']);
const MAX_RULES = 8, MAX_ACTS = 6, MAX_RULED = 200, MAX_RULED_USER = 40, SAY_MAX = 100, SAY_RANGE = 20, TOUCH_RANGE = 15;
const nclamp = (n, lo, hi, def) => Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
const r3 = (a, lo, hi) => Array.isArray(a) && a.length === 3 ? a.map(n => +nclamp(n, lo, hi, 0).toFixed(2)) : null;
function cleanActs(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const a of list.slice(0, MAX_ACTS)) {
    if (!a || typeof a !== 'object') continue;
    if (a.a === 'move') { const to = r3(a.to, -50, 50); if (to) out.push({ a: 'move', to, t: +nclamp(a.t, 0, 30, 1).toFixed(2), tog: !!a.tog }); }
    else if (a.a === 'rot') { const to = r3(a.to, -360, 360); if (to) out.push({ a: 'rot', to, t: +nclamp(a.t, 0, 30, 1).toFixed(2), tog: !!a.tog }); }
    else if (a.a === 'vis') { if (a.v === 'show' || a.v === 'hide' || a.v === 'toggle') out.push({ a: 'vis', v: a.v }); }
    else if (a.a === 'color') { if (typeof a.c === 'string' && HEX.test(a.c)) out.push({ a: 'color', c: a.c.toLowerCase() }); }
    else if (a.a === 'say') { const text = String(a.text || '').replace(/[<>]/g, '').trim().slice(0, SAY_MAX); if (text) out.push({ a: 'say', text }); }
    else if (a.a === 'tp') { const to = r3(a.to, -500, 500); if (to) { to[1] = Math.max(0, to[1]); out.push({ a: 'tp', to }); } }
    else if (a.a === 'reset') out.push({ a: 'reset' });
  }
  return out;
}
function cleanRules(list) {   // devuelve la lista saneada o null si no queda ninguna regla válida
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const r of list.slice(0, MAX_RULES)) {
    if (!r || typeof r !== 'object' || !RULE_EV.has(r.ev)) continue;
    const acts = cleanActs(r.acts); if (!acts.length) continue;
    const o = { ev: r.ev };
    if (r.ev === 'timer') o.every = +nclamp(r.every, 1, 3600, 5).toFixed(1);   // temporizador mínimo: 1 s
    if (r.ev === 'near') o.r = +nclamp(r.r, 1, 20, 4).toFixed(1);
    o.acts = acts; out.push(o);
  }
  return out.length ? out : null;
}
const v3 = a => Array.isArray(a) && a.length === 3 && a.every(n => Number.isFinite(n) && Math.abs(n) < 1000);
const MAX_GDEPTH = 3, MAX_LEAVES = 200;   // v6.28: grupos anidados: hasta 3 niveles y 200 piezas en total
const MAX_CSG_TRI = 3000;   // v6.37: triángulos máximos de una pieza combinada (CSG)
function cleanCsg(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.v) || !Array.isArray(c.g) || c.g.length !== 2) return null;
  if (!c.v.length || c.v.length % 9 || c.v.length > 9 * MAX_CSG_TRI) return null;
  if (!c.v.every(n => Number.isInteger(n) && Math.abs(n) <= 200000)) return null;
  if (!c.g.every(n => Number.isInteger(n) && n >= 0 && n % 3 === 0) || c.g[0] + c.g[1] !== c.v.length / 3) return null;
  return { v: c.v.slice(), g: c.g.slice() };
}
const PRIM_TYPES = new Set(['box', 'cylinder', 'prism']);   // v6.33: parámetros de prim (ver public/prim.js)
function cleanPrim(p) {
  if (!p || typeof p !== 'object') return null;
  const r = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; };
  const cb = r(p.cutB, 0, 0.98, 0), ce = Math.min(1, Math.max(r(p.cutE, 0.02, 1, 1), cb + 0.02));
  return { cutB: cb, cutE: ce, hollow: r(p.hollow, 0, 0.95, 0), twistB: r(p.twistB, -180, 180, 0), twistE: r(p.twistE, -180, 180, 0), taperX: r(p.taperX, -1, 1, 0), taperY: r(p.taperY, -1, 1, 0), shearX: r(p.shearX, -1, 1, 0), shearY: r(p.shearY, -1, 1, 0) };
}
// v6.39: textura y transparencia por cara de un prim. Son arreglos paralelos a `faces` (5 entradas: arriba, abajo, lado, corte, interior).
// Una textura de cara sigue las mismas reglas que la de la pieza (de la lista fija, o `u:<hash>.png|jpg|webp`; en objetos el archivo debe existir en el servidor y,
// si no, esa cara queda sin textura propia; en plantillas solo se comprueba el formato, como con `tex`). La opacidad se limita a 0,10–1 (como SL, nunca del todo invisible).
const texFmt = t => TEX.has(t) || (typeof t === 'string' && t.startsWith('u:') && ID_IMG.test(t.slice(2)));
function cleanFaceTex(a, ok) { if (!Array.isArray(a) || a.length !== 5) return null; const r = a.map(t => (typeof t === 'string' && t && ok(t)) ? t : ''); return r.some(Boolean) ? r : null; }
function cleanFaceOp(a) { if (!Array.isArray(a) || a.length !== 5) return null; const r = a.map(v => (typeof v === 'number' && Number.isFinite(v)) ? +Math.min(1, Math.max(0.1, v)).toFixed(2) : 1); return r.some(v => v < 1) ? r : null; }
// v6.39b: `ftf` = transformación de la textura por cara: 5 entradas, cada una null (sin cambio) o [repetirX, repetirY, desplazarX, desplazarY, giro°]; repetir ±0,1–16 (negativo = espejo), desplazar ±1, giro ±180
function cleanFaceTf(a) {
  if (!Array.isArray(a) || a.length !== 5) return null;
  const n = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v)) ? +Math.min(hi, Math.max(lo, v)).toFixed(2) : d;
  const r = a.map(x => {
    if (!Array.isArray(x) || x.length !== 5) return null;
    let rx = n(x[0], -16, 16, 1), ry = n(x[1], -16, 16, 1); if (Math.abs(rx) < 0.1) rx = rx < 0 ? -0.1 : 0.1; if (Math.abs(ry) < 0.1) ry = ry < 0 ? -0.1 : 0.1;
    const t = [rx, ry, n(x[2], -1, 1, 0), n(x[3], -1, 1, 0), n(x[4], -180, 180, 0)];
    return (t[0] === 1 && t[1] === 1 && !t[2] && !t[3] && !t[4]) ? null : t;
  });
  return r.some(Boolean) ? r : null;
}
// v6.41: `fgl` = brillo (glow) por cara: 5 números 0–1 (0 = sin brillo); la cara emite su propio color
function cleanFaceGl(a) { if (!Array.isArray(a) || a.length !== 5) return null; const r = a.map(v => (typeof v === 'number' && Number.isFinite(v)) ? +Math.min(1, Math.max(0, v)).toFixed(2) : 0); return r.some(v => v > 0) ? r : null; }
// v6.43: `lz` = luz real de una pieza: [intensidad 0,1–3, radio 2–40 m]; solo en formas (no en grupos ni modelos). El cliente enciende como mucho las 6 más cercanas.
function cleanLz(a) { if (!Array.isArray(a) || a.length !== 2 || typeof a[0] !== 'number' || typeof a[1] !== 'number' || !Number.isFinite(a[0]) || !Number.isFinite(a[1])) return null; return [+Math.min(3, Math.max(0.1, a[0])).toFixed(2), +Math.min(40, Math.max(2, a[1])).toFixed(1)]; }
// v6.42: `fsh` = brillo especular (shininess) por cara: 5 enteros 0–3 (0 = el de la pieza, 1 bajo, 2 medio, 3 alto)
function cleanFaceSh(a) { if (!Array.isArray(a) || a.length !== 5) return null; const r = a.map(v => (Number.isInteger(v) && v >= 0 && v <= 3) ? v : 0); return r.some(v => v > 0) ? r : null; }
function faceExtra(d, o, ok) { const ft = cleanFaceTex(d.ftex, ok), fo = cleanFaceOp(d.fop), tf = cleanFaceTf(d.ftf), fg = cleanFaceGl(d.fgl), sh = cleanFaceSh(d.fsh); if (sh) o.fsh = sh; if (ft) o.ftex = ft; if (fo) o.fop = fo; if (tf) o.ftf = tf; if (fg) o.fgl = fg; }
const MAX_Y = 150, MIN_Y = -20;   // altura permitida a un avatar (v6.44)
function clean(d, depth = 0, ctr = { n: 0 }) {
  if (!d || typeof d !== 'object' || !v3(d.pos) || !v3(d.rot) || !v3(d.scale)) return null;
  const o = { pos: d.pos, rot: d.rot, scale: d.scale.map(n => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))) };
  if (depth === 1) { const rl = cleanRules(d.rules); if (rl) o.rules = rl; }   // v6.19: una pieza (o subgrupo) de primer nivel dentro de un grupo puede llevar reglas (puertas, portones); las de niveles más profundos se descartan
  if (!depth && ATT.has(d.att || '') && d.att) o.att = d.att;
  if (!depth) { const rl = cleanRules(d.rules); if (rl) o.rules = rl; const nm = String(d.name || '').replace(/[<>]/g, '').trim().slice(0, 63), ds = String(d.desc || '').replace(/[<>]/g, '').trim().slice(0, 127); if (nm) o.name = nm; if (ds) o.desc = ds; }   // reglas (v6.2): solo en objetos de primer nivel
  if (Array.isArray(d.children)) {
    if (depth >= MAX_GDEPTH || d.children.length < 1 || d.children.length > MAX_LEAVES) return null;
    o.children = [];
    for (const c of d.children) { const k = clean(c, depth + 1, ctr); if (!k || !(k.type || k.children)) return null; o.children.push(k); }
    return o;
  }
  if (d.type === 'model') {   // modelo glTF subido: solo como objeto suelto y solo si el archivo existe en el servidor
    if (depth || typeof d.src !== 'string' || !ID_GLB.test(d.src) || !world.assets[d.src]) return null;
    o.type = 'model'; o.src = d.src; o.color = '#ffffff'; o.mat = 'mate'; o.tex = '';
    return o;
  }
  if (d.type === 'csg') {   // v6.37: pieza combinada con su malla guardada
    const cs = cleanCsg(d.csg);
    if (!cs || !/^#[0-9a-f]{6}$/i.test(d.color) || !MATS.has(d.mat) || (depth && ++ctr.n > MAX_LEAVES)) return null;
    o.type = 'csg'; o.color = d.color; o.mat = d.mat; o.tex = ''; o.csg = cs;
    if (Array.isArray(d.faces) && d.faces.length === 2) o.faces = d.faces.map(f => (typeof f === 'string' && /^#[0-9a-f]{6}$/i.test(f)) ? f : '');
    return o;
  }
  if (!TYPES.has(d.type) || !/^#[0-9a-f]{6}$/i.test(d.color) || !MATS.has(d.mat)) return null;
  if (depth && ++ctr.n > MAX_LEAVES) return null;
  o.type = d.type; o.color = d.color; o.mat = d.mat; o.tex = texOk(d.tex || '') ? (d.tex || '') : '';
  if (PRIM_TYPES.has(d.type) && d.prim) {
    const pr = cleanPrim(d.prim);
    if (pr) { o.prim = pr; if (Array.isArray(d.faces) && d.faces.length === 5) o.faces = d.faces.map(f => (typeof f === 'string' && /^#[0-9a-f]{6}$/i.test(f)) ? f : ''); faceExtra(d, o, texOk); }
  }
  { const lz = cleanLz(d.lz); if (lz) o.lz = lz; }
  return o;
}

// ---- Archivos subidos: se comprueba el CONTENIDO real, no la extensión ----
const GLB_OK_EXT = new Set(['KHR_materials_unlit', 'KHR_materials_clearcoat', 'KHR_materials_transmission', 'KHR_materials_pbrSpecularGlossiness', 'KHR_texture_transform', 'KHR_mesh_quantization', 'EXT_texture_webp']);
function checkGlb(b) {
  if (b.length < 28 || b.toString('latin1', 0, 4) !== 'glTF' || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) return 'No es un GLB válido (glTF 2.0 binario).';
  const jl = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4E4F534A || 20 + jl > b.length) return 'GLB dañado.';
  let j; try { j = JSON.parse(b.toString('utf8', 20, 20 + jl)); } catch (e) { return 'GLB dañado (JSON).'; }
  if (!j.asset || !String(j.asset.version).startsWith('2')) return 'Solo se admite glTF 2.0.';
  for (const x of (j.extensionsRequired || [])) if (!GLB_OK_EXT.has(x)) return 'Extensión no admitida: ' + String(x).slice(0, 40) + ' (no uses compresión Draco/Meshopt/Basis).';
  for (const x of (j.extensionsUsed || [])) if (/draco|meshopt|basisu|lights/i.test(x)) return 'Extensión no admitida: ' + String(x).slice(0, 40) + '.';
  for (const e of [...(j.buffers || []), ...(j.images || [])]) if (e && e.uri && !String(e.uri).startsWith('data:')) return 'El modelo no puede enlazar archivos externos; exporta un GLB con todo incluido.';
  if ((j.nodes || []).length > 3000 || (j.images || []).length > 16 || (j.meshes || []).length > 500) return 'Modelo demasiado complejo.';
  let verts = 0;
  for (const m of (j.meshes || [])) for (const pr of (m.primitives || [])) {
    const a = (j.accessors || [])[pr.attributes && pr.attributes.POSITION]; if (a && Number.isFinite(a.count)) verts += a.count;
  }
  if (verts > MAX_VERTS) return 'Demasiados vértices (' + verts + '; máximo ' + MAX_VERTS + ').';
  return null;
}
function imgInfo(b) {   // devuelve { ext, w, h } o null
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504E47 && b.readUInt32BE(4) === 0x0D0A1A0A) return { ext: 'png', w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xFF) { i++; continue; }
      const mk = b[i + 1];
      if (mk === 0xFF) { i++; continue; }
      if (mk === 0xD8 || mk === 0x01 || (mk >= 0xD0 && mk <= 0xD7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (mk >= 0xC0 && mk <= 0xCF && mk !== 0xC4 && mk !== 0xC8 && mk !== 0xCC) return { ext: 'jpg', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const f = b.toString('latin1', 12, 16);
    if (f === 'VP8X') return { ext: 'webp', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (f === 'VP8 ') return { ext: 'webp', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const bits = b.readUInt32LE(21); return { ext: 'webp', w: (bits & 0x3FFF) + 1, h: ((bits >> 14) & 0x3FFF) + 1 }; }
  }
  return null;
}
const jres = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
function handleUpload(req, res) {
  const tok = req.headers['x-token'];
  if (typeof tok !== 'string' || tok.length < 8 || tok.length > 200) return jres(res, 401, { error: 'Sin identidad: recarga la página.' });
  const uid = crypto.createHash('sha1').update(tok).digest('hex').slice(0, 10);
  const declared = parseInt(req.headers['content-length'], 10);
  if (!Number.isFinite(declared) || declared < 1) return jres(res, 411, { error: 'Falta el tamaño del archivo.' });
  if (declared > MAX_GLB) return jres(res, 413, { error: 'Archivo demasiado grande (máximo 8 MB para modelos y 2 MB para imágenes).' });
  const parts = []; let got = 0, dead = false;
  req.on('data', c => { got += c.length; if (got > MAX_GLB && !dead) { dead = true; jres(res, 413, { error: 'Archivo demasiado grande.' }); req.destroy(); } else if (!dead) parts.push(c); });
  req.on('error', () => {});
  req.on('end', () => {
    if (dead) return;
    const b = Buffer.concat(parts);
    let kind, ext;
    if (b.toString('latin1', 0, 4) === 'glTF') {
      const err = checkGlb(b); if (err) return jres(res, 400, { error: err });
      kind = 'model'; ext = 'glb';
    } else {
      const inf = imgInfo(b);
      if (!inf) return jres(res, 400, { error: 'Formato no admitido. Usa GLB para modelos, o PNG, JPG o WebP para imágenes.' });
      if (b.length > MAX_IMG) return jres(res, 413, { error: 'La imagen supera 2 MB.' });
      if (!(inf.w > 0 && inf.h > 0) || inf.w > MAX_DIM || inf.h > MAX_DIM) return jres(res, 400, { error: 'La imagen debe medir como máximo ' + MAX_DIM + '×' + MAX_DIM + ' píxeles.' });
      kind = 'image'; ext = inf.ext;
    }
    const id = crypto.createHash('sha256').update(b).digest('hex') + '.' + ext;
    if (world.assets[id]) { try { const t = new Date(); fs.utimesSync(path.join(UP, id), t, t); } catch (e) {} return jres(res, 200, { id, kind, dup: true }); }   // ya existe: se reutiliza (y se refresca su fecha para que la limpieza no lo borre antes de colocarlo)
    const mine = Object.values(world.assets).filter(a => a.owner === uid);
    const total = Object.values(world.assets).reduce((n, a) => n + a.size, 0);
    if (mine.length >= MAX_ASSETS_PER_USER) return jres(res, 429, { error: 'Has alcanzado el máximo de ' + MAX_ASSETS_PER_USER + ' archivos subidos.' });
    if (mine.reduce((n, a) => n + a.size, 0) + b.length > MAX_BYTES_PER_USER) return jres(res, 429, { error: 'Superas tu cuota de 60 MB.' });
    if (total + b.length > MAX_BYTES_TOTAL) return jres(res, 507, { error: 'El servidor no tiene más espacio para archivos.' });
    fs.writeFile(path.join(UP, id), b, e => {
      if (e) return jres(res, 500, { error: 'No se pudo guardar el archivo.' });
      world.assets[id] = { owner: uid, size: b.length, kind }; persist();
      jres(res, 200, { id, kind });
    });
  });
}

// ---- Servidor HTTP estático ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent(req.url.split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end('{"ok":true}'); }
  if (req.method === 'POST' && p === '/upload') return handleUpload(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (p === '/') p = '/index.html';
  const up = /^\/uploads\/([0-9a-f]{64}\.(glb|png|jpg|webp))$/.exec(p);   // archivos subidos: solo nombres por hash conocidos
  const f = up ? path.join(UP, up[1]) : path.normalize(path.join(PUB, p));
  if (!up && !f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e || (up && !world.assets[up[1]])) { res.writeHead(404); return res.end('No encontrado'); }
    const h = { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    if (up) h['Cache-Control'] = 'public, max-age=31536000, immutable';
    res.writeHead(200, h); res.end(d);
  });
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024, verifyClient: (info, cb) => {
  const o = String(info.origin || '').toLowerCase().replace(/\/$/, '');
  if (ORIGINS.length && !ORIGINS.includes(o)) return cb(false, 403, 'Origen no permitido');   // evita que otra web abra conexiones con tu navegador
  if ((connPerIp.get(clientIp(info.req)) || 0) >= MAX_CONN_IP) return cb(false, 429, 'Demasiadas conexiones');
  cb(true);
} });
const players = new Map();
const EMOTES = new Set(['Wave', 'Dance', 'ThumbsUp', 'Yes', 'No']);
const COLORS = ['#e4572e', '#17bebb', '#ffc914', '#76b041', '#a15ecf', '#f28f3b', '#4c9aff', '#e85d9a'];
let nid = 1;
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
const bcast = (m, except, wid) => { for (const [ws, p] of players) if (ws !== except && p.world === wid) send(ws, m); };   // solo a quien está en ese mundo
// ---- Interés por cercanía (v6.18): cada jugador solo recibe los objetos cercanos ----
// Entra a 170 m (contando el tamaño del objeto) y sale a 200 m. Siempre se envían los tuyos y los acoplados al avatar. me.known = ids que el cliente ya tiene.
const NEAR_IN = 170, NEAR_OUT = 200;
const grpR = c => { const k = Math.max(...c.scale); if (!c.children) return k; let r = 0; for (const q of c.children) r = Math.max(r, Math.hypot(q.pos[0], q.pos[1], q.pos[2]) + grpR(q)); return Math.max(k, r * k); };
const itRadius = it => { const k = Math.max(...it.scale); if (!it.children) return k; let r = 0; for (const c of it.children) r = Math.max(r, Math.hypot(c.pos[0], c.pos[1], c.pos[2]) + grpR(c)); return Math.max(k, r * k); };
const relevant = (me, it, lim) => it.att || it.owner === me.uid || Math.hypot(it.pos[0] - me.x, it.pos[2] - me.z) - itRadius(it) < lim;
const knownOf = me => (me.known = me.known || new Set());
function ibcast(m, except, wid) {   // difunde add / upd / del / fx de un objeto solo a quien lo tiene o debería tenerlo
  const id = m.item ? m.item.id : (m.pid !== undefined ? m.pid : m.id);
  for (const [ws, p] of players) {
    if (p.world !== wid || ws === except) continue;
    const k = knownOf(p), has = k.has(id);
    if (m.t === 'add' || m.t === 'upd') {
      if (has || relevant(p, m.item, NEAR_IN)) { k.add(id); send(ws, m); }
    } else if (m.t === 'del') { if (has) { k.delete(id); send(ws, m); } }
    else if (has) send(ws, m);   // fx
  }
}
function syncKnown(ws, me) {   // añade lo que entra en rango y olvida lo que sale; se llama al moverse más de 12 m
  const W = world.worlds[me.world]; if (!W) return;
  const k = knownOf(me), add = [], drop = [], fx = {}, st = RT.get(me.world), seen = new Set();
  for (const it of W.items) {
    seen.add(it.id);
    if (!k.has(it.id)) { if (relevant(me, it, NEAR_IN)) { add.push(it); k.add(it.id); if (st) for (const [fk, fv] of st) if (Number(String(fk).split('.')[0]) === it.id) fx[fk] = fv; } }
    else if (!relevant(me, it, NEAR_OUT)) { drop.push(it.id); k.delete(it.id); }
  }
  for (const id of [...k]) if (!seen.has(id)) k.delete(id);
  me.sx = me.x; me.sz = me.z;
  if (add.length || drop.length) send(ws, { t: 'items', add, drop, fx });
}
const pub = p => ({ id: p.id, uid: p.uid, name: p.name, color: p.color, h: p.h, w: p.w, c2: p.c2, x: p.x, y: p.y, z: p.z, ry: p.ry, st: p.st });
const invOf = uid => (world.inv[uid] = Array.isArray(world.inv[uid]) ? world.inv[uid] : []);
const invName = it => (it.children ? 'Grupo (' + it.children.length + ')' : it.type === 'model' ? 'Modelo importado' : ({ box: 'Cubo', sphere: 'Esfera', cylinder: 'Cilindro', cone: 'Cono', pyramid: 'Pirámide', torus: 'Toro', plane: 'Plano', tetra: 'Tetraedro', octa: 'Octaedro', icosa: 'Icosaedro', dodeca: 'Dodecaedro', hemi: 'Cúpula', tube: 'Tubo', capsule: 'Cápsula', ramp: 'Rampa', stairs: 'Escalera', arch: 'Arco', prism: 'Prisma', frustum: 'Tronco', disc: 'Disco', octprism: 'Octaprisma', pent: 'Pentaprisma', ring: 'Anillo', star: 'Estrella', heart: 'Corazón', cross: 'Cruz', lshape: 'Muro en L', knot: 'Nudo', spring: 'Resorte' }[it.type] || 'Objeto'));
const invList = uid => invOf(uid).map(e => ({ id: e.id, name: e.name, n: e.item.children ? e.item.children.length : 0, type: e.item.children ? 'group' : e.item.type, color: e.item.color || '', creatorName: e.item.creatorName, cur: e.item.cur, next: e.item.next }));
const sendInv = (ws, me) => send(ws, { t: 'inv', list: invList(me.uid) });
const nIn = wid => { let n = 0; for (const p of players.values()) if (p.world === wid) n++; return n; };
const worldList = () => Object.entries(world.worlds).map(([id, w]) => ({ id, name: w.name, theme: w.theme, owner: w.owner, ownerName: w.ownerName, n: nIn(id), items: w.items.length }));
const sendWorlds = () => { const l = worldList(); for (const ws of players.keys()) send(ws, { t: 'worlds', worlds: l }); };
const winfo = id => { const w = world.worlds[id]; return { id, name: w.name, theme: w.theme, owner: w.owner, ownerName: w.ownerName }; };
function enter(ws, me, id, reset) {   // mete al jugador en un mundo y le manda su contenido
  me.world = id;
  if (reset) Object.assign(me, { x: 0, y: 0, z: 3, ry: 0, st: 0 });
  activate(id);
  me.known = new Set(); me.sx = me.x; me.sz = me.z;
  send(ws, { t: 'init', reset: !!reset, world: winfo(id), parcels: world.worlds[id].parcels, fx: Object.fromEntries([...(RT.get(id) || [])]), worlds: worldList(), me: { id: me.id, uid: me.uid, admin: !!me.admin, color: me.color, h: me.h, w: me.w, c2: me.c2 },
    items: world.worlds[id].items.filter(it => relevant(me, it, NEAR_IN)), players: [...players.values()].filter(p => p !== me && p.world === id).map(pub) });
  for (const it of world.worlds[id].items) if (relevant(me, it, NEAR_IN)) me.known.add(it.id);
  bcast({ t: 'join', p: pub(me) }, ws, id);
}
function slug(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '');
}

// ---- Motor de reglas (v6.2) ----
// Un mundo «está activo» mientras haya alguien dentro: entonces corren temporizadores y sensores. Al quedarse vacío se descarta el estado en ejecución
// (puertas abiertas, colores, visibilidad) y al volver a entrar se parte de cero lanzando «Al empezar». El estado en ejecución no se guarda en world.json.
const ACTIVE = new Set(), RT = new Map(), TM = new Map(), NEAR = new Map(), BUD = new Map();
const wsOf = p => { for (const [w, q] of players) if (q === p) return w; return null; };
// v6.19: «nodo con reglas» = el objeto de primer nivel (clave = id) o una pieza de su grupo (clave = «id.índice»). Cada nodo tiene su propio estado en ejecución
const yawPos = (it, c) => { const k = it.scale, x = c.pos[0] * k[0], z = c.pos[2] * k[2], a = it.rot[1] || 0, cs = Math.cos(a), sn = Math.sin(a); return [it.pos[0] + x * cs + z * sn, it.pos[1] + c.pos[1] * k[1], it.pos[2] - x * sn + z * cs]; };
const nodesOf = it => { const out = []; if (it.att) return out; if (it.rules) out.push({ key: it.id, node: it, pos: it.pos }); if (it.children) it.children.forEach((c, i) => { if (c.rules) out.push({ key: it.id + '.' + i, node: c, pos: yawPos(it, c) }); }); return out; };
const rsig = it => JSON.stringify([it.rules || null, (it.children || []).map(c => c.rules || null)]);
const fresh = () => ({ d: [0, 0, 0], dt: 0.5, r: [0, 0, 0], rt: 0.5, v: true, c: null });
const isZero = a => a.every(n => n === 0);
function spend(wid, n) {   // tope de efectos por segundo y mundo (80/s, ráfaga de 160): frena bucles y abusos
  const now = Date.now(); let b = BUD.get(wid);
  if (!b) BUD.set(wid, b = { tok: 160, ts: now });
  b.tok = Math.min(160, b.tok + (now - b.ts) * 0.08); b.ts = now;
  if (b.tok < n) return false;
  b.tok -= n; return true;
}
function runRule(wid, W, it, r, actor, quiet, key = it.id, pos = it.pos) {
  if (!quiet && !spend(wid, 1 + r.acts.length)) return;
  const st = RT.get(wid); if (!st) return;
  let s = st.get(key) || fresh(), ch = false;
  // quién oye al objeto se decide antes de ejecutar las acciones (un teletransporte previo no debe dejar sin oír al jugador)
  const hearers = !quiet && r.acts.some(a => a.a === 'say') ? [...players].filter(([, p]) => p.world === wid && Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]) <= SAY_RANGE) : [];
  for (const a of r.acts) {
    if (a.a === 'move') { s.d = a.tog && !isZero(s.d) ? [0, 0, 0] : a.to.slice(); s.dt = a.t; ch = true; }
    else if (a.a === 'rot') { s.r = a.tog && !isZero(s.r) ? [0, 0, 0] : a.to.slice(); s.rt = a.t; ch = true; }
    else if (a.a === 'vis') { s.v = a.v === 'toggle' ? !s.v : a.v === 'show'; ch = true; }
    else if (a.a === 'color') { s.c = a.c; ch = true; }
    else if (a.a === 'reset') { s = fresh(); ch = true; }
    else if (a.a === 'say' && !quiet) {   // se oye a SAY_RANGE metros, como llSay de Second Life
      for (const [pws] of hearers) send(pws, { t: 'chat', obj: 1, name: 'Objeto de ' + (it.ownerName || 'alguien'), text: a.text });
    } else if (a.a === 'tp' && actor && !quiet) {   // solo teletransporta a quien tocó o se acercó; pausa de 2 s por jugador (evita rebotes entre portales)
      const now = Date.now(), aws = wsOf(actor);
      if (aws && now - (actor.tpAt || 0) >= 2000) { actor.tpAt = now; actor.x = a.to[0]; actor.y = a.to[1]; actor.z = a.to[2]; send(aws, { t: 'tp', x: a.to[0], y: a.to[1], z: a.to[2] }); }
    }
  }
  if (ch) { st.set(key, s); if (!quiet) ibcast({ t: 'fx', id: key, pid: it.id, s }, null, wid); }
}
function activate(wid) {
  if (ACTIVE.has(wid)) return;
  const W = world.worlds[wid]; if (!W) return;
  ACTIVE.add(wid); RT.set(wid, new Map());
  for (const it of W.items) for (const n of nodesOf(it)) for (const r of n.node.rules) if (r.ev === 'start') runRule(wid, W, it, r, null, true, n.key, n.pos);
}
function deact(wid) {
  ACTIVE.delete(wid); RT.delete(wid); BUD.delete(wid);
  for (const m of [TM, NEAR]) for (const k of [...m.keys()]) if (k.startsWith(wid + '|')) m.delete(k);
}
const idleCheck = wid => { if (wid && ACTIVE.has(wid) && nIn(wid) === 0) deact(wid); };
function dropRt(wid, id) {   // olvida el estado en ejecución de un objeto (borrado o con reglas nuevas)
  const st = RT.get(wid);
  if (st) for (const k of [...st.keys()]) if (String(k).split('.')[0] === String(id)) { st.delete(k); ibcast({ t: 'fx', id: k, pid: id, s: null }, null, wid); }
  for (const m of [TM, NEAR]) for (const k of [...m.keys()]) if (k.startsWith(wid + '|' + id + '|') || k.startsWith(wid + '|' + id + '.')) m.delete(k);
}
function rulesRestart(wid, W, it) {   // objeto nuevo o con reglas cambiadas: estado limpio y «Al empezar»
  if (!ACTIVE.has(wid)) return;
  dropRt(wid, it.id);
  for (const n of nodesOf(it)) for (const r of n.node.rules) if (r.ev === 'start') runRule(wid, W, it, r, null, false, n.key, n.pos);
}
const ruledCount = (W, uid) => W.items.reduce((n, i) => n + (!uid || i.owner === uid ? nodesOf(i).length : 0), 0);
function rulesCap(W, me, add = 1) {   // null si caben otros «add» nodos con reglas; si no, el motivo
  if (ruledCount(W) + add > MAX_RULED) return 'Este mundo ya tiene el máximo de ' + MAX_RULED + ' objetos con reglas.';
  if (ruledCount(W, me.uid) + add > MAX_RULED_USER) return 'Ya tienes ' + MAX_RULED_USER + ' objetos con reglas en este mundo.';
  return null;
}
setInterval(() => {
  const now = Date.now();
  for (const wid of [...ACTIVE]) {
    const W = world.worlds[wid], ps = [...players.values()].filter(p => p.world === wid);
    if (!W || !ps.length) { deact(wid); continue; }
    for (const it of W.items) {
      for (const nd of nodesOf(it)) nd.node.rules.forEach((r, i) => {
        if (r.ev !== 'timer' && r.ev !== 'near') return;
        const k = wid + '|' + nd.key + '|' + i;
        if (r.ev === 'timer') {
          const e = TM.get(k);
          if (!e || e.every !== r.every) TM.set(k, { due: now + r.every * 1000, every: r.every });
          else if (now >= e.due) { e.due = now + r.every * 1000; runRule(wid, W, it, r, null, false, nd.key, nd.pos); }
        } else {   // sensor: salta una vez cuando alguien entra en el radio
          let set = NEAR.get(k); if (!set) NEAR.set(k, set = new Set());
          for (const id of [...set]) if (!ps.some(p => p.id === id)) set.delete(id);
          for (const p of ps) {
            const inside = Math.hypot(p.x - nd.pos[0], p.y + 1 - nd.pos[1], p.z - nd.pos[2]) <= r.r;
            if (inside && !set.has(p.id)) { set.add(p.id); runRule(wid, W, it, r, p, false, nd.key, nd.pos); }
            else if (!inside && set.has(p.id)) set.delete(p.id);
          }
        }
      });
    }
  }
}, 250);

// ---- Cuentas con contraseña (v6.6) ----
if (!world.accounts || typeof world.accounts !== 'object') world.accounts = {};
if (!world.sess || typeof world.sess !== 'object') world.sess = {};
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex');
const accKey = n => String(n).trim().toLowerCase();
const accByUid = uid => Object.values(world.accounts).find(a => a.uid === uid);
const NAME_RE = /^[\p{L}\p{N}_ -]{3,20}$/u;
const pwHash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
const pwOk = (a, pw) => { const h = Buffer.from(pwHash(pw, a.salt), 'hex'), g = Buffer.from(a.hash, 'hex'); return h.length === g.length && crypto.timingSafeEqual(h, g); };
const fails = new Map();
const blocked = ip => { const f = fails.get(ip); return !!f && f.n >= 5 && Date.now() - f.t < 600000; };
const addFail = ip => { const f = fails.get(ip); if (!f || Date.now() - f.t > 600000) fails.set(ip, { n: 1, t: Date.now() }); else { f.n++; f.t = Date.now(); } };
const sendAcct = (ws, me) => { const a = accByUid(me.uid); send(ws, { t: 'acct', name: a ? a.name : null, admin: !!me.admin }); };
const adminCount = () => Object.values(world.accounts).filter(a => a.admin).length;

// ---- Amigos y mensajes privados (v6.5) ----
if (!world.friends || typeof world.friends !== 'object') world.friends = {};
const MAX_FRIENDS = 100, pend = new Set();
const friendsOf = uid => (world.friends[uid] = Array.isArray(world.friends[uid]) ? world.friends[uid] : []);
const socketsOf = uid => [...players].filter(([, p]) => p.uid === uid);
function friendList(uid) {
  return friendsOf(uid).map(f => { const s = socketsOf(f.uid)[0], p = s && s[1];
    return { uid: f.uid, name: p ? p.name : f.name, online: !!p, world: p ? ((world.worlds[p.world] || {}).name || '') : '' }; });
}
const pushFriends = uid => { for (const [ws] of socketsOf(uid)) send(ws, { t: 'friends', list: friendList(uid) }); };
const presence = uid => { for (const f of friendsOf(uid)) pushFriends(f.uid); };
function befriend(a, an, b, bn) {
  if (friendsOf(a).some(f => f.uid === b)) return;
  friendsOf(a).push({ uid: b, name: bn }); friendsOf(b).push({ uid: a, name: an }); persist(); pushFriends(a); pushFriends(b);
}

// ---- Plantillas propias, favoritos y recientes en el servidor (v6.27): ligados a la identidad (cuenta), iguales en todos los mundos y navegadores ----
const MAX_TPL = 30, MAX_TPL_BYTES = 900000, MAX_TFAV = 100, MAX_TPL_USERS = 5000;
if (!world.tpl || typeof world.tpl !== 'object') world.tpl = {};
const v3t = a => Array.isArray(a) && a.length === 3 && a.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000);
const txtT = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
function cleanTplS(t) {
  if (!t || typeof t.name !== 'string' || typeof t.id !== 'string' || !/^[\w\-]{1,24}$/.test(t.id) || !Array.isArray(t.children) || t.children.length > 200) return null;
  const models = [];
  if (t.models !== undefined) {
    if (!Array.isArray(t.models) || t.models.length > 10) return null;
    for (const q of t.models) {
      if (!q || typeof q.src !== 'string' || !ID_GLB.test(q.src) || !v3t(q.pos) || !v3t(q.rot) || !v3t(q.scale) || !q.scale.every(n => n > 0 && n <= 100)) return null;
      models.push({ src: q.src, pos: q.pos.slice(), rot: q.rot.slice(), scale: q.scale.slice() });
    }
  }
  if (!t.children.length && !models.length) return null;
  const ch = [];
  for (const c of t.children) {
    if (!c || !TYPES.has(c.type) || typeof c.color !== 'string' || !HEX.test(c.color) || !MATS.has(c.mat) || !v3t(c.pos) || !v3t(c.rot) || !v3t(c.scale)) return null;
    const tx = typeof c.tex === 'string' ? c.tex : '';
    const k = { type: c.type, color: c.color, mat: c.mat, tex: (TEX.has(tx) || (tx.startsWith('u:') && ID_IMG.test(tx.slice(2)))) ? tx : '', pos: c.pos.slice(), rot: c.rot.slice(), scale: c.scale.slice() };
    if (PRIM_TYPES.has(c.type) && c.prim) { const pr = cleanPrim(c.prim); if (pr) { k.prim = pr; if (Array.isArray(c.faces) && c.faces.length === 5) k.faces = c.faces.map(f => (typeof f === 'string' && /^#[0-9a-f]{6}$/i.test(f)) ? f : ''); faceExtra(c, k, texFmt); } }
    { const lz = cleanLz(c.lz); if (lz) k.lz = lz; }
    ch.push(k);
  }
  return { id: t.id, name: txtT(t.name, 24) || 'Plantilla', cat: txtT(t.cat, 16), children: ch, models };
}
function cleanTplData(m) {
  const out = { tpls: [], favs: [], rec: [] }, ids = new Set();
  if (!Array.isArray(m.tpls) || m.tpls.length > MAX_TPL) return null;
  for (const t of m.tpls) { const c = cleanTplS(t); if (!c || ids.has(c.id)) return null; ids.add(c.id); out.tpls.push(c); }
  if (!Array.isArray(m.favs) || m.favs.length > MAX_TFAV) return null;
  for (const f of m.favs) if (typeof f === 'string' && /^[sp]:[\w\-.:]{1,45}$/.test(f) && !out.favs.includes(f)) out.favs.push(f);
  if (!Array.isArray(m.rec) || m.rec.length > 8) return null;
  for (const r of m.rec) if (r && (r.k === 's' || r.k === 'p') && typeof r.v === 'string' && /^[\w\-.:]{1,45}$/.test(r.v)) out.rec.push({ k: r.k, v: r.v });
  return out;
}
const tplPayload = uid => { const d = world.tpl[uid]; return { t: 'tpl', has: !!d, tpls: d ? d.tpls : [], favs: d ? d.favs : [], rec: d ? d.rec : [] }; };
const sendTpl = (ws, me, init) => send(ws, Object.assign(tplPayload(me.uid), { init: !!init }));

wss.on('connection', (ws, req) => {
  ws._ip = clientIp(req); connPerIp.set(ws._ip, (connPerIp.get(ws._ip) || 0) + 1);
  ws._alive = true; ws.on('pong', () => { ws._alive = true; });
  ws.on('close', () => { const n = (connPerIp.get(ws._ip) || 1) - 1; if (n > 0) connPerIp.set(ws._ip, n); else connPerIp.delete(ws._ip); });
  const me = { id: nid++, name: 'Visitante', uid: null, world: 'main', trash: new Map(), color: COLORS[nid % COLORS.length], x: 0, y: 0, z: 3, ry: 0, st: 0, h: 1, w: 1, c2: '' };
  let count = 0; const tick = setInterval(() => { count = 0; }, 1000);
  ws.on('message', raw => {
    if (++count > 120) return;                       // límite de mensajes por segundo
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (me.uid || typeof m.token !== 'string' || m.token.length < 8) return;
      const hh = sha(m.token); me.sh = hh; me.uid = world.sess[hh] || hh.slice(0, 10);   // sesión de una cuenta, o identidad anónima del navegador
      let nm = String(m.name || 'Visitante').replace(/[<>]/g, '').slice(0, 20) || 'Visitante';
      const ac = accByUid(me.uid);
      if (ac) { nm = ac.name; me.admin = !!ac.admin; }
      else { const ow = world.accounts[accKey(nm)]; if (ow) nm = (nm.slice(0, 11) + ' (visit.)').slice(0, 20); }   // nadie se hace pasar por una cuenta
      me.name = nm;
      Object.assign(me, cleanLook(m.look));
      players.set(ws, me);
      const want = typeof m.world === 'string' && Object.prototype.hasOwnProperty.call(world.worlds, m.world) ? m.world : 'main';
      enter(ws, me, want, false);
      sendInv(ws, me); sendTpl(ws, me, true);
      sendWorlds();
      pushFriends(me.uid); presence(me.uid); sendAcct(ws, me);
      return;
    }
    if (!me.uid) return;
    const W = world.worlds[me.world];
    if (m.t === 'move') {
      if (![m.x, m.y, m.z, m.ry].every(Number.isFinite)) return;
      const st = [0, 1, 2, 3, 4].includes(m.st) ? m.st : 0;   // 0 reposo, 1 caminar, 2 correr, 3 en el aire, 4 volando (v6.48)
      {   // v6.49: parcela con «volar: solo su dueño»: quien manda estado 4 (volando) dentro de ella sin permiso no se difunde y vuelve a donde estaba
        const par = st === 4 ? parcelAt(W, m.x, m.z) : null;
        if (par && par.fly === 'owner' && par.owner !== me.uid && !me.admin && !(W.owner && W.owner === me.uid)) {
          if (Number.isFinite(me.x) && Number.isFinite(me.z)) send(ws, { t: 'tp', x: me.x, y: 0, z: me.z });
          return;
        }
      }
      m.y = Math.min(MAX_Y, Math.max(MIN_Y, m.y));   // v6.44: con vuelo, la altura se acota (el cliente ya se limita a 120 m)
      Object.assign(me, { x: m.x, y: m.y, z: m.z, ry: m.ry, st });
      bcast({ t: 'pos', id: me.id, x: m.x, y: m.y, z: m.z, ry: m.ry, st }, ws, me.world);
      if (me.sx === undefined || Math.hypot(m.x - me.sx, m.z - me.sz) > 12) syncKnown(ws, me);
    } else if (m.t === 'look') {
      Object.assign(me, cleanLook(m.look));
      bcast({ t: 'look', id: me.id, look: { color: me.color, h: me.h, w: me.w, c2: me.c2 } }, ws, me.world);
    } else if (m.t === 'emote') {
      if (EMOTES.has(m.n)) bcast({ t: 'emote', id: me.id, n: m.n }, ws, me.world);
    } else if (m.t === 'chat') {
      const text = String(m.text || '').slice(0, 200).trim();
      if (text) bcast({ t: 'chat', name: me.name, text }, null, me.world);
    } else if (m.t === 'freq') {          // invitar a ser amigo (el otro tiene que estar conectado)
      const to = String(m.to || ''), tg = socketsOf(to), say = text => send(ws, { t: 'err', text });
      if (!tg.length || to === me.uid) return say('Ese jugador no está conectado.');
      if (friendsOf(me.uid).some(f => f.uid === to)) return say('Ya sois amigos.');
      if (friendsOf(me.uid).length >= MAX_FRIENDS) return say('Tu lista de amigos está llena (máximo ' + MAX_FRIENDS + ').');
      const tn = tg[0][1].name;
      if (pend.has(to + '>' + me.uid)) { pend.delete(to + '>' + me.uid); if (friendsOf(to).length >= MAX_FRIENDS) return say(tn + ' tiene la lista llena.'); befriend(me.uid, me.name, to, tn); return say('Ahora eres amigo de ' + tn + '.'); }
      pend.add(me.uid + '>' + to); if (pend.size > 2000) pend.delete(pend.values().next().value);
      for (const [tw] of tg) send(tw, { t: 'freq', from: me.uid, name: me.name });
      say('Invitación enviada a ' + tn + '.');
    } else if (m.t === 'fans') {          // responder a una invitación
      const to = String(m.to || ''), k = to + '>' + me.uid;
      if (!pend.has(k)) return; pend.delete(k);
      const rq = socketsOf(to); if (!rq.length) return;
      if (m.ok) {
        if (friendsOf(me.uid).length >= MAX_FRIENDS || friendsOf(to).length >= MAX_FRIENDS) return send(ws, { t: 'err', text: 'No se pudo: una de las listas está llena.' });
        befriend(me.uid, me.name, to, rq[0][1].name);
        for (const [rw] of rq) send(rw, { t: 'err', text: me.name + ' aceptó tu invitación.' });
      } else for (const [rw] of rq) send(rw, { t: 'err', text: me.name + ' rechazó tu invitación.' });
    } else if (m.t === 'fdel') {
      const o = String(m.uid || ''); if (!friendsOf(me.uid).some(f => f.uid === o)) return;
      world.friends[me.uid] = friendsOf(me.uid).filter(f => f.uid !== o); world.friends[o] = friendsOf(o).filter(f => f.uid !== me.uid);
      persist(); pushFriends(me.uid); pushFriends(o);
    } else if (m.t === 'pm') {            // mensaje privado: a un amigo o a alguien de tu mundo
      const to = String(m.to || ''), text = String(m.text || '').slice(0, 200).trim(), tg = socketsOf(to);
      if (!text) return;
      if (!tg.length) return send(ws, { t: 'err', text: 'Ese jugador no está conectado.' });
      if (!friendsOf(me.uid).some(f => f.uid === to) && !tg.some(([, p]) => p.world === me.world)) return send(ws, { t: 'err', text: 'Solo puedes escribir en privado a amigos o a jugadores de tu mundo.' });
      for (const [tw] of tg) send(tw, { t: 'pm', uid: me.uid, name: me.name, text });
      send(ws, { t: 'pm', mine: true, uid: to, name: tg[0][1].name, text });
    } else if (m.t === 'ftp') {           // ir junto a un amigo (en el mismo mundo)
      const o = String(m.uid || ''); if (!friendsOf(me.uid).some(f => f.uid === o)) return;
      const tg = socketsOf(o); if (!tg.length) return send(ws, { t: 'err', text: 'Tu amigo no está conectado.' });
      const p = tg[0][1];
      if (p.world !== me.world) return send(ws, { t: 'err', text: p.name + ' está en el mundo «' + ((world.worlds[p.world] || {}).name || '?') + '»: cámbiate desde Mundos.' });
      send(ws, { t: 'tp', x: p.x + 1.5, y: p.y, z: p.z });
    } else if (m.t === 'register') {      // convierte la identidad actual en una cuenta (conserva objetos, inventario y amigos)
      const say = text => send(ws, { t: 'err', text }), name = String(m.name || '').trim().replace(/\s+/g, ' '), pw = String(m.pass || '');
      if (accByUid(me.uid)) return say('Esta identidad ya tiene una cuenta.');
      if (!NAME_RE.test(name)) return say('El nombre debe tener de 3 a 20 letras, números, espacios, guiones o guiones bajos.');
      if (pw.length < 6 || pw.length > 64) return say('La contraseña debe tener entre 6 y 64 caracteres.');
      if (world.accounts[accKey(name)]) return say('Ese nombre de cuenta ya existe.');
      if (Object.keys(world.accounts).length >= 5000) return say('El servidor no admite más cuentas.');
      const salt = crypto.randomBytes(16).toString('hex'), first = !Object.keys(world.accounts).length;
      world.accounts[accKey(name)] = { name, uid: me.uid, salt, hash: pwHash(pw, salt), admin: first, sess: [] };
      me.name = name; me.admin = first; persist();
      send(ws, { t: 'accdone', name, text: first ? 'Cuenta creada. Eres el administrador del servidor.' : 'Cuenta creada.' });
    } else if (m.t === 'login') {         // el navegador envía un token nuevo y el servidor lo asocia a la cuenta
      const ip = ws._ip, say = text => send(ws, { t: 'err', text });
      if (blocked(ip)) return say('Demasiados intentos fallidos. Espera 10 minutos.');
      const a = world.accounts[accKey(m.name || '')], tk = String(m.token || '');
      if (tk.length < 8 || tk.length > 100) return;
      if (!a || !pwOk(a, m.pass || '')) { addFail(ip); return say('Nombre o contraseña incorrectos.'); }
      fails.delete(ip);
      const hh = sha(tk); world.sess[hh] = a.uid; a.sess = (a.sess || []).filter(x => x !== hh); a.sess.push(hh);
      while (a.sess.length > 10) delete world.sess[a.sess.shift()];
      persist(); send(ws, { t: 'logged', name: a.name });
    } else if (m.t === 'passwd') {
      const a = accByUid(me.uid), say = text => send(ws, { t: 'err', text }), np = String(m.pw || '');
      if (!a) return say('No tienes cuenta.');
      if (blocked(ws._ip) || !pwOk(a, m.old || '')) { addFail(ws._ip); return say('La contraseña actual no es correcta.'); }
      if (np.length < 6 || np.length > 64) return say('La contraseña nueva debe tener entre 6 y 64 caracteres.');
      a.salt = crypto.randomBytes(16).toString('hex'); a.hash = pwHash(np, a.salt);
      for (const x of a.sess || []) if (x !== me.sh) delete world.sess[x];   // cierra las demás sesiones
      a.sess = (a.sess || []).filter(x => x === me.sh); persist(); say('Contraseña cambiada. Se cerraron tus otras sesiones.');
    } else if (m.t === 'alist') {         // solo administrador
      if (!me.admin) return;
      const on = new Set([...players.values()].map(p => p.uid));
      send(ws, { t: 'alist', list: Object.values(world.accounts).map(a => ({ name: a.name, admin: !!a.admin, online: on.has(a.uid) })) });
    } else if (m.t === 'asetadm') {
      if (!me.admin) return;
      const a = world.accounts[accKey(m.name || '')]; if (!a) return;
      const on = !!m.on;
      if (!on && a.admin && adminCount() <= 1) return send(ws, { t: 'err', text: 'Tiene que quedar al menos un administrador.' });
      a.admin = on; persist();
      for (const [tw, p] of players) if (p.uid === a.uid) { p.admin = on; sendAcct(tw, p); }
      send(ws, { t: 'alist', list: Object.values(world.accounts).map(x => ({ name: x.name, admin: !!x.admin, online: [...players.values()].some(p => p.uid === x.uid) })) });
    } else if (m.t === 'goto') {          // cambiar de mundo
      const id = String(m.world || '');
      if (!Object.prototype.hasOwnProperty.call(world.worlds, id) || id === me.world) return;
      const old = me.world;
      bcast({ t: 'leave', id: me.id }, ws, old);
      enter(ws, me, id, true); idleCheck(old); sendWorlds();
    } else if (m.t === 'newworld') {      // crear un mundo y entrar en él
      const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 30);
      if (!name) return send(ws, { t: 'err', text: 'Escribe un nombre para el mundo.' });
      if (Object.keys(world.worlds).length >= MAX_WORLDS) return send(ws, { t: 'err', text: 'El servidor ya tiene el máximo de ' + MAX_WORLDS + ' mundos.' });
      if (Object.values(world.worlds).filter(w => w.owner === me.uid).length >= MAX_WORLDS_PER_USER) return send(ws, { t: 'err', text: 'Ya tienes ' + MAX_WORLDS_PER_USER + ' mundos; elimina alguno para crear otro.' });
      const base = slug(name) || 'mundo'; let id = base, k = 2;
      while (Object.prototype.hasOwnProperty.call(world.worlds, id)) id = base.slice(0, 20).replace(/-+$/g, '') + '-' + k++;
      world.worlds[id] = { name, theme: WTHEMES.has(m.theme) ? m.theme : 'pradera', owner: me.uid, ownerName: me.name, created: Date.now(), items: [], parcels: [] };
      persist();
      const old = me.world;
      bcast({ t: 'leave', id: me.id }, ws, old);
      enter(ws, me, id, true); idleCheck(old); sendWorlds();
    } else if (m.t === 'delworld') {      // solo el creador, y nunca el principal
      const id = String(m.id || ''), w = Object.prototype.hasOwnProperty.call(world.worlds, id) ? world.worlds[id] : null;
      if (!w || id === 'main' || (w.owner !== me.uid && !me.admin)) return;
      const movers = [...players].filter(([, p]) => p.world === id);
      delete world.worlds[id]; deact(id); persist();
      for (const [pws, p] of movers) { enter(pws, p, 'main', true); if (pws !== ws) send(pws, { t: 'err', text: 'El mundo «' + w.name + '» fue eliminado.' }); }
      sendWorlds();
    } else if (m.t === 'add') {
      const rej = text => send(ws, { t: 'rej', tmp: m.tmp, text });
      const it = clean(m.item);
      if (!it || W.items.length >= MAX_ITEMS || W.items.filter(i => i.owner === me.uid).length >= MAX_PER_USER) return rej('No se pudo crear el objeto (límite alcanzado o datos no válidos).');
      if (it.type === 'model' && W.items.filter(i => i.owner === me.uid && i.type === 'model').length >= MAX_MODELS_PER_USER) return rej('Máximo de modelos importados alcanzado.');
      if (!it.att) { const pe = canPlace(W, me, it.pos); if (pe) return rej(pe); }
      { const nn = nodesOf(it).length; if (nn) { const re = rulesCap(W, me, nn); if (re) return rej(re); } }
      let src = null;
      if (m.from !== undefined) {   // copia de un objeto tuyo (necesita permiso de copia) o restauración de uno que acabas de borrar (deshacer)
        const own = W.items.find(x => x.id === m.from && x.owner === me.uid);
        if (own) { if (!own.cur.copy) return rej('No tienes permiso para copiar ese objeto.'); src = own; }
        else { const t = me.trash.get(m.from); if (!t || t.world !== me.world) return rej('Ese objeto ya no te pertenece y no se puede restaurar.'); src = t.item; me.trash.delete(m.from); }
        if (!src.cur.mod && coreOf(it) !== coreOf(src)) return rej('Ese objeto no se puede modificar.');
      }
      it.id = world.next++; it.owner = me.uid; it.ownerName = me.name;
      if (src) { it.creator = src.creator; it.creatorName = src.creatorName; it.cur = permOf(src.cur); it.next = permOf(m.item.next, src.cur); }
      else { it.creator = me.uid; it.creatorName = me.name; it.cur = permAll(); it.next = permOf(m.item && m.item.next); }
      W.items.push(it); persist();
      send(ws, { t: 'added', tmp: m.tmp, id: it.id, creator: it.creator, creatorName: it.creatorName, cur: it.cur, next: it.next });
      knownOf(me).add(it.id); ibcast({ t: 'add', item: it }, ws, me.world);
      if (nodesOf(it).length) rulesRestart(me.world, W, it);
    } else if (m.t === 'upd') {
      const i = W.items.findIndex(x => x.id === m.id);
      if (i < 0) return;
      const old = W.items[i], revert = text => { send(ws, { t: 'upd', item: old }); if (text) send(ws, { t: 'err', text }); };
      if (old.owner !== me.uid) return revert('Ese objeto es de ' + (old.ownerName || 'otro jugador') + ': solo su dueño puede editarlo.');
      const it = clean(m.item);
      if (!it) return revert();
      if (!old.cur.mod && ((old.name || '') !== (it.name || '') || (old.desc || '') !== (it.desc || ''))) return revert('No tienes permiso para cambiar el nombre de ese objeto.');
      if (!old.cur.mod && coreOf(it) !== coreOf(old)) return revert('No tienes permiso para modificar ese objeto (solo moverlo, girarlo o acoplarlo).');
      if (!it.att) { const pe = canPlace(W, me, it.pos, old.att ? null : old.pos); if (pe) return revert(pe); }
      const rchg = rsig(old) !== rsig(it);
      if (rchg) { const extra = nodesOf(it).length - nodesOf(old).length; if (extra > 0) { const re = rulesCap(W, me, extra); if (re) return revert(re); } }
      it.id = old.id; it.owner = me.uid; it.ownerName = me.name; it.creator = old.creator; it.creatorName = old.creatorName;
      it.cur = old.cur; it.next = permOf(m.item.next, old.cur);   // los permisos «siguiente dueño» nunca superan los tuyos
      W.items[i] = it; persist(); ibcast({ t: 'upd', item: it }, ws, me.world);
      if (rchg) rulesRestart(me.world, W, it);
    } else if (m.t === 'del') {
      const i = W.items.findIndex(x => x.id === m.id);
      if (i < 0) return;
      const old = W.items[i], isOwner = old.owner === me.uid;
      const par = old.att ? null : parcelAt(W, old.pos[0], old.pos[2]);
      if (!isOwner && !me.admin && !(W.owner && W.owner === me.uid) && !(par && par.owner === me.uid)) return;   // el dueño del objeto, quien creó el mundo o el dueño de la parcela («devolver objeto» de OpenSim)
      W.items.splice(i, 1); persist(); dropRt(me.world, old.id);
      if (isOwner) { me.trash.set(old.id, { item: old, world: me.world }); if (me.trash.size > 100) me.trash.delete(me.trash.keys().next().value); }
      if (isOwner) knownOf(me).delete(m.id);
      ibcast({ t: 'del', id: m.id }, isOwner ? ws : null, me.world);
    } else if (m.t === 'pclaim') {        // reclamar una parcela libre
      const n = [m.x1, m.z1, m.x2, m.z2];
      if (!n.every(v => Number.isFinite(v) && Math.abs(v) < 1000)) return;
      const q = { x1: Math.min(n[0], n[2]), z1: Math.min(n[1], n[3]), x2: Math.max(n[0], n[2]), z2: Math.max(n[1], n[3]) };
      const w = q.x2 - q.x1, h = q.z2 - q.z1;
      if (w < P_MIN || h < P_MIN || w > P_MAX || h > P_MAX) return send(ws, { t: 'err', text: 'La parcela debe medir entre ' + P_MIN + ' y ' + P_MAX + ' m por lado.' });
      if (W.parcels.length >= MAX_PARCELS) return send(ws, { t: 'err', text: 'Este mundo ya tiene el máximo de parcelas.' });
      if (W.parcels.filter(p => p.owner === me.uid).length >= MAX_PARCELS_PER_USER) return send(ws, { t: 'err', text: 'Ya tienes ' + MAX_PARCELS_PER_USER + ' parcelas en este mundo; libera alguna.' });
      const ov = W.parcels.find(p => q.x1 < p.x2 && q.x2 > p.x1 && q.z1 < p.z2 && q.z2 > p.z1);
      if (ov) return send(ws, { t: 'err', text: 'Ese terreno se solapa con la parcela «' + ov.name + '» de ' + ov.ownerName + '.' });
      const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 24) || ('Parcela de ' + me.name).slice(0, 24);
      W.parcels.push({ id: world.next++, name, owner: me.uid, ownerName: me.name, x1: q.x1, z1: q.z1, x2: q.x2, z2: q.z2, build: 'owner', fly: 'all', max: P_DEF_MAX });
      persist(); bcast({ t: 'parcels', list: W.parcels }, null, me.world);
    } else if (m.t === 'pset' || m.t === 'prel') {   // configurar o liberar: su dueño o quien creó el mundo
      const p = W.parcels.find(x => x.id === m.id);
      if (!p || (p.owner !== me.uid && !me.admin && !(W.owner && W.owner === me.uid))) return;
      if (m.t === 'prel') W.parcels.splice(W.parcels.indexOf(p), 1);
      else {
        const name = String(m.name === undefined ? p.name : m.name).replace(/[<>]/g, '').trim().slice(0, 24);
        if (name) p.name = name;
        if (m.build === 'all' || m.build === 'owner') p.build = m.build;
        if (m.fly === 'all' || m.fly === 'owner') p.fly = m.fly;   // v6.47: quién puede volar en la parcela
        if (Number.isFinite(m.max)) p.max = Math.min(500, Math.max(1, Math.round(m.max)));
      }
      persist(); bcast({ t: 'parcels', list: W.parcels }, null, me.world);
    } else if (m.t === 'take') {          // guardar un objeto tuyo en el inventario (se quita del mundo)
      const i = W.items.findIndex(x => x.id === m.id);
      if (i < 0 || W.items[i].owner !== me.uid) return;
      const inv = invOf(me.uid);
      if (inv.length >= MAX_INV) return send(ws, { t: 'err', text: 'Tu inventario está lleno (máximo ' + MAX_INV + ' objetos).' });
      const it = W.items[i]; W.items.splice(i, 1); dropRt(me.world, it.id);
      const copy = JSON.parse(JSON.stringify(it)); delete copy.id; delete copy.att; delete copy.owner; delete copy.ownerName;
      inv.push({ id: world.next++, name: String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 30) || String(copy.name || '').slice(0, 30) || invName(copy), item: copy });
      persist(); ibcast({ t: 'del', id: it.id }, null, me.world); sendInv(ws, me);
      send(ws, { t: 'err', text: 'Guardado en el inventario.' });
    } else if (m.t === 'rez') {           // sacar un objeto del inventario al mundo actual
      const inv = invOf(me.uid), k = inv.findIndex(e => e.id === m.inv);
      if (k < 0) return;
      const e = inv[k], it = clean(JSON.parse(JSON.stringify(e.item)));
      if (!it) return send(ws, { t: 'err', text: 'Ese objeto ya no se puede colocar (falta su archivo en el servidor).' });
      if (W.items.length >= MAX_ITEMS || W.items.filter(x => x.owner === me.uid).length >= MAX_PER_USER) return send(ws, { t: 'err', text: 'No caben más objetos tuyos en este mundo.' });
      if (it.type === 'model' && W.items.filter(x => x.owner === me.uid && x.type === 'model').length >= MAX_MODELS_PER_USER) return send(ws, { t: 'err', text: 'Máximo de modelos importados alcanzado.' });
      if (v3(m.pos)) it.pos = [m.pos[0], m.pos[1], m.pos[2]];
      else if (Array.isArray(m.xz) && m.xz.length === 2 && m.xz.every(n => Number.isFinite(n) && Math.abs(n) < 1000)) it.pos = [m.xz[0], it.pos[1], m.xz[1]];   // conserva la altura guardada
      { const pe = canPlace(W, me, it.pos); if (pe) return send(ws, { t: 'err', text: pe }); }
      { const nn = nodesOf(it).length; if (nn) { const re = rulesCap(W, me, nn); if (re) return send(ws, { t: 'err', text: re }); } }
      it.id = world.next++; it.owner = me.uid; it.ownerName = me.name;
      it.creator = e.item.creator; it.creatorName = e.item.creatorName; it.cur = permOf(e.item.cur); it.next = permOf(e.item.next, it.cur);
      if (it.cur.copy) { /* se queda en el inventario */ } else inv.splice(k, 1);   // sin copiar, al colocarlo sale del inventario
      W.items.push(it); persist(); ibcast({ t: 'add', item: it }, null, me.world); sendInv(ws, me);
      if (nodesOf(it).length) rulesRestart(me.world, W, it);
    } else if (m.t === 'invdel') {
      const inv = invOf(me.uid), k = inv.findIndex(e => e.id === m.inv);
      if (k < 0) return; inv.splice(k, 1); persist(); sendInv(ws, me);
    } else if (m.t === 'invname') {
      const e = invOf(me.uid).find(x => x.id === m.inv), name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 30);
      if (!e || !name) return; e.name = name; persist(); sendInv(ws, me);
    } else if (m.t === 'tplset') {        // v6.27: guarda en el servidor las plantillas, favoritos y recientes de esta identidad
      const now = Date.now(), ack = (ok, text, busy) => send(ws, { t: 'tplack', ok, text: text || '', busy: !!busy });
      if (now - (me.tplAt || 0) < 300) return ack(false, '', true); me.tplAt = now;
      const d = cleanTplData(m); if (!d) return ack(false, 'Las plantillas no son válidas y no se guardaron en el servidor.');
      if (JSON.stringify(d).length > MAX_TPL_BYTES) return ack(false, 'Tus plantillas ocupan demasiado para guardarlas en el servidor (máximo unos 900 KB). Siguen en este navegador.');
      if (!d.tpls.length && !d.favs.length && !d.rec.length) delete world.tpl[me.uid];
      else { if (!world.tpl[me.uid] && Object.keys(world.tpl).length >= MAX_TPL_USERS) return ack(false, 'El servidor no admite más datos de plantillas.'); world.tpl[me.uid] = d; }
      persist(); ack(true);
      for (const [ows] of socketsOf(me.uid)) if (ows !== ws) sendTpl(ows, me, false);   // otras pestañas o navegadores con la misma cuenta
    } else if (m.t === 'touch') {         // tocar un objeto con reglas «Al tocar» (cualquier jugador, no solo el dueño)
      const it = W.items.find(x => x.id === m.id);
      if (!it || it.att) return;
      const nd = nodesOf(it).find(n => Number.isInteger(m.c) ? n.key === it.id + '.' + m.c : n.key === it.id); if (!nd) return;
      const rs = nd.node.rules.filter(r => r.ev === 'touch'); if (!rs.length) return;
      const now = Date.now(); if (now - (me.touchAt || 0) < 300) return; me.touchAt = now;
      if (Math.hypot(me.x - nd.pos[0], me.y - nd.pos[1], me.z - nd.pos[2]) > TOUCH_RANGE) return send(ws, { t: 'err', text: 'Estás demasiado lejos para tocarlo (máximo ' + TOUCH_RANGE + ' m).' });
      for (const r of rs) runRule(me.world, W, it, r, me, false, nd.key, nd.pos);
    } else if (m.t === 'give') {          // regalar un objeto a otro jugador del mismo mundo (necesita permiso de transferir)
      const it = W.items.find(x => x.id === m.id), to = [...players.values()].find(p => p.id === m.to && p.world === me.world && p !== me);
      if (!it || it.owner !== me.uid) return;
      if (!to) return send(ws, { t: 'err', text: 'Ese jugador ya no está en este mundo.' });
      if (!it.cur.trans) return send(ws, { t: 'err', text: 'No tienes permiso para transferir ese objeto.' });
      if (W.items.filter(x => x.owner === to.uid).length >= MAX_PER_USER) return send(ws, { t: 'err', text: to.name + ' ya tiene el máximo de objetos.' });
      if (it.type === 'model' && W.items.filter(x => x.owner === to.uid && x.type === 'model').length >= MAX_MODELS_PER_USER) return send(ws, { t: 'err', text: to.name + ' ya tiene el máximo de modelos importados.' });
      it.owner = to.uid; it.ownerName = to.name; it.cur = permOf(it.next); delete it.att; persist();
      ibcast({ t: 'upd', item: it }, null, me.world);
      send(ws, { t: 'err', text: 'Has regalado el objeto a ' + to.name + '.' });
      for (const [pws, p] of players) if (p === to) send(pws, { t: 'err', text: me.name + ' te ha regalado un objeto.' });
    }
  });
  ws.on('close', () => { clearInterval(tick); if (players.delete(ws)) { bcast({ t: 'leave', id: me.id }, null, me.world); idleCheck(me.world); sendWorlds(); if (me.uid && !socketsOf(me.uid).length) presence(me.uid); } });
});

// ---- Limpieza de archivos subidos (v6.29) ----
// Un archivo de uploads/ se considera en uso si su nombre (64 hex + extensión) aparece en cualquier objeto (con subgrupos), en un inventario,
// en las plantillas guardadas o en la papelera de un jugador conectado. Se busca por nombre en todo el contenido para cubrir `src`, texturas `u:…` y campos futuros.
// Solo se borra lo que lleva más de GC_DAYS días sin usarse (por defecto 7), así no se pierde un archivo recién subido que aún no se ha colocado ni uno que una plantilla local del navegador está por sincronizar.
const UP_NAME = /[0-9a-f]{64}\.(?:glb|png|jpg|webp)/g, UP_ONE = /^[0-9a-f]{64}\.(?:glb|png|jpg|webp)$/;
const GC_MS = Math.max(0, Number(process.env.GC_DAYS === undefined ? 7 : process.env.GC_DAYS)) * 86400000;
function usedUploads() {
  const used = new Set(), scan = o => { for (const m of (JSON.stringify(o) || '').matchAll(UP_NAME)) used.add(m[0]); };
  scan(world.worlds); scan(world.inv); scan(world.tpl);
  for (const p of players.values()) for (const t of p.trash.values()) scan(t.item);
  return used;
}
function gcUploads(dry) {   // devuelve { removed: [{id, bytes, why}], freed }
  const used = usedUploads(), now = Date.now(), removed = [];
  let names = []; try { names = fs.readdirSync(UP); } catch (e) { return { removed, freed: 0 }; }
  for (const name of names) {
    if (!UP_ONE.test(name) || used.has(name)) continue;   // solo toca archivos con nombre de hash y que nadie usa
    let st; try { st = fs.statSync(path.join(UP, name)); } catch (e) { continue; }
    if (now - st.mtimeMs < GC_MS) continue;
    removed.push({ id: name, bytes: st.size, why: world.assets[name] ? 'sin uso' : 'sin registro' });
    if (!dry) { try { fs.unlinkSync(path.join(UP, name)); } catch (e) { removed.pop(); continue; } delete world.assets[name]; }
  }
  for (const id of Object.keys(world.assets)) if (!used.has(id) && !fs.existsSync(path.join(UP, id))) { if (!dry) delete world.assets[id]; }   // registro sin archivo
  if (!dry && removed.length) persist();
  return { removed, freed: removed.reduce((n, r) => n + r.bytes, 0) };
}
function runGc() {
  try { const r = gcUploads(false); if (r.removed.length) console.log('Limpieza de uploads/: ' + r.removed.length + ' archivo(s) sin uso borrados (' + (r.freed / 1048576).toFixed(1) + ' MB).'); }
  catch (e) { console.error('Falló la limpieza de uploads/:', e.message); }
}
setInterval(runGc, 6 * 3600 * 1000).unref();

// Latido: los proxies y balanceadores cortan las conexiones inactivas (suelen ser 60 s); un ping cada 25 s las mantiene y cierra las que ya no responden
setInterval(() => { for (const ws of wss.clients) { if (ws._alive === false) { ws.terminate(); continue; } ws._alive = false; try { ws.ping(); } catch (e) {} } }, 25000).unref();
server.listen(PORT, HOST, () => { console.log('Mundo Virtual en http://localhost:' + PORT + (DATA !== __dirname ? ' · datos en ' + DATA : '') + (TRUST_PROXY ? ' · detrás de proxy' : '') + (ORIGINS.length ? ' · orígenes: ' + ORIGINS.join(', ') : '')); runGc(); });
