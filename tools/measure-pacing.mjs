#!/usr/bin/env node
/**
 * measure-pacing.mjs — the pacing proof for the in-wave director.
 *
 * Drives the real WaveDirector with the built-in Skynet, pacer on, seed 7:
 *   - passive run: one fresh match per wave 1..10 with a player who never moves
 *     and never fires. A death ends a match, so each wave needs its own match to
 *     report its own death time.
 *   - sniper run:  one continuous match, waves 1..10, with the sniper ghost from
 *     tools/prove-core-roster.mjs (slot 5, perfect accuracy on the nearest
 *     visible unit, reload when the magazine is empty, strafe, sprint).
 *
 * Per wave it prints units spawned by type, mobs, first contact, sustain peaks,
 * straggler events, relax seconds, combat share, wave length, and the passive
 * death time. The last table scores every contract target.
 *
 * Usage: node tools/measure-pacing.mjs [--prove] [--json] [--waves=N]
 *   --prove   fail the exit code when a contract target or the full-match proof fails.
 *   --json    print the rows and the proof as JSON instead of tables. The script
 *             sandbox writes its own banner to stdout, so read from the first brace.
 *   --waves=N shorten the passive run to the first N waves.
 *
 * The full-match proof (ten waves end, wave 10 extracts, no script_error, every
 * director event present) also runs as test/core/director/full-match.test.js.
 */
import {performance} from 'node:perf_hooks'
import {BuiltinSkynet} from '../lib/core/builtin-skynet.js'
import {INTENSITY} from '../lib/core/director.js'
import {copyVec, planarDistance, yawTo} from '../lib/core/math.js'
import {MAX_WAVES, WaveDirector} from '../lib/core/waves.js'
import {World} from '../lib/core/world.js'

export const SEED = 7

export const MEASURE = Object.freeze({
  // First contact: a living unit this close with a sight line, or the first hit.
  contactRadius: INTENSITY.engagedRadius,
  contactSightEveryTicks: 6,
  // Combat share: a living unit this close, or a hit inside the memory window.
  combatRadius: 15,
  combatMemorySeconds: 3,
  // A passive player never survives a wave; this only bounds a stuck run.
  passiveCapSeconds: 180,
  // The sniper drives to the pad once the chopper is down.
  padRepathTicks: 30,
  // A driving ghost that stopped moving walks sideways instead of into the wall.
  unstickCheckTicks: 30,
  unstickMeters: 0.3,
  unstickTicks: 45,
  // A hunt this long without a shot means the ghost needs a better angle.
  vantageAfterTicks: 300,
  // A wave that runs this long is stuck. The run stops and says so.
  waveStallSeconds: 300,
})

export const TARGETS = Object.freeze({
  combatShare: 0.6,
  firstContactSeconds: 12,
  peaks: Object.freeze([2, 3]),
  stragglerHuntSeconds: 15,
  // A still player caught by a mob dies. It should not take three seconds.
  passiveDeathSeconds: Object.freeze([8, 20]),
})

const HOST_EYE = 1.65

// ---------------------------------------------------------------- per wave ---

/** One wave's worth of samples. Every number comes from the world, not a guess. */
class WaveMetrics {
  constructor(wave) {
    this.wave = wave
    this.spawns = {}
    this.mobs = 0
    this.firstMobAt = null
    this.peaks = 0
    this.stragglerEvents = 0
    this.firstContact = null
    this.ticks = 0
    this.combatTicks = 0
    this.relaxTicks = 0
    this.stragglerSeconds = 0
    this.huntSeconds = 0
    this.length = 0
    this.deathAt = null
    this.endReason = null
    this.lastDamageAt = -Infinity
    this.enragedAt = null
  }

  get combatShare() {
    return this.ticks === 0 ? 0 : this.combatTicks / this.ticks
  }

  get relaxSeconds() {
    return this.relaxTicks / 60
  }

  toJSON() {
    return {...this, combatShare: this.combatShare, relaxSeconds: this.relaxSeconds}
  }
}

function readEvents(world, cursor, metrics) {
  const log = world.eventLog
  for (; cursor < log.length; cursor += 1) {
    const event = log[cursor]
    if (event.type === 'unit_spawn') metrics.spawns[event.unitType] = (metrics.spawns[event.unitType] || 0) + 1
    else if (event.type === 'mob_incoming') {
      metrics.mobs += 1
      metrics.firstMobAt ??= world.waveTime()
    }
    else if (event.type === 'director_state' && event.state === 'sustain_peak') metrics.peaks += 1
    else if (event.type === 'stragglers_enraged') {
      metrics.stragglerEvents += 1
      metrics.enragedAt = world.waveTime()
    } else if (event.type === 'player_damage') {
      metrics.lastDamageAt = world.waveTime()
      metrics.firstContact ??= world.waveTime()
    } else if (event.type === 'player_death') metrics.deathAt ??= world.waveTime()
  }
  return cursor
}

function nearestUnitDistance(world) {
  let nearest = Infinity
  for (const unit of world.aliveUnits) {
    for (const player of world.livingPlayers) nearest = Math.min(nearest, planarDistance(player.pos, unit.pos))
  }
  return nearest
}

function anySightedWithin(world, radius) {
  for (const player of world.livingPlayers) {
    const eye = {...player.pos, y: player.pos.y + HOST_EYE}
    for (const unit of world.aliveUnits) {
      if (planarDistance(player.pos, unit.pos) > radius) continue
      if (world.lineOfSight(world.unitEye(unit), eye)) return true
    }
  }
  return false
}

function stragglerCandidates(world) {
  return world.aliveUnits.filter((unit) => world.unitCatalog.types[unit.type]?.role !== 'boss')
}

function sampleTick(world, director, metrics) {
  const now = world.waveTime()
  metrics.ticks += 1
  metrics.length = now
  if (world.director?.state === 'relax') metrics.relaxTicks += 1
  if (nearestUnitDistance(world) <= MEASURE.combatRadius || now - metrics.lastDamageAt <= MEASURE.combatMemorySeconds) {
    metrics.combatTicks += 1
  }
  if (metrics.firstContact == null && world.tick % MEASURE.contactSightEveryTicks === 0
    && nearestUnitDistance(world) <= MEASURE.contactRadius && anySightedWithin(world, MEASURE.contactRadius)) {
    metrics.firstContact = now
  }
  // The straggler tail: an empty reservoir, nothing queued, three or fewer left.
  // A boss is not a straggler, so a boss fight never counts as a hunt.
  const alive = stragglerCandidates(world).length
  const hunting = director.pacer != null && director.pacer.reservoir <= 0
    && director.population.pending.length === 0 && alive > 0 && alive <= 3
    && world.aliveUnits.length === alive
  if (hunting) {
    metrics.stragglerSeconds += 1 / 60
    if (metrics.enragedAt != null) metrics.huntSeconds += 1 / 60
  }
}

// ------------------------------------------------------------------ ghosts ---

function passiveInputs() {
  return {move: {x: 0, z: 0}, yaw: 0, fire: false, sprint: false}
}

/** The sniper ghost: slot 5, strafe, sprint, reload on an empty magazine. */
function sniperInputs(world, tick, {reloadEdge, driveTo = null, sidestep = false}) {
  const player = world.player
  const inputs = {
    move: {x: Math.floor(tick / 120) % 2 ? -0.7 : 0.7, z: 0},
    yaw: player.yaw,
    sprint: true,
    fire: false,
    reload: reloadEdge,
    switchTo: player.activeWeapon === 'sniper' ? null : 5,
  }
  if (driveTo) {
    inputs.yaw = yawTo(player.pos, driveTo)
    inputs.move = sidestep ? {x: 1, z: 0} : {x: 0, z: 1}
  }
  return inputs
}

/** Perfect-accuracy shot at the nearest unit in sight, the way sim/index.js fires. */
function fireSniperShot(world) {
  const player = world.player
  const weaponId = player.activeWeapon
  const weapon = world.weaponCatalog.weapons[weaponId]
  const ammo = player.ammo[weaponId]
  if (!weapon || !ammo || player.fireCooldown > 0 || player.reloadTimer > 0 || ammo.mag <= 0) return false
  ammo.mag -= 1
  player.fireCooldown = 1 / weapon.rate
  const origin = {...player.pos, y: player.pos.y + (player.crouch ? 1.12 : HOST_EYE)}
  const target = world.aliveUnits
    .filter((unit) => world.lineOfSight(origin, world.unitEye(unit)))
    .sort((a, b) => planarDistance(player.pos, a.pos) - planarDistance(player.pos, b.pos) || a.id.localeCompare(b.id))[0]
  if (target) {
    world.damageUnit(target.id, weapon.damage * (weapon.pellets || 1), {
      source: 'player',
      playerId: player.id,
      weapon: weaponId,
      distance: planarDistance(player.pos, target.pos),
      point: copyVec(target.pos),
    })
  }
  world.recordShot(weaponId, Boolean(target), player.id)
  world.addSound('gunshot', player.pos, undefined, player.id)
  return true
}

// The ghost owns every weapon and never shops, so its reserve is topped up the
// way an ammo cache would. Only the reserve: it still reloads and it still waits
// out the fire rate.
function armGhost(world) {
  const player = world.player
  for (const id of world.weaponCatalog.slots) {
    player.ammo[id].owned = true
    player.ammo[id].reserve = world.weaponCatalog.weapons[id].reserveMax
  }
}

// The ghost walks somewhere only for two reasons: the chopper is down, or the
// last few units are out of sight and a player would go and finish them.
function ghostGoal(world, director, huntTicks) {
  if (world.extraction?.phase === 'arrived') return copyVec(world.extraction.pos)
  const alive = world.aliveUnits
  const tail = director.pacer != null && director.pacer.reservoir <= 0 && director.population.pending.length === 0
  if (!tail || alive.length === 0) return null
  const player = world.player
  const eye = {...player.pos, y: player.pos.y + HOST_EYE}
  const hidden = alive.filter((unit) => !world.lineOfSight(eye, world.unitEye(unit)))
  if (hidden.length !== alive.length) return null
  const target = hidden.sort((a, b) => planarDistance(player.pos, a.pos) - planarDistance(player.pos, b.pos))[0]
  // Walking at it did not open a shot, so take the nearest spot that sees it.
  if (huntTicks > MEASURE.vantageAfterTicks) return vantagePoint(world, target) || copyVec(target.pos)
  return copyVec(target.pos)
}

// Known standing places on the map, ranked by how close they are to the ghost.
function vantagePoint(world, target) {
  const map = world.map
  const eye = world.unitEye(target)
  const player = world.player
  return [...(map.spawnGates || []), ...(map.spawnSpots || []), ...(map.cacheSpots || []), ...(map.traderSpots || [])]
    .map(({pos}) => pos)
    .filter((pos) => planarDistance(player.pos, pos) > 3 && world.lineOfSight({...pos, y: pos.y + HOST_EYE}, eye))
    .sort((a, b) => planarDistance(player.pos, a) - planarDistance(player.pos, b))
    .map((pos) => copyVec(pos))[0] || null
}

// The map has walls, so the ghost follows a nav path instead of a straight line.
// A flyer has no nav cell, so the path goes to the ground under it.
function pathTo(world, goal) {
  const from = world.player.pos
  return world.nav.findPath(from, goal) || world.nav.findPath(from, {...goal, y: 0}) || []
}

function waypoint(world, path) {
  const player = world.player
  while (path.length > 0 && planarDistance(player.pos, path[0]) < 1.5) path.shift()
  return path[0] || null
}

// ------------------------------------------------------------------- runs ----

function newMatch({seed = SEED, wave = 1} = {}) {
  const world = new World({seed})
  const director = new WaveDirector(world, {builtin: new BuiltinSkynet(), now: () => 0})
  director.wave = wave - 1
  return {world, director}
}

/** One passive wave: nobody moves, nobody shoots. It ends at the death. */
export function runPassiveWave(wave, {seed = SEED} = {}) {
  const {world, director} = newMatch({seed: seed + wave, wave})
  const metrics = new WaveMetrics(wave)
  const started = director.start()
  if (!started?.ok) throw new Error(`passive wave ${wave} failed to start`)
  let cursor = readEvents(world, 0, metrics)
  const maxTicks = Math.round(MEASURE.passiveCapSeconds * 60)
  for (let tick = 0; tick < maxTicks; tick += 1) {
    director.step({[world.hostPlayerId]: passiveInputs()})
    cursor = readEvents(world, cursor, metrics)
    if (director.phase !== 'wave') break
    sampleTick(world, director, metrics)
  }
  metrics.endReason = director.telemetryByWave.get(wave)?.end_reason || 'timeout'
  return metrics
}

/**
 * The full sniper match: waves 1..10 in one world. Returns a metrics row per
 * wave plus the event log facts the full-match proof checks.
 */
export function runSniperMatch({seed = SEED, invulnerable = false} = {}) {
  const {world, director} = newMatch({seed})
  if (invulnerable) world.setSandbox({invulnerable: true})
  armGhost(world)
  const rows = []
  const started = director.start()
  if (!started?.ok) throw new Error('sniper match failed to start')
  let metrics = new WaveMetrics(director.wave)
  let cursor = readEvents(world, 0, metrics)
  let reloadEdge = false
  let padPath = []
  let exception = null
  let stalled = null
  const unstick = {at: copyVec(world.player.pos), checkedTick: 0, until: 0}
  let huntTicks = 0
  const maxTicks = Math.round((MAX_WAVES * 260 + 200) * 60)
  let tick = 0
  try {
    for (; tick < maxTicks && director.phase !== 'ended'; tick += 1) {
      if (director.phase === 'intermission') {
        director.step({[world.hostPlayerId]: {...passiveInputs(), ready: true}})
        cursor = readEvents(world, cursor, metrics)
        continue
      }
      if (metrics.wave !== director.wave) {
        rows.push(metrics)
        metrics = new WaveMetrics(director.wave)
        padPath = []
      }
      const player = world.player
      const ammo = player.ammo[player.activeWeapon]
      if (ammo) ammo.reserve = world.weaponCatalog.weapons[player.activeWeapon].reserveMax
      const wantsReload = Boolean(ammo) && ammo.mag <= 0 && player.reloadTimer === 0 && ammo.reserve > 0
      reloadEdge = wantsReload && !reloadEdge
      const goal = ghostGoal(world, director, huntTicks)
      huntTicks = goal ? huntTicks + 1 : 0
      let driveTo = null
      if (goal) {
        if (tick % MEASURE.padRepathTicks === 0 || padPath.length === 0) padPath = pathTo(world, goal)
        driveTo = waypoint(world, padPath)
        if (tick - unstick.checkedTick >= MEASURE.unstickCheckTicks) {
          if (planarDistance(player.pos, unstick.at) < MEASURE.unstickMeters) unstick.until = tick + MEASURE.unstickTicks
          unstick.at = copyVec(player.pos)
          unstick.checkedTick = tick
        }
      } else {
        padPath = []
        unstick.at = copyVec(player.pos)
        unstick.checkedTick = tick
      }
      const inputs = sniperInputs(world, tick, {reloadEdge, driveTo, sidestep: tick < unstick.until})
      director.step({[world.hostPlayerId]: {...inputs, fire: false}})
      fireSniperShot(world)
      cursor = readEvents(world, cursor, metrics)
      if (director.phase === 'wave') sampleTick(world, director, metrics)
      if (director.phase === 'wave' && world.waveTime() > MEASURE.waveStallSeconds) {
        stalled = {wave: director.wave, alive: world.aliveUnits.map((unit) => `${unit.type}@${unit.pos.x.toFixed(0)},${unit.pos.y.toFixed(1)},${unit.pos.z.toFixed(0)}`)}
        metrics.endReason = 'stalled'
        break
      }
    }
  } catch (error) {
    exception = error
  }
  rows.push(metrics)
  for (const row of rows) row.endReason = director.telemetryByWave.get(row.wave)?.end_reason || row.endReason
  return {
    rows,
    world,
    director,
    exception,
    stalled,
    ticks: tick,
    playerDied: world.livingPlayers.length === 0,
    wavesFinished: [...director.telemetryByWave.keys()].sort((a, b) => a - b),
  }
}

// ---------------------------------------------------------------- printing ---

function spawnText(spawns) {
  const entries = Object.entries(spawns).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries.length === 0 ? '-' : entries.map(([type, count]) => `${type}:${count}`).join(' ')
}

function seconds(value) {
  return value == null ? '-' : `${value.toFixed(1)}s`
}

function percent(value) {
  return `${Math.round(value * 100)}%`
}

function table(headers, rows) {
  const widths = headers.map((head, index) => Math.max(head.length, ...rows.map((row) => String(row[index]).length)))
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ')
  return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...rows.map(line)].join('\n')
}

function printWaveTable(title, rows, {death = false} = {}) {
  const headers = ['wave', 'spawned', 'mobs', 'mob1', 'contact', 'peaks', 'strag', 'hunt', 'relax', 'combat', 'length']
  if (death) headers.push('death')
  const body = rows.map((row) => {
    const cells = [
      row.wave,
      spawnText(row.spawns),
      row.mobs,
      seconds(row.firstMobAt),
      seconds(row.firstContact),
      row.peaks,
      row.stragglerEvents,
      seconds(row.stragglerSeconds),
      seconds(row.relaxSeconds),
      percent(row.combatShare),
      seconds(row.length),
    ]
    if (death) cells.push(seconds(row.deathAt))
    return cells
  })
  console.log(`\n${title}\n${table(headers, body)}`)
}

function verdict(ok) {
  return ok ? 'PASS' : 'FAIL'
}

function scoreboard(passive, sniper, {extracted}) {
  // The passive run scores first contact: it measures the director's opening
  // pressure. A perfect sniper kills the first mob at forty metres, so its own
  // contact time measures the ghost, not the pacer.
  const contactsOk = passive.filter((row) => row.firstContact != null && row.firstContact < TARGETS.firstContactSeconds).length
  const worstContact = Math.max(0, ...passive.map((row) => row.firstContact ?? 0))
  const sniperShare = sniper.reduce((sum, row) => sum + row.combatTicks, 0) / Math.max(1, sniper.reduce((sum, row) => sum + row.ticks, 0))
  const passiveShare = passive.reduce((sum, row) => sum + row.combatTicks, 0) / Math.max(1, passive.reduce((sum, row) => sum + row.ticks, 0))
  const peaksOk = sniper.filter((row) => row.peaks >= TARGETS.peaks[0] && row.peaks <= TARGETS.peaks[1]).length
  const worstHunt = Math.max(0, ...sniper.map((row) => row.huntSeconds))
  const deaths = passive.map((row) => row.deathAt).filter((value) => value != null)
  const deathsOk = deaths.filter((value) => value >= TARGETS.passiveDeathSeconds[0] && value <= TARGETS.passiveDeathSeconds[1]).length
  const rows = [
    ['combat share (sniper match)', `above ${percent(TARGETS.combatShare)}`, percent(sniperShare), verdict(sniperShare > TARGETS.combatShare)],
    // Not a match: a passive wave is a death probe that ends in under half a
    // minute, and the mob needs a few seconds of that to arrive. Reported only.
    ['combat share (passive waves)', 'reference only', percent(passiveShare), '-'],
    ['first contact (passive waves)', `under ${TARGETS.firstContactSeconds}s`, `${contactsOk}/${passive.length} waves, worst ${seconds(worstContact)}`, verdict(contactsOk >= Math.ceil(passive.length * 0.6))],
    ['peaks per wave in range', `${TARGETS.peaks[0]} to ${TARGETS.peaks[1]}`, `${peaksOk}/${sniper.length} waves`, verdict(peaksOk >= Math.ceil(sniper.length * 0.6))],
    ['straggler hunt after the enrage', `never over ${TARGETS.stragglerHuntSeconds}s`, seconds(worstHunt), verdict(worstHunt <= TARGETS.stragglerHuntSeconds)],
    ['passive death in range', `${TARGETS.passiveDeathSeconds[0]} to ${TARGETS.passiveDeathSeconds[1]}s`, `${deathsOk}/${passive.length} waves`, verdict(deathsOk >= Math.ceil(passive.length * 0.6))],
    ['wave 10 reaches extraction', 'extracted', extracted ? 'extracted' : 'no', verdict(extracted)],
  ]
  console.log(`\nContract targets\n${table(['metric', 'target', 'measured', 'verdict'], rows)}`)
  return rows.every((row) => row[3] !== 'FAIL')
}

// ------------------------------------------------------------------- proof ---

export function proveFullMatch(run) {
  const types = new Set(run.world.eventLog.map(({type}) => type))
  const phases = run.world.eventLog.filter(({type}) => type === 'extraction').map(({phase}) => phase)
  const summary = run.director.telemetryByWave.get(MAX_WAVES)
  const failures = []
  if (run.exception) failures.push(`exception: ${run.exception.message}`)
  if (run.stalled) failures.push(`wave ${run.stalled.wave} never ended, still alive: ${run.stalled.alive.join(' ')}`)
  if (run.wavesFinished.length !== MAX_WAVES) failures.push(`waves finished: ${run.wavesFinished.join(',') || 'none'}`)
  if (summary?.end_reason !== 'extracted') failures.push(`wave ${MAX_WAVES} end reason: ${summary?.end_reason ?? 'none'}`)
  if (types.has('script_error')) failures.push('script_error in the event log')
  for (const required of ['mob_incoming', 'special_dispatched', 'deck_card', 'trader_moved']) {
    if (!types.has(required)) failures.push(`missing event: ${required}`)
  }
  if (!types.has('cache_taken') && !types.has('cache_spawned')) failures.push('missing event: cache_taken or cache_spawned')
  for (const phase of ['announced', 'arrived', 'complete']) {
    if (!phases.includes(phase)) failures.push(`missing extraction phase: ${phase}`)
  }
  return {ok: failures.length === 0, failures, phases, wavesFinished: run.wavesFinished}
}

// -------------------------------------------------------------------- main ---

function main(argv) {
  const prove = argv.includes('--prove')
  const asJson = argv.includes('--json')
  const waveArg = argv.find((flag) => flag.startsWith('--waves='))
  const waves = Math.max(1, Math.min(MAX_WAVES, Number(waveArg?.split('=')[1]) || MAX_WAVES))
  const startedAt = performance.now()

  const passive = []
  for (let wave = 1; wave <= waves; wave += 1) passive.push(runPassiveWave(wave))

  let sniper = runSniperMatch()
  let invulnerable = false
  if (sniper.playerDied || sniper.wavesFinished.length < waves) {
    invulnerable = true
    sniper = runSniperMatch({invulnerable: true})
  }
  const proof = proveFullMatch(sniper)
  const wallSeconds = (performance.now() - startedAt) / 1000

  if (asJson) {
    console.log(JSON.stringify({passive, sniper: sniper.rows, proof, invulnerable, wallSeconds}, null, 2))
  } else {
    console.log(`measure-pacing: seed ${SEED}, waves 1 to ${waves}, built-in Skynet, pacer on`)
    console.log('passive run: one fresh match per wave, because a death ends a match')
    console.log('sniper ghost: reserve ammo is topped up every tick, because a ghost never shops')
    if (invulnerable) console.log('NOTE: the sniper ghost died before wave 10, so the sniper run uses world.setSandbox({invulnerable: true})')
    else console.log('sniper run: no sandbox, the ghost survived to wave 10 on its own')
    printWaveTable('Passive player (never moves, never fires)', passive, {death: true})
    printWaveTable('Sniper ghost (slot 5, perfect accuracy, strafing)', sniper.rows)
    const extracted = sniper.director.telemetryByWave.get(MAX_WAVES)?.end_reason === 'extracted'
    const ok = scoreboard(passive, sniper.rows, {extracted})
    console.log(`\nfull match proof: ${proof.ok ? 'ok' : `FAILED — ${proof.failures.join('; ')}`}`)
    console.log(`waves finished: ${proof.wavesFinished.join(', ') || 'none'}; extraction phases: ${proof.phases.join(', ') || 'none'}`)
    console.log(`wall time: ${wallSeconds.toFixed(1)}s`)
    if (prove && !ok) process.exitCode = 1
  }
  if (prove && !proof.ok) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2))
