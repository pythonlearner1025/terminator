import assert from 'node:assert/strict'
import {test} from 'node:test'
globalThis.ImageData??=class{}
const {destroyedFacade,extrudeMasonry}=await import('../lib/view/v2/architecture-skyline.js')
const {BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial,Raycaster,Vector3,DoubleSide}=await import('three')
const random=n=>()=>((n=Math.imul(n,1664525)+1013904223>>>0)/4294967296)
function closed(triangles){
 const edges=new Map();let volume=0
 for(const [a,b,c] of triangles){
  for(const p of [a,b,c])assert.ok(p.every(Number.isFinite))
  volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
  for(const [u,v] of [[a,b],[b,c],[c,a]]){const x=u.join(','),y=v.join(','),key=[x,y].sort().join('|'),e=edges.get(key)||[0,0];e[0]++;e[1]+=x<y?1:-1;edges.set(key,e)}
 }
 assert.ok(volume>0)
 for(const e of edges.values())assert.deepEqual(e,[2,0],'every wall, reveal and cap has an exact opposing shared edge')
}
test('destroyed skyline masses have closed reveals and real sight-through openings',()=>{
 let openings=0
 for(let seed=1;seed<=24;seed++){
  const h=destroyedFacade({x0:-8,x1:8,bottom:0,top0:18,top1:11,thickness:.9,random:random(seed)})
  closed(h.triangles);openings+=h.holes.length
  const g=new BufferGeometry().setAttribute('position',new Float32BufferAttribute(h.triangles.flat(2),3)),m=new MeshBasicMaterial({side:DoubleSide}),mesh=new Mesh(g,m);mesh.updateMatrixWorld()
  for(const hole of h.holes){const x=hole.reduce((n,p)=>n+p[0],0)/hole.length,y=hole.reduce((n,p)=>n+p[1],0)/hole.length
   assert.equal(new Raycaster(new Vector3(x,y,-1),new Vector3(0,0,1),0,3).intersectObject(mesh).length,0)
  }
  assert.ok(new Raycaster(new Vector3(-7.7,.2,-1),new Vector3(0,0,1),0,3).intersectObject(mesh).length>0)
  g.dispose();m.dispose()
 }
 assert.ok(openings>180&&openings<400,'bounded sparse multi-storey openings, rather than blank planes or a complete cage')
})
test('broken floor remnants have closed undersides and irregular deep edge caps',()=>{
 closed(extrudeMasonry([[0,0],[5,0],[4.7,1.8],[3.4,2.4],[3.7,3.2],[0,3.2]],[],.32))
})
