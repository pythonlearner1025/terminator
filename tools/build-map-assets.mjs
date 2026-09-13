#!/usr/bin/env node
import {Document, NodeIO, Accessor} from '@gltf-transform/core'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {dirname, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {applySelectedFloor} from './lib/selected-floor.mjs'
import {applySelectedProps} from './lib/selected-props.mjs'

globalThis.ImageData ??= class {}
const THREE = await import('three')
const {mergeGeometries} = await import('three/addons/utils/BufferGeometryUtils.js')

const root = fileURLToPath(new URL('../', import.meta.url))
const mapPath = resolve(root, 'lib/core/data/map.json')
const registryPath = resolve(root, 'lib/core/data/map-piece-registry.json')
const layoutPath = resolve(root, 'lib/core/data/map-piece-placements.json')
const manifestPath = resolve(root, 'assets.json')

async function main() {
  const map = JSON.parse(await readFile(mapPath, 'utf8'))
  let registry
  let placements
  try {
    registry = JSON.parse(await readFile(registryPath, 'utf8'))
    placements = JSON.parse(await readFile(layoutPath, 'utf8'))
  } catch {
    if (!Array.isArray(map.colliders)) throw new Error('Map-piece registry is missing and map.json has no migration colliders')
    ;({registry, placements} = migrateMap(map))
    await writeJson(registryPath, registry)
    await writeJson(layoutPath, placements)
  }

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = 1
  manifest.files ||= {}
  const generatedIds = new Set()
  let totalBytes = 0
  let filesWritten = 0

  for (const [assetId, spec] of Object.entries(registry.assets)) {
    const slug = assetId.replace(/^map-/, '')
    const directory = resolve(root, 'assets/models/map', slug)
    const gltfPath = resolve(directory, `${slug}.gltf`)
    const binPath = resolve(directory, `${slug}.bin`)
    await mkdir(directory, {recursive: true})
    const object = createPiece(spec)
    await writeGltf(object, gltfPath, binPath, assetId)
    const gltfBytes = (await readFile(gltfPath)).byteLength
    const binBytes = (await readFile(binPath)).byteLength
    totalBytes += gltfBytes + binBytes
    filesWritten += 2
    generatedIds.add(assetId)
    manifest.files[assetId] = {
      path: posix(relative(root, gltfPath)),
      files: {
        'f.gltf': posix(relative(root, gltfPath)),
        [`${slug}.bin`]: posix(relative(root, binPath)),
      },
    }
  }

  for (const id of Object.keys(manifest.files)) {
    if (!id.startsWith('map-') || generatedIds.has(id)) continue
    const slug = id.replace(/^map-/, '')
    await rm(resolve(root, 'assets/models/map', slug), {recursive: true, force: true})
    delete manifest.files[id]
  }
  await writeJson(manifestPath, manifest)
  await applySelectedFloor(root)
  await applySelectedProps(root)
  process.stdout.write(`${JSON.stringify({pieceTypes: Object.keys(registry.assets).length, instances: placements.pieces.length, filesWritten, totalBytes}, null, 2)}\n`)
}

function migrateMap(source) {
  const assets = {}
  const pieces = []
  const counters = new Map()
  const add = (record, role = 'collider', options = {}) => {
    const spec = pieceSpec(record, role, options)
    const assetId = assetIdFor(spec, record)
    assets[assetId] ||= spec
    const key = displayType(spec.kind, role)
    const number = (counters.get(key) || 0) + 1
    counters.set(key, number)
    pieces.push({
      id: options.id || record.id,
      nodeId: `${role}:${options.id || record.id}`,
      name: options.name || `${key} ${number}`,
      assetId,
      role,
      category: categoryFor(spec.kind, role),
      translation: vector(options.pos || record.center || record.pos),
      rotation: [0, options.yaw ?? record.yaw ?? 0, 0],
      ...(record.navBlock !== undefined ? {navBlock: record.navBlock} : {}),
      ...(record.blocksSight !== undefined ? {blocksSight: record.blocksSight} : {}),
      ...(record.area ? {area: record.area} : {}),
    })
  }

  for (const collider of source.colliders) add(collider)
  add(source.trader, 'trader', {name: 'Trader crate 1'})
  for (const door of source.doors) add({...door, center: door.pos, kind: 'door'}, 'door', {name: `Door ${door.id}`})
  for (const gate of source.spawnGates) add({
    ...gate,
    center: gate.pos,
    kind: 'gate',
    size: {x: gate.width || 4, y: gate.height || 3, z: .24},
  }, 'gate', {name: `Gate ${gate.id}`})
  for (const slot of source.hazardSlots) add({...slot, center: slot.pos, kind: 'hazard'}, 'hazard', {name: `Hazard fixture ${slot.id}`})
  add({...source.flankWall, center: source.flankWall.pos, kind: 'flank'}, 'flank', {name: 'Breakable flank wall'})
  for (const fixture of source.environment?.fixtures || []) add({
    ...fixture,
    id: fixture.id,
    center: fixture.pos,
    kind: 'fixture',
    size: {x: fixture.style === 'tube' ? 1.7 : .5, y: .28, z: .28},
  }, 'fixture', {name: `Light fixture ${fixture.id}`})
  for (const x of [-38.66, -31.34]) for (const y of [-.78, -1.02]) add({
    id: `service-pipe-${x}-${y}`,
    kind: 'pipe',
    center: {x, y, z: 0},
    size: {x: .26, y: .26, z: 30.4},
  }, 'decoration')
  for (const x of [-7.75, 7.75]) add({
    id: `balcony-cable-${x}`,
    kind: 'cable',
    center: {x, y: 5.25, z: 16.73},
    size: {x: 8, y: .75, z: .06},
  }, 'decoration')
  return {
    registry: {version: 1, assets},
    placements: {version: 1, pieces},
  }
}

function pieceSpec(record, role, options) {
  const center = record.center || record.pos || {x: 0, y: 0, z: 0}
  const shapes = (record.shapes || []).map(part => ({...part, offset: {...(part.offset || {x: 0, y: 0, z: 0})}}))
  return {
    kind: record.kind || role,
    size: {...(record.size || {x: 1, y: 1, z: 1})},
    ...(shapes.length ? {shapes} : {}),
    ...(record.id ? {sourceId: record.id} : {}),
    ...(record.style ? {style: record.style} : {}),
    ...(record.color ? {color: record.color} : {}),
    ...(record.power !== undefined ? {power: record.power} : {}),
    ...(record.range !== undefined ? {range: record.range} : {}),
    collider: ['collider', 'trader'].includes(role) ? {
      kind: record.kind || role,
      shape: record.shape || 'box',
      size: {...(record.size || {x: 1, y: 1, z: 1})},
      ...(shapes.length ? {shapes} : {}),
    } : null,
    anchor: vector(center),
  }
}

function assetIdFor(spec, record) {
  if (spec.kind === 'rubble' && ['rubble_nw', 'rubble_se'].includes(record.id)) return `map-${record.id.replaceAll('_', '-')}`
  if (spec.kind === 'container') return `map-${record.id.replaceAll('_', '-')}`
  if (spec.kind === 'gate') return `map-gate-${number(spec.size.x)}x${number(spec.size.y)}`
  if (spec.kind === 'fixture') return `map-light-fixture-${spec.style}`
  const shapeKey = spec.shapes?.length ? `-${shortHash(JSON.stringify(spec.shapes))}` : ''
  return `map-${slug(spec.kind)}-${number(spec.size.x)}x${number(spec.size.y)}x${number(spec.size.z)}${shapeKey}`
}

function createPiece(spec) {
  const root = new THREE.Group()
  root.name = `${displayType(spec.kind)} asset`
  root.userData.mapPieceAsset = true
  const size = vector(spec.size)
  const box = (name, extent = size, position = [0, 0, 0], material = materialFor(spec)) => addMesh(root, name, new THREE.BoxGeometry(...extent), position, material)
  const cylinder = (name, radius, height, position = [0, 0, 0], material = materialFor(spec), axis = 'y') => {
    const rotation = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0]
    return addMesh(root, name, new THREE.CylinderGeometry(radius, radius, height, 16), position, material, rotation)
  }
  const localShapes = () => {
    if (!spec.shapes?.length) return false
    for (const part of spec.shapes) {
      const offset = vector(part.offset || {x: 0, y: 0, z: 0})
      if (part.shape === 'cylinder') cylinder(part.id || 'Collider cylinder', part.radius, part.height, offset, materialFor(spec), part.axis)
      else if (part.shape === 'sphere') addMesh(root, part.id || 'Collider sphere', new THREE.SphereGeometry(part.radius, 14, 9), offset, materialFor(spec))
      else box(part.id || 'Collider box', vector(part.size), offset)
    }
    return true
  }

  switch (spec.kind) {
    case 'floor':
      if (!localShapes()) box('Floor slab')
      break
    case 'wall':
    case 'building_wall':
    case 'tunnel_wall': {
      box(spec.kind === 'wall' ? 'Wall shell' : 'Bunker shell')
      const alongX = spec.size.x >= spec.size.z
      const length = alongX ? spec.size.x : spec.size.z
      for (let at = -length / 2 + 1.6; at < length / 2 - .6; at += 3.4) {
        const extent = alongX ? [.16, spec.size.y * .96, spec.size.z] : [spec.size.x, spec.size.y * .96, .16]
        const position = alongX ? [at, 0, 0] : [0, 0, at]
        addMesh(root, 'Structural rib', new THREE.BoxGeometry(...extent), position, 'rust')
      }
      break
    }
    case 'stair':
      box('Stair tread')
      break
    case 'ramp': {
      const geometry = new THREE.BoxGeometry(...size, 8, 1, 8)
      const position = geometry.attributes.position
      for (let index = 0; index < position.count; index += 1) {
        if (position.getY(index) > 0) position.setY(index, -spec.size.y / 2 + ((position.getX(index) / spec.size.x) + .5) * spec.size.y)
      }
      geometry.computeVertexNormals()
      addMesh(root, 'Dock ramp', geometry, [0, 0, 0], 'steel')
      break
    }
    case 'rubble': {
      box('Rubble bank foundation', [spec.size.x, spec.size.y * .42, spec.size.z], [0, -spec.size.y * .29, 0], 'concrete')
      const rand = randomSource(hashNumber(spec.sourceId || 'rubble'))
      for (let index = 0; index < 14; index += 1) {
        const sx = spec.size.x * (.07 + rand() * .13)
        const sy = spec.size.y * (.18 + rand() * .35)
        const sz = spec.size.z * (.13 + rand() * .25)
        const x = (rand() - .5) * Math.max(0, spec.size.x - sx * 1.2)
        const z = (rand() - .5) * Math.max(0, spec.size.z - sz * 1.2)
        const y = -spec.size.y / 2 + spec.size.y * .4 + sy / 2
        const geometry = new THREE.DodecahedronGeometry(1, 0).scale(sx * .6, sy * .598, sz * .6)
        addMesh(root, 'Broken rubble slab', geometry, [x, Math.min(y, spec.size.y / 2 - sy * .598), z], index % 4 ? 'concrete' : 'rust')
      }
      break
    }
    case 'truck':
      localShapes()
      break
    case 'barrel':
      cylinder('Burn barrel drum', .395, 1.262, [0, .011, 0], 'rust')
      for (const y of [-.5, -.16, .32, .59]) cylinder('Barrel steel hoop', .395, .05, [0, y, 0], 'steel')
      break
    case 'container': {
      box('Container shell', size, [0, 0, 0], spec.sourceId?.includes('red') ? 'red' : spec.sourceId?.includes('blue') ? 'blue' : 'steel')
      for (const x of [-spec.size.x / 2 + .06, spec.size.x / 2 - .06]) {
        for (const y of [-spec.size.y / 2 + .07, spec.size.y / 2 - .07]) addMesh(root, 'Container reinforced edge', new THREE.BoxGeometry(.12, .12, spec.size.z), [x, y, 0], 'rust')
      }
      break
    }
    case 'column':
      box('Reinforced column', size, [0, 0, 0], 'concrete')
      for (const y of [-spec.size.y / 2 + .12, spec.size.y / 2 - .12]) addMesh(root, 'Column steel collar', new THREE.BoxGeometry(spec.size.x, .23, spec.size.z), [0, y, 0], 'steel')
      break
    case 'supply':
      for (const x of [-.665, .665]) {
        addMesh(root, 'Sealed supply chest', new THREE.BoxGeometry(1.27, spec.size.y - .04, spec.size.z - .04), [x, 0, 0], 'olive')
        for (const dx of [-.46, .46]) addMesh(root, 'Supply chest strap', new THREE.BoxGeometry(.07, spec.size.y, spec.size.z), [x + dx, 0, 0], 'steel')
      }
      break
    case 'sandbags':
      for (let row = 0; row < 4; row += 1) for (let index = 0; index < 4; index += 1) {
        const x = -spec.size.x / 2 + spec.size.x / 8 + index * spec.size.x / 4
        const y = -spec.size.y / 2 + spec.size.y / 8 + row * spec.size.y / 4
        addMesh(root, 'Stitched sandbag', roundedBox([spec.size.x / 4, spec.size.y / 4, spec.size.z]), [x, y, 0], 'canvas')
      }
      break
    case 'generator':
      box('Generator skid', [spec.size.x, .18, spec.size.z], [0, -spec.size.y / 2 + .09, 0], 'steel')
      box('Generator enclosure', [spec.size.x - .1, spec.size.y - .24, spec.size.z - .18], [0, .03, 0], 'olive')
      box('Generator hood', [spec.size.x, .16, spec.size.z - .06], [0, spec.size.y / 2 - .08, 0], 'steel')
      break
    case 'spool':
      if (!localShapes()) cylinder('Cable spool', spec.size.x / 2, spec.size.y, [0, 0, 0], 'rust')
      for (let index = 0; index < 10; index += 1) addMesh(root, 'Wound cable', new THREE.TorusGeometry(.397, .018, 4, 20), [0, -.4 + index * .087, 0], 'rubber', [Math.PI / 2, 0, 0])
      break
    case 'bunk':
      box('Field bed frame', size, [0, 0, 0], 'steel')
      addMesh(root, 'Canvas mattress', roundedBox([spec.size.x - .06, .24, spec.size.z - .06]), [0, spec.size.y / 2 - .12, 0], 'canvas')
      break
    case 'trader':
      box('Trader armored crate', size, [0, 0, 0], 'olive')
      addMesh(root, 'Trader sliding lid', new THREE.BoxGeometry(spec.size.x, .2, spec.size.z), [0, spec.size.y / 2 - .1, 0], 'steel')
      break
    case 'door': {
      const alongX = spec.size.x >= spec.size.z
      const width = alongX ? spec.size.x : spec.size.z
      const depth = alongX ? spec.size.z : spec.size.x
      const shutter = new THREE.Group(); shutter.name = 'Door shutter'; root.add(shutter)
      addMesh(shutter, 'Armored door leaf', new THREE.BoxGeometry(width - .1, spec.size.y - .06, depth), [0, 0, 0], 'steel')
      for (let y = -spec.size.y / 2 + .25; y < spec.size.y / 2; y += .32) addMesh(shutter, 'Door lamella', new THREE.BoxGeometry(width - .08, .06, depth), [0, y, 0], 'rust')
      const signal = addMesh(shutter, 'Door lock indicator', new THREE.BoxGeometry(.13, .13, depth), [width * .34, spec.size.y * .3, 0], 'redGlow')
      signal.userData.mapDynamic = 'door-signal'
      if (!alongX) root.rotation.y = Math.PI / 2
      break
    }
    case 'gate': {
      const shutter = new THREE.Group(); shutter.name = 'Gate shutter'; shutter.position.set(0, spec.size.y / 2, -2.04); root.add(shutter)
      addMesh(shutter, 'Gate sealed plating', new THREE.BoxGeometry(spec.size.x - .05, spec.size.y, .08), [0, 0, 0], 'steel')
      for (let x = -spec.size.x / 2 + .3; x < spec.size.x / 2; x += .48) addMesh(shutter, 'Gate armor rib', new THREE.BoxGeometry(.1, spec.size.y, .08), [x, 0, .06], 'rust')
      const signal = addMesh(root, 'Gate warning strip', new THREE.BoxGeometry(spec.size.x - .25, .13, .04), [0, spec.size.y - .25, -1.91], 'redGlow')
      signal.userData.mapDynamic = 'gate-signal'
      break
    }
    case 'hazard':
      box('Hazard recessed grate', [spec.size.x, .04, spec.size.z], [0, 0, 0], 'steel')
      for (let x = -spec.size.x / 2 + .2; x < spec.size.x / 2; x += .35) addMesh(root, 'Hazard grille', new THREE.BoxGeometry(.035, .04, spec.size.z - .12), [x, .02, 0], 'rust')
      break
    case 'flank':
      for (let row = 0; row < 4; row += 1) for (let column = 0; column < 6; column += 1) {
        const sx = spec.size.x / 6, sy = spec.size.y / 4
        addMesh(root, 'Fractured flank block', new THREE.BoxGeometry(sx - .025, sy - .025, spec.size.z), [-spec.size.x / 2 + sx * (column + .5), -spec.size.y / 2 + sy * (row + .5), 0], 'concrete')
      }
      break
    case 'fixture': {
      box('Protective light housing', size, [0, .055, 0], 'steel')
      if (spec.style === 'tube') for (const z of [-.065, .065]) cylinder('Fluorescent tube', .024, 1.5, [0, -.035, z], 'whiteGlow', 'x')
      else box('Practical light lens', [.38, .035, .2], [0, -.009, 0], spec.style === 'emergency' ? 'redGlow' : 'whiteGlow')
      break
    }
    case 'pipe':
      cylinder('Corroded service pipe', spec.size.x / 2, spec.size.z, [0, 0, 0], 'rust', 'z')
      for (let z = -spec.size.z / 2 + 2; z < spec.size.z / 2; z += 4) cylinder('Service pipe coupling', spec.size.x * .64, .13, [0, 0, z], 'steel', 'z')
      break
    case 'cable': {
      const points = []
      for (let index = 0; index <= 18; index += 1) points.push(new THREE.Vector3(-4 + index * 8 / 18, -Math.sin(index / 18 * Math.PI) * .7, 0))
      addMesh(root, 'Sagging electrical cable', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, .025, 5, false), [0, 0, 0], 'rubber')
      break
    }
    default:
      box(`${displayType(spec.kind)} shell`)
  }
  if (!['door', 'gate', 'trader', 'flank'].includes(spec.kind)) mergePieceMeshes(root, spec.kind)
  return root
}

function mergePieceMeshes(root, kind) {
  root.updateMatrixWorld(true)
  const groups = new Map()
  root.traverse(object => {
    if (!object.isMesh || !object.geometry) return
    const material = object.userData.material || 'concrete'
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()
    geometry.applyMatrix4(object.matrixWorld)
    const entries = groups.get(material) || []
    entries.push(geometry)
    groups.set(material, entries)
  })
  root.clear()
  for (const [material, geometries] of groups) {
    const geometry = mergeGeometries(geometries, false)
    for (const item of geometries) item.dispose()
    if (!geometry) throw new Error(`Could not merge ${kind} ${material} geometry`)
    addMesh(root, `${displayType(kind)} ${material}`, geometry, [0, 0, 0], material)
  }
}

async function writeGltf(object, gltfPath, binPath, assetId) {
  const document = new Document()
  const buffer = document.createBuffer('Map piece geometry').setURI(binPath.split('/').pop())
  const materialCache = new Map()
  const textureCache = new Map()
  const scene = document.createScene(displayType(assetId.replace(/^map-/, '')))
  scene.addChild(exportNode(object))
  await new NodeIO().write(gltfPath, document)
  const json = JSON.parse(await readFile(gltfPath, 'utf8'))
  for (const image of json.images || []) {
    image.uri = `/kite3d/assets/textures/map/${image.name}`
    delete image.bufferView
  }
  json.asset.generator = 'Terminator tools/build-map-assets.mjs with glTF-Transform 4.5.0 and three.js'
  await writeFile(gltfPath, `${JSON.stringify(json, null, 2)}\n`)

  function exportNode(source) {
    const node = document.createNode(source.name || 'Map piece')
    node.setTranslation(source.position.toArray())
    node.setRotation(source.quaternion.toArray())
    node.setScale(source.scale.toArray())
    if (Object.keys(source.userData).length) node.setExtras({...source.userData})
    if (source.isMesh) {
      const geometry = source.geometry
      const primitive = document.createPrimitive()
      for (const [name, semantic, type] of [['position', 'POSITION', Accessor.Type.VEC3], ['normal', 'NORMAL', Accessor.Type.VEC3], ['uv', 'TEXCOORD_0', Accessor.Type.VEC2]]) {
        const attribute = geometry.getAttribute(name)
        if (!attribute) continue
        primitive.setAttribute(semantic, document.createAccessor(`${source.name} ${semantic}`, buffer).setType(type).setArray(new Float32Array(attribute.array)))
      }
      if (geometry.index) {
        const values = geometry.index.array
        const IndexArray = values.length > 65535 ? Uint32Array : Uint16Array
        primitive.setIndices(document.createAccessor(`${source.name} indices`, buffer).setType(Accessor.Type.SCALAR).setArray(new IndexArray(values)))
      }
      primitive.setMaterial(getMaterial(source.userData.material || 'concrete'))
      node.setMesh(document.createMesh(source.name || 'Map mesh').addPrimitive(primitive))
    }
    for (const child of source.children) node.addChild(exportNode(child))
    return node
  }

  function getMaterial(key) {
    if (materialCache.has(key)) return materialCache.get(key)
    const spec = MATERIALS[key] || MATERIALS.concrete
    const material = document.createMaterial(`Map ${key}`)
      .setBaseColorFactor([...spec.color, 1])
      .setRoughnessFactor(spec.roughness)
      .setMetallicFactor(spec.metallic)
    if (spec.textures) {
      const albedo = texture(`${spec.textures}_albedo`, spec.source)
      const normal = texture(`${spec.textures}_normal`, spec.source)
      const arm = texture(`${spec.textures}_arm`, spec.source)
      material.setBaseColorTexture(albedo).setNormalTexture(normal).setMetallicRoughnessTexture(arm).setOcclusionTexture(arm)
    }
    if (spec.emissive) material.setEmissiveFactor(spec.emissive)
    materialCache.set(key, material)
    return material
  }

  function texture(stem, source = false) {
    const file = source ? SOURCE_TEXTURES[stem] : `${stem}.jpg`
    if (!textureCache.has(file)) textureCache.set(file, document.createTexture(file).setURI(file))
    return textureCache.get(file)
  }
}

const SOURCE_TEXTURES = {
  concrete_albedo: 'concrete_wall_007_diff_1k.jpg', concrete_normal: 'concrete_wall_007_nor_gl_1k.jpg', concrete_arm: 'concrete_wall_007_arm_1k.jpg',
  asphalt_albedo: 'asphalt_02_diff_1k.jpg', asphalt_normal: 'asphalt_02_nor_gl_1k.jpg', asphalt_arm: 'asphalt_02_arm_1k.jpg',
  rust_albedo: 'rusty_metal_02_diff_1k.jpg', rust_normal: 'rusty_metal_02_nor_gl_1k.jpg', rust_arm: 'rusty_metal_02_arm_1k.jpg',
}

const MATERIALS = {
  concrete: {color: [.56, .59, .59], roughness: .9, metallic: 0, textures: 'concrete', source: true},
  ground: {color: [.32, .38, .43], roughness: .94, metallic: 0, textures: 'asphalt', source: true},
  serviceFloor: {color: [.26, .32, .28], roughness: .86, metallic: 0, textures: 'concrete', source: true},
  steel: {color: [.44, .49, .51], roughness: .68, metallic: .82, textures: 'paint'},
  rust: {color: [.48, .30, .18], roughness: .92, metallic: .42, textures: 'rust', source: true},
  red: {color: [.56, .19, .14], roughness: .82, metallic: .72, textures: 'corrugated'},
  blue: {color: [.20, .39, .48], roughness: .82, metallic: .72, textures: 'corrugated'},
  canvas: {color: [.56, .52, .34], roughness: 1, metallic: 0, textures: 'canvas'},
  olive: {color: [.29, .39, .27], roughness: .84, metallic: .55, textures: 'paint'},
  rubber: {color: [.025, .035, .045], roughness: 1, metallic: 0, textures: 'asphalt', source: true},
  redGlow: {color: [.45, .02, .01], roughness: .65, metallic: 0, textures: 'glass', emissive: [1, .015, .005]},
  whiteGlow: {color: [.55, .75, .82], roughness: .5, metallic: 0, textures: 'glass', emissive: [.35, .7, .9]},
}

function materialFor(spec) {
  if (spec.kind === 'floor') return spec.sourceId === 'ground' ? 'ground' : spec.sourceId === 'exp_service_floor' ? 'serviceFloor' : 'concrete'
  if (['stair', 'ramp'].includes(spec.kind)) return 'steel'
  return 'concrete'
}

function addMesh(parent, name, geometry, position, material, rotation = [0, 0, 0]) {
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry)
  mesh.name = name
  mesh.position.fromArray(position)
  mesh.rotation.fromArray(rotation)
  mesh.userData.material = material
  parent.add(mesh)
  return mesh
}

function roundedBox(size) {
  const geometry = new THREE.BoxGeometry(...size, 2, 2, 2)
  const position = geometry.attributes.position
  const radius = Math.min(.035, Math.min(...size) * .08)
  for (let index = 0; index < position.count; index += 1) {
    const point = [position.getX(index), position.getY(index), position.getZ(index)]
    const inset = point.map((value, axis) => Math.max(-size[axis] / 2 + radius, Math.min(size[axis] / 2 - radius, value)))
    const delta = point.map((value, axis) => value - inset[axis])
    const length = Math.hypot(...delta) || 1
    position.setXYZ(index, ...inset.map((value, axis) => value + delta[axis] / length * radius))
  }
  geometry.computeVertexNormals()
  return geometry
}

function categoryFor(kind, role) {
  if (['gate', 'door', 'hazard', 'flank'].includes(role)) return 'Gates'
  if (['floor', 'stair', 'ramp'].includes(kind)) return 'Floors'
  if (['wall', 'building_wall', 'tunnel_wall'].includes(kind)) return 'Walls'
  return 'Props'
}

function displayType(kind, role = '') {
  const names = {
    wall: 'Wall segment', building_wall: 'Bunker shell', tunnel_wall: 'Tunnel wall', floor: 'Floor slab',
    stair: 'Stair tread', ramp: 'Ramp slab', rubble: 'Rubble bank', truck: 'Wrecked truck', barrel: 'Barrel',
    container: 'Container', column: 'Column', supply: 'Supply chests', sandbags: 'Sandbag stack', generator: 'Generator',
    spool: 'Cable spool', bunk: 'Field bed', trader: 'Trader crate', door: 'Door', gate: 'Gate', hazard: 'Hazard fixture',
    flank: 'Flank wall', fixture: 'Light fixture', pipe: 'Service pipe', cable: 'Electrical cable',
  }
  return names[kind] || names[role] || kind.split(/[-_]/).map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ')
}

function vector(value) {
  if (Array.isArray(value)) return value.map(Number)
  return [Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0]
}

function number(value) {
  return String(Number(Number(value).toFixed(3))).replace('-', 'n').replace('.', 'p')
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function shortHash(value) {
  return hashNumber(value).toString(36)
}

function hashNumber(value) {
  let hash = 2166136261
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return hash >>> 0
}

function randomSource(seed) {
  return () => {
    seed = Math.imul(seed ^ seed >>> 15, 1 | seed)
    seed ^= seed + Math.imul(seed ^ seed >>> 7, 61 | seed)
    return ((seed ^ seed >>> 14) >>> 0) / 4294967296
  }
}

function posix(path) {
  return path.split('\\').join('/')
}

async function writeJson(path, value) {
  await mkdir(dirname(path), {recursive: true})
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

await main()
