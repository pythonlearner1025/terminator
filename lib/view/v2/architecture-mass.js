import {ShapeUtils, Vector2} from 'three'

/** Selected near-play solids. Their original collider envelopes remain immutable. */
export function useVolumetricFracture(c){
 return (c.id.includes('barracks_partition')&&c.center.y<2&&c.center.z<=10&&Math.max(c.size.x,c.size.z)>=2)||['exp_service_choke_w','exp_service_choke_e'].includes(c.id)
}
const TAU=Math.PI*2
const normal=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n)}

/** Connected polyhedral loss at failed edges: large chunks, nested smaller chips.
 * Surviving faces are the original box planes, not a noisy whole-face heightfield.
 * A shared tetrahedral lattice extracts actual depth through the thin wall.
 */
export function fracturedWallMass({length:L,height:H,thickness:T,random:r,topOpen=true}){
 if(![L,H,T].every(n=>Number.isFinite(n)&&n>.02)||typeof r!=='function')throw new TypeError('Fractured wall requires positive dimensions and seeded random')
 const half=[L/2-.004,H/2-.004,T/2-.004],cuts=[]
 function cutter(center,radii,inward){
  const az=r()*TAU,ay=r()*TAU,cz=Math.cos(az),sz=Math.sin(az),cy=Math.cos(ay),sy=Math.sin(ay),phi=(1+Math.sqrt(5))/2,planes=[]
  for(let axis=0;axis<3;axis++)for(const a of [-1,1])for(const b of [-1,1]){
   const v=axis===0?[a,b*phi,0]:axis===1?[0,a,b*phi]:[b*phi,0,a],n=normal(v),x=n[0]*cz-n[1]*sz,y=n[0]*sz+n[1]*cz
   planes.push({n:[x*cy+n[2]*sy,y,-x*sy+n[2]*cy],d:.82+r()*.36})
  }
  const c={center,radii,inward,planes,scale:Math.min(...radii)};cuts.push(c);return c
 }
 function chip(parent,size){
  const direction=normal([parent.inward[0]*(.5+r())+(r()-.5)*.45,parent.inward[1]*(.5+r())+(r()-.5)*1.2,(r()-.5)*1.4])
  let hit=Infinity
  for(const p of parent.planes){const d=p.n.reduce((s,x,i)=>s+x*direction[i],0);if(d>0)hit=Math.min(hit,p.d/d)}
  const vector=direction.map((x,i)=>x*parent.radii[i]),unit=normal(vector)
  const center=parent.center.map((x,i)=>x+vector[i]*hit-unit[i]*size*.38)
  return cutter(center,[size*(.8+r()*.5),size*(.75+r()*.6),size*(.7+r()*.5)],parent.inward)
 }
 const coarse=[]
 for(const end of [-1,1])for(let y=-H/2+.12+r()*.2;y<H/2;y+=.40+r()*.48){
  coarse.push(cutter([end*(L/2+.035+r()*.045),y,(r()-.5)*T*.8],[Math.min(L*.12,.12+r()*.12),.13+r()*.22,Math.max(.08,T*(.35+r()*.55))],[-end,0,0]))
 }
 if(topOpen)for(let x=-L/2+.2;x<L/2;x+=.5+r()*.65){
  coarse.push(cutter([x,H/2+.06,(r()-.5)*T*.8],[.16+r()*.24,.11+r()*.13,Math.max(.08,T*(.4+r()*.5))],[0,-1,0]))
 }
 for(const c of coarse)for(let j=0;j<4;j++){
  const medium=chip(c,.035+r()*.06)
  for(let k=0;k<2;k++)chip(medium,.019+r()*.025)
 }
 function field(x,y,z){
  let s=Math.min(half[0]-Math.abs(x),half[1]-Math.abs(y),half[2]-Math.abs(z))
  if(s<-.06)return s
  for(const c of cuts){
   const a=(x-c.center[0])/c.radii[0],b=(y-c.center[1])/c.radii[1],d=(z-c.center[2])/c.radii[2]
   if(Math.abs(a)>2.5||Math.abs(b)>2.5||Math.abs(d)>2.5)continue
   let outside=-Infinity
   for(const p of c.planes)outside=Math.max(outside,p.n[0]*a+p.n[1]*b+p.n[2]*d-p.d)
   s=Math.min(s,outside*c.scale)
  }
  return s-1e-5
 }
 const steps=[.035,.035,Math.min(.04,T/8)],sizes=[L,H,T],counts=sizes.map((s,i)=>Math.max(3,Math.min([256,128,24][i],Math.ceil((s+.0364)/steps[i])+1)))
 const axes=sizes.map((s,i)=>Array.from({length:counts[i]},(_,k)=>-s/2-.0173+k*(s+.0364)/(counts[i]-1))),[nx,ny,nz]=counts,nxy=nx*ny,total=nxy*nz
 const values=new Float64Array(total),coords=new Array(total)
 const index=(i,j,k)=>i+j*nx+k*nxy
 for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const id=index(i,j,k),p=[axes[0][i],axes[1][j],axes[2][k]];coords[id]=p;values[id]=field(...p)}
 const gradients=new Map(),grad=id=>{
  if(gradients.has(id))return gradients.get(id)
  const k=Math.floor(id/nxy),j=Math.floor((id-k*nxy)/nx),i=id%nx,at=[i,j,k],g=[]
  for(let a=0;a<3;a++){const lo=at.slice(),hi=at.slice();lo[a]=Math.max(0,lo[a]-1);hi[a]=Math.min(counts[a]-1,hi[a]+1);g[a]=-(values[index(...hi)]-values[index(...lo)])/(axes[a][hi[a]]-axes[a][lo[a]])}
  gradients.set(id,g);return g
 }
 const vertices=[],normals=[],edges=new Map(),weld=new Map(),faces=[]
 function crossing(a,b){
  const key=a<b?`${a}:${b}`:`${b}:${a}`;if(edges.has(key))return edges.get(key)
  const t=values[a]/(values[a]-values[b]),p=coords[a].map((x,i)=>Math.round((x+(coords[b][i]-x)*t)*1e7)/1e7),tag=p.join(',')
  let id=weld.get(tag)
  if(id===undefined){id=vertices.length;vertices.push(p);const ga=grad(a),gb=grad(b);normals.push(normal(ga.map((x,i)=>x+(gb[i]-x)*t)));weld.set(tag,id)}
  edges.set(key,id);return id
 }
 function triangle(ids,outward){
  if(new Set(ids).size<3)return
  const [a,b,c]=ids.map(i=>vertices[i]),u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
  if(Math.hypot(...n)<1e-13)return
  if(n.reduce((s,x,i)=>s+x*outward[i],0)<0)ids.reverse()
  faces.push(ids)
 }
 const tets=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]]
 for(let k=0;k<nz-1;k++)for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
  const a=index(i,j,k),cube=[a,a+1,a+1+nx,a+nx,a+nxy,a+nxy+1,a+nxy+nx+1,a+nxy+nx]
  if(cube.every(v=>values[v]>=0)||cube.every(v=>values[v]<0))continue
  for(const tet of tets){
   const inside=tet.map(t=>cube[t]).filter(v=>values[v]>=0),outside=tet.map(t=>cube[t]).filter(v=>values[v]<0)
   if(!inside.length||!outside.length)continue
   const direction=[0,1,2].map(axis=>outside.reduce((s,v)=>s+coords[v][axis],0)/outside.length-inside.reduce((s,v)=>s+coords[v][axis],0)/inside.length)
   if(inside.length===1)triangle(outside.map(b=>crossing(inside[0],b)),direction)
   else if(outside.length===1)triangle(inside.map(a=>crossing(a,outside[0])),direction)
   else {const [a,b]=inside,[c,d]=outside,q=[crossing(a,c),crossing(a,d),crossing(b,d),crossing(b,c)];triangle([q[0],q[1],q[2]],direction);triangle([q[0],q[2],q[3]],direction)}
  }
 }
 // Keep the surviving connected mass. Detached slivers are removed, not left
 // floating as unsupported chunks; separate supported collapse dressing owns them.
 const parents=Uint32Array.from(vertices,(_,i)=>i),find=i=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i}
 for(const t of faces){const a=find(t[0]);for(const b of t.slice(1))parents[find(b)]=a}
 const components=new Map();for(const t of faces){const k=find(t[0]);components.set(k,(components.get(k)||0)+1)}
 const largest=[...components].sort((a,b)=>b[1]-a[1])[0]?.[0],kept=faces.filter(t=>find(t[0])===largest)
 const compact=compactPlanes(kept,vertices,normals,half)
 const triangles=compact.map(ids=>{
  const p=ids.map(i=>vertices[i]),coherent=[0,1,2].some(axis=>p.every(v=>Math.abs(Math.abs(v[axis])-half[axis])<.00005)&&p.every(v=>Math.sign(v[axis])===Math.sign(p[0][axis])))
  return {a:p[0],b:p[1],c:p[2],surface:coherent?'concrete':'fracture',normals:ids.map(i=>normals[i])}
 })
 return {triangles,cavities:[],cuts:cuts.length,removedComponents:Math.max(0,components.size-1),lattice:counts,flatTrianglesRemoved:kept.length-compact.length}
}

// Remove the extraction lattice from coherent box faces. Every original boundary
// vertex is reinserted, so rough neighbouring surfaces retain exact shared edges.
function compactPlanes(faces,vertices,normals,half){
 const groups=new Map(),output=[]
 for(const t of faces){
  const p=t.map(i=>vertices[i]),axis=[0,1,2].find(a=>p.every(v=>v[a]===p[0][a])&&Math.abs(Math.abs(p[0][a])-half[a])<.00005)
  if(axis===undefined){output.push(t);continue}
  const key=`${axis}:${p[0][axis]}`,g=groups.get(key)||{axis,sign:Math.sign(p[0][axis]),triangles:[]};g.triangles.push(t);groups.set(key,g)
 }
 for(const g of groups.values()){
  const edges=new Map(),uv=id=>[vertices[id][(g.axis+1)%3],vertices[id][(g.axis+2)%3]]
  for(const t of g.triangles)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`,e=edges.get(key)||{a,b,count:0};e.count++;edges.set(key,e)}
  const boundary=[...edges.values()].filter(e=>e.count===1),next=new Map();let ambiguous=false
  for(const {a,b} of boundary){if(next.has(a))ambiguous=true;next.set(a,b)}
  if(ambiguous){output.push(...g.triangles);continue}
  const rings=[],unused=new Set(next.keys())
  while(unused.size){const first=unused.values().next().value,ring=[];let at=first
   do{if(!unused.delete(at)){ambiguous=true;break}ring.push(at);at=next.get(at)}while(at!==first&&at!==undefined)
   if(at===undefined)ambiguous=true;rings.push(ring);if(ambiguous)break
  }
  if(ambiguous){output.push(...g.triangles);continue}
  const area=ring=>ring.reduce((sum,a,i)=>{const p=uv(a),q=uv(ring[(i+1)%ring.length]);return sum+p[0]*q[1]-q[0]*p[1]},0)/2
  const inside=(point,ring)=>{let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=uv(ring[i]),b=uv(ring[j]);if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes}return yes}
  const outers=rings.filter(r=>area(r)*g.sign>0),holes=rings.filter(r=>area(r)*g.sign<0),points=[...next.keys()],built=[]
  for(const outer of outers){
   const ownedHoles=holes.filter(h=>inside(uv(h[0]),outer)),flat=[...outer,...ownedHoles.flat()]
   const result=ShapeUtils.triangulateShape(outer.map(i=>new Vector2(...uv(i))),ownedHoles.map(h=>h.map(i=>new Vector2(...uv(i)))))
   for(const indices of result){
    const t=indices.map(i=>flat[i]);if(g.sign<0)t.reverse()
    const [pa,pb,pc]=t.map(uv)
    if(Math.abs((pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0]))<.00001*Math.max(Math.hypot(pb[0]-pa[0],pb[1]-pa[1]),Math.hypot(pc[0]-pa[0],pc[1]-pa[1]),Math.hypot(pc[0]-pb[0],pc[1]-pb[1])))continue
    const polygon=[]
    for(let i=0;i<3;i++){
     const a=t[i],b=t[(i+1)%3],p=uv(a),q=uv(b),dx=q[0]-p[0],dy=q[1]-p[1],length2=dx*dx+dy*dy,chain=[]
     for(const id of points){if(id===a||id===b)continue;const v=uv(id),cross=dx*(v[1]-p[1])-dy*(v[0]-p[0]),along=((v[0]-p[0])*dx+(v[1]-p[1])*dy)/length2
      // Include nearly collinear boundary knots in the adjacent non-sliver face.
      if(Math.abs(cross)<.00001*Math.sqrt(length2)&&along>1e-9&&along<1-1e-9)chain.push({id,along})
     }
     chain.sort((a,b)=>a.along-b.along);polygon.push(a,...chain.map(v=>v.id))
    }
    if(polygon.length===3){built.push(t);continue}
    const center=t.map(i=>vertices[i]).reduce((a,p)=>a.map((x,i)=>x+p[i]/3),[0,0,0]),id=vertices.length,n=[0,0,0];n[g.axis]=g.sign;vertices.push(center);normals.push(n)
    for(let i=0;i<polygon.length;i++)built.push([id,polygon[i],polygon[(i+1)%polygon.length]])
   }
  }
  // A triangulation must preserve total projected area before replacing a face.
  const triangleArea=t=>{const [a,b,c]=t.map(uv);return Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2}
  const before=g.triangles.reduce((n,t)=>n+triangleArea(t),0),after=built.reduce((n,t)=>n+triangleArea(t),0)
  // Preserve the exact oriented boundary, including sub-grid contour knots.
  // Earcut can bridge a very narrow concavity; retain the original face there.
  const signature=ts=>{const result=new Map();for(const t of ts)for(let i=0;i<3;i++){
   const a=t[i],b=t[(i+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`,e=result.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;result.set(key,e)
  }return result}
  const original=signature(g.triangles),replacement=signature(built)
  const valid=built.every(t=>{const [a,b,c]=t.map(uv);return ((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))*g.sign>1e-12})&&[...replacement].every(([k,e])=>e[0]===2?e[1]===0:e[0]===1&&original.get(k)?.[0]===1&&original.get(k)?.[1]===e[1])&&[...original].every(([k,e])=>e[0]!==1||replacement.get(k)?.[0]===1&&replacement.get(k)?.[1]===e[1])
  if(Math.abs(before-after)>1e-7||!built.length||!valid)output.push(...g.triangles);else output.push(...built)
 }
 return output
}
