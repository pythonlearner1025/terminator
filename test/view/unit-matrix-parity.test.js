import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {loadUnitFigure} from '../../tools/load-unit-asset.mjs'
import {NavGrid} from '../../lib/core/nav.js'
import {defaultMap} from '../../lib/core/map.js'

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
// CPU rig tests do not decode texture pixels or create a renderer.
globalThis.document ??= {createElement: () => ({getContext: () => ({createRadialGradient: () => ({addColorStop(){}}),fillRect(){}})})}
E.TextureLoader.prototype.load = function(url, onLoad) {const texture = new E.Texture(); queueMicrotask(() => onLoad?.(texture)); return texture}
E.RGBELoader.prototype.load = function(url, onLoad) {const texture = new E.DataTexture(); queueMicrotask(() => onLoad?.(texture)); return texture}
const {bindUnitRig, animateUnit} = await import('../../lib/view/units-animation.js')
const source = await readFile(new URL('../../lib/view/units-animation.js', import.meta.url), 'utf8')
const optimized = 'for(const actuator of rig.actuators)actuator.bone.updateMatrixWorld(true)\n  for(const name of rig.severed)j[name].updateMatrixWorld(true)'
assert.ok(source.includes(optimized))
// Restore exactly the old final full-tree traversal for the reference solver.
const referenceSource = source.replace(optimized, 'rig.object.updateMatrixWorld(true)')
  .replace("from 'threepipe'", `from '${import.meta.resolve('threepipe')}'`)
  .replace("from './roster-animation.js'", `from '${new URL('../../lib/view/roster-animation.js', import.meta.url)}'`)
const {animateUnit: referenceAnimate} = await import(`data:text/javascript;base64,${Buffer.from(referenceSource).toString('base64')}`)
const nav = new NavGrid(defaultMap)

test('all actual asset node matrices and skin palettes match the old full traversal through movement, IK, severing and death', async () => {
  for (const type of ['scout','endo','heavy','t1000','hkaerial','hktank']) {
    const objects = await Promise.all([loadUnitFigure(type),loadUnitFigure(type)])
    const rigs = objects.map(bindUnitRig), nodeLists = objects.map(object => {const nodes=[];object.traverse(n=>nodes.push(n));return nodes})
    const unit = {id:type,type,alive:true,hp:100,maxHp:100,spawnedAt:0,pos:{x:10,y:0,z:25},vel:{x:0,y:0,z:2},yaw:0,intent:{}}
    let optimizedUpdates=0, referenceUpdates=0
    for (let k=0;k<2;k++) for (const n of nodeLists[k]) {
      const update=n.updateMatrixWorld
      n.updateMatrixWorld=function(...args){if(k)referenceUpdates++;else optimizedUpdates++;return update.apply(this,args)}
    }
    for (let tick=0;tick<180;tick++) {
      unit.pos.x=10+Math.sin(tick/24)*.3;unit.pos.z=25-tick/60;unit.pos.y=nav.supportAt(unit.pos,unit.pos.y)?.y??unit.pos.y
      unit.yaw=Math.sin(tick/40)*.6;unit.vel.x=Math.sin(tick/15);unit.spinUp=(tick%60)/60
      unit.intent={aimAt:{x:12,y:1.6,z:19},fire:tick%20<8,melee:tick%60>40}
      if(tick===70)for(const r of rigs)r.severed.add('Shin Left')
      if(tick===110){unit.alive=false;for(const r of rigs)r.severed.add('Forearm Right')}
      for(let k=0;k<2;k++){
        objects[k].position.copy(unit.pos);objects[k].rotation.y=unit.yaw
        ;(k?referenceAnimate:animateUnit)(rigs[k],unit,1/30,tick/30,nav)
      }
      for(let i=0;i<nodeLists[0].length;i++){
        const a=nodeLists[0][i],b=nodeLists[1][i]
        assert.deepEqual(a.matrixWorld.elements,b.matrixWorld.elements,`${type} tick ${tick}: ${a.name}`)
        assert.deepEqual(a.matrix.elements,b.matrix.elements,`${type} local ${a.name}`)
        if(a.isSkinnedMesh){a.skeleton.update();b.skeleton.update();assert.deepEqual(a.skeleton.boneMatrices,b.skeleton.boneMatrices)}
      }
    }
    if(['scout','endo','heavy','t1000'].includes(type)) assert.ok(optimizedUpdates < referenceUpdates*.95,`${type}: ${optimizedUpdates} vs ${referenceUpdates} traversals`)
  }
})
