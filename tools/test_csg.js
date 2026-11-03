// node tools/test_csg.js  -> prueba unión / resta / intersección con volúmenes conocidos
global.window=global;global.self=global;var vm=require('vm'),fs=require('fs'),p=require('path');var P_=p;
vm.runInThisContext(fs.readFileSync(p.join(__dirname,'../three.min.js'),'utf8'));
global.THREE=window.THREE||THREE;require('../prim.js');require('../csg.js');
function vol(g){var a=g.attributes.position.array,v=0;for(var i=0;i<a.length;i+=9)v+=(a[i]*(a[i+4]*a[i+8]-a[i+5]*a[i+7])-a[i+1]*(a[i+3]*a[i+8]-a[i+5]*a[i+6])+a[i+2]*(a[i+3]*a[i+7]-a[i+4]*a[i+6]))/6;return v}
var ok=0,bad=0;function t(n,c,x){console.log((c?'OK  ':'FALLA ')+n+(x!==undefined?'  ['+x+']':''));c?ok++:bad++}
function near(a,b,e){return Math.abs(a-b)<(e||1e-4)}
var M=function(x,y,z,sx,sy,sz){return new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion(),new THREE.Vector3(sx||1,sy||1,sz||1))};
var box=primGeo({sides:4}),cyl=primGeo({sides:32}),I=M(0,0,0);
var u=csgGeo(box,I,box,M(0.5,0,0),'union'),s=csgGeo(box,I,box,M(0.5,0,0),'subtract'),i=csgGeo(box,I,box,M(0.5,0,0),'intersect');
t('unión de dos cajas solapadas = 1,5 (caras coplanares)',near(vol(u),1.5),vol(u));
t('resta = 0,5',near(vol(s),0.5),vol(s));
t('intersección = 0,5',near(vol(i),0.5),vol(i));
var d=csgGeo(box,I,box,M(5,0,0),'union');t('unión de cajas separadas = 2',near(vol(d),2),vol(d));
var e=csgGeo(box,I,box,M(5,0,0),'intersect');t('intersección vacía → sin caras',!e.attributes.position.count||near(vol(e),0));
var hole=csgGeo(box,I,cyl,M(0,0,0,0.5,1.4,0.5),'subtract'),exp=1-0.5*32*0.25*Math.sin(2*Math.PI/32)*0.25;
t('caja − cilindro que la atraviesa',near(vol(hole),exp,1e-4),vol(hole)+' esperado '+exp.toFixed(5));
var gs=hole.groups.map(function(x){return x.materialIndex}).join();t('grupos: caras de A y paredes del corte (B) ['+gs+']',gs==='0,1');
var hol=csgGeo(primGeo({sides:4,hollow:0.5}),I,box,M(0,0,0.5),'subtract');t('prim hueco − caja = resultado válido (>0)',vol(hol)>0&&vol(hol)<0.75,vol(hol));
var all=csgGeo(box,I,cyl,M(0.2,0.1,0,0.7,1,0.7),'intersect');t('caja ∩ cilindro: volumen entre 0 y 0,39',vol(all)>0.05&&vol(all)<0.39,vol(all));
var big=primGeo({sides:32,levels:200});t('operando enorme → null',csgGeo(big,I,box,I,'union')===null);
var n=all.attributes.normal.array;t('normales sin NaN',!Array.prototype.some.call(n,isNaN));
var t0=Date.now();csgGeo(primGeo({sides:32,levels:6}),I,primGeo({sides:32,levels:6}),M(0.3,0.1,0.2),'subtract');var ms=Date.now()-t0;t('rendimiento: dos cilindros 32 lados en <3 s',ms<3000,ms+' ms');
var pk=csgPack(hole),rt=csgUnpack(JSON.parse(JSON.stringify(pk)));
t('empaquetar → JSON → desempaquetar conserva volumen y grupos',near(vol(rt),vol(hole),2e-3)&&rt.groups.map(function(x){return x.count}).join()===hole.groups.map(function(x){return x.count}).join(),vol(rt));
t('lo guardado son enteros',pk.v.every(Number.isInteger)&&pk.g[0]+pk.g[1]===pk.v.length/3);
var src=fs.readFileSync(p.join(__dirname,'../server.js'),'utf8'),cc=new Function(src.match(/const MAX_CSG_TRI = \d+;/)[0]+src.match(/function cleanCsg[\s\S]*?\n}\n/)[0]+';return cleanCsg')();
t('servidor acepta una malla válida',cc(pk)!==null);
t('servidor rechaza: coordenada decimal',cc({v:[0.5,0,0,1,0,0,0,1,0],g:[3,0]})===null);
t('servidor rechaza: grupos que no suman',cc({v:[0,0,0,1,0,0,0,1,0],g:[3,3]})===null);
t('servidor rechaza: demasiados triángulos',cc({v:new Array(9*3001).fill(0),g:[3*3001,0]})===null);
t('servidor rechaza: coordenada fuera de rango',cc({v:[0,0,0,1,0,0,0,999999,0],g:[3,0]})===null);
t('servidor rechaza: no objeto',cc(null)===null&&cc('x')===null);
var SP=new THREE.SphereGeometry(0.5,32,20),su=csgGeo(SP,I,SP,M(0.5,0,0),'union');t('aviso: la unión de dos esferas finas (32×20) pesa mucho ('+su.attributes.position.count/3+' triángulos); el editor reintenta con formas simplificadas',su.attributes.position.count/3>3000);
var SL=new THREE.SphereGeometry(0.5,12,8),sl=csgGeo(SL,I,SL,M(0.5,0,0),'union');t('con esferas simplificadas (12×8) cabe en 3000 y el volumen es coherente',sl.attributes.position.count/3<=3000&&vol(sl)>vol(SL.toNonIndexed())&&vol(sl)<2*vol(SL.toNonIndexed()),sl.attributes.position.count/3+' tri, volumen '+vol(sl).toFixed(3)+' (una esfera: '+vol(SL.toNonIndexed()).toFixed(3)+')');
console.log(ok+' bien, '+bad+' mal');process.exit(bad?1:0);
