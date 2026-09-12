import assert from 'node:assert/strict'
import test from 'node:test'
import {NavGrid} from '../../lib/core/nav.js'
import {staticColliders} from '../../lib/core/collision.js'
import map from '../../lib/core/data/map.json' with {type:'json'}

test('nav candidates and cached connections match full scans on every layer and doorway state',()=>{
  const dynamic=map.doors.map(d=>({id:d.id,center:d.pos,size:d.size,navBlock:true}))
  // Include cell-edge contacts, rotated boxes, offsets, and round compound pieces.
  dynamic.push(
    {id:'edge',center:{x:.5,y:1,z:.5},size:{x:.0001,y:2,z:3},yaw:Math.PI/4},
    {id:'offset',center:{x:4,y:1,z:3},offset:{x:1,y:0,z:2},size:{x:2,y:2,z:1}},
    {id:'round',center:{x:9,y:1,z:5},shapes:[{shape:'cylinder',radius:.5,height:2,offset:{x:1,y:0,z:0}}]},
  )
  for(const doors of [[],dynamic]) {
    const nav=new NavGrid(map,doors)
    const blockers=[...staticColliders(map).filter(c=>c.navBlock),...doors]
    for(const node of nav.nodes) {
      const point=nav.nodePoint(node)
      const solid=blockers.some(c=>nav.colliderBlocksNode(c,node,point))
      const overhead=nav.nodesAt(node.x,node.z).some(other=>other.y>node.y+1e-6
        &&other.y<node.y+nav.agentHeight-1e-6&&!nav.isMovementHole(other.colliderId,point,nav.spec.agentRadius))
      assert.equal(nav.blocked[node.index],Number(solid||overhead),JSON.stringify(point))
      const expected=[]
      for(const [x,z] of [[node.x+1,node.z],[node.x-1,node.z],[node.x,node.z+1],[node.x,node.z-1]]){
        if(!nav.inBounds({x,z}))continue
        for(const other of nav.nodesAt(x,z))if(Math.abs(other.y-node.y)<=nav.maxStep+1e-6)expected.push(other.index)
      }
      for(const other of nav.nodesAt(node.x,node.z))if(other.index!==node.index&&Math.abs(other.y-node.y)<=nav.maxStep+1e-6)expected.push(other.index)
      assert.deepEqual(nav.neighbors(node).map(n=>n.index),expected)
    }
  }
})
