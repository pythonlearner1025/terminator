import assert from 'node:assert/strict'
import test from 'node:test'
import {defaultMap as map} from '../../lib/core/map.js'
import {World} from '../../lib/core/world.js'
import {NavGrid} from '../../lib/core/nav.js'
import {colliderBounds,colliderPrimitives} from '../../lib/core/collision.js'

const point=(x,y,z)=>({x,y,z})
function coverage(nav) {
  const start=nav.resolveNode(nav.nearestOpen(nav.worldToCell(map.playerStart.pos)))
  const seen=new Set([start.index]),queue=[start]
  for(let i=0;i<queue.length;i++)for(const next of nav.neighbors(queue[i])) {
    if(nav.blocked[next.index]||seen.has(next.index))continue
    seen.add(next.index);queue.push(next)
  }
  const missing=nav.nodes.filter(n=>!nav.blocked[n.index]&&!seen.has(n.index))
  assert.deepEqual(missing.map(n=>({...nav.nodePoint(n),layer:n.layer})),[])
  return seen.size
}

test('all Bunker 7 walkable cells belong to one reachable component',()=>{
  const nav=new NavGrid(map)
  assert.ok(coverage(nav)>4500)
  const world=new World({seed:71})
  world.configureMap({doors:Object.fromEntries(map.doors.map(d=>[d.id,'unlocked']))})
  assert.ok(coverage(world.nav)>4500)
  assert.equal(map.size.x*map.size.z,3600*1.4)
})

test('new gates reach the player and the boss gate has seven metres of clear width',()=>{
  const world=new World({seed:72})
  for(const id of ['E2','W2','S3']){
    const gate=map.spawnGates.find(g=>g.id===id)
    const path=world.findPath(gate.pos,map.playerStart.pos)
    assert.ok(path?.length,`${id} cannot reach courtyard`)
  }
  const gate=map.spawnGates.find(g=>g.id==='S3')
  assert.ok(gate.tags.includes('boss'));assert.equal(gate.width,7)
  for(const x of [34.2,36,37.8])assert.equal(world.positionBlocked(point(x,0,-28),1.6,3.2),false)
})

for(const type of ['scout','heavy']){
  test(`${type} traverses both tunnel mouths and the below-ground choke`,()=>{
    const goals=[point(-36,0,-22.5),point(-36,-3.5,-10.5),point(-36,-3.5,10.5),point(-36,0,22.5),point(-25,0,20)]
    traverse(type,point(-25,0,-20),goals,'service')
  })
  test(`${type} enters Block C, follows its corridor, and climbs to the roof`,()=>{
    const goals=[point(36,0,12.5),point(36,0,22.5),point(36,3.2,14.5),point(36,6.4,22.5),point(36,6.4,6.5)]
    traverse(type,point(27,0,13),goals,'roof')
  })
}

function traverse(type,start,goals,mode){
  let target=goals[0]
  const world=new World({seed:73,brains:{[type]:{tick(self,sense,act){act.moveTo(target)}}}})
  world.player.alive=false
  const unit=world.spawnUnit(type,start)
  const heights=new Set(),radius=world.unitCatalog.types[type].radius
  for(const goal of goals){
    target=goal
    const path=world.findPath(unit.pos,goal)
    assert.ok(path?.length,`missing path ${JSON.stringify(goal)}`)
    let reached=false
    for(let tick=0;tick<3600;tick++){
      world.step();heights.add(Math.round(unit.pos.y*10)/10)
      assert.equal(world.positionBlocked(unit.pos,radius,world.unitCatalog.types[type].height),false,`${type} penetrates solid at ${JSON.stringify(unit.pos)}`)
      if(Math.hypot(unit.pos.x-goal.x,unit.pos.z-goal.z)<.8&&Math.abs(unit.pos.y-goal.y)<.21){reached=true;break}
    }
    assert.ok(reached,`${type} did not reach ${JSON.stringify(goal)} from ${JSON.stringify(unit.pos)}`)
  }
  assert.ok(heights.has(mode==='service'?-3.5:6.4))
}

test('Block C window apertures pass shots while their concrete sills stop shots',()=>{
  const world=new World({seed:74})
  for(const y of [1.75,4.95]){
    assert.equal(world.lineOfSight(point(30.5,y,7.5),point(33,y,7.5)),true)
    assert.equal(world.lineOfSight(point(39,y,7.5),point(41.4,y,7.5)),true)
  }
  assert.equal(world.lineOfSight(point(30.5,.8,7.5),point(33,.8,7.5)),false)
})

test('expansion floor holes exclude shots and each stair keeps the half-metre tread rule',()=>{
  const nav=new NavGrid(map)
  for(const s of map.walkable.surfaces.filter(s=>s.collider.startsWith('exp_')&&s.height==='stairTread')){
    const c=map.colliders.find(c=>c.id===s.collider)
    assert.equal(c.size.y,.5)
    assert.ok(Math.abs(nav.surfaceHeight({...s,source:c},c.center)-(c.center.y+c.size.y/2))<1e-9)
  }
  const deck=map.colliders.find(c=>c.id==='exp_west_yard')
  assert.ok(colliderPrimitives(deck).length>1)
  for(const c of map.colliders.filter(c=>c.area==='expansion')){
    const b=colliderBounds(c)
    for(const axis of ['x','y','z'])assert.ok(b.min[axis]<=b.max[axis])
  }
})
