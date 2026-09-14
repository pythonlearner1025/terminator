#!/usr/bin/env node
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {NodeIO} from '@gltf-transform/core'

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
  t1000: [
    ['idle', {vel: {x: 0, y: 0, z: 0}, intent: {}}],
    ['aim', {vel: {x: 0, y: 0, z: 0}, intent: {aimAt: {x: 0, y: 1.6, z: 8}, fire: true}}],
  ],
  hkaerial: [
    ['idle', {vel: {x: 0, y: 0, z: 0}, intent: {}}],
    ['aim', {vel: {x: 0, y: 0, z: 0}, intent: {aimAt: {x: 0, y: 1.6, z: 8}, fire: true}}],
  ],
  hktank: [
    ['idle', {vel: {x: 0, y: 0, z: 0}, intent: {}}],
    ['aim', {vel: {x: 0, y: 0, z: 0}, intent: {aimAt: {x: 0, y: 1.6, z: 8}, fire: true}}],
  ],
}

export async function measureColliderFit() {
  const {defaultMap: map} = await import('../lib/core/map.js')
  const placements = JSON.parse(await readFile(new URL('lib/core/data/map-piece-placements.json', root), 'utf8')).pieces
  const units = JSON.parse(await readFile(new URL('lib/core/data/units.json', root), 'utf8'))
  const {E, createUnitPlaceholder, bindUnitRig, animateUnit} = await loadGeometry()
  const visualById = await placedVisualBounds(E, placements)

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
      const object = createUnitPlaceholder(E, type)
      const rig = bindUnitRig(object)
      const state = {id: `fit-${type}`, type, pos: {x: 0, y: 0, z: 0}, yaw: 0, alive: true, spinUp: 1, spawnedAt: 0, ...statePatch}
      for (let frame = 0; frame < 90; frame += 1) {
        object.position.set(state.pos.x, state.pos.y, state.pos.z)
        object.rotation.y = state.yaw
        animateUnit(rig, state, 1 / 60, frame / 60)
      }
      object.updateMatrixWorld(true)
      const vehicleVisual = object.getObjectByName(type === 'hkaerial' ? 'HK-Aerial Placeholder Visual' : 'HK-Tank Placeholder Visual')
      const anatomy = vehicleVisual
        ? objectBounds(E, vehicleVisual)
        : skinnedBounds(E, rig, part => !['Weapon', 'Barrels', 'Muzzle', 'Blade Left', 'Blade Right'].includes(part.bone.name))
      const skull = vehicleVisual || spec.flying || spec.boss ? null : skinnedBounds(E, rig, part => part.bone.name === 'Head')
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
        headOuterCm: headBounds && skull ? Math.max(0, ...Object.values(compareBounds(skull, headBounds))) : 0,
      })
    }
  }
  return {props, units: unitRows}
}

export async function measureRosterParts() {
  const units=JSON.parse(await readFile(new URL('lib/core/data/units.json',root),'utf8'))
  const {E,createUnitPlaceholder,bindUnitRig}=await loadGeometry(),rows=[]
  for(const type of ['t1000','hkaerial','hktank']){
    const object=createUnitPlaceholder(E,type),rig=bindUnitRig(object)
    object.updateMatrixWorld(true)
    const spec=units.types[type],volumes=unitHitVolumes(spec,'idle')
    const aliases={pelvis:['Pelvis'],spine:['Spine'],chest:['Chest','Shoulder Left','Shoulder Right','Neck'],
      head:['Head'], 'arm-left':['Upper Arm Left','Forearm Left','Hand Left','Palm Left'],
      'arm-right':['Upper Arm Right','Forearm Right','Hand Right','Palm Right'],
      'leg-left':['Thigh Left','Shin Left','Foot Left'],'leg-right':['Thigh Right','Shin Right','Foot Right']}
    const groups=new Map()
    for(const volume of volumes){const key=type==='t1000'?volume.id:volume.part;(groups.get(key)||groups.set(key,[]).get(key)).push(volume)}
    for(const [name,shapes] of groups){
      const names=aliases[name]||[name],set=new Set()
      for(const bone of rig.mesh.skeleton.bones)if(names.includes(bone.name)||name==='Cannon'&&bone.name.startsWith('Cannon '))set.add(bone.name)
      const visual=skinnedBounds(E,rig,part=>set.has(part.bone.name)),hit=combinedPrimitiveBounds(shapes)
      const delta=compareBounds(visual,hit)
      rows.push({type,part:name,visual,hit,sideCm:delta,maxErrorCm:Math.max(...Object.values(delta).map(Math.abs))})
    }
  }
  return rows
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

function objectBounds(E, object) {
  const box = new E.Box3().setFromObject(object)
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
  const [{loadUnitAsset}, {clonePlacedUnitFigure}, {bindUnitRig, animateUnit}] = await Promise.all([
    import('./load-unit-asset.mjs'),
    import('../lib/view/unit-assets.js'),
    import('../lib/view/units-animation.js'),
  ])
  const unitSources = new Map(await Promise.all(
    Object.keys(POSES).map(async type => [type, await loadUnitAsset(type)]),
  ))
  const createUnitPlaceholder = (_engine, type, {detail = 1} = {}) =>
    clonePlacedUnitFigure(unitSources.get(type), type, detail ? 'high' : 'far')
  return {E, createUnitPlaceholder, bindUnitRig, animateUnit}
}

async function placedVisualBounds(E, placements) {
  const manifest = JSON.parse(await readFile(new URL('assets.json', root), 'utf8'))
  const cache = new Map()
  const result = new Map()
  for (const placement of placements.filter(item => ['collider', 'trader'].includes(item.role))) {
    let document = cache.get(placement.assetId)
    if (!document) {
      const entry = manifest.files[placement.assetId]
      if (!entry) throw new Error(`Missing asset manifest entry ${placement.assetId}`)
      document = await loadVisualGeometry(entry.path)
      cache.set(placement.assetId, document)
    }
    const matrix = new E.Matrix4()
    const position = new E.Vector3().fromArray(placement.translation)
    const rotation = new E.Euler().fromArray(placement.rotation || [0, 0, 0])
    const quaternion = new E.Quaternion().setFromEuler(rotation)
    const scale = new E.Vector3().fromArray(placement.scale || [1, 1, 1])
    matrix.compose(position, quaternion, scale)
    result.set(placement.id, measureVisualBounds(E, document, matrix))
  }
  return result
}

async function loadVisualGeometry(path) {
  const source = JSON.parse(await readFile(new URL(path, root), 'utf8')), resources = {}
  for (const buffer of source.buffers || []) {
    const uri = buffer.uri.startsWith('/kite3d/') ? new URL(buffer.uri.slice(8), root) : new URL(buffer.uri, new URL(path, root))
    resources[buffer.uri] = new Uint8Array(await readFile(uri))
  }
  // Measurement is CPU geometry only: preserve nodes and accessors, omit textures.
  delete source.extensions; delete source.extensionsUsed; delete source.extensionsRequired
  delete source.images; delete source.textures; delete source.materials
  for (const mesh of source.meshes || []) for (const primitive of mesh.primitives) delete primitive.material
  return new NodeIO().readJSON({json:source, resources})
}

export function measureVisualBounds(E, document, placementMatrix = new E.Matrix4()) {
  const box = new E.Box3(), point = new E.Vector3()
  const scene = document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0]
  const walk = node => {
    const world = placementMatrix.clone().multiply(new E.Matrix4().fromArray(node.getWorldMatrix()))
    for (const primitive of node.getMesh()?.listPrimitives() || []) {
      const positions = primitive.getAttribute('POSITION')?.getArray()
      if (!positions) throw new Error(`Missing POSITION geometry on ${node.getName()}`)
      // Transform actual vertices through the complete chain before taking bounds.
      // Rotated accessor/aggregate AABB corners can describe empty space.
      for (let i = 0; i < positions.length; i += 3) box.expandByPoint(point.fromArray(positions, i).applyMatrix4(world))
    }
    for (const child of node.listChildren()) walk(child)
  }
  for (const node of scene?.listChildren() || []) walk(node)
  if (box.isEmpty()) throw new Error('No visual POSITION geometry in default scene')
  return bounds(box.min.toArray(), box.max.toArray())
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
