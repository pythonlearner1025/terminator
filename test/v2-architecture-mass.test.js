import assert from 'node:assert/strict'
import {test} from 'node:test'
import {defaultMap} from '../lib/core/map.js'
globalThis.ImageData ??= class {}
const {fracturedWallMass,useVolumetricFracture}=await import('../lib/view/v2/architecture-mass.js')
const random=text=>{let s=2166136261;for(const c of text)s=Math.imul(s^c.charCodeAt(0),16777619);return()=>((s=Math.imul(s,1664525)+1013904223>>>0)/4294967296)}

test('six near cast slabs retain closed contained volumes, broad planar faces and depth-varying chipped margins',()=>{
 const selected=defaultMap.colliders.filter(useVolumetricFracture),before=JSON.stringify(selected)
 assert.equal(selected.length,6)
 let total=0
 for(const c of selected){
  const L=Math.max(c.size.x,c.size.z),H=c.size.y,T=Math.min(c.size.x,c.size.z)
  const m=fracturedWallMass({length:L,height:H,thickness:T,random:random(c.id+':volume-r8'),topOpen:!c.id.includes('service')})
  const edges=new Map();let volume=0,planarArea=0,depthFaces=0
  for(const t of m.triangles){
   const p=[t.a,t.b,t.c],[a,b,d]=p,u=b.map((x,i)=>x-a[i]),v=d.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
   assert.ok(Math.hypot(...n)>1e-12,`${c.id}: no degenerate triangles`)
   for(const q of p)assert.ok(q.every((x,i)=>Number.isFinite(x)&&Math.abs(x)<=[L,H,T][i]/2),`${c.id}: original collider envelope`)
   for(const n of t.normals)assert.ok(Math.abs(Math.hypot(...n)-1)<1e-9)
   if(t.surface==='concrete'&&p.every(q=>Math.abs(Math.abs(q[2])-(T/2-.004))<.00005))planarArea+=Math.hypot(...n)/2
   if(t.surface==='fracture'&&Math.max(...p.map(q=>q[2]))-Math.min(...p.map(q=>q[2]))>.001)depthFaces++
   volume+=(a[0]*(b[1]*d[2]-b[2]*d[1])+a[1]*(b[2]*d[0]-b[0]*d[2])+a[2]*(b[0]*d[1]-b[1]*d[0]))/6
   for(let i=0;i<3;i++){const a=p[i].join(','),b=p[(i+1)%3].join(','),key=[a,b].sort().join('|'),e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e)}
  }
  assert.ok([...edges.values()].every(e=>e[0]===2&&e[1]===0),`${c.id}: exact closed oriented manifold`)
  assert.ok(volume>L*H*T*.85&&volume<L*H*T,`${c.id}: coherent cast slab, not large missing chevrons`)
  assert.ok(planarArea>2*L*H*.72,`${c.id}: broad planar surviving substrate`)
  assert.ok(depthFaces>1000,`${c.id}: true chipped depth surfaces`)
  total+=m.triangles.length
 }
 assert.ok(total<270000,'bounded selected edge representation including conservative flat triangulation fallback')
 assert.equal(JSON.stringify(selected),before)
})

test('final Float32 world batches preserve nondegenerate closed wall shells',async()=>{
 globalThis.window??={}
 const {Group}=await import('threepipe'),{mountV2Architecture}=await import('../lib/view/v2/architecture.js')
 const selected=defaultMap.colliders.filter(useVolumetricFracture),ids=new Set(selected.map(c=>c.id))
 const map={...defaultMap,colliders:selected,mapPieces:[]},h=mountV2Architecture({root:new Group(),map,preview:true})
 try{
  let walls=0
  h.root.traverse(m=>{
   if(m.userData.architectureSurface!=='concrete'||!ids.has(m.userData.sourceColliderIds[0]))return
   walls++;const p=m.geometry.attributes.position.array,edges=new Map()
   for(let i=0;i<p.length;i+=9){
    const points=[Array.from(p.slice(i,i+3)),Array.from(p.slice(i+3,i+6)),Array.from(p.slice(i+6,i+9))],[a,b,c]=points,u=b.map((x,j)=>x-a[j]),v=c.map((x,j)=>x-a[j])
    assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>1e-12,m.name)
    for(let j=0;j<3;j++){const a=points[j].join(','),b=points[(j+1)%3].join(','),key=[a,b].sort().join('|'),e=edges.get(key)||[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e)}
   }
   assert.ok([...edges.values()].every(e=>e[0]===2&&e[1]===0),m.name)
  });assert.equal(walls,6)
 }finally{h.dispose()}
})
