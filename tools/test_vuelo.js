// Prueba del servidor para el vuelo (v6.44; v6.47 añade el permiso de vuelo por parcela): la altura que se difunde a los demás jugadores se acota a [-20, 150] m.
// Uso: node tools/test_vuelo.js   (arranca el servidor real en una carpeta temporal; no toca tu world.json)
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), WebSocket = require('ws'), root = path.dirname(__dirname);
let fails = 0; const ok = (c, t, x) => { console.log((c ? 'OK    ' : 'FALLO ') + t + (!c && x !== undefined ? '  ' + JSON.stringify(x) : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mv_vuelo_')), PORT = 3453;
  const p = spawn('node', [path.join(root, 'server.js')], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit'] });
  await sleep(1500);
  const open = async (tok, name) => { const w = new WebSocket('ws://127.0.0.1:' + PORT); const got = []; w.on('message', d => got.push(JSON.parse(d))); await new Promise(r => w.on('open', r)); w.send(JSON.stringify({ t: 'hello', name, token: tok })); await sleep(400); const ini = got.find(x => x.t === 'init'); return { w, got, id: ini && ini.me && ini.me.id }; };
  const A = await open('token-vuelo-A-123456', 'Volador'), B = await open('token-vuelo-B-123456', 'Observador');
  const mv = async y => { B.got.length = 0; A.w.send(JSON.stringify({ t: 'move', x: 1, y, z: 1, ry: 0, st: 3 })); await sleep(250); const m = B.got.filter(x => x.t === 'pos').pop(); return m && m.y; };
  ok(await mv(50) === 50, 'una altura normal de vuelo (50 m) se difunde tal cual');
  ok(await mv(150) === 150, 'el techo permitido (150 m) se difunde tal cual');
  ok(await mv(9999) === 150, 'una altura absurda (9999 m) se acota a 150 m');
  ok(await mv(-500) === -20, 'una altura por debajo del suelo (-500 m) se acota a -20 m');
  const st = B.got.filter(x => x.t === 'pos').pop(); ok(st && st.st === 3, 'el estado «en el aire» (3) se difunde para que los demás vean la pose de vuelo', st);
  // ---- v6.48: estado «volando» (4)
  B.got.length = 0; A.w.send(JSON.stringify({ t: 'move', x: 1, y: 20, z: 1, ry: 0, st: 4 })); await sleep(250);
  ok((B.got.filter(x => x.t === 'pos').pop() || {}).st === 4, 'el estado «volando» (4) se difunde a los demás');
  B.got.length = 0; A.w.send(JSON.stringify({ t: 'move', x: 1, y: 20, z: 1, ry: 0, st: 5 })); await sleep(250);
  ok((B.got.filter(x => x.t === 'pos').pop() || {}).st === 0, 'un estado inventado (5) se descarta y vale 0');
  // ---- v6.47: permiso de vuelo por parcela
  const lastParcels = async () => { await sleep(250); const m = B.got.filter(x => x.t === 'parcels').pop(); return m && m.list; };
  B.got.length = 0; A.w.send(JSON.stringify({ t: 'pclaim', x1: 100, z1: 100, x2: 116, z2: 116, name: 'Mia' }));
  let L = await lastParcels(), pc = L && L[0];
  ok(pc && pc.fly === 'all', 'una parcela nueva permite volar a cualquiera (fly = all)', pc);
  B.got.length = 0; A.w.send(JSON.stringify({ t: 'pset', id: pc.id, fly: 'owner' })); L = await lastParcels();
  ok(L && L[0].fly === 'owner', 'su dueño puede dejar volar «solo yo» (fly = owner)', L);
  B.got.length = 0; A.w.send(JSON.stringify({ t: 'pset', id: pc.id, fly: 'cualquier cosa' })); L = await lastParcels();
  ok(L && L[0].fly === 'owner', 'un valor inválido se ignora y se conserva el anterior', L);
  B.got.length = 0; B.w.send(JSON.stringify({ t: 'pset', id: pc.id, fly: 'all' })); await sleep(300); A.w.send(JSON.stringify({ t: 'pset', id: pc.id, name: 'Mia2' })); L = await lastParcels();
  ok(L && L[0].fly === 'owner' && L[0].name === 'Mia2', 'otro jugador no puede cambiar el permiso de vuelo de una parcela ajena', L);
  // ---- v6.49: el servidor hace cumplir «volar: solo su dueño» contra el estado 4
  const mvB = async (x, y, z, st) => { A.got.length = 0; B.got.length = 0; B.w.send(JSON.stringify({ t: 'move', x, y, z, ry: 0, st })); await sleep(300); };
  await mvB(60, 0, 60, 0);
  await mvB(105, 20, 105, 4);
  ok(!A.got.some(x => x.t === 'pos' && x.id !== undefined && x.y === 20), 'un jugador sin permiso que manda «volando» dentro de la parcela no se difunde a los demás');
  const tpB = B.got.find(x => x.t === 'tp'); ok(tpB && tpB.x === 60 && tpB.z === 60, 'y el servidor lo devuelve a su última posición válida', tpB);
  await mvB(70, 20, 70, 4);
  ok(A.got.some(x => x.t === 'pos' && x.y === 20), 'fuera de la parcela sí puede volar (se difunde)');
  A.got.length = 0; B.got.length = 0; A.w.send(JSON.stringify({ t: 'move', x: 105, y: 20, z: 105, ry: 0, st: 4 })); await sleep(300);
  ok(B.got.some(x => x.t === 'pos' && x.y === 20) && !A.got.some(x => x.t === 'tp'), 'el dueño de la parcela sí puede volar dentro de ella');
  // ---- v6.52: lista de invitados para volar
  const pB = B.id !== undefined ? { id: B.id } : null;
  ok(!!pB, 'A conoce el id del jugador B', pB);
  const lastP = async () => { await sleep(300); const m = A.got.filter(x => x.t === 'parcels').pop(); return m && m.list.find(q => q.id === pc.id); };
  A.got.length = 0; B.w.send(JSON.stringify({ t: 'pguest', id: pc.id, add: pB && pB.id })); await sleep(300);
  ok(!A.got.some(x => x.t === 'parcels'), 'un jugador que no es dueño no puede invitarse a sí mismo');
  A.got.length = 0; A.w.send(JSON.stringify({ t: 'pguest', id: pc.id, add: pB && pB.id })); let gp = await lastP();
  ok(gp && Array.isArray(gp.guests) && gp.guests.length === 1 && gp.guests[0].name === 'Observador', 'el dueño invita a B a volar', gp);
  A.got.length = 0; A.w.send(JSON.stringify({ t: 'pguest', id: pc.id, add: pB && pB.id })); await sleep(300);
  ok(!A.got.some(x => x.t === 'parcels'), 'invitar dos veces al mismo jugador no lo duplica');
  await mvB(60, 0, 60, 0); await mvB(105, 20, 105, 4);
  ok(A.got.some(x => x.t === 'pos' && x.y === 20) && !B.got.some(x => x.t === 'tp'), 'el invitado ya puede volar dentro de la parcela');
  A.got.length = 0; A.w.send(JSON.stringify({ t: 'pguest', id: pc.id, del: gp && gp.guests[0].uid })); gp = await lastP();
  ok(gp && gp.guests.length === 0, 'el dueño quita al invitado', gp);
  await mvB(60, 0, 60, 0); await mvB(105, 20, 105, 4);
  ok(B.got.some(x => x.t === 'tp') && !A.got.some(x => x.t === 'pos' && x.y === 20), 'sin invitación vuelve a ser rechazado');
  A.w.send(JSON.stringify({ t: 'pguest', id: pc.id, add: 99999 })); await sleep(300);
  ok(A.got.some(x => x.t === 'err'), 'invitar a un jugador que no existe da un aviso');
  // ---- v6.52: los invitados también pueden construir en la parcela «construir: solo yo»
  const resB = new Map(); B.w.on('message', d => { const m = JSON.parse(d); if (m.t === 'added' || m.t === 'rej') resB.set(m.tmp, m); });
  let nb = 100; const addB = async () => { const tmp = ++nb; B.w.send(JSON.stringify({ t: 'add', tmp, item: { type: 'box', color: '#cc3333', mat: 'mate', tex: '', pos: [108, 0.5, 108], rot: [0, 0, 0], scale: [1, 1, 1] } })); await sleep(250); return resB.get(tmp); };
  let rb = await addB(); ok(rb && rb.t === 'rej' && /invitados/.test(rb.text), 'sin invitación, B no puede construir en la parcela y el aviso menciona a los invitados', rb);
  A.got.length = 0; A.w.send(JSON.stringify({ t: 'pguest', id: pc.id, add: pB && pB.id })); gp = await lastP();
  rb = await addB(); ok(rb && rb.t === 'added', 'con invitación, B sí puede construir en la parcela', rb);
  A.w.send(JSON.stringify({ t: 'pguest', id: pc.id, del: (gp && gp.guests[0] || {}).uid })); await sleep(300);
  rb = await addB(); ok(rb && rb.t === 'rej', 'al quitar la invitación, B ya no puede construir', rb);
  // ---- v6.53: el servidor valida la altura aunque el cliente mienta con el estado
  await mvB(60, 0, 60, 0);
  await mvB(105, 20, 105, 0);
  ok(!A.got.some(x => x.t === 'pos' && x.y === 20) && B.got.some(x => x.t === 'tp'), 'estado «reposo» (0) a 20 m dentro de la parcela sin permiso: se rechaza y se devuelve');
  await mvB(60, 0, 60, 0); await mvB(105, 20, 105, 3);
  ok(!A.got.some(x => x.t === 'pos' && x.y === 20) && B.got.some(x => x.t === 'tp'), 'estado «en el aire» (3) a 20 m: también se rechaza');
  await mvB(60, 0, 60, 0); await mvB(105, 1, 105, 3);
  ok(A.got.some(x => x.t === 'pos' && x.y === 1) && !B.got.some(x => x.t === 'tp'), 'un salto normal (1 m) en la parcela sí se difunde');
  A.got.length = 0; A.w.send(JSON.stringify({ t: 'add', tmp: 900, item: { type: 'box', color: '#cc3333', mat: 'mate', tex: '', pos: [112, 5, 112], rot: [0, 0, 0], scale: [2, 10, 2] } })); await sleep(300);
  ok(A.got.some(x => x.t === 'added' && x.tmp === 900), 'el dueño coloca una torre de 10 m en su parcela');
  await mvB(60, 0, 60, 0); await mvB(112, 10.5, 112, 0);
  ok(A.got.some(x => x.t === 'pos' && x.y === 10.5) && !B.got.some(x => x.t === 'tp'), 'subido sobre la torre (10,5 m) es legítimo y se difunde');
  await mvB(112, 60, 112, 3);
  ok(!A.got.some(x => x.t === 'pos' && x.y === 60) && B.got.some(x => x.t === 'tp'), 'pero a 60 m sobre la torre se rechaza');
  await mvB(60, 0, 60, 0); await mvB(70, 40, 70, 3);
  ok(A.got.some(x => x.t === 'pos' && x.y === 40), 'fuera de la parcela la altura no se restringe (vuelo permitido)');
  A.w.close(); B.w.close(); p.kill('SIGTERM'); await sleep(300); fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nRESULTADO:', fails ? fails + ' fallo(s)' : 'TODO OK'); process.exit(fails ? 1 : 0);
})();
