import test from 'node:test'
import assert from 'node:assert/strict'
import {loadWeaponFixture} from '../../../test/view/weapon-assets-fixture.mjs'
globalThis.window??={}
const {getWeaponLibrary}=await import('../../../lib/view/weapon-assets.js')
// Variant sources can be inserted/replaced without changing base gun identity.
test('weapon library invalidates for newly loaded and replaced revolver variants',async()=>{
 const modelRoot=await loadWeaponFixture()
 const first=getWeaponLibrary(modelRoot),source=first.sources.pistol.clone(true)
 source.userData.weaponAsset='revolver-rebuild';modelRoot.add(source)
 const second=getWeaponLibrary(modelRoot);assert.notEqual(second,first);assert.equal(second.sources['revolver-rebuild'],source)
 const replacement=source.clone(true);source.removeFromParent();modelRoot.add(replacement)
 const third=getWeaponLibrary(modelRoot);assert.notEqual(third,second);assert.equal(third.sources['revolver-rebuild'],replacement)
})

const {Group,AnimationClip,QuaternionKeyframeTrack}=await import('three')
const {AuthoredWeaponClips}=await import('../../../lib/view/weapons-animation.js')
function presentationFixture(){
 const root=new Group();root.userData.viewModel={mechanism:'swingout',cartridgePresentation:'separate-replacements'}
 for(const name of ['Cylinder',...Array.from({length:6},(_,i)=>['Case'+i,'Fresh'+i,'Bullet'+i]).flat()]){const node=new Group();node.name=name;root.add(node)}
 const clips=['Idle','Draw','Fire','Reload','AimIn','AimOut','AimIdle','Sprint','Inspect'].map(name=>new AnimationClip(name,1,name==='Fire'?[new QuaternionKeyframeTrack('Cylinder.quaternion',[0,.05,1],[0,0,0,1,0,0,-.5,Math.sqrt(.75),0,0,-.5,Math.sqrt(.75)])]:[]))
 return {root,player:new AuthoredWeaponClips({root,clips})}
}
test('rebuild shot index stays fixed across idle ticks without a static cylinder track',()=>{
 const {root,player}=presentationFixture(),state={draw:false,fire:false,reloading:false,aim:false,sprint:false,reloadProgress:0}
 player.sync(0,{...state,fire:true});player.sync(.1,state)
 const indexed=root.getObjectByName('Cylinder').quaternion.clone()
 player.sync(1,state);player.sync(.1,state)
 for(let i=0;i<10;i++){player.sync(.016,state);assert.ok(root.getObjectByName('Cylinder').quaternion.angleTo(indexed)<1e-6)}
 player.dispose()
})
test('rebuild replacement copies remain hidden outside their reload phase',()=>{
 const {root,player}=presentationFixture(),state={draw:false,fire:false,reloading:false,aim:false,sprint:false,reloadProgress:0,missingRounds:6}
 player.sync(.1,state);assert.equal(root.getObjectByName('Fresh0').scale.x,.001)
 player.sync(0,{...state,reloading:true,reloadProgress:.2});assert.equal(root.getObjectByName('Fresh0').scale.x,.001)
 player.sync(0,{...state,reloading:true,reloadProgress:.7});assert.equal(root.getObjectByName('Fresh0').scale.x,1)
 player.sync(0,state);assert.equal(root.getObjectByName('Fresh0').scale.x,.001);player.dispose()
})
