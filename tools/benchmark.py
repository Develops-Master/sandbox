#!/usr/bin/env python3
"""Mide el rendimiento del cliente con muchos objetos (v6.30).
Trabaja en una COPIA temporal del proyecto: no toca tu world.json ni tu uploads/.
Requisitos: Node 18+, `pip install playwright` y `playwright install chromium`.
Uso:  python3 tools/benchmark.py [--grupos 2000] [--piezas 8] [--area 110] [--segundos 4]
Muestra: geometrías en memoria, triángulos y llamadas de dibujo por fotograma, milisegundos de CPU dentro de render() y por fotograma.
Aviso: en un Chromium sin GPU el dibujado es por software, así que los milisegundos totales NO representan a una GPU real;
sí sirven para comparar versiones entre sí (triángulos, geometrías y CPU de render)."""
import argparse, json, os, random, shutil, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--grupos', type=int, default=2000); ap.add_argument('--piezas', type=int, default=8)
ap.add_argument('--area', type=float, default=110, help='medio lado del cuadrado donde se reparten (m)')
ap.add_argument('--segundos', type=float, default=4); ap.add_argument('--puerto', type=int, default=3390)
a = ap.parse_args()
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(prefix='mv_bench_')
for f in ('server.js', 'package.json'): shutil.copy(os.path.join(root, f), tmp)
shutil.copytree(os.path.join(root, 'public'), os.path.join(tmp, 'public')); shutil.copytree(os.path.join(root, 'node_modules'), os.path.join(tmp, 'node_modules')); os.mkdir(os.path.join(tmp, 'uploads'))
random.seed(9)
def pieza():
    return {'type': random.choice(['box', 'cylinder', 'sphere', 'cone']), 'color': '#%06x' % random.randrange(0x555555, 0xffffff), 'mat': 'mate', 'tex': '',
            'pos': [random.uniform(-1.5, 1.5), random.uniform(0, 3), random.uniform(-1.5, 1.5)], 'rot': [0, 0, 0], 'scale': [random.uniform(0.05, 1.2) for _ in range(3)]}
items = [{'id': i + 1, 'owner': 'u%d' % (i % 20), 'ownerName': 'x', 'pos': [random.uniform(-a.area, a.area), 0, random.uniform(-a.area, a.area)], 'rot': [0, random.uniform(0, 6.28), 0], 'scale': [1, 1, 1],
          'children': [pieza() for _ in range(a.piezas)]} for i in range(a.grupos)]
json.dump({'next': a.grupos + 1, 'assets': {}, 'inv': {}, 'tpl': {}, 'worlds': {'main': {'name': 'Mundo principal', 'theme': 'pradera', 'owner': '', 'ownerName': 'Sistema', 'created': 0, 'items': items, 'parcels': []}}}, open(os.path.join(tmp, 'world.json'), 'w'))
p_idx = os.path.join(tmp, 'public', 'index.html'); h = open(p_idx, encoding='utf8').read(); marker = 'var clock=new THREE.Clock();'
assert h.count(marker) == 1, 'no se encontró el punto donde enganchar la medición'
open(p_idx, 'w', encoding='utf8').write(h.replace(marker, "window.__dbg={renderer:renderer,view:function(t,p,r){th=t;ph=p;rad=r;target.set(0,0,0);updCam()}};" + marker))
srv = subprocess.Popen(['node', 'server.js'], cwd=tmp, env=dict(os.environ, PORT=str(a.puerto)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.5)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 800, 'height': 500}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:%d/' % a.puerto); pg.wait_for_function('window.__dbg!==undefined', timeout=30000); pg.wait_for_timeout(3000)
        VISTAS = [(0.0, 0.9, 40), (2.1, 0.9, 40), (4.2, 0.9, 40)]   # cámara fija: 3 vistas desde el centro, para que dos ejecuciones sean comparables
        JS = """([v,s])=>new Promise(res=>{var d=window.__dbg,r=d.renderer;d.view(v[0],v[1],v[2]);var fr=0,t0=performance.now(),calls=0,tri=0,rt=0,R=r.render.bind(r);
          r.render=function(x,y){var q=performance.now();R(x,y);rt+=performance.now()-q};
          function f(){fr++;calls+=r.info.render.calls;tri+=r.info.render.triangles;if(performance.now()-t0<s*1000)requestAnimationFrame(f);else{r.render=R;res({fr:fr,ms:(performance.now()-t0)/fr,cpu:rt/fr,calls:calls/fr,tri:tri/fr,geo:r.info.memory.geometries,info:document.getElementById('cullinfo').textContent})}}
          requestAnimationFrame(f)})"""
        rs = []
        for v in VISTAS:
            pg.evaluate("v=>window.__dbg.view(v[0],v[1],v[2])", list(v)); pg.wait_for_timeout(1500)   # deja que el culling (4 veces por segundo) se recalcule
            rs.append(pg.evaluate(JS, [list(v), a.segundos / len(VISTAS)]))
        m = lambda k: sum(x[k] for x in rs) / len(rs)
        r = {'fotogramas': sum(x['fr'] for x in rs), 'ms_por_fotograma': round(m('ms'), 1), 'ms_cpu_render': round(m('cpu'), 1), 'llamadas': round(m('calls')), 'triangulos': round(m('tri')), 'geometrias': rs[-1]['geo'], 'info': rs[-1]['info']}
        b.close()
    print('Mundo: %d grupos x %d piezas en %dx%d m' % (a.grupos, a.piezas, 2 * a.area, 2 * a.area)); print(json.dumps(r, ensure_ascii=False, indent=2)); print('Errores de página:', errs or 'ninguno')
finally:
    srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)
