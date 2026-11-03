/* v6.36: unión, resta e intersección de sólidos (CSG con árbol BSP). Sin dependencias salvo THREE.
   csgGeo(geoA, matA, geoB, matB, 'union'|'subtract'|'intersect') -> BufferGeometry sin índice, o null si algún operando es demasiado grande.
   Grupos del resultado: 0 = caras que vienen de A, 1 = caras que vienen de B (en una resta, las paredes del corte llevan el material de B).
   Los operandos deben ser sólidos cerrados (como los de prim.js o las formas básicas). */
(function(w){
var EPS=1e-5,MAXTRI=4000;
function sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
function Poly(v,tag){this.v=v;this.tag=tag;var n=cross(sub(v[1],v[0]),sub(v[2],v[0])),l=Math.hypot(n[0],n[1],n[2])||1;this.n=[n[0]/l,n[1]/l,n[2]/l];this.d=dot(this.n,v[0])}
Poly.prototype.flip=function(){this.v.reverse();this.n=[-this.n[0],-this.n[1],-this.n[2]];this.d=-this.d};
function split(pn,pd,poly,cf,cb,f,b){var T=0,types=[],i,t;
 for(i=0;i<poly.v.length;i++){t=dot(pn,poly.v[i])-pd;var ty=t<-EPS?2:t>EPS?1:0;T|=ty;types.push(ty)}
 if(T===0)(dot(pn,poly.n)>0?cf:cb).push(poly);else if(T===1)f.push(poly);else if(T===2)b.push(poly);
 else{var fv=[],bv=[],n=poly.v.length;
  for(i=0;i<n;i++){var j=(i+1)%n,ti=types[i],tj=types[j],vi=poly.v[i],vj=poly.v[j];
   if(ti!==2)fv.push(vi);if(ti!==1)bv.push(vi);
   if((ti|tj)===3){var s=(pd-dot(pn,vi))/dot(pn,sub(vj,vi)),v=[vi[0]+(vj[0]-vi[0])*s,vi[1]+(vj[1]-vi[1])*s,vi[2]+(vj[2]-vi[2])*s];fv.push(v);bv.push(v)}}
  if(fv.length>=3)f.push(new Poly(fv,poly.tag));if(bv.length>=3)b.push(new Poly(bv,poly.tag))}}
function Node(p){this.n=null;this.d=0;this.front=null;this.back=null;this.polys=[];if(p)this.build(p)}
Node.prototype.build=function(list){if(!list.length)return;if(!this.n){this.n=list[0].n;this.d=list[0].d}
 var f=[],b=[],i;for(i=0;i<list.length;i++)split(this.n,this.d,list[i],this.polys,this.polys,f,b);
 if(f.length){if(!this.front)this.front=new Node();this.front.build(f)}if(b.length){if(!this.back)this.back=new Node();this.back.build(b)}};
Node.prototype.invert=function(){this.polys.forEach(function(p){p.flip()});if(this.n){this.n=[-this.n[0],-this.n[1],-this.n[2]];this.d=-this.d}
 var t=this.front;this.front=this.back;this.back=t;if(this.front)this.front.invert();if(this.back)this.back.invert()};
Node.prototype.clip=function(list){if(!this.n)return list.slice();var f=[],b=[],i;
 for(i=0;i<list.length;i++)split(this.n,this.d,list[i],f,b,f,b);
 f=this.front?this.front.clip(f):f;b=this.back?this.back.clip(b):[];return f.concat(b)};
Node.prototype.clipTo=function(o){this.polys=o.clip(this.polys);if(this.front)this.front.clipTo(o);if(this.back)this.back.clipTo(o)};
Node.prototype.all=function(){var a=this.polys.slice();if(this.front)a=a.concat(this.front.all());if(this.back)a=a.concat(this.back.all());return a};
function polysOf(g,m,tag){var T=w.THREE;if(g.index)g=g.toNonIndexed();var a=g.attributes.position.array,out=[],v=new T.Vector3();
 if(a.length/9>MAXTRI)return null;
 for(var i=0;i<a.length;i+=9){var tri=[];for(var k=0;k<3;k++){v.set(a[i+k*3],a[i+k*3+1],a[i+k*3+2]);if(m)v.applyMatrix4(m);tri.push([v.x,v.y,v.z])}
  var p=new Poly(tri,tag);if(Math.abs(p.d)<1e9&&Math.hypot.apply(null,cross(sub(tri[1],tri[0]),sub(tri[2],tri[0])))>1e-12)out.push(p)}return out}
function csgGeo(gA,mA,gB,mB,op){var pa=polysOf(gA,mA,0),pb=polysOf(gB,mB,1);if(!pa||!pb)return null;var a=new Node(pa),b=new Node(pb);
 if(op==='union'){a.clipTo(b);b.clipTo(a);b.invert();b.clipTo(a);b.invert();a.build(b.all())}
 else if(op==='subtract'){a.invert();a.clipTo(b);b.clipTo(a);b.invert();b.clipTo(a);b.invert();a.build(b.all());a.invert()}
 else if(op==='intersect'){a.invert();b.clipTo(a);b.invert();a.clipTo(b);b.clipTo(a);a.build(b.all());a.invert()}
 else return null;
 var T=w.THREE,pos=[[],[]];a.all().forEach(function(p){for(var i=1;i<p.v.length-1;i++)pos[p.tag].push(p.v[0],p.v[i],p.v[i+1])});
 var g=new T.BufferGeometry(),flat=[],n=0;pos.forEach(function(arr,ti){var c=0;arr.forEach(function(v){flat.push(v[0],v[1],v[2]);c++});if(c)g.addGroup(n,c,ti);n+=c});
 g.setAttribute('position',new T.Float32BufferAttribute(flat,3));g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g}
/* Guardado: malla -> {v:[coordenadas en milésimas enteras, 3 por vértice], g:[vértices del grupo 0, del grupo 1]} y al revés */
function csgPack(g){var a=g.attributes.position.array,v=new Array(a.length),i,c=[0,0];for(i=0;i<a.length;i++)v[i]=Math.round(a[i]*1000);
 g.groups.forEach(function(x){c[x.materialIndex]=x.count});return{v:v,g:c}}
function csgUnpack(d){var T=w.THREE,g=new T.BufferGeometry(),pos=new Float32Array(d.v.length),i,n=0;for(i=0;i<pos.length;i++)pos[i]=d.v[i]/1000;
 g.setAttribute('position',new T.BufferAttribute(pos,3));d.g.forEach(function(c,k){if(c){g.addGroup(n,c,k);n+=c}});g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();return g}
w.csgGeo=csgGeo;w.csgPack=csgPack;w.csgUnpack=csgUnpack})(typeof window!=='undefined'?window:global);
