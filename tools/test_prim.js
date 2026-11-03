// node tools/test_prim.js  -> comprueba volumen, orientación de normales y grupos de primGeo
global.window=global;global.self=global;var vm=require('vm'),fs=require('fs'),p=require('path');
vm.runInThisContext(fs.readFileSync(p.join(__dirname,'../three.min.js'),'utf8'));
global.THREE=window.THREE||THREE;require('../prim.js');
function vol(g){var a=g.attributes.position.array,v=0;for(var i=0;i<a.length;i+=9){var x1=a[i],y1=a[i+1],z1=a[i+2],x2=a[i+3],y2=a[i+4],z2=a[i+5],x3=a[i+6],y3=a[i+7],z3=a[i+8];
 v+=(x1*(y2*z3-z2*y3)-y1*(x2*z3-z2*x3)+z1*(x2*y3-y2*x3))/6}return v}
var ok=0,bad=0;function t(n,c){console.log((c?'OK  ':'FALLA ')+n);c?ok++:bad++}
function near(a,b,e){return Math.abs(a-b)<(e||0.01)}
t('caja 4 lados = 1',near(vol(primGeo({sides:4})),1,1e-6));
t('cilindro 32 ≈ 0.785',near(vol(primGeo({sides:32})),0.7846));
t('prisma 3 lados >0',vol(primGeo({sides:3}))>0);
t('hueco 0.5 → volumen ×0.75',near(vol(primGeo({sides:4,hollow:0.5})),0.75,1e-6));
t('corte 0..0.5 → mitad',near(vol(primGeo({sides:32,cutE:0.5})),0.3923,0.005));
t('corte+hueco coherente',near(vol(primGeo({sides:32,cutE:0.5,hollow:0.5})),0.3923*0.75,0.005));
t('torsión 90° ≈ volumen (error baja al subir niveles)',near(vol(primGeo({sides:4,twistE:90,levels:24})),1,0.03));
t('afilado 1 en caja = pirámide ≈ 1/3·(ver)',vol(primGeo({sides:4,taperX:1,taperY:1}))>0.3&&vol(primGeo({sides:4,taperX:1,taperY:1}))<0.34);
t('desplazamiento lateral conserva volumen',near(vol(primGeo({sides:4,shearX:0.5})),1,1e-6));
var g=primGeo({sides:32,cutE:0.5,hollow:0.5}),m=g.groups.map(function(x){return x.materialIndex}).sort().join();
t('grupos 0,1,2,3,4 con corte y hueco ('+m+')',m==='0,1,2,3,4');
t('caja sin hueco: grupos 0,1,2',primGeo({sides:4}).groups.map(function(x){return x.materialIndex}).join()==='2,0,1'||primGeo({sides:4}).groups.length===3);
var n=primGeo({sides:32}).attributes.normal.array;t('normales sin NaN',!Array.prototype.some.call(n,isNaN));
// v6.39: coordenadas UV (sin ellas ninguna textura se veía sobre un prim: salía lisa)
function uvr(g,gi){var u=g.attributes.uv.array,r=[1e9,-1e9,1e9,-1e9],gr=g.groups.filter(function(x){return x.materialIndex===gi})[0];if(!gr)return null;
 for(var i=gr.start;i<gr.start+gr.count;i++){r[0]=Math.min(r[0],u[i*2]);r[1]=Math.max(r[1],u[i*2]);r[2]=Math.min(r[2],u[i*2+1]);r[3]=Math.max(r[3],u[i*2+1])}return r}
[{sides:4},{sides:32},{sides:6,hollow:0.5,cutB:0.1,cutE:0.8},{sides:4,twistE:45,taperX:0.3},{sides:32,hollow:0.4,cutE:0.5}].forEach(function(o){var g=primGeo(o),u=g.attributes.uv;
 t('UV: '+JSON.stringify(o)+' → uv de 2 componentes, uno por vértice y sin NaN',u&&u.itemSize===2&&u.count===g.attributes.position.count&&!Array.prototype.some.call(u.array,function(x){return !isFinite(x)}))});
var gb=primGeo({sides:4}),ub=[0,1,2].map(function(i){return uvr(gb,i)});
t('UV caja: la tapa superior cubre 0–1 en ambos ejes (la textura entera, no un punto)',near(ub[0][0],0,1e-4)&&near(ub[0][1],1,1e-4)&&near(ub[0][2],0,1e-4)&&near(ub[0][3],1,1e-4));
t('UV caja: la tapa inferior también cubre 0–1',near(ub[1][1]-ub[1][0],1,1e-4)&&near(ub[1][3]-ub[1][2],1,1e-4));
t('UV caja: los lados (4 caras planas) llevan cada uno la textura entera (u 0–1, v 0–1)',near(ub[2][0],0,1e-4)&&near(ub[2][1],1,1e-4)&&near(ub[2][2],0,1e-4)&&near(ub[2][3],1,1e-4));
var gc=primGeo({sides:32}),uc=uvr(gc,2);
t('UV cilindro: el lado da una vuelta continua (u de 0 a 1) y v de 0 a 1',near(uc[0],0,1e-4)&&near(uc[1],1,1e-4)&&near(uc[2],0,1e-4)&&near(uc[3],1,1e-4));
var gh=primGeo({sides:4,hollow:0.5,cutB:0.25,cutE:0.75}),u3=uvr(gh,3),u4=uvr(gh,4);
t('UV corte y hueco: la cara de corte (radial 0,5–1 × altura) y la pared interior tienen valores propios',u3&&near(u3[0],0.5,1e-4)&&near(u3[1],1,1e-4)&&near(u3[3]-u3[2],1,1e-4)&&u4&&u4[1]-u4[0]>0.5);
// validación del servidor (se extrae cleanPrim de server.js)
var src=fs.readFileSync(p_('../server.js'),'utf8'),mm=src.match(/function cleanPrim[\s\S]*?\n}\n/);function p_(x){return p.join(__dirname,x)}
var cleanPrim=new Function(mm[0]+';return cleanPrim')();
var c=cleanPrim({cutB:-5,cutE:0.1,hollow:9,twistE:999,taperX:'x',shearX:5});
t('servidor recorta rangos',c.cutB===0&&c.cutE===0.1&&c.hollow===0.95&&c.twistE===180&&c.taperX===0&&c.shearX===1);
t('servidor: cutE siempre > cutB',cleanPrim({cutB:0.9,cutE:0.1}).cutE>=0.92);
t('servidor rechaza no-objeto',cleanPrim('x')===null&&cleanPrim(null)===null);
console.log(ok+' bien, '+bad+' mal');process.exit(bad?1:0);
