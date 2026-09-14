import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {location:{href:'http://localhost/'}}
const E = await import('threepipe')
const {installV2Transparency} = await import('../lib/view/v2/transparency.js')
const stock = 'c = vec4(a.rgb * (1. - b.a) + b.rgb * b.a, 1.);'
function fixture() {
 const original = new E.GenericBlendTexturePass({},stock,'',undefined,120)
 const main = {isExtendedRenderPass:true,_blendPass:original}
 return {original,main,viewer:{renderManager:{rgbm:true,renderPass:main},setDirty(){}}}
}
test('owned compositor shares one installation and restores exact original with hooks and borrowed targets untouched',()=>{
 const {original,main,viewer}=fixture(),texture=new E.Texture()
 original.uniforms.tDiffuse2.value=texture
 original.material.onBeforeCompile=function(shader){shader.defines.CUSTOM=1;assert.notEqual(this,original.material)}
 original.material.customProgramCacheKey=function(){return this.name+'|custom'}
 const before={shader:original.material.fragmentShader,uniforms:original.uniforms,compile:original.material.onBeforeCompile,key:original.material.customProgramCacheKey}
 let textureDisposals=0,sharedDisposals=0,originalDisposals=0
 texture.addEventListener('dispose',()=>textureDisposals++)
 original.fsQuad._mesh.geometry.addEventListener('dispose',()=>sharedDisposals++)
 original.material.addEventListener('dispose',()=>originalDisposals++)
 const a=installV2Transparency({viewer}),b=installV2Transparency({viewer}),owned=main._blendPass
 original.material.addEventListener('dispose',()=>originalDisposals++)
 assert.notEqual(owned,original);assert.ok(owned.material.fragmentShader.includes('+ b.rgb, 1.)'))
 assert.equal(owned.uniforms.tDiffuse2.value,texture);assert.notEqual(owned.uniforms,original.uniforms)
 const shader={defines:{}};owned.material.onBeforeCompile(shader);assert.equal(shader.defines.CUSTOM,1);assert.match(owned.material.customProgramCacheKey(),/custom$/)
 a.dispose();assert.equal(main._blendPass,owned);a.dispose();b.dispose();b.dispose()
 assert.equal(main._blendPass,original);assert.equal(textureDisposals,0);assert.equal(sharedDisposals,0);assert.equal(originalDisposals,0)
 assert.equal(original.material.fragmentShader,before.shader);assert.equal(original.uniforms,before.uniforms);assert.equal(original.material.onBeforeCompile,before.compile);assert.equal(original.material.customProgramCacheKey,before.key)
 assert.equal(original.uniforms.tDiffuse2.value,texture);assert.equal(owned.uniforms.tDiffuse2.value,null)
})
test('unsupported shader leaves original untouched, later owner survives Stop, and previews never install',()=>{
 const {original,main,viewer}=fixture();original.material.fragmentShader+='\n// foreign modification'
 assert.throws(()=>installV2Transparency({viewer}),/Unsupported/);assert.equal(main._blendPass,original)
 original.material.fragmentShader=original.material.fragmentShader.replace('\n// foreign modification','')
 assert.equal(installV2Transparency({viewer,preview:true}).attached,false)
 const a=installV2Transparency({viewer}),foreign={name:'later owner'};main._blendPass=foreign
 assert.throws(()=>a.sync(),/displaced/);assert.throws(()=>installV2Transparency({viewer}),/ownership changed/)
 a.dispose();assert.equal(main._blendPass,foreign)
 main._blendPass=original;const b=installV2Transparency({viewer});b.dispose();assert.equal(main._blendPass,original)
})
