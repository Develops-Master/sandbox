/* v6.33: generador de prims estilo Second Life. primGeo({sides,cutB,cutE,hollow,twistB,twistE,taperX,taperY,shearX,shearY,levels})
   Devuelve BufferGeometry sin índice con grupos por cara: 0 tapa superior, 1 inferior, 2 lateral exterior, 3 caras de corte, 4 pared interior (hueco). */
(function(w){
function primGeo(o){
 o=Object.assign({sides:32,cutB:0,cutE:1,hollow:0,twistB:0,twistE:0,taperX:0,taperY:0,shearX:0,shearY:0,levels:12},o||{});
 var T=w.THREE,S=Math.max(3,o.sides|0),cb=Math.min(Math.max(o.cutB,0),0.98),ce=Math.min(Math.max(o.cutE,cb+0.02),1),
 full=ce-cb>=0.9999,np=full?S:S+1,H=Math.min(Math.max(o.hollow,0),0.95),L=full&&S<=8&&!o.twistB&&!o.twistE?1:Math.max(1,o.levels|0),
 R=S<=8?0.5/Math.cos(Math.PI/S):0.5,off=S<=8&&S%2===0?Math.PI/S:0,P=[],G=[[],[],[],[],[]],U=[[],[],[],[],[]],k,j,FL=S<=8;
 for(k=0;k<np;k++){var a=(cb+(ce-cb)*k/S)*2*Math.PI+off;P.push([R*Math.cos(a),R*Math.sin(a)])}
 function pt(p,h,t){var sx=1-o.taperX*t,sy=1-o.taperY*t,x=p[0]*h*sx,z=p[1]*h*sy,
  tw=(o.twistB+(o.twistE-o.twistB)*t)*Math.PI/180,c=Math.cos(tw),s=Math.sin(tw);
  return[x*c+z*s+o.shearX*t,t-0.5,-x*s+z*c+o.shearY*t]}
 function q(g,a,b,c,d,ua,ub,uc,ud){G[g].push(a,b,c,a,c,d);U[g].push(ua,ub,uc,ua,uc,ud)}   /* v6.39: cada triángulo lleva sus UV (ua..ud = [u,v] de a..d) */
 function pl(p,f){return[f?0.5-p[0]:p[0]+0.5,p[2]+0.5]}   /* tapas: proyección plana desde arriba (la de abajo, espejada para leerse bien desde abajo) */
 var top=L/L;
 for(k=0;k<np-(full?0:1);k++){var k2=(k+1)%np;
  for(j=0;j<L;j++){var t0=j/L,t1=(j+1)/L;
   var ua=FL?0:k/S,ub=FL?1:(k+1)/S;   /* lados planos (caja, prisma): cada cara lleva la textura entera; redondos: una vuelta continua */
   q(2,pt(P[k],1,t0),pt(P[k],1,t1),pt(P[k2],1,t1),pt(P[k2],1,t0),[ua,t0],[ua,t1],[ub,t1],[ub,t0]);
   if(H>0)q(4,pt(P[k],H,t0),pt(P[k2],H,t0),pt(P[k2],H,t1),pt(P[k],H,t1),[ua,t0],[ub,t0],[ub,t1],[ua,t1])}
  var c0=pt(P[k],1,1),c1=pt(P[k],H,1),c2=pt(P[k2],H,1),c3=pt(P[k2],1,1),d0=pt(P[k],1,0),d1=pt(P[k2],1,0),d2=pt(P[k2],H,0),d3=pt(P[k],H,0);
  q(0,c0,c1,c2,c3,pl(c0),pl(c1),pl(c2),pl(c3));
  q(1,d0,d1,d2,d3,pl(d0,1),pl(d1,1),pl(d2,1),pl(d3,1))}
 if(!full)for(j=0;j<L;j++){var u0=j/L,u1=(j+1)/L;
  q(3,pt(P[0],1,u0),pt(P[0],H,u0),pt(P[0],H,u1),pt(P[0],1,u1),[1,u0],[H,u0],[H,u1],[1,u1]);
  var e=P[np-1];q(3,pt(e,1,u0),pt(e,1,u1),pt(e,H,u1),pt(e,H,u0),[1,u0],[1,u1],[H,u1],[H,u0])}
 var pos=[],uv=[],g=new T.BufferGeometry(),n=0;
 G.forEach(function(a,i){var c=0;a.forEach(function(v,m){pos.push(v[0],v[1],v[2]);uv.push(U[i][m][0],U[i][m][1]);c++});if(c)g.addGroup(n,c,i);n+=c});
 g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.computeVertexNormals();
 if(S>8){ /* suaviza lados redondos: promedia normales de vértices coincidentes */
  var nm=g.attributes.normal,ps=g.attributes.position,acc={},key=function(i){return[0,1,2].map(function(a){return Math.round(ps.array[i*3+a]*1e4)}).join()+(i>=0?'':'')};
  g.groups.forEach(function(gr){if(gr.materialIndex!==2&&gr.materialIndex!==4)return;
   for(var i=gr.start;i<gr.start+gr.count;i++){var kk=gr.materialIndex+key(i),A=acc[kk]||(acc[kk]=[0,0,0]);A[0]+=nm.array[i*3];A[1]+=nm.array[i*3+1];A[2]+=nm.array[i*3+2]}
   for(i=gr.start;i<gr.start+gr.count;i++){A=acc[gr.materialIndex+key(i)];var l=Math.hypot(A[0],A[1],A[2])||1;nm.setXYZ(i,A[0]/l,A[1]/l,A[2]/l)}})}
 g.computeBoundingBox();g.computeBoundingSphere();return g}
w.primGeo=primGeo})(typeof window!=='undefined'?window:global);
