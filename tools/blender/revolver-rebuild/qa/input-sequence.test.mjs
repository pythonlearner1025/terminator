import test from 'node:test'
import assert from 'node:assert/strict'
import {World} from '../../../../lib/core/world.js'
import {WaveDirector} from '../../../../lib/core/waves.js'
import {WeaponsRange} from '../../../../lib/core/range.js'
import {createLabMap,labTargetLayout} from '../../../../lib/view/lab-layout.js'
function lab(t){
 const world=new World({map:createLabMap(),seed:2029}),director=new WaveDirector(world),range=new WeaponsRange(world,director)
 range.layout=labTargetLayout();range.start();range.setReloads(true);t.after(()=>world.destroy())
 const step=(n,input={})=>{for(let i=0;i<n;i++){director.pauseWaves();director.step(range.input({yaw:0,pitch:0,...input}));range.afterStep()}}
 return {world,range,step}
}
test('QA shot cadence empties six chambers without advancing an implicit reload',t=>{
 const {world,step}=lab(t);step(70)
 for(let shot=0;shot<6;shot++){step(1,{fire:true});if(shot<5)step(40)}
 assert.equal(world.eventLog.filter(e=>e.type==='shot'&&e.weapon==='pistol').length,6)
 assert.equal(world.player.ammo.pistol.mag,0);assert.equal(world.player.reloadTimer,0)
 step(1,{reload:true});assert.equal(world.player.reloadTimer,world.weaponCatalog.weapons.pistol.reloadSeconds)
})
test('held empty trigger can start reload before a later explicit request',t=>{
 const {world,range,step}=lab(t);world.player.ammo.pistol.mag=0
 step(1,{fire:true});assert.ok(world.player.reloadTimer>0)
 step(40);const before=world.player.reloadTimer;range.input({reload:true})
 assert.equal(world.player.reloadTimer,before,'An explicit request does not reset an active reload')
 const fraction=1-before/world.weaponCatalog.weapons.pistol.reloadSeconds
 assert.ok(fraction>.17,'The opening phase would already be missed by an assumed zero start')
})
