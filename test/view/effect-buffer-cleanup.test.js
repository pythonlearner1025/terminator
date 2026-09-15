import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {WebGLObjects}=await import('three/src/renderers/webgl/WebGLObjects.js')
const {RosterFx}=await import('../../lib/view/roster-fx.js')
const {GoreSystem}=await import('../../lib/view/gore.js')

// Exercise the actual renderer's instance-buffer registration/removal, without
// a GPU or texture-loading DOM. Geometry disposal is intentionally independent.
function rendererBuffers(){
  const resident=new Set(),info={render:{frame:0}}
  const objects=WebGLObjects({ARRAY_BUFFER:34962},{get:(_o,g)=>g,update(){}},
    {update:a=>resident.add(a),remove:a=>resident.delete(a)},info)
  return {resident,upload(mesh){info.render.frame++;objects.update(mesh)}}
}
function mesh(count){return new E.InstancedMesh(new E.PlaneGeometry(),new E.MeshBasicMaterial(),count)}

test('repeated roster teardown releases uploaded particle instance buffers',()=>{
  const buffers=rendererBuffers()
  for(let restart=0;restart<30;restart++){
    const fx=Object.create(RosterFx.prototype)
    Object.assign(fx,{prepared:new Set(),deaths:new Set(),items:[],mesh:mesh(192),root:new E.Group(),definitions:new Map(),map:new E.Texture()})
    fx.material=fx.mesh.material;fx.root.add(fx.mesh)
    buffers.upload(fx.mesh);assert.equal(buffers.resident.size,1)
    fx.dispose()
    assert.equal(buffers.resident.size,0,`restart ${restart}: roster instance buffer retained`)
  }
})

test('repeated gore teardown releases uploaded stain and stump instance buffers',()=>{
  const buffers=rendererBuffers()
  for(let restart=0;restart<30;restart++){
    const gore=Object.create(GoreSystem.prototype)
    Object.assign(gore,{pieces:{reset(){},items:[]},definitions:new Map(),visuals:new Set(),particles:[],fluidMaterial:new E.MeshBasicMaterial(),stainMesh:mesh(64),stumpMesh:mesh(128),placeholder:new E.BoxGeometry(),root:new E.Group()})
    gore.root.add(gore.stainMesh,gore.stumpMesh)
    buffers.upload(gore.stainMesh);buffers.upload(gore.stumpMesh);assert.equal(buffers.resident.size,2)
    gore.dispose()
    assert.equal(buffers.resident.size,0,`restart ${restart}: gore instance buffers retained`)
    gore.stainMesh.material.dispose();gore.stumpMesh.material.dispose()
  }
})
