import {parentPort, workerData} from 'node:worker_threads'
import {UnitScriptRegistry, UnitScriptRuntime} from '../lib/core/sandbox/index.js'

console.info = () => {}

function smokeRun({unitType, source, rev}) {
  const runtime = new UnitScriptRuntime({unitType, source, rev})
  const self = {
    id: `${unitType}-smoke`,
    type: unitType,
    hp: 100,
    maxHp: 100,
    pos: {x: 0, y: 0, z: 0},
    yaw: 0,
    vel: {x: 0, y: 0, z: 0},
    weapon: {ready: true, range: 30, spread: 1, cooldownLeft: 0},
    alive: true,
    spawnedAt: 0,
  }
  const mem = {}
  const noop = () => {}
  const act = {moveTo: noop, stop: noop, face: noop, fire: noop, aimAt: noop, melee: noop, crouch: noop, say: noop, broadcast: noop}
  const log = []
  try {
    for (let index = 0; index < 50; index += 1) {
      runtime.tick(self, {
        time: index / 10,
        rand: () => 0.5,
        player: {pos: {x: 0, y: 0, z: 8}, dist: 8, vel: {x: 0, y: 0, z: 0}, facingMe: true, hp: 100, armor: 0, weapon: 'pistol', reloading: false},
        lastKnownPlayer: null,
        allies: [self],
        sounds: [],
        messages: [],
        nav: {
          canSee: () => true,
          pathTo: (pos) => ({next: pos, dist: 1}),
          coverNear: () => null,
          randomPoint: () => ({x: 1, y: 0, z: 1}),
          gates: [{id: 'N1', pos: {x: 0, y: 0, z: 10}}],
          doors: [],
        },
      }, act, mem)
    }
    log.push('50 ticks completed')
    return {ok: true, log}
  } catch (error) {
    log.push(String(error?.message || error))
    return {ok: false, error: String(error?.message || error), log}
  } finally {
    runtime.destroy()
  }
}

try {
  const {unitType, source, current} = workerData
  const registry = new UnitScriptRegistry({scriptSources: current ? {[unitType]: current} : {}})
  const result = registry.acceptScript({unitType, source}, smokeRun)
  parentPort.postMessage({ok: result.ok, ...(result.rev ? {rev: result.rev} : {}), ...(result.error ? {error: result.error} : {}), smoke_log: result.smokeLog || []})
} catch (error) {
  parentPort.postMessage({ok: false, error: String(error?.message || error), smoke_log: []})
}
