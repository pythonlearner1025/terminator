import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {UnrealBloomPass}=await import('../../lib/view/post-unreal-bloom.js')
function render(blendToInput) {
 const pass=new UnrealBloomPass(new E.Vector2(384,216),.3,.55,1.2)
 pass.blendToInput=blendToInput
 const input=new E.WebGLRenderTarget(384,216),draws=[]
 let target=null,color=new E.Color(0x123456),alpha=.7
 const r={autoClear:true,getClearColor:v=>v.copy(color),getClearAlpha:()=>alpha,
  setClearColor:(v,a)=>{color.set(v);alpha=a},setRenderTarget:v=>{target=v},clear(){}}
 pass.fsQuad.render=()=>draws.push({target,material:pass.fsQuad.material})
 pass.render(r,null,input,1/60,false)
 const result={pass,input,draws,r,color,alpha}
 return result
}
test('bloom-only mode retains every extraction/blur/composite draw and omits only the unused input blend', () => {
 const before=render(true),after=render(false)
 assert.equal(before.draws.length,13);assert.equal(after.draws.length,12)
 assert.equal(before.draws.at(-1).target,before.input)
 assert.equal(after.draws.at(-1).target,after.pass.renderTargetsHorizontal[0])
 assert.equal(after.draws.at(-1).material,after.pass.compositeMaterial)
 assert.ok(after.draws.every(d=>d.target!==after.input))
 for(let i=0;i<12;i++) {
  assert.equal(before.draws[i].target.width,after.draws[i].target.width)
  assert.equal(before.draws[i].target.height,after.draws[i].target.height)
  assert.equal(before.draws[i].material.fragmentShader,after.draws[i].material.fragmentShader)
 }
 assert.equal(after.r.autoClear,true);assert.equal(after.color.getHex(),0x123456);assert.equal(after.alpha,.7)
 // FullScreenQuad uses shared geometry; these tests never submit WebGL work.
 before.pass.dispose();after.pass.dispose();before.input.dispose();after.input.dispose()
})
