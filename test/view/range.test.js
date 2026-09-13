import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
globalThis.ImageData??=class {}
globalThis.window??={}
const E=await import('threepipe')
const {RangeView}=await import('../../lib/view/range.js')
const {RangeClock}=await import('../../lib/core/range.js')
const {CameraFeel}=await import('../../lib/view/camera-feel.js')
const {WeaponAnimation}=await import('../../lib/view/weapons-animation.js')
const {createWeaponRigs}=await import('../../lib/view/weapons.js')

test('range fixtures are registered glTF assets with a named animation pivot',async()=>{
 const root=new URL('../../',import.meta.url)
 const manifest=JSON.parse(await readFile(new URL('assets.json',root),'utf8'))
 for(const [id,slug] of [['range-steel-target','steel-target'],['range-firing-line','firing-line']]){
  const entry=manifest.files[id]
  assert.equal(entry.path,`assets/models/range/${slug}/${slug}.gltf`)
  assert.ok(entry.files['f.gltf']);assert.ok(entry.files[`${slug}.bin`])
 }
 const target=JSON.parse(await readFile(new URL(manifest.files['range-steel-target'].path,root),'utf8'))
 const names=new Set(target.nodes.map(node=>node.name))
 assert.ok(names.has('Plate Pivot'));assert.ok(names.has('Suspended steel silhouette'))
})

test('range plates register silhouette hits, reject empty shoulders, and respect nearer world impacts',()=>{
 const plate={x:15,y:1.8,z:0,id:'plate-1',lastHit:-Infinity,hits:0}
 const view={props:{plates:[plate]},manager:{world:{tick:10}},ring(){this.rings=(this.rings||0)+1}}
 const cast=(y,z,max=20,react=false)=>RangeView.prototype.plateHit.call(view,{x:0,y,z},{x:1,y:0,z:0},max,react)
 assert.equal(cast(1.4,0,20,true).distance,15);assert.equal(plate.hits,1);assert.equal(view.rings,1)
 assert.equal(cast(1.88,.2),null);assert.equal(cast(1.88,0).plate,plate)
 assert.equal(cast(1.4,0,14),null);assert.equal(cast(.5,0),null)
})

test('range paths keep the last twenty shots and release overwritten projectile references',()=>{
 const view={shots:[],projectileShots:new Map()}
 for(let i=0;i<100;i++){const shot={tick:i,projectileId:String(i)};view.projectileShots.set(String(i),shot);RangeView.prototype.addShot.call(view,shot)}
 assert.equal(view.shots.length,20);assert.equal(view.shots[0].tick,80);assert.equal(view.projectileShots.size,20)
})

test('freeze flash retains the current shot at its peak and does not invent a new shot',()=>{
 const fx={rig:null,flashMax:.045,flashLife:0,flash:{visible:false},material:{opacity:0},beforeRender(){}}
 const view={options:{freeze:true},manager:{playerView:{weapons:{fx,animation:{aimAmount:0}},camera:{}}}}
 RangeView.prototype.freezeFlash.call(view);assert.equal(fx.flashLife,0)
 fx.rig={};RangeView.prototype.freezeFlash.call(view)
 assert.equal(fx.flashLife,.045);assert.equal(fx.flash.visible,true);assert.equal(fx.material.opacity,1)
 view.options.freeze=false;fx.flashLife=.01;RangeView.prototype.freezeFlash.call(view);assert.equal(fx.flashLife,.01)
})

test('weapon animation and camera spring follow admitted ticks, including a paused single step',()=>{
 const clock=new RangeClock(),rigs=createWeaponRigs(new E.Group(),new E.PhysicalMaterial())
 const fx={update(){},fire(){},eject(){}},animation=new WeaponAnimation(rigs,fx)
 const world={tick:0,eventLog:[],weaponCatalog:{weapons:{pistol:{rate:2.5,mag:6}}},player:{id:'player',activeWeapon:'pistol',pos:{x:0,y:0,z:0},vel:{x:0,z:0},yaw:0,pitch:0,ammo:{pistol:{mag:6,reserve:66}}}}
 const feel=new CameraFeel(),camera=new E.PerspectiveCamera();feel.velocity=1
 function render(ms){world.tick+=clock.takeTicks(ms);animation.sync(world);camera.rotation.set(0,0,0);feel.apply(camera,world.tick/60)}
 render(0);clock.setScale(.1)
 for(let i=0;i<600;i++)render(1000/60)
 assert.equal(world.tick,60);assert.ok(Math.abs(animation.time-1)<1e-8)
 clock.setScale(0);const time=animation.time,kick=feel.kick
 for(let i=0;i<100;i++)render(1000/60)
 assert.equal(animation.time,time);assert.equal(feel.kick,kick)
 clock.step();render(1000/60);assert.equal(world.tick,61);assert.ok(animation.time>time)
})
