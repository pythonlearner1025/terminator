#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises'

globalThis.ImageData ??= class {}
const {Object3D, PerspectiveCamera, Quaternion, Vector3} = await import('three')

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const overviewPosition = packageJson.kite3d.viewer.camera.position
const overviewTarget = packageJson.kite3d.viewer.camera.target
const scenePath = new URL('../assets/main.scene.gltf', import.meta.url)
const specs = [
  {
    name: 'Game Manager',
    uuid: 'terminator-node-game-manager',
    authoring: {role: 'direct', id: 'terminator-game-manager'},
    components: {
      'terminator-component-game-manager': {type: 'GameManager', state: {seed: 2029, intermissionSeconds: 45}},
    },
  },
  {
    name: 'Map',
    uuid: 'terminator-node-map',
    authoring: {role: 'generator', id: 'terminator-map'},
    components: {
      'terminator-component-map-generator': {type: 'Generator', state: {module: 'generators/map.generator.js', params: {markers: true, detail: process.env.MAP_DETAIL || 'full'}}},
    },
  },
  {
    name: 'Weapons Range', uuid: 'terminator-node-range',
    authoring: {role: 'generator', id: 'terminator-range'},
    components: {'terminator-component-range': {type: 'Generator', state: {module: 'generators/range.generator.js', params: {}}}},
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
  ...[
    ['Service Loop', 'service-loop', [-35, -3.5, 0]],
    ['Barracks Block C', 'barracks-c', [36, 0, 14]],
    ['Covered Yard Link', 'covered-link', [22, 0, 13]],
  ].map(([name,id,translation])=>({name,uuid:`terminator-node-${id}`,translation,authoring:{role:'direct',id:`terminator-${id}`}})),
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

let document
try {
  document = JSON.parse(await readFile(scenePath, 'utf8'))
} catch {
  document = null
}
if (!document || typeof document !== 'object' || Array.isArray(document)) {
  document = {asset: {version: '2.0', generator: 'Kite3D 0.15.0'}, scene: 0, scenes: [{name: 'Main Scene', nodes: []}], nodes: []}
}
document.asset ??= {version: '2.0', generator: 'Kite3D 0.15.0'}
document.asset.generator = 'Kite3D 0.15.0 plus tools/build-scene.mjs'
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
scene.nodes ??= []
const childIndices = new Set(document.nodes.flatMap((node) => node.children || []))

for (const spec of specs) {
  let index = document.nodes.findIndex((node) => node.name === spec.name || node.name === spec.previousName)
  if (index < 0) {
    document.nodes.push({name: spec.name})
    index = document.nodes.length - 1
  }
  const node = document.nodes[index]
  node.name = spec.name
  if (spec.translation) node.translation = spec.translation
  if (spec.rotation) node.rotation = spec.rotation
  if (spec.camera !== undefined) node.camera = spec.camera
  if (spec.extension) node.extensions = {...(node.extensions || {}), ...spec.extension}
  const extras = {...(node.extras || {})}
  extras.gltfUUID ||= spec.uuid
  extras.kite3dAuthoring = {...(extras.kite3dAuthoring || {}), ...spec.authoring}
  if (spec.asset) {
    extras.rootPath = `/kite3d/@${spec.asset.id}/${spec.asset.file}`
    extras.rootPathOptions = {...(extras.rootPathOptions || {}), createUniqueNames: false}
    extras.sProperties = Array.isArray(extras.sProperties) ? extras.sProperties : []
    extras.unitTemplateType = spec.asset.type
  }
  if (spec.components) {
    const components = {...(extras.EntityComponentPlugin || {})}
    for (const [id, component] of Object.entries(spec.components)) {
      const priorState = components[id]?.type === component.type ? components[id].state || {} : {}
      components[id] = {type: component.type, state: {...priorState, ...component.state}}
    }
    extras.EntityComponentPlugin = components
  }
  if (spec.removeComponents && extras.EntityComponentPlugin) {
    for (const id of spec.removeComponents) delete extras.EntityComponentPlugin[id]
    if (!Object.keys(extras.EntityComponentPlugin).length) delete extras.EntityComponentPlugin
  }
  node.extras = extras
  if (!scene.nodes.includes(index) && !childIndices.has(index)) scene.nodes.push(index)
}

await writeFile(scenePath, `${JSON.stringify(document, null, 2)}\n`)
console.log(`Wrote ${specs.length} authored nodes to ${scenePath.pathname}`)

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
