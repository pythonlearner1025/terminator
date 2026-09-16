import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultMap as map} from '../../lib/core/map.js'

globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {RagdollSystem, ACTIVE_BUDGET, STEP_HZ} = await import('../../lib/view/ragdoll.js')

// A rig small enough to build fast, with every joint the system drives.
function fixture(pos) {
  const object = new E.Group(), joints = {}, contacts = []
  object.position.set(pos.x, pos.y, pos.z)
  const bone = (name, parent, x, y, z, size) => {
    const b = new E.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); joints[name] = b
    const [w, h, d] = size
    contacts.push({bone: b, corners: Array.from({length: 8}, (_, i) => new E.Vector3((i & 1 ? 1 : -1) * w / 2, (i & 2 ? 0 : -h), (i & 4 ? 1 : -1) * d / 2))})
    return b
  }
  const pelvis = bone('Pelvis', object, 0, 1, 0, [.3, .15, .2]), chest = bone('Chest', pelvis, 0, .4, 0, [.5, .3, .24])
  bone('Head', chest, 0, .4, 0, [.25, .24, .24])
  for (const [side, sign] of [['Left', -1], ['Right', 1]]) {
    const arm = bone('Shoulder ' + side, chest, sign * .32, .15, 0, [.15, .35, .15])
    bone('Forearm ' + side, arm, 0, -.35, 0, [.14, .42, .14])
    const thigh = bone('Thigh ' + side, pelvis, sign * .14, -.08, 0, [.16, .42, .16])
    bone('Shin ' + side, thigh, 0, -.42, 0, [.14, .45, .18])
  }
  const mesh = new E.Mesh(new E.BoxGeometry(), new E.MeshStandardMaterial())
  object.add(mesh); object.updateMatrixWorld(true)
  return {object, rig: {joints, contacts, mesh, actuators: [], severed: new Set(), states: new Set()}}
}

// Each death lands on its own spot, so the cap is what limits the crowd.
function kill(system, index) {
  const pos = {x: 4 + index * 2, y: 0, z: 10}
  const unit = {type: 'endo', pos, vel: {x: 0, y: 0, z: 1}}
  const shot = {weapon: 'rifle', headshot: false, direction: {x: 0, y: 0, z: -1}, point: {x: pos.x, y: 1.4, z: pos.z}}
  return system.add(fixture(pos), unit, shot, () => {})
}

test('a fresh pool keeps the stock cap and the stock step rate', () => {
  const system = new RagdollSystem(map)
  assert.equal(ACTIVE_BUDGET, 8)
  assert.equal(STEP_HZ, 60)
  assert.equal(system.activeBudget, ACTIVE_BUDGET)
  assert.equal(system.stepSeconds, 1 / STEP_HZ)
  for (let index = 0; index < 12; index += 1) kill(system, index)
  assert.equal(system.activeCount('unit'), ACTIVE_BUDGET, 'eight wrecks stay in the solver')
  system.update(1 / 60)
  assert.equal(system.stats.steps, 1, 'one 60 Hz step per 60 Hz frame')
  system.dispose()
})

test('the cap option limits how many wrecks stay in the solver', () => {
  const system = new RagdollSystem(map, undefined, {activeBudget: 4})
  for (let index = 0; index < 12; index += 1) kill(system, index)
  assert.equal(system.activeBudget, 4)
  assert.equal(system.activeCount('unit'), 4, 'four wrecks stay in the solver')
  // The rest are frozen, not deleted: they still render until they fade.
  assert.equal(system.retainedCount('unit') > 4, true)
  system.dispose()
})

test('a lower cap takes effect on wrecks that are already live', () => {
  const system = new RagdollSystem(map)
  for (let index = 0; index < 8; index += 1) kill(system, index)
  assert.equal(system.activeCount('unit'), 8)
  system.setOptions({activeBudget: 4})
  kill(system, 8)
  assert.equal(system.activeCount('unit'), 4)
  system.dispose()
})

test('the step option halves the solver rate without changing wreck lifetime', () => {
  const system = new RagdollSystem(map, undefined, {stepHz: 30})
  assert.equal(system.stepSeconds, 1 / 30)
  kill(system, 0)
  for (let frame = 0; frame < 60; frame += 1) system.update(1 / 60)
  assert.equal(system.stats.steps, 30, 'half as many solver steps for one second of frames')
  assert.equal(Math.round(system.clock * 100) / 100, 1, 'the wreck clock still advances one second')
  system.dispose()
})

test('leaving an option out restores the stock value, so presets can be switched back', () => {
  const system = new RagdollSystem(map, undefined, {activeBudget: 4, stepHz: 30})
  system.setOptions({})
  assert.equal(system.activeBudget, ACTIVE_BUDGET)
  assert.equal(system.stepSeconds, 1 / STEP_HZ)
  system.dispose()
})
