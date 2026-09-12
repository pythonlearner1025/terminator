#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises'

globalThis.ImageData ??= class {}
const {Object3D, PerspectiveCamera, Quaternion, Vector3} = await import('three')

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const placements = JSON.parse(await readFile(new URL('../lib/core/data/map-piece-placements.json', import.meta.url), 'utf8')).pieces
const overviewPosition = packageJson.kite3d.viewer.camera.position
const overviewTarget = packageJson.kite3d.viewer.camera.target
const scenePath = new URL('../assets/main.scene.gltf', import.meta.url)

let document
try {
  document = JSON.parse(await readFile(scenePath, 'utf8'))
} catch {
  document = null
}
if (!document || typeof document !== 'object' || Array.isArray(document)) {
  document = {asset: {version: '2.0'}, scene: 0, scenes: [{name: 'Main Scene', nodes: []}], nodes: []}
}
document.asset ??= {version: '2.0'}
document.asset.generator = 'Kite3D 0.18.0 plus tools/build-scene.mjs'
document.nodes ??= []
document.scenes ??= [{name: 'Main Scene', nodes: []}]
document.scene ??= 0
document.cameras = [{name: 'Saved Overview Camera', type: 'perspective', perspective: {aspectRatio: 1.6, yfov: Math.PI / 3, znear: 0.1, zfar: 220}}]
document.extensionsUsed = [...new Set([...(document.extensionsUsed || []), 'KHR_lights_punctual'])]
document.extensions = {
  ...(document.extensions || {}),
  KHR_lights_punctual: {
    lights: [
      {name: 'Cool Blue Key', type: 'directional', color: [0.42, 0.62, 1], intensity: 3.2},
      {name: 'Orange Fill', type: 'point', color: [1, 0.26, 0.06], intensity: 95, range: 24},
    ],
  },
}

const scene = document.scenes[document.scene] || document.scenes[0]
const rootIndices = []
const resetPlacements = process.env.RESET_MAP_PLACEMENTS === '1'
const preservePlacedMap = !resetPlacements && document.nodes.some(node => node.extras?.mapPiece?.nodeId)
const mapIndex = ensureNode({
  name: 'Map',
  uuid: 'terminator-node-map',
  authoring: {role: 'direct', id: 'terminator-map'},
  removeComponents: ['terminator-component-map-generator'],
})
const bunkerIndex = ensureNode({name: 'Bunker 7', uuid: 'terminator-node-bunker-7', authoring: {role: 'direct', id: 'terminator-bunker-7'}})
const categoryIndices = Object.fromEntries(['Walls', 'Floors', 'Props', 'Gates'].map(name => [name, ensureNode({
  name,
  uuid: `terminator-node-map-${name.toLowerCase()}`,
  authoring: {role: 'direct', id: `terminator-map-${name.toLowerCase()}`},
})]))

document.nodes[mapIndex].children = [bunkerIndex]
document.nodes[bunkerIndex].children = Object.values(categoryIndices)
for (const index of Object.values(categoryIndices)) document.nodes[index].children = []

for (const placement of placements) {
  const nodeId = placement.nodeId || `${placement.role}:${placement.id}`
  const existing = document.nodes.findIndex(node => node.extras?.mapPiece?.nodeId === nodeId)
  if (existing < 0 && preservePlacedMap) continue
  const index = existing >= 0 ? existing : ensureNode({name: placement.name})
  const node = document.nodes[index]
  node.name = placement.name
  if (existing < 0 || resetPlacements) {
    delete node.matrix
    node.translation = [...placement.translation]
    node.rotation = quaternionFromEuler(...placement.rotation)
    if (placement.scale) node.scale = [...placement.scale]
  }
  const extras = {...(node.extras || {})}
  const assetId = existing >= 0 && !resetPlacements
    ? assetIdFromRootPath(extras.rootPath) || extras.mapPiece?.assetId || placement.assetId
    : placement.assetId
  extras.gltfUUID ||= `terminator-map-piece-${stableId(nodeId)}`
  extras.kite3dAuthoring = {role: 'direct', id: `terminator-map-piece-${nodeId}`}
  extras.rootPath = `/kite3d/@${assetId}/f.gltf`
  extras.sProperties = ['visible', 'name', 'position', 'quaternion', 'scale']
  extras.mapPiece = {
    id: placement.id,
    nodeId,
    assetId,
    role: placement.role,
    ...(placement.navBlock !== undefined ? {navBlock: placement.navBlock} : {}),
    ...(placement.blocksSight !== undefined ? {blocksSight: placement.blocksSight} : {}),
    ...(placement.area ? {area: placement.area} : {}),
  }
  delete extras.kite3dImportedInstance
  delete extras.EntityComponentPlugin
  node.extras = extras
  node.children = []
  document.nodes[categoryIndices[placement.category] ?? categoryIndices.Props].children.push(index)
}

rootIndices.push(mapIndex)
for (const spec of authoredSpecs()) rootIndices.push(ensureNode(spec))
scene.nodes = [...new Set(rootIndices)]
pruneUnreachableNodes(document)

await writeFile(scenePath, `${JSON.stringify(document, null, 2)}\n`)
const placedCount = document.nodes.filter(node => node.extras?.mapPiece?.nodeId).length
console.log(`Wrote ${placedCount} placed map nodes and ${rootIndices.length - 1} other authored roots to ${scenePath.pathname}`)

function ensureNode(spec) {
  let index = spec.uuid ? document.nodes.findIndex(node => node.extras?.gltfUUID === spec.uuid) : -1
  if (index < 0 && spec.name) index = document.nodes.findIndex(node => node.name === spec.name || node.name === spec.previousName)
  if (index < 0) {
    document.nodes.push({name: spec.name || 'Node'})
    index = document.nodes.length - 1
  }
  const node = document.nodes[index]
  if (spec.name) node.name = spec.name
  if (spec.translation || spec.rotation) delete node.matrix
  if (spec.translation) node.translation = [...spec.translation]
  if (spec.rotation) node.rotation = [...spec.rotation]
  if (spec.camera !== undefined) node.camera = spec.camera
  if (spec.extension) node.extensions = {...(node.extensions || {}), ...spec.extension}
  const extras = {...(node.extras || {})}
  if (spec.uuid) extras.gltfUUID ||= spec.uuid
  if (spec.authoring) extras.kite3dAuthoring = {...(extras.kite3dAuthoring || {}), ...spec.authoring}
  if (spec.asset) {
    extras.rootPath = `/kite3d/@${spec.asset.id}/${spec.asset.file}`
    extras.rootPathOptions = {...(extras.rootPathOptions || {}), createUniqueNames: false}
    extras.sProperties = []
    extras.unitTemplateType = spec.asset.type
  }
  const components = {...(extras.EntityComponentPlugin || {})}
  for (const id of spec.removeComponents || []) delete components[id]
  for (const [id, component] of Object.entries(spec.components || {})) {
    const priorState = components[id]?.type === component.type ? components[id].state || {} : {}
    components[id] = {type: component.type, state: {...priorState, ...component.state}}
  }
  if (Object.keys(components).length) extras.EntityComponentPlugin = components
  else delete extras.EntityComponentPlugin
  node.extras = extras
  return index
}

function authoredSpecs() {
  return [
    {
      name: 'Game Manager',
      uuid: 'terminator-node-game-manager',
      authoring: {role: 'direct', id: 'terminator-game-manager'},
      components: {
        'terminator-component-game-manager': {type: 'GameManager', state: {seed: 2029, intermissionSeconds: 45}},
      },
    },
    unitAsset('T-600 Scout', 'scout', [47, 0, -5]),
    unitAsset('T-800 Endo', 'endo', [47, 0, 0]),
    unitAsset('T-800 Heavy', 'heavy', [47, 0, 5]),
    unitAsset('T-1000', 't1000', [52, 0, -5]),
    unitAsset('HK-Aerial', 'hkaerial', [52, 2, 0]),
    unitAsset('HK-Tank', 'hktank', [52, 0, 7]),
    {
      name: 'Unit Resistance Soldier',
      previousName: 'Soldier Template',
      uuid: 'terminator-node-soldier-template',
      translation: [47, 0, 9],
      authoring: {role: 'template', id: 'terminator-soldier-template'},
      asset: {id: 'unit-soldier', file: 'soldier.gltf', type: 'soldier'},
      removeComponents: ['terminator-component-soldier-generator'],
    },
    {
      name: 'Player Start',
      uuid: 'terminator-node-player-start',
      translation: [0, 0, 9],
      authoring: {role: 'direct', id: 'terminator-player-start'},
    },
    {
      name: 'Cool Blue Key',
      uuid: 'terminator-node-cool-key',
      rotation: quaternionFromEuler(-0.72, -0.55, 0),
      authoring: {role: 'direct', id: 'terminator-light-cool-key'},
      extension: {KHR_lights_punctual: {light: 0}},
    },
    {
      name: 'Orange Fill',
      uuid: 'terminator-node-orange-fill',
      translation: [-4, 4, 3],
      authoring: {role: 'direct', id: 'terminator-light-orange-fill'},
      extension: {KHR_lights_punctual: {light: 1}},
    },
    {
      name: 'Saved Overview Camera',
      uuid: 'terminator-node-saved-camera',
      translation: overviewPosition,
      rotation: lookQuaternion(overviewPosition, overviewTarget),
      camera: 0,
      authoring: {role: 'direct', id: 'terminator-saved-camera'},
    },
  ]
}

function unitAsset(label, type, translation) {
  return {
    name: `Unit ${label}`,
    previousName: `Unit Template ${label.replace(/^T-\d+ /, '')}`,
    uuid: `terminator-node-unit-template-${type}`,
    translation,
    authoring: {role: 'template', id: `terminator-unit-template-${type}`},
    asset: {id: `unit-${type}`, file: `${type}.gltf`, type},
    removeComponents: [`terminator-component-unit-generator-${type}`],
  }
}

function lookQuaternion(position, target) {
  const camera = new PerspectiveCamera()
  camera.position.fromArray(position)
  camera.lookAt(new Vector3().fromArray(target))
  return camera.quaternion.toArray()
}

function quaternionFromEuler(x, y, z) {
  const object = new Object3D()
  object.rotation.set(x, y, z)
  return new Quaternion().copy(object.quaternion).toArray()
}

function stableId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, '-')
}

function assetIdFromRootPath(value) {
  return typeof value === 'string' ? value.match(/^\/kite3d\/@([^/]+)\/f\.[^/]+$/)?.[1] : undefined
}

function pruneUnreachableNodes(gltf) {
  const reachable = new Set()
  const visit = index => {
    if (reachable.has(index)) return
    reachable.add(index)
    for (const child of gltf.nodes[index]?.children || []) visit(child)
  }
  for (const item of gltf.scenes || []) for (const index of item.nodes || []) visit(index)
  const ordered = [...reachable].sort((a, b) => a - b)
  const remap = new Map(ordered.map((oldIndex, newIndex) => [oldIndex, newIndex]))
  gltf.nodes = ordered.map(oldIndex => {
    const node = gltf.nodes[oldIndex]
    if (!node.children) return node
    return {...node, children: node.children.filter(index => reachable.has(index)).map(index => remap.get(index))}
  })
  for (const item of gltf.scenes || []) item.nodes = (item.nodes || []).filter(index => reachable.has(index)).map(index => remap.get(index))
}
