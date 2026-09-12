#!/usr/bin/env node
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const root = new URL('../', import.meta.url)
const STRUCTURAL_KINDS = new Set(['floor', 'wall', 'building_wall', 'tunnel_wall', 'stair', 'ramp'])
const POSES = {
  scout: [
    ['idle', {vel: {x: 0, y: 0, z: 0}, intent: {}}],
    ['melee', {vel: {x: 0, y: 0, z: 0}, intent: {melee: true}}],
  ],
  endo: [
    ['idle', {vel: {x: 0, y: 0, z: 0}, intent: {}}],
    ['aim', {vel: {x: 0, y: 0, z: 0}, intent: {aimAt: {x: 0, y: 1.6, z: 8}, fire: true}}],
  ],
  heavy: [
    ['idle', {vel: {x: 0, y: 0, z: 0}, intent: {}}],
    ['aim', {vel: {x: 0, y: 0, z: 0}, intent: {aimAt: {x: 0, y: 1.6, z: 8}, fire: true}}],
  ],
}

export async function measureColliderFit() {
  const map = JSON.parse(await readFile(new URL('lib/core/data/map.json', root), 'utf8'))
  const units = JSON.parse(await readFile(new URL('lib/core/data/units.json', root), 'utf8'))
  const {E, createMapGroup, createUnitFigure, bindUnitRig, animateUnit} = await loadGeometry()
  const mapGroup = createMapGroup(E, map, {markers: false, runtime: true})
  mapGroup.updateMatrixWorld(true)
  const visualById = new Map(mapGroup.userData.mapVisualBounds.map(item => [item.id, bounds(item.min, item.max)]))
  const trader = mapGroup.getObjectByName('Resistance trader crate')
  trader.updateWorldMatrix(true, true)
  const traderBounds = new E.Box3().setFromObject(trader)
  visualById.set('trader_crate', bounds(traderBounds.min.toArray(), traderBounds.max.toArray()))

  const staticColliders = [...map.colliders, ...(map.trader?.navBlock ? [map.trader] : [])]
  const propIds = staticColliders.filter(item => !STRUCTURAL_KINDS.has(item.kind)).map(item => item.id)
  const props = propIds.map(id => {
    const visual = visualById.get(id)
    const movement = staticColliders.find(item => item.id === id && item.navBlock) || null
    const shots = staticColliders.find(item => item.id === id && item.blocksSight !== false) || null
    const movementBounds = colliderBounds(movement)
    const shotBounds = colliderBounds(shots)
    const overshoot = movementBounds ? compareBounds(visual, movementBounds) : null
    const shotOvershoot = shotBounds ? compareBounds(visual, shotBounds) : null
    return {
      id,
      type: movement?.kind || (id === 'trader_crate' ? 'trader' : 'unknown'),
      visual,
      movement: describeCollider(movement),
      shots: describeCollider(shots),
      movementBounds,
      shotBounds,
      overshoot,
      shotOvershoot,
      maxOvershootCm: overshoot ? Math.max(...Object.values(overshoot)) : Infinity,
    }
  }).sort((a, b) => b.maxOvershootCm - a.maxOvershootCm || a.id.localeCompare(b.id))

  const unitRows = []
  for (const [type, spec] of Object.entries(units.types)) {
    for (const [pose, statePatch] of POSES[type]) {
      const object = createUnitFigure(E, type)
      const rig = bindUnitRig(object)
      const state = {id: `fit-${type}`, type, pos: {x: 0, y: 0, z: 0}, yaw: 0, alive: true, spinUp: 1, ...statePatch}
      for (let frame = 0; frame < 90; frame += 1) animateUnit(rig, state, 1 / 60, frame / 60)
      object.updateMatrixWorld(true)
      const anatomy = skinnedBounds(E, rig, part => !['Weapon', 'Barrels', 'Muzzle'].includes(part.bone.name))
      const skull = skinnedBounds(E, rig, part => part.bone.name === 'Head')
      const hitVolumes = unitHitVolumes(spec, pose)
      const hitBounds = combinedPrimitiveBounds(hitVolumes)
      const headVolumes = hitVolumes.filter(part => part.part === 'head')
      const headBounds = combinedPrimitiveBounds(headVolumes)
      const outer = compareBounds(anatomy, hitBounds)
      const missing = compareBounds(hitBounds, anatomy)
      unitRows.push({
        type,
        pose,
        anatomy,
        skull,
        hitBounds,
        headBounds,
        volumes: hitVolumes.map(describePrimitive).join(' + '),
        outerCm: Math.max(0, ...Object.values(outer)),
        missingCm: Math.max(0, ...Object.values(missing)),
        headOuterCm: headBounds ? Math.max(0, ...Object.values(compareBounds(skull, headBounds))) : Infinity,
      })
    }
  }
  return {props, units: unitRows}
}

export function formatReport(report) {
  const lines = [
    '# Collider fit evidence',
    '',
    'Positive side values mean invisible collider overshoot. Negative values mean collider undershoot.',
    'All bounds use world metres. All side differences use centimetres.',
    '',
    '## Bunker 7 props',
    '',
    '| Prop | Type | Visual bounds | Movement collider | Shot collider | -X | +X | -Y | +Y | -Z | +Z | Max |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ]
  for (const row of report.props) {
    const side = row.overshoot || {}
    lines.push(`| ${row.id} | ${row.type} | ${formatBounds(row.visual)} | ${row.movement} | ${row.shots} | ${cm(side.minX, false)} | ${cm(side.maxX, false)} | ${cm(side.minY, false)} | ${cm(side.maxY, false)} | ${cm(side.minZ, false)} | ${cm(side.maxZ, false)} | ${cm(row.maxOvershootCm, false)} |`)
  }
  lines.push(
    '',
    '## Unit hit volumes',
    '',
    'Weapons are excluded from anatomy bounds. The skull row uses geometry rigidly skinned to the Head bone.',
    '',
    '| Unit | Pose | Anatomy visual bounds | Core hit bounds | Core volumes | Outer max | Missing max | Skull visual | Head hit bounds | Head outer max |',
    '|---|---|---|---|---|---:|---:|---|---|---:|',
  )
  for (const row of report.units) {
    lines.push(`| ${row.type} | ${row.pose} | ${formatBounds(row.anatomy)} | ${formatBounds(row.hitBounds)} | ${row.volumes} | ${cm(row.outerCm, false)} | ${cm(row.missingCm, false)} | ${formatBounds(row.skull)} | ${formatBounds(row.headBounds)} | ${cm(row.headOuterCm, false)} |`)
  }
  return `${lines.join('\n')}\n`
}

function unitHitVolumes(spec, pose) {
  const configured = Array.isArray(spec.hitVolumes) ? spec.hitVolumes : spec.hitVolumes?.[pose] || spec.hitVolumes?.idle
  if (configured) return configured.map(part => normalizePrimitive(part, {x: 0, y: 0, z: 0}, 0))
  return [
    {id: 'body', part: 'body', shape: 'box', center: {x: 0, y: spec.height * 0.42, z: 0}, size: {x: spec.radius * 2, y: spec.height * 0.66, z: spec.radius * 2}},
    {id: 'head', part: 'head', shape: 'sphere', center: {x: 0, y: spec.height * 0.84, z: 0}, radius: spec.radius * 0.5},
  ]
}

function colliderPrimitives(collider) {
  if (!collider) return []
  if (Array.isArray(collider.shapes)) return collider.shapes.map(part => normalizePrimitive(part, collider.center, collider.yaw || 0))
  return [normalizePrimitive(collider, collider.center, collider.yaw || 0)]
}

function normalizePrimitive(part, base, baseYaw) {
  const offset = part.offset || (part.center && part.center !== base ? part.center : {x: 0, y: 0, z: 0})
  const cos = Math.cos(baseYaw), sin = Math.sin(baseYaw)
  return {
    ...part,
    shape: part.shape || 'box',
    center: part.offset ? {
      x: base.x + offset.x * cos + offset.z * sin,
      y: base.y + offset.y,
      z: base.z - offset.x * sin + offset.z * cos,
    } : {...part.center},
    yaw: baseYaw + (part.yaw || 0),
  }
}

function colliderBounds(collider) {
  return combinedPrimitiveBounds(colliderPrimitives(collider))
}

function combinedPrimitiveBounds(parts) {
  if (!parts.length) return null
  const result = {min: {x: Infinity, y: Infinity, z: Infinity}, max: {x: -Infinity, y: -Infinity, z: -Infinity}}
  for (const part of parts) {
    const item = primitiveBounds(part)
    for (const axis of ['x', 'y', 'z']) {
      result.min[axis] = Math.min(result.min[axis], item.min[axis])
      result.max[axis] = Math.max(result.max[axis], item.max[axis])
    }
  }
  return result
}

function primitiveBounds(part) {
  if (part.shape === 'sphere') {
    return boundsFromCenter(part.center, {x: part.radius * 2, y: part.radius * 2, z: part.radius * 2})
  }
  if (part.shape === 'cylinder') {
    const axis = part.axis || 'y'
    const size = {x: part.radius * 2, y: part.radius * 2, z: part.radius * 2}
    size[axis] = part.height
    return boundsFromCenter(part.center, size)
  }
  const yaw = part.yaw || 0
  const cos = Math.abs(Math.cos(yaw)), sin = Math.abs(Math.sin(yaw))
  return boundsFromCenter(part.center, {
    x: part.size.x * cos + part.size.z * sin,
    y: part.size.y,
    z: part.size.x * sin + part.size.z * cos,
  })
}

function boundsFromCenter(center, size) {
  return bounds(
    [center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2],
    [center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2],
  )
}

function skinnedBounds(E, rig, include) {
  const box = new E.Box3()
  const point = new E.Vector3()
  for (const part of rig.pickParts) {
    if (!include(part)) continue
    const values = part.triangles
    for (let index = 0; index < values.length; index += 3) {
      point.fromArray(values, index).applyMatrix4(part.bone.matrixWorld)
      box.expandByPoint(point)
    }
  }
  return bounds(box.min.toArray(), box.max.toArray())
}

function compareBounds(visual, collider) {
  if (!visual || !collider) return null
  return {
    minX: (visual.min.x - collider.min.x) * 100,
    maxX: (collider.max.x - visual.max.x) * 100,
    minY: (visual.min.y - collider.min.y) * 100,
    maxY: (collider.max.y - visual.max.y) * 100,
    minZ: (visual.min.z - collider.min.z) * 100,
    maxZ: (collider.max.z - visual.max.z) * 100,
  }
}

function bounds(min, max) {
  return {min: {x: min[0], y: min[1], z: min[2]}, max: {x: max[0], y: max[1], z: max[2]}}
}

function describeCollider(collider) {
  if (!collider) return 'none'
  return colliderPrimitives(collider).map(describePrimitive).join(' + ')
}

function describePrimitive(part) {
  const at = vector(part.center)
  if (part.shape === 'sphere') return `sphere r=${number(part.radius)} @${at}`
  if (part.shape === 'cylinder') return `cylinder-${part.axis || 'y'} r=${number(part.radius)} h=${number(part.height)} @${at}`
  return `box ${vector(part.size)} @${at}${part.yaw ? ` yaw=${number(part.yaw * 180 / Math.PI)}deg` : ''}`
}

function formatBounds(value) {
  return value ? `${vector(value.min)}..${vector(value.max)}` : 'none'
}

function vector(value) {
  return `(${number(value.x)},${number(value.y)},${number(value.z)})`
}

function number(value) {
  return Number(value).toFixed(3).replace(/\.000$/, '').replace(/(\.\d*?)0+$/, '$1')
}

function cm(value, convert = true) {
  if (!Number.isFinite(value)) return 'n/a'
  return `${(convert ? value * 100 : value).toFixed(1)}`
}

async function loadGeometry() {
  globalThis.ImageData ??= class {}
  globalThis.window ??= {}
  const noop = () => {}
  const gradient = {addColorStop: noop}
  const context = {
    fillRect: noop, fillText: noop, beginPath: noop, moveTo: noop, bezierCurveTo: noop, fill: noop,
    createRadialGradient: () => gradient, createLinearGradient: () => gradient,
    set fillStyle(value) {}, set textAlign(value) {}, set textBaseline(value) {}, set font(value) {},
    set globalCompositeOperation(value) {},
  }
  globalThis.document ??= {createElement: () => ({width: 0, height: 0, getContext: () => context})}
  const E = await import('threepipe')
  E.TextureLoader.prototype.load = function load(url, onLoad) {
    const texture = new E.Texture()
    queueMicrotask(() => onLoad?.(texture))
    return texture
  }
  E.RGBELoader.prototype.load = function load(url, onLoad) {
    const texture = new E.DataTexture()
    queueMicrotask(() => onLoad?.(texture))
    return texture
  }
  const [{createMapGroup}, {createUnitFigure}, {bindUnitRig, animateUnit}] = await Promise.all([
    import('../generators/map.geometry.js'),
    import('../generators/unit-template.generator.js'),
    import('../lib/view/units-animation.js'),
  ])
  return {E, createMapGroup, createUnitFigure, bindUnitRig, animateUnit}
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  const report = formatReport(await measureColliderFit())
  const outputIndex = process.argv.indexOf('--output')
  if (outputIndex >= 0) {
    const output = resolve(process.argv[outputIndex + 1])
    await mkdir(dirname(output), {recursive: true})
    await writeFile(output, report)
  }
  process.stdout.write(report)
}
