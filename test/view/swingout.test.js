import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {NodeIO} from '@gltf-transform/core'
globalThis.ImageData??=class {};globalThis.ProgressEvent??=class {constructor(type,p){Object.assign(this,p)}};globalThis.window??={}
const T=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js')
const {AuthoredWeaponClips}=await import('../../lib/view/weapons-animation.js')
const {revolverCaseGeometry}=await import('../../lib/view/revolver-fx.js')
const folder=new URL('../../assets/models/weapons/swingout/',import.meta.url),raw=JSON.parse(await readFile(new URL('swingout.gltf',folder),'utf8'))
async function fixture(){
 const g=structuredClone(raw)
 for(const b of g.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(new URL(b.uri,folder))).toString('base64')
 for(const m of g.materials){for(const k of ['normalTexture','occlusionTexture','emissiveTexture'])delete m[k];delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture}
 const asset=await new GLTFLoader().parseAsync(JSON.stringify(g),'');const root=asset.scene.getObjectByName('SwingoutRig');return {root,cp:new AuthoredWeaponClips({root,clips:asset.animations}),clips:asset.animations}
}
const matrixSnapshot=root=>{root.updateMatrixWorld(true);const a=[];root.traverse(n=>a.push(...n.matrixWorld.elements));return a}
function near(a,b,tolerance=1e-5){assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`)}

test('swingout keeps one atlas, three draws, one skeleton and bounded triangles',async()=>{
 const doc=await new NodeIO().read(new URL('swingout.gltf',folder).pathname),r=doc.getRoot();let triangles=0
 for(const m of r.listMeshes())for(const p of m.listPrimitives()){triangles+=p.getIndices().getCount()/3;assert.ok(p.getAttribute('JOINTS_0'));assert.ok(p.getAttribute('WEIGHTS_0'))}
 assert.ok(triangles<=25500);assert.equal(r.listMeshes().length,3);assert.equal(r.listTextures().length,3);assert.equal(r.listSkins().length,1)
 for(const image of r.listTextures())assert.deepEqual(image.getSize(),[2048,2048])
})
test('physical hierarchy keeps cylinder, extractor and cartridges on their own supports',()=>{
 const parent=new Map();for(const n of raw.nodes)for(const i of n.children||[])parent.set(raw.nodes[i].name,n.name)
 for(const [child,p]of [['Cylinder','Crane'],['Ejector','Cylinder'],['Muzzle','Frame'],['Hammer','Body'],['Trigger','Body'],['Latch','Body']])assert.equal(parent.get(child),p)
 for(let i=0;i<6;i++)assert.equal(parent.get('Case'+i),'Cylinder')
})
test('all nine clips exist and loop endpoints agree',async()=>{
 const {root,cp,clips}=await fixture();assert.deepEqual(clips.map(c=>c.name),['Idle','Draw','Fire','Reload','AimIn','AimOut','AimIdle','Sprint','Inspect'])
 for(const name of ['Idle','AimIdle','Sprint']){cp.sample(name,0);const a=matrixSnapshot(root);cp.sample(name,cp.actions.get(name).getClip().duration);const b=matrixSnapshot(root);for(let i=0;i<a.length;i++)near(a[i],b[i])}cp.dispose()
})
test('Reload produces identical poses after arbitrary forward and backward seeks',async()=>{
 const {root,cp}=await fixture();const samples=[0,.18,.3,.58,.84,.95,1.24,1.5,1.8,2.05,2.22,2.6],saved=new Map()
 for(const t of samples){cp.sample('Reload',t);saved.set(t,matrixSnapshot(root))}
 for(const t of samples.toReversed()){cp.sample('Reload',t);const a=matrixSnapshot(root),b=saved.get(t);for(let i=0;i<a.length;i++)near(a[i],b[i])}cp.dispose()
})
test('reload gameplay progress owns sampling, including pause and a jump backwards',async()=>{
 const {root,cp}=await fixture();const state={draw:false,fire:false,reloading:true,aim:false,sprint:false,reloadProgress:.7}
 cp.sync(.5,state);near(cp.actions.get('Reload').time,1.82)
 cp.sync(.9,{...state,reloadProgress:.2});near(cp.actions.get('Reload').time,.52)
 cp.sync(0,{...state,reloadProgress:.2});near(cp.actions.get('Reload').time,.52);cp.dispose()
})
test('crane rotation preserves its journal and cylinder center radius',async()=>{
 const {root,cp}=await fixture(),crane=root.getObjectByName('Crane'),cylinder=root.getObjectByName('Cylinder');let radius
 for(const t of [0,.2,.32,.45,.58,.84,1.5,2.1,2.3,2.6]){
  cp.sample('Reload',t);const a=crane.getWorldPosition(new T.Vector3()),b=cylinder.getWorldPosition(new T.Vector3()),r=a.distanceTo(b)
  radius??=r;near(r,radius);near(cylinder.position.x,0);near(cylinder.position.y,.03442234)
 }cp.dispose()
})
test('ejector stroke stays coaxial and equals 42 millimetres',async()=>{
 const {root,cp}=await fixture(),rod=root.getObjectByName('Ejector');cp.sample('Reload',.6);const a=rod.position.clone();cp.sample('Reload',.92);const b=rod.position.clone();near(a.x,b.x);near(a.y,b.y);near(a.z-b.z,.042);cp.dispose()
})
test('case trajectories leave the gun and remain distinct',async()=>{
 const {root,cp}=await fixture();cp.sample('Reload',1.1);const p=Array.from({length:6},(_,i)=>root.getObjectByName('Case'+i).getWorldPosition(new T.Vector3()))
 for(let i=0;i<6;i++)for(let j=i+1;j<6;j++)assert.ok(p[i].distanceTo(p[j])>.003)
 cp.sample('Reload',1.5);for(let i=0;i<6;i++)assert.ok(root.getObjectByName('Case'+i).getWorldPosition(new T.Vector3()).y<p[i].y-.2);cp.dispose()
})
test('each hammer strike puts one successive chamber on the bore axis',async()=>{
 const {root,cp}=await fixture(),state={draw:false,fire:false,reloading:false,aim:false,sprint:false,reloadProgress:0}
 cp.sample('Idle',0)
 for(let shot=1;shot<=6;shot++){
  cp.sync(0,{...state,fire:true});cp.sync(.05,state)
  const chamber=root.getObjectByName('Case'+(6-shot)).getWorldPosition(new T.Vector3())
  near(chamber.x,0,2e-5);near(chamber.y,.09441534,2e-5)
  near(root.getObjectByName('Bullet'+(6-shot)).scale.x,.001)
  cp.sync(.4,state);cp.sync(0,state)
 }
 assert.equal(cp.shots,6);cp.dispose()
})
test('reload completion exchanges seated cartridges without blended travel through the gun',async()=>{
 const {root,cp}=await fixture(),state={draw:false,fire:false,reloading:true,aim:false,sprint:false,reloadProgress:1}
 cp.sync(0,state);const seated=Array.from({length:6},(_,i)=>root.getObjectByName('Fresh'+i).getWorldPosition(new T.Vector3()))
 cp.sync(0,{...state,reloading:false})
 for(let i=0;i<6;i++){const p=root.getObjectByName('Case'+i).getWorldPosition(new T.Vector3());near(p.distanceTo(seated[i]),0)}
 cp.dispose()
})
test('world case has an open mouth and recessed strike geometry',()=>{
 const g=revolverCaseGeometry(),p=g.getAttribute('position');g.computeBoundingBox();near(g.boundingBox.max.z,.035)
 // No vertex caps the axis at the case mouth. Inner wall vertices define its black cavity.
 assert.ok(Array.from({length:p.count},(_,i)=>Math.hypot(p.getX(i),p.getY(i))).every(r=>r>.0006))
 assert.ok(Array.from({length:p.count},(_,i)=>p.getZ(i)).some(z=>z<-.0007));g.dispose()
})
test('registration does not change default gameplay weapon or the 1858 source',async()=>{
 const registry=JSON.parse(await readFile('assets.json','utf8'));assert.equal(registry.files['weapon-pistol'].path,'assets/models/weapons/pistol/pistol.gltf');assert.equal(registry.files['weapon-swingout'].path,'assets/models/weapons/swingout/swingout.gltf')
 const vm=raw.nodes.find(n=>n.extras?.viewModel).extras.viewModel;assert.equal(vm.gameplayWeapon,'pistol');assert.equal(vm.mechanism,'swingout')
})

test('partial reload retains every unfired cartridge and only loads the fired chambers',async()=>{
 for(const missing of [1,3,5,6]){
  const {root,cp}=await fixture(),state={draw:false,fire:false,reloading:true,aim:false,sprint:false,missingRounds:missing}
  const rest=Array.from({length:6},(_,i)=>root.getObjectByName('Case'+i).position.clone())
  for(const progress of [.25,.36,.55,.7,.95]){
   cp.sync(0,{...state,reloadProgress:progress});assert.equal(cp.spent.length,missing)
   for(let i=0;i<6-missing;i++){
    near(root.getObjectByName('Case'+i).position.distanceTo(rest[i]),0)
    near(root.getObjectByName('Case'+i).scale.x,1);near(root.getObjectByName('Bullet'+i).scale.x,1)
    near(root.getObjectByName('Fresh'+i).scale.x,.001)
   }
  }
  cp.sync(0,{...state,reloading:false,reloadProgress:0});assert.equal(cp.shots,0);cp.dispose()
 }
})

test('fire discharge follows the sampled hammer contact',async()=>{
 const {root,cp}=await fixture(),fire=root.userData.viewModel.fire
 assert.ok(fire.discharge>fire.strike)
 cp.sample('Fire',fire.strike);const hammer=root.getObjectByName('Hammer')
 near(hammer.quaternion.angleTo(new T.Quaternion()),0,1e-4)
 cp.sample('Fire',fire.strike-1/120);assert.ok(hammer.quaternion.angleTo(new T.Quaternion())>.1)
 cp.dispose()
})


test('a partial reload cannot leave cartridge masks behind for the next full reload',async()=>{
 const {root,cp}=await fixture(),state={draw:false,fire:false,reloading:true,aim:false,sprint:false}
 cp.sync(0,{...state,missingRounds:1,reloadProgress:.7})
 root.getObjectByName('Case5').scale.setScalar(.001)
 cp.sync(0,{...state,reloading:false,reloadProgress:0})
 for(let i=0;i<6;i++)near(root.getObjectByName('Case'+i).scale.x,1)
 cp.sync(0,{...state,missingRounds:6,reloadProgress:.35})
 for(let i=0;i<6;i++){near(root.getObjectByName('Case'+i).scale.x,1);near(root.getObjectByName('Fresh'+i).scale.x,1)}
 cp.dispose()
})
