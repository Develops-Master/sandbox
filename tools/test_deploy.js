// Prueba de las opciones para publicar en internet (v6.32). Arranca el servidor real varias veces en una carpeta temporal. Uso: node tools/test_deploy.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const WebSocket = require('ws'), root = path.dirname(__dirname);
let fails = 0; const ok = (c, t) => { console.log((c ? 'OK    ' : 'FALLO ') + t); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const start = (env, port) => new Promise(res => { const p = spawn('node', [path.join(root, 'server.js')], { env: { ...process.env, PORT: port, ...env }, stdio: ['ignore', 'pipe', 'inherit'] }); let out = ''; p.stdout.on('data', d => { out += d; if (out.includes('Mundo Virtual en')) res({ p, out }); }); });
const get = (port, u) => new Promise(r => http.get({ port, path: u, host: '127.0.0.1' }, x => { let b = ''; x.on('data', d => b += d); x.on('end', () => r({ s: x.statusCode, b, h: x.headers })); }).on('error', () => r({ s: 0 })));
const open = (port, headers) => new Promise(r => { const w = new WebSocket('ws://127.0.0.1:' + port, { headers }); w.on('open', () => r({ w, ok: true })); w.on('unexpected-response', (q, s) => r({ ok: false, status: s.statusCode })); w.on('error', () => {}); });
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv_dep_'));
  // 1) DATA_DIR + healthz + guardado fuera de la carpeta del proyecto
  let { p, out } = await start({ DATA_DIR: dir, ALLOWED_ORIGINS: 'https://mundo.example.com/', TRUST_PROXY: '1', MAX_CONN_IP: '2' }, 3441);
  ok(out.includes(dir), 'el arranque indica la carpeta de datos'); ok(fs.existsSync(path.join(dir, 'uploads')), 'uploads/ se crea dentro de DATA_DIR');
  const h = await get(3441, '/healthz'); ok(h.s === 200 && JSON.parse(h.b).ok === true, '/healthz responde {"ok":true}');
  ok((await get(3441, '/')).s === 200, 'la página principal sigue sirviéndose');
  // 2) origen
  const bad = await open(3441, { Origin: 'https://otra-web.com', 'X-Forwarded-For': '1.1.1.1' }); ok(!bad.ok && bad.status === 403, 'un origen no permitido recibe 403 (' + bad.status + ')');
  const none = await open(3441, { Origin: 'https://mundo.example.com', 'X-Forwarded-For': '1.1.1.1' }); ok(none.ok, 'el origen permitido (con barra final en la variable) conecta');
  // 3) límite por IP con TRUST_PROXY: la IP sale de X-Forwarded-For
  const c2 = await open(3441, { Origin: 'https://mundo.example.com', 'X-Forwarded-For': '9.9.9.9, 1.1.1.1' }); ok(c2.ok, 'segunda conexión de la misma IP (1.1.1.1)');
  const c3 = await open(3441, { Origin: 'https://mundo.example.com', 'X-Forwarded-For': '1.1.1.1' }); ok(!c3.ok && c3.status === 429, 'la tercera conexión de la misma IP recibe 429 (' + c3.status + ')');
  const c4 = await open(3441, { Origin: 'https://mundo.example.com', 'X-Forwarded-For': '2.2.2.2' }); ok(c4.ok, 'otra IP (2.2.2.2) conecta aunque la primera esté llena');
  none.w.close(); await sleep(300);
  const c5 = await open(3441, { Origin: 'https://mundo.example.com', 'X-Forwarded-For': '1.1.1.1' }); ok(c5.ok, 'al cerrar una conexión se libera el cupo de esa IP');
  [none.w, c2.w, c4.w, c5.w].forEach(w => { try { w.close(); } catch (e) {} });
  p.kill(); await sleep(300);
  // 5) sin TRUST_PROXY la cabecera X-Forwarded-For se ignora (no se puede falsear)
  ({ p } = await start({ DATA_DIR: dir, MAX_CONN_IP: '2' }, 3442));
  const a = await open(3442, { 'X-Forwarded-For': '5.5.5.5' }), b = await open(3442, { 'X-Forwarded-For': '6.6.6.6' }), c = await open(3442, { 'X-Forwarded-For': '7.7.7.7' });
  ok(a.ok && b.ok && !c.ok && c.status === 429, 'sin TRUST_PROXY, cambiar X-Forwarded-For no evita el límite (3.ª conexión: ' + (c.ok ? 'abierta' : c.status) + ')');
  a.w.close(); await sleep(300); const d = await open(3442, { Origin: 'https://cualquiera.com' }); ok(d.ok, 'sin ALLOWED_ORIGINS cualquier origen conecta (comportamiento anterior)');
  [b.w, d.w].forEach(w => d.ok && w.close()); fs.rmSync(path.join(dir, 'world.json'), { force: true }); p.kill('SIGTERM'); await sleep(500);
  // 6) el mundo se guarda en DATA_DIR al cerrar (SIGTERM)
  ok(fs.existsSync(path.join(dir, 'world.json')), 'al recibir SIGTERM el mundo se guarda en DATA_DIR'); fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nRESULTADO:', fails ? fails + ' fallo(s)' : 'TODO OK'); process.exit(fails ? 1 : 0);
})();
