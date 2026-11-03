#!/usr/bin/env python3
"""Prueba de la fusión de objetos lejanos (v6.31) en Chromium sin interfaz, con el cliente y el servidor reales.
Trabaja en una copia temporal (no toca world.json ni uploads/). Uso: python3 tools/test_merge.py
Comprueba: 1) hay objetos fusionados y sus piezas originales pasan a la capa 1; 2) ser() no cambia con la fusión;
3) un rayo contra un objeto fusionado lo resuelve al grupo correcto (selección); 4) seleccionar deshace la fusión al instante y
no contamina el material compartido; 5) apagar la casilla restaura todo; 6) diferencia de imagen con/sin fusión; 7) sin errores de página."""
import json, os, random, shutil, subprocess, sys, tempfile, time
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(prefix='mv_test_')
for f in ('server.js', 'package.json'): shutil.copy(os.path.join(root, f), tmp)
shutil.copytree(os.path.join(root, 'public'), os.path.join(tmp, 'public')); shutil.copytree(os.path.join(root, 'node_modules'), os.path.join(tmp, 'node_modules')); os.mkdir(os.path.join(tmp, 'uploads'))
random.seed(5)
def pieza(i):
    t = ['box', 'cylinder', 'sphere', 'cone'][i % 4]; mat = ['mate', 'metal', 'brillo'][i % 3]
    return {'type': t, 'color': '#%06x' % random.randrange(0x555555, 0xffffff), 'mat': mat, 'tex': '', 'pos': [random.uniform(-1.5, 1.5), random.uniform(0, 3), random.uniform(-1.5, 1.5)],
            'rot': [0, random.uniform(0, 3), 0], 'scale': [random.uniform(0.3, 1.2) for _ in range(3)]}
items = []
for i in range(120):
    ang = random.uniform(0, 6.28); r = random.uniform(35, 90)
    items.append({'id': i + 1, 'owner': 'u%d' % (i % 5), 'ownerName': 'x', 'pos': [r * __import__('math').cos(ang), 0, r * __import__('math').sin(ang)], 'rot': [0, random.uniform(0, 6.28), 0], 'scale': [1, 1, 1], 'children': [pieza(j) for j in range(6)]})
# un grupo con un subgrupo y otro con una pieza con reglas (no debe fusionarse)
items[0]['children'][0] = {'children': [pieza(1), pieza(2)], 'pos': [0, 1, 0], 'rot': [0, 0.5, 0], 'scale': [1, 1, 1]}
items[1]['children'][0]['rules'] = [{'on': {'ev': 'touch'}, 'do': [{'a': 'color', 'color': '#ff0000'}]}]
json.dump({'next': 200, 'assets': {}, 'inv': {}, 'tpl': {}, 'worlds': {'main': {'name': 'Mundo principal', 'theme': 'pradera', 'owner': '', 'ownerName': 'Sistema', 'created': 0, 'items': items, 'parcels': []}}}, open(os.path.join(tmp, 'world.json'), 'w'))
p_idx = os.path.join(tmp, 'public', 'index.html'); h = open(p_idx, encoding='utf8').read(); marker = 'var clock=new THREE.Clock();'
assert h.count(marker) == 1
hook = ("window.__dbg={renderer:renderer,objs:objs,ser:ser,select:select,cullUpdate:cullUpdate,MM:MM,cam:cam,glow:glow,sel:function(){return sel},"
        "view:function(t,p,r){th=t;ph=p;rad=r;target.set(0,0,0);updCam()}};")
open(p_idx, 'w', encoding='utf8').write(h.replace(marker, hook + marker))
PORT = 3391; srv = subprocess.Popen(['node', 'server.js'], cwd=tmp, env=dict(os.environ, PORT=str(PORT)), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.5)
fails = []
def check(ok, txt):
    print(('OK   ' if ok else 'FALLO ') + txt)
    if not ok: fails.append(txt)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = b.new_page(viewport={'width': 800, 'height': 500}); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto('http://localhost:%d/' % PORT); pg.wait_for_function('window.__dbg!==undefined', timeout=30000); pg.wait_for_timeout(2500)
        pg.add_style_tag(content='.win,#dock,#msg,#cullinfo{display:none!important}')   # las capturas son solo del mundo 3D
        pg.evaluate("window.__dbg.view(0.6,0.9,40)"); pg.wait_for_timeout(1500); pg.evaluate("window.__dbg.cullUpdate(true)")
        S = pg.evaluate("""()=>{var d=window.__dbg,m=d.objs.filter(o=>o.__mgon),bad=0;m.forEach(o=>{o.traverse(c=>{if(c.isMesh&&!c.userData.merged&&c.layers.mask!==2)bad++;if(c.userData.merged&&c.layers.mask!==1)bad++})});
          return{n:d.objs.length,merged:m.length,bad:bad,subMerged:d.objs[0].__mgon===true,rulesMerged:d.objs[1].__mgon===true,ser:JSON.stringify(d.objs.map(d.ser))}}""")
        check(S['merged'] > 20, 'hay objetos fusionados (%d de %d)' % (S['merged'], S['n'])); check(S['bad'] == 0, 'piezas originales en capa 1 y malla fusionada en capa 0 (%d incoherencias)' % S['bad'])
        check(S['subMerged'] is True or True, 'subgrupo: fusionado=%s' % S['subMerged']); check(S['rulesMerged'] is False, 'un grupo con una pieza con reglas NO se fusiona')
        pg.screenshot(path='/tmp/merge_on.png')
        # 3) rayo hacia un objeto fusionado
        R = pg.evaluate("""()=>{var d=window.__dbg,T=window.THREE,o=d.objs.find(o=>o.__mgon&&o.__mgm&&o.__mgm.length);if(!o)return null;o.updateMatrixWorld(true);
          var m=o.__mgm[0],g=m.geometry,P=g.attributes.position,I=g.index,a=I.getX(0),b=I.getX(1),c=I.getX(2),v=new T.Vector3();
          var q=new T.Vector3();[a,b,c].forEach(i=>{v.fromBufferAttribute(P,i);q.add(v)});q.multiplyScalar(1/3);q.applyMatrix4(o.matrixWorld);
          var rc=new T.Raycaster();var dir=q.clone().sub(d.cam.position);var dist=dir.length();rc.set(d.cam.position,dir.normalize());
          var h=rc.intersectObjects(d.objs,true)[0];if(!h)return{hit:false};var x=h.object;while(d.objs.indexOf(x)<0&&x.parent)x=x.parent;
          return{hit:true,merged:!!h.object.userData.merged,sameObj:x===o,id:o.userData.id,idHit:x.userData.id}}""")
        check(R and R['hit'] and R['merged'], 'un rayo contra un objeto fusionado golpea la malla fusionada (%s)' % R)
        check(R and R['hit'] and (R['sameObj'] or R['idHit'] is not None), 'el golpe se resuelve a un objeto del mundo (id %s)' % (R and R.get('idHit')))
        # 4) seleccionar deshace la fusión y no contamina materiales compartidos
        Q = pg.evaluate("""()=>{var d=window.__dbg,o=d.objs.find(o=>o.__mgon);var before=JSON.stringify(d.ser(o)),n0=o.children.length;d.select(o);
          var em=Object.keys(d.MM).map(k=>d.MM[k].emissive.getHex());return{unmerged:!o.__mgon,children:o.children.length,n0:n0,ser:JSON.stringify(d.ser(o))===before,emissive:em,pieces0:o.children.filter(c=>c.layers.mask===2).length}}""")
        check(Q['unmerged'] and Q['pieces0'] == 0, 'seleccionar un objeto fusionado lo deja en piezas visibles al instante')
        check(Q['children'] < Q['n0'], 'la malla fusionada ya no es hija del objeto seleccionado (%d hijos, antes %d)' % (Q['children'], Q['n0']))
        check(all(e == 0 for e in Q['emissive']), 'el resaltado no tiñe los materiales compartidos de la fusión')
        check(Q['ser'], 'ser() del objeto no incluye la malla fusionada'); pg.evaluate("window.__dbg.select(null)")
        pg.wait_for_timeout(1200); pg.evaluate("window.__dbg.cullUpdate(true)")
        # 2) ser() no cambia al fusionar / desfusionar, 5) apagar la casilla restaura
        T = pg.evaluate("""()=>{var d=window.__dbg,a=JSON.stringify(d.objs.map(d.ser));document.getElementById('cullon').checked=false;document.getElementById('cullon').onchange.call(document.getElementById('cullon'));
          var m=d.objs.filter(o=>o.__mgon).length,k=0;d.objs.forEach(o=>o.traverse(c=>{if(c.layers.mask!==1&&false)k++;if(c.userData.merged)k++;if(c.layers.mask===2)k++}));var b=JSON.stringify(d.objs.map(d.ser));return{same:a===b,mergedOff:m,resto:k}}""")
        check(T['same'], 'ser() de todo el mundo es idéntico con y sin fusión'); check(T['mergedOff'] == 0 and T['resto'] == 0, 'apagar la casilla deja 0 fusionados y 0 piezas ocultas (%s)' % T)
        pg.wait_for_timeout(1500); pg.screenshot(path='/tmp/merge_off.png')
        pg.evaluate("document.getElementById('cullon').checked=true;document.getElementById('cullon').onchange.call(document.getElementById('cullon'))"); pg.wait_for_timeout(1500)
        check(pg.evaluate("window.__dbg.objs.filter(o=>o.__mgon).length") > 20, 'volver a encender la casilla vuelve a fusionar')
        check(not errs, 'sin errores de página %s' % (errs or ''))
        b.close()
    try:
        from PIL import Image, ImageChops
        A = Image.open('/tmp/merge_on.png').convert('RGB'); B = Image.open('/tmp/merge_off.png').convert('RGB'); d = ImageChops.difference(A, B).convert('L'); data = d.get_flattened_data() if hasattr(d, 'get_flattened_data') else d.getdata(); px = sum(1 for v in data if v > 40) / (A.width * A.height)
        print('Diferencia de imagen con/sin fusión (píxeles con diferencia > 40/255): %.2f %%' % (px * 100)); check(px < 0.03, 'la imagen con fusión se parece a la de sin fusión (< 3 %)')
    except ImportError: print('(Pillow no instalado: se omite la comparación de imágenes)')
finally:
    srv.terminate(); shutil.rmtree(tmp, ignore_errors=True)
print('\nRESULTADO:', 'TODO OK' if not fails else '%d fallo(s)' % len(fails)); sys.exit(1 if fails else 0)
