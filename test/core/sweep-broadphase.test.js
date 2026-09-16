import test from 'node:test'
import assert from 'node:assert/strict'
import {SweepBroadphase} from '../../lib/core/sweep-broadphase.js'
import {sweepSphereCollider} from '../../lib/core/collision.js'
import {defaultMap} from '../../lib/core/map.js'
import {staticColliders} from '../../lib/core/collision.js'

function exhaustive(origin, movement, radius, colliders) {
  let closest = null
  for (const collider of colliders) {
    const hit = sweepSphereCollider(origin, movement, radius, collider)
    if (hit && (!closest || hit.fraction < closest.fraction)) closest = hit
  }
  return closest
}
const random = () => {
  let seed = 10901
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
}

test('indexed sweeps preserve complete hits and first-source ties across terrain, mixed shapes and live edits', () => {
  const rand = random(), index = new SweepBroadphase()
  const vec = scale => ({x:(rand()-.5)*scale,y:(rand()-.5)*scale,z:(rand()-.5)*scale})
  const primitive = i => ({shape:['box','sphere','cylinder'][i%3],axis:['x','y','z'][Math.floor(i/3)%3],
    center:vec(20),size:{x:rand()*4+.1,y:rand()*3+.1,z:rand()*4+.1},radius:rand()*2+.1,height:rand()*4+.1,yaw:rand()*6})
  const colliders = [...staticColliders(structuredClone(defaultMap)), ...Array.from({length:36}, (_,i) => ({id:`extra-${i}`, ...primitive(i),
    ...(i%2 ? {shapes:Array.from({length:4}, (_,j) => ({...primitive(i+j),offset:vec(8)}))} : {})}))]
  for (let phase = 0; phase < 4; phase++) {
    if (phase) {
      for (const c of colliders.filter(c => c.id.startsWith('extra-'))) {
        c.center.x += 17; c.yaw -= .38; c.size.z *= 1.3; c.radius += .4; c.height += .5
        if (c.shapes) {c.shapes[0].offset.z -= 6; c.shapes[1].yaw += 2; c.shapes[2].axis = 'z'; c.shapes[3].radius += 2}
      }
      if (phase === 2) colliders.reverse()
      if (phase === 3) {colliders[0].shapes=[]; colliders.pop(); colliders.push({...primitive(0),id:'replacement'})}
    }
    index.prepare(colliders)
    index.prepare(colliders.slice()) // Equivalent list reuses the validated grid.
    for (let i = 0; i < 1500; i++) {
      const origin = vec(100), movement = vec(i % 3 ? 2 : 80), radius = i % 13 ? rand()*2 : 0
      assert.deepEqual(index.sweep(origin,movement,radius),exhaustive(origin,movement,radius,colliders))
    }
  }
  const first = {id:'first',center:{x:0,y:0,z:0},size:{x:2,y:2,z:2}}
  const second = {...first,id:'second'}
  index.prepare([first,second])
  for (const p of [{x:-2,y:-2,z:-2},{x:1,y:0,z:0},{x:1+1e-10,y:0,z:0},{x:0,y:0,z:0}]) {
    for (const d of [{x:1,y:1,z:1},{x:0,y:0,z:0},{x:-1e-10,y:0,z:0}]) {
      assert.deepEqual(index.sweep(p,d,0),exhaustive(p,d,0,[first,second]))
    }
  }
  index.prepare([second,first])
  assert.equal(index.sweep({x:0,y:0,z:-2},{x:0,y:0,z:2},0).collider,second)
  index.stamp = 0xffffffff
  assert.equal(index.sweep({x:0,y:0,z:-2},{x:0,y:0,z:2},0).collider,second)
})

test('fresh equivalent door records reuse the grid and still return current collider identity', () => {
  const index = new SweepBroadphase()
  const door = {id:'door', center:{x:0,y:0,z:0}, size:{x:2,y:4,z:.4}}
  index.prepare([door])
  const cells = [...index.cells.values()]
  const fresh = structuredClone(door)
  index.prepare([fresh])
  assert.deepEqual([...index.cells.values()], cells)
  assert.equal([...index.cells.values()][0], cells[0])
  assert.equal(index.sweep({x:0,y:0,z:-2},{x:0,y:0,z:4},.1).collider,fresh)
  fresh.center.z = 30
  index.prepare([fresh])
  assert.equal(index.sweep({x:0,y:0,z:-2},{x:0,y:0,z:4},.1),null)
})
