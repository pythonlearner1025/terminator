import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {CameraFeel} from '../../../lib/view/camera-feel.js'
const feel=new CameraFeel()
const world={player:{pos:{x:0,y:0,z:0}},eventLog:[]}
world.eventLog.push({type:'shot',unitType:'heavy',origin:{x:100,y:0,z:0}})
feel.consume(world);assert.equal(feel.shake,0)
world.eventLog.push({type:'shot',by:'player',weapon:'shotgun'})
feel.consume(world);assert.ok(feel.kick>0)
world.eventLog.push({type:'shot',unitType:'heavy',origin:{x:2,y:0,z:0}})
feel.consume(world);assert.ok(feel.shake>0)
const heavyShake=feel.shake
world.eventLog.push({type:'explosion',pos:{x:1,y:0,z:0}})
feel.consume(world);assert.ok(feel.shake>heavyShake)
const camera={rotation:{x:0,y:0,z:0},updateMatrixWorld(){}}
feel.apply(camera);assert.notEqual(camera.rotation.x,0)
feel.dispose();assert.equal(feel.shake,0);assert.equal(feel.kick,0)
const result={ok:true,checks:['distant Heavy does not shake the camera','fire applies weapon kick','nearby Heavy fire shakes camera','nearby grenade increases shake','offset reaches camera','dispose clears impulses']}
await writeFile(new URL('feel-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result))
