import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {V2_SUBSTRATE_GLSL} from '../lib/view/v2/materials-substrate.js'

test('photographed substrate receipts match committed maps and bound texture memory',()=>{
 const root=new URL('../assets/v2/materials/',import.meta.url)
 const receipt=JSON.parse(readFileSync(new URL('substrate-rubble-provenance.json',root)))
 assert.equal(receipt.license,'CC0-1.0');assert.deepEqual(receipt.source_dimensions_metres,[2,2])
 assert.equal(receipt.sources.length,3);assert.equal(receipt.outputs.length,3)
 for(const output of receipt.outputs){
  const bytes=readFileSync(new URL(output.file,root))
  assert.equal(bytes.length,output.bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),output.sha256)
 }
 assert.equal(receipt.additional_gpu_mib_rgba8_with_mips,16)
})

test('both photographic UV rotations preserve metre scale and rotate tangent normals by inverse Jacobian',()=>{
 const matrix=name=>V2_SUBSTRATE_GLSL.match(new RegExp(`mat2 ${name}=mat2\\(([^)]+)\\)`))[1].split(',').map(Number)
 const mul=(m,v)=>[m[0]*v[0]+m[2]*v[1],m[1]*v[0]+m[3]*v[1]]
 for(const pair of [['a','ai'],['b','bi']]){
  const r=matrix(pair[0]), inv=matrix(pair[1])
  assert.ok(Math.abs(r[0]*r[3]-r[1]*r[2]-1)<1e-6,'rotation must preserve area and handedness')
  const n=[.3,-.2], world=mul(inv,n)
  const eps=1e-4
  // Independent plane-height gradient: h(q)=-n dot R(q).
  const height=q=>{const uv=mul(r,q);return -n[0]*uv[0]-n[1]*uv[1]}
  assert.ok(Math.abs(world[0]+(height([eps,0])-height([0,0]))/eps)<1e-6)
  assert.ok(Math.abs(world[1]+(height([0,eps])-height([0,0]))/eps)<1e-6)
  const restored=mul(r,world)
  assert.ok(Math.hypot(restored[0]-n[0],restored[1]-n[1])<1e-6)
 }
 assert.equal((V2_SUBSTRATE_GLSL.match(/texture2D\(/g)||[]).length,6)
})
