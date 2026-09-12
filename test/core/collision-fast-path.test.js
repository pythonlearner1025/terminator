import assert from 'node:assert/strict'
import test from 'node:test'
import {rayCollider,colliderSurfacesAt,pointInsideColliderFootprint} from '../../lib/core/collision.js'

test('axis-aligned wall queries match equivalent compound shapes at faces and corners',()=>{
  const box={id:'wall',center:{x:-35,y:-2,z:8},size:{x:3,y:4,z:.6}}
  const compound={...box,shapes:[{shape:'box',offset:{x:0,y:0,z:0},size:box.size}]}
  for(const radius of [0,.38,.55])for(const x of [-37,-36.5,-35,-33.5,-33])for(const z of [7,7.7,8,8.3,9]){
    const pos={x,y:-2,z}
    assert.equal(pointInsideColliderFootprint(pos,box,radius),pointInsideColliderFootprint(pos,compound,radius))
    const intervals=c=>colliderSurfacesAt(pos,c,radius).map(({bottom,top})=>({bottom,top}))
    assert.deepEqual(intervals(box),intervals(compound))
    for(const dir of [{x:0,y:0,z:1},{x:1,y:0,z:0},{x:.6,y:0,z:.8},{x:0,y:1,z:0}]){
      const hit=c=>{const h=rayCollider(pos,dir,c,20);return h&&{distance:h.distance,normal:h.normal}}
      assert.deepEqual(hit(box),hit(compound))
    }
  }
  // Single primitives may also carry offsets. These must use the general path.
  const offset={x:3,y:1,z:-2}
  const shifted={...box,offset}
  const moved={...box,center:{x:box.center.x+offset.x,y:box.center.y+offset.y,z:box.center.z+offset.z}}
  const pos={x:-32,y:-1,z:5},direction={x:0,y:0,z:1}
  assert.equal(pointInsideColliderFootprint(pos,shifted,.4),pointInsideColliderFootprint(pos,moved,.4))
  assert.equal(rayCollider(pos,direction,shifted,20).distance,rayCollider(pos,direction,moved,20).distance)
})
