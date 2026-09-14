import test from 'node:test'
import assert from 'node:assert/strict'
import {colliderPrimitives,colliderSurfacesAt,pointInsideColliderFootprint,rayCollider,sweepSphereCollider,sphereIntersectsCollider} from '../../lib/core/collision.js'

// Independent reference: expand the compound into standalone primitives. These
// take the general singleton narrow phase, bypassing compound candidate bounds.
// The existing singleton normalization adds base yaw and part yaw, both read
// from that same record. Halving here preserves its current public behavior.
const singles=c=>colliderPrimitives(c).map(p=>({...p,offset:undefined,yaw:p.yaw/2}))
const interval=s=>s.map(({bottom,top})=>({bottom,top}))
const hit=h=>h&&{distance:h.distance??h.fraction,normal:h.normal}
function closest(hits){return hits.filter(Boolean).sort((a,b)=>(a.distance??a.fraction)-(b.distance??b.fraction))[0]||null}

test('compound candidates match unpruned primitives for rotated mixed shapes, rays, supports and sweeps',()=>{
 let seed=2029
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
 const collider={center:{x:-7,y:2,z:4},yaw:.71,shapes:Array.from({length:64},(_,i)=>({
  shape:['box','sphere','cylinder'][i%3],axis:['x','y','z'][i%3],offset:{x:rand()*12-6,y:rand()*4-2,z:rand()*12-6},
  size:{x:rand()*3+.1,y:rand()*3+.1,z:rand()*3+.1},radius:rand()+.1,height:rand()*4+.1,yaw:rand()*3,
 }))}
 for(let mutation=0;mutation<2;mutation++){
  if(mutation){collider.center.x+=9;collider.yaw=-1.2;collider.shapes[0].offset.z+=20;collider.shapes[2].radius=8;collider.shapes.push({...collider.shapes[1],offset:{x:0,y:0,z:0}})}
  const parts=singles(collider)
  for(let i=0;i<350;i++){
   const point={x:rand()*30-15,y:rand()*14-7,z:rand()*30-15},direction={x:rand()*2-1,y:rand()*2-1,z:rand()*2-1},radius=i%7===0?0:rand()*2
   assert.equal(pointInsideColliderFootprint(point,collider,radius),parts.some(p=>pointInsideColliderFootprint(point,p,radius)))
   assert.deepEqual(interval(colliderSurfacesAt(point,collider,radius)),parts.flatMap(p=>interval(colliderSurfacesAt(point,p,radius))))
   assert.equal(sphereIntersectsCollider(point,radius,collider),parts.some(p=>sphereIntersectsCollider(point,radius,p)))
   for(const distance of [0,20,Infinity])assert.deepEqual(hit(rayCollider(point,direction,collider,distance)),hit(closest(parts.map(p=>rayCollider(point,direction,p,distance)))))
   assert.deepEqual(hit(sweepSphereCollider(point,direction,radius,collider)),hit(closest(parts.map(p=>sweepSphereCollider(point,direction,radius,p)))))
  }
 }
})

test('zero-radius tangent tolerance and rotated sweep expansion survive broad phase',()=>{
 const box={center:{x:0,y:0,z:0},size:{x:2,y:2,z:2}}
 const compound={...box,shapes:[{offset:{x:0,y:0,z:0},size:box.size}]}
 for(const x of [1,1+1e-6,1+2e-5,1+1e-4]){
  const p={x,y:0,z:0}
  assert.equal(pointInsideColliderFootprint(p,compound),pointInsideColliderFootprint(p,box))
  assert.equal(sphereIntersectsCollider(p,0,compound),sphereIntersectsCollider(p,0,box))
 }
 const c={...compound,yaw:Math.PI/4}
 for(const p of [{x:2.5,y:0,z:0},{x:2,y:0,z:2}]){
  const movement={x:-1,y:0,z:-1}
  assert.deepEqual(hit(sweepSphereCollider(p,movement,1,c)),hit(sweepSphereCollider(p,movement,1,singles(c)[0])))
 }
})
