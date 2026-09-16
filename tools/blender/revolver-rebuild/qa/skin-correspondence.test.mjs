import test from 'node:test'
import assert from 'node:assert/strict'
import {blenderWorldPoint,buildCorrespondence,compareWorldPositions} from './skin-correspondence.mjs'

const vertex=(position,uv=[.2,.3],weights={Wrist:1})=>({position,uvs:[[uv[0],1-uv[1]]],weights})
function source(points,trajectories=[points]){
 return {vertices:points.map(()=>({uvs:{UVMap:[[.2,.3]]},weights:{Wrist:1}})),uvLayers:['UVMap'],
  samples:{Fire:{frames:trajectories.map(worldGltfAxes=>({worldGltfAxes}))}}}
}

test('fixed correspondence survives reordering and seam duplication without overweighting duplicates',()=>{
 const bind=[[0,0,0],[1,0,0],[2,0,0]],src=source(bind)
 const mapping=buildCorrespondence(src,[vertex(bind[2]),vertex(bind[0]),vertex(bind[1]),vertex(bind[0])],bind)
 assert.equal(mapping.ok,true)
 assert.deepEqual(mapping.mapping,[2,0,1,0])
 const pose=[[0,0,1],[1,0,2],[2,0,3]]
 const result=compareWorldPositions(pose,[[2,0,3],[0,0,1.3],[1,0,2],[0,0,1]],mapping)
 assert.equal(result.sourceVertexErrors.count,3)
 assert.ok(Math.abs(result.sourceVertexErrors.rmsM-.3/Math.sqrt(3))<1e-12)
 assert.equal(result.allExportedVertexErrors.count,4)
})

test('coincident bind vertices with different motion cannot be declared interchangeable',()=>{
 const bind=[[0,0,0],[0,0,0]],motion=[[0,0,0],[0,.01,0]]
 const result=buildCorrespondence(source(bind,[bind,motion]),[vertex(bind[0])],bind)
 assert.equal(result.ok,false)
 assert.equal(result.ambiguous[0].equivalent,false)
 assert.equal(result.ambiguous[0].maxSourceTrajectorySeparationM,.01)
})

test('coincident source vertices are covered only when sampled trajectories agree',()=>{
 const bind=[[0,0,0],[0,0,0]],motion=[[0,.01,0],[0,.01,0]]
 const result=buildCorrespondence(source(bind,[bind,motion]),[vertex(bind[0])],bind)
 assert.equal(result.ok,true)
 assert.equal(result.coveredSourceVertices,2)
 assert.equal(result.ambiguous[0].maxSourceTrajectorySeparationM,0)
})

test('UV and named bone weights disambiguate; mismatches do not fall back to position',()=>{
 const bind=[[0,0,0]],src=source(bind)
 for(const bad of [vertex(bind[0],[.8,.3]),vertex(bind[0],[.2,.3],{Elbow:1})]){
  const result=buildCorrespondence(src,[bad],bind)
  assert.equal(result.ok,false)
  assert.deepEqual(result.unmatched,[0])
  assert.deepEqual(result.uncovered,[0])
 }
})

test('Blender world conversion includes parent scale and translation; missing transform fails tolerance',()=>{
 const world=blenderWorldPoint([1,2,3],[[2,0,0,4],[0,3,0,5],[0,0,4,6],[0,0,0,1]])
 assert.deepEqual(world,[6,18,-11])
 const identity={mapping:[0],candidates:[[0]]}
 const missedParent=compareWorldPositions([world],[[1,3,-2]],identity)
 assert.ok(missedParent.sourceVertexErrors.maxM>1e-5)
 const shifted=compareWorldPositions([world],[[6,18,-10.9999]],identity)
 assert.ok(shifted.sourceVertexErrors.maxM>1e-5)
})
