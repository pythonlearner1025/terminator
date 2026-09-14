import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {optimizeFrameRendering} = await import('../../lib/view/frame-rendering.js')
function fixture() {
  const scene = new E.Scene(), child = new E.Object3D(), viewer = new E.EventDispatcher()
  scene.add(child); viewer.scene = scene
  let updates = 0
  const update = scene.updateMatrixWorld
  scene.updateMatrixWorld = function(...args) {updates++;return update.apply(this,args)}
  const renderer = {render(object) {if(object.matrixWorldAutoUpdate)object.updateMatrixWorld(); return object}}
  viewer.renderManager = {webglRenderer: renderer}
  const original = renderer.render, lease = optimizeFrameRendering(viewer)
  return {scene,child,viewer,renderer,original,lease,get updates(){return updates},begin(){viewer.dispatchEvent({type:'preRender'})},end(){viewer.dispatchEvent({type:'postRender'})}}
}
test('one settled matrix update serves all scene passes; subsequent frames update movement', () => {
  const f=fixture();f.begin();f.child.position.x=3
  for(let i=0;i<4;i++)f.renderer.render(f.scene)
  assert.equal(f.updates,1);assert.equal(f.child.matrixWorld.elements[12],3)
  assert.equal(f.scene.matrixWorldAutoUpdate,true)
  f.end();f.begin();f.child.position.x=7;f.renderer.render(f.scene)
  assert.equal(f.updates,2);assert.equal(f.child.matrixWorld.elements[12],7)
  f.lease.dispose();f.lease.dispose();assert.equal(f.renderer.render,f.original)
  f.renderer.render(f.scene);assert.equal(f.updates,3)
})
test('object updates invalidate between passes, while explicit matrix updates always work', () => {
  const f=fixture();f.begin();f.renderer.render(f.scene)
  f.child.position.y=8;f.scene.dispatchEvent({type:'objectUpdate'})
  f.renderer.render(f.scene);assert.equal(f.child.matrixWorld.elements[13],8)
  f.child.position.z=4;f.scene.updateMatrixWorld(true)
  f.renderer.render(f.scene);assert.equal(f.child.matrixWorld.elements[14],4)
  assert.equal(f.updates,3);f.lease.dispose()
})
test('outside-frame and other-scene renders retain normal updates; disabled auto-update remains disabled', () => {
  const f=fixture();f.renderer.render(f.scene);f.renderer.render(f.scene);assert.equal(f.updates,2)
  f.begin();f.scene.matrixWorldAutoUpdate=false;f.renderer.render(f.scene)
  assert.equal(f.updates,2);assert.equal(f.scene.matrixWorldAutoUpdate,false)
  const other=new E.Scene();let count=0;other.updateMatrixWorld=()=>count++
  f.renderer.render(other);f.renderer.render(other);assert.equal(count,2)
  f.lease.dispose()
})
test('exceptions restore scene settings and dispose preserves a later renderer owner', () => {
  const scene=new E.Scene(),viewer=new E.EventDispatcher();viewer.scene=scene
  let fails=false
  const renderer={render(){if(fails)throw Error('render failure')}};viewer.renderManager={webglRenderer:renderer}
  const lease=optimizeFrameRendering(viewer);viewer.dispatchEvent({type:'preRender'});renderer.render(scene)
  fails=true;assert.throws(()=>renderer.render(scene),/render failure/);assert.equal(scene.matrixWorldAutoUpdate,true)
  const later=()=>{};renderer.render=later;lease.dispose();assert.equal(renderer.render,later)
})
test('nested scene renders can refresh matrices even while the outer pass reuses them', () => {
  const scene=new E.Scene(),viewer=new E.EventDispatcher();viewer.scene=scene
  let nested=false,inside=false,updates=0
  const renderer={render(object){if(object.matrixWorldAutoUpdate)updates++;if(nested&&!inside){inside=true;renderer.render(object);inside=false}}}
  viewer.renderManager={webglRenderer:renderer};const lease=optimizeFrameRendering(viewer)
  viewer.dispatchEvent({type:'preRender'});renderer.render(scene);nested=true;renderer.render(scene)
  assert.equal(updates,2);assert.equal(scene.matrixWorldAutoUpdate,true);lease.dispose()
})

test('empty transmission skips only a current same-camera list and preserves fallback and renderer ownership', () => {
 const scene=new E.Scene(),camera=new E.PerspectiveCamera(),viewer=new E.EventDispatcher();viewer.scene=scene;scene.renderCamera=camera
 const list={transmissive:[]};let callbacks=0
 const renderer={render(){},renderLists:{get:()=>list},info:{autoReset:true,render:{frame:0,calls:99},reset(){this.render.calls=0}},renderWithModes(modes,fn){return fn()}}
 viewer.renderManager={webglRenderer:renderer}
 const originalModes=renderer.renderWithModes,lease=optimizeFrameRendering(viewer)
 const modes={transmissionRender:true,opaqueRender:false,transparentRender:false,backgroundRender:false,shadowMapRender:false}
 const run=()=>renderer.renderWithModes(modes,()=>callbacks++)
 run();assert.equal(callbacks,1)
 viewer.dispatchEvent({type:'preRender'});run();assert.equal(callbacks,2)
 renderer.render(scene,camera);run();assert.equal(callbacks,2);assert.equal(renderer.info.render.calls,0)
 assert.equal(lease.stats.emptyTransmissionPassesSkipped,1)
 list.transmissive.push({material:{transmission:1}});run();assert.equal(callbacks,3)
 list.transmissive.length=0;scene.dispatchEvent({type:'objectUpdate'});run();assert.equal(callbacks,4)
 renderer.render(scene,camera);scene.renderCamera=new E.PerspectiveCamera();run();assert.equal(callbacks,5)
 scene.renderCamera=camera;viewer.dispatchEvent({type:'postRender'});run();assert.equal(callbacks,6)
 lease.dispose();assert.equal(renderer.renderWithModes,originalModes)
})
