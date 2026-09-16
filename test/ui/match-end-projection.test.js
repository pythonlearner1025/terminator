import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../lib/core/world.js'
import {WaveDirector} from '../../lib/core/waves.js'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
globalThis.requestAnimationFrame ??= () => 1
const {GameManager} = await import('../../scripts/GameManager.script.js')

const idleBrain = {tick() {}}
const config = {
  spawns: [{t: 0, gate: 'N1', unit: 'scout', count: 1}],
  knobs: {gates: ['N1'], doors: {}, lights: {}, fog: 0, hazards: [], break_flank_wall: false},
}
// One tick per frame, the cadence of a machine that runs faster than 60 Hz.
const ONE_TICK_MS = 1000 / 60

function makeManager(world, director, seen) {
  return Object.assign(Object.create(GameManager.prototype), {
    started: true, world, director, party: null, sessionMode: 'single', accumulator: 0,
    localPlayerId: world.hostPlayerId, cameraFeel: null, lobby: null,
    uiProjectionTick: null, uiProjectionPhase: null,
    // The real Screens opens the results screen on the first projected frame that
    // reports the ended phase, and a screen freezes the session from then on.
    ui: {
      frozen: false,
      sample: () => ({move: {x: 0, z: 0}}),
      sync(view) { seen.push(view.wave.phase); if (view.wave.phase === 'ended') this.frozen = true },
    },
    // syncViews ends in syncUi. Only the projection throttle is under test here.
    syncViews() { this.syncUi() },
  })
}

// The UI projection throttle keys on world.tick. An ended match stops the tick, so
// a death that lands one tick past the last projection used to hold the throttle
// shut for good: no results screen, no input release, a frozen picture and a mouse
// still locked to the canvas. Both tick parities must reach the UI.
for (const lead of [0, 1]) test(`a match that ends still reaches the UI (${lead} lead frame)`, t => {
  const world = new World({seed: 91, brains: {scout: idleBrain, endo: idleBrain, heavy: idleBrain, t1000: idleBrain, hkaerial: idleBrain, hktank: idleBrain}})
  t.after(() => world.destroy())
  const director = new WaveDirector(world)
  director.start(config)
  const seen = []
  const manager = makeManager(world, director, seen)

  for (let frame = 0; frame < 30 + lead; frame += 1) manager.update({deltaTime: ONE_TICK_MS})
  assert.equal(world.phase, 'wave')
  assert.ok(seen.includes('wave'), 'a running wave reaches the UI')

  world.damagePlayer(999, {id: 'unit-1', type: 'scout', pos: {x: 0, y: 0, z: 0}}, world.hostPlayerId)
  const before = seen.length
  manager.update({deltaTime: ONE_TICK_MS})
  assert.equal(world.phase, 'ended', 'the dead host ends the match on this frame')

  // Two more frames of grace, then the UI must have been told the match is over.
  manager.update({deltaTime: ONE_TICK_MS})
  manager.update({deltaTime: ONE_TICK_MS})
  assert.ok(seen.slice(before).includes('ended'), 'the UI is handed an ended frame within three frames of the death')

  for (let frame = 0; frame < 600; frame += 1) manager.update({deltaTime: ONE_TICK_MS})
  assert.ok(seen.slice(before).filter(phase => phase === 'ended').length > 300,
    'the frozen results screen keeps receiving frames')
})
