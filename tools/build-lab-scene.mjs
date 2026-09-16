#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {addWeaponReferences} from './weapons/scene-references.mjs'
import {LAB_CAMERA, LAB_LIGHTS, LAB_TYPES, LAB_LABELS, LAB_LANES, LAB_PLATES} from '../lib/view/lab-layout.js'

globalThis.ImageData ??= class {}
const {PerspectiveCamera, Vector3} = await import('three')
const EDITABLE = ['visible', 'name', 'position', 'quaternion', 'scale']
const UNIT_NAMES = {
  scout: 'Unit T-600 Scout', endo: 'Unit T-800 Endo', heavy: 'Unit T-800 Heavy',
  t1000: 'Unit T-1000', hkaerial: 'Unit HK-Aerial', hktank: 'Unit HK-Tank',
}

const cameraRotation = (position, target) => {
  const camera = new PerspectiveCamera()
  camera.position.fromArray(position)
  camera.lookAt(new Vector3(...target))
  return camera.quaternion.toArray()
}

export function labSceneDocument(previous = {}, candidates = []) {
  const previousNodes = previous.nodes || []
  const nodes = []
  const roots = []
  const findPrevious = (id, names = []) => previousNodes.find(node => node.extras?.gltfUUID === id)
    || previousNodes.find(node => names.some(name => node.name === name || node.name === name.replaceAll(' ', '_')))
  const cleanExtras = extras => {
    const result = {...(extras || {})}
    const components = {...(result.EntityComponentPlugin || {})}
    for (const [id, component] of Object.entries(components)) if (component.type === 'Generator') delete components[id]
    if (Object.keys(components).length) result.EntityComponentPlugin = components
    else delete result.EntityComponentPlugin
    return result
  }
  const makeNode = ({name, id, translation, rotation, role = 'direct', aliases = [], asset, component}) => {
    const prior = findPrevious(id, [name, ...aliases]) || {}
    const extras = cleanExtras(prior.extras)
    extras.gltfUUID ||= id
    extras.kite3dAuthoring = {...(extras.kite3dAuthoring || {}), role, id: extras.kite3dAuthoring?.id || id}
    if (asset) {
      extras.rootPath = `/kite3d/@${asset.id}/${asset.file}`
      extras.rootPathOptions = {...(extras.rootPathOptions || {}), createUniqueNames: false}
      extras.sProperties = [...EDITABLE]
      if (asset.type) extras.unitTemplateType = asset.type
    }
    if (component) {
      const entries = {...(extras.EntityComponentPlugin || {})}
      const key = Object.keys(entries).find(key => entries[key].type === component.type) || `${id}-component`
      entries[key] = component
      extras.EntityComponentPlugin = entries
    }
    const node = {...prior, name, translation: [...(prior.translation || translation)], extras}
    delete node.matrix
    if (rotation || prior.rotation) node.rotation = [...(prior.rotation || rotation)]
    else delete node.rotation
    delete node.children
    return node
  }
  const addRoot = node => {nodes.push(node); roots.push(nodes.length - 1); return nodes.length - 1}
  const addChild = (parent, node) => {nodes.push(node); (parent.children ||= []).push(nodes.length - 1); return nodes.length - 1}

  addRoot(makeNode({name: 'Lab_Manager', id: 'lab-lab_manager', translation: [0, 0, 0],
    component: {type: 'WeaponsLab', state: {seed: 2029}}}))
  addRoot(makeNode({name: 'Range', id: 'lab-range', translation: [0, 0, 0],
    asset: {id: 'lab-range-shell', file: 'f.gltf'}}))
  addRoot(makeNode({name: 'Firing_Line', id: 'lab-firing_line', translation: [-18, 0, -13],
    asset: {id: 'lab-firing-line', file: 'f.gltf'}}))
  addRoot(makeNode({name: 'Turntable', id: 'lab-turntable', translation: [-16, 0, -13],
    asset: {id: 'lab-turntable', file: 'f.gltf'}}))

  if (candidates.length) {
    const rack = makeNode({name: 'Candidates', id: 'lab-candidates', translation: [-19, 1.5, -21]})
    addRoot(rack)
    for (const [index, candidate] of candidates.entries()) {
      const original = candidate.derivedFrom
        ? nodes.find(node => node.extras?.gltfUUID === `lab-${candidate.derivedFrom}`)
        : null
      if (candidate.derivedFrom && !original) throw new Error(`Missing original for ${candidate.name}`)
      const translation = original
        ? [original.translation[0] + 1, original.translation[1], original.translation[2]]
        : [0, 0, index]
      const node = makeNode({name: candidate.name, id: `lab-${candidate.id}`,
        translation, rotation: original?.rotation || [0, Math.SQRT1_2, 0, Math.SQRT1_2], asset: candidate})
      node.extras.candidate = {weapon: candidate.weapon, shippable: candidate.shippable,
        ...(candidate.derivedFrom ? {derivedFrom: candidate.derivedFrom} : {})}
      addChild(rack, node)
    }
  }

  for (const row of [10, 20, 40]) {
    const group = makeNode({name: `Targets_${row}m`, id: `lab-targets_${row}m`, translation: [-18 + row, 0, -13]})
    addRoot(group)
    for (const [index, type] of LAB_TYPES.entries()) addChild(group, makeNode({
      name: `${row}m ${LAB_LABELS[index]} Target`, id: `lab-${row}-${type}`,
      translation: [0, type === 'hkaerial' ? 4 : 0, LAB_LANES[index] + 13],
      rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2],
      asset: {id: `unit-${type}`, file: `${type}.gltf`, type},
    }))
  }

  const plates = makeNode({name: 'Plates', id: 'lab-plates', translation: [-3, 0, -13]})
  addRoot(plates)
  for (const [index, plate] of LAB_PLATES.entries()) addChild(plates, makeNode({
    name: `Plate ${index + 1}`, id: plate.id, translation: [0, 0, plate.z + 13],
    rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], asset: {id: 'range-steel-target', file: 'f.gltf'},
  }))

  for (const [lightIndex, spec] of Object.values(LAB_LIGHTS).entries()) {
    const node = makeNode({name: spec.name, id: `lab-${spec.name.toLowerCase()}`, translation: spec.position,
      rotation: cameraRotation(spec.position, [-16, 1, -13])})
    node.extensions = {...(node.extensions || {}), KHR_lights_punctual: {light: lightIndex}}
    addRoot(node)
  }
  const camera = makeNode({name: 'Lab_Camera', id: 'lab-lab_camera', translation: LAB_CAMERA.position,
    rotation: cameraRotation(LAB_CAMERA.position, LAB_CAMERA.target)})
  camera.camera = 0
  addRoot(camera)

  for (const [index, type] of LAB_TYPES.entries()) addRoot(makeNode({
    name: UNIT_NAMES[type], id: `lab-unit-template-${type}`, aliases: [`Unit Template ${LAB_LABELS[index]}`],
    translation: [-21, type === 'hkaerial' ? 4 : 0, -21 + index * 2.9], role: 'template',
    asset: {id: `unit-${type}`, file: `${type}.gltf`, type},
  }))

  const result = {
    asset: {version: '2.0', generator: 'tools/build-lab-scene.mjs; placed glTF assets only'},
    scene: 0,
    scenes: [{name: 'Weapons Lab', nodes: roots}],
    nodes,
    cameras: [{name: 'Lab_Camera', type: 'perspective', perspective: {yfov: Math.PI / 3, znear: .05, zfar: 180}}],
    extensionsUsed: [...new Set([...(previous.extensionsUsed || []), 'KHR_lights_punctual'])],
    extensions: {...(previous.extensions || {}), KHR_lights_punctual: {lights: Object.values(LAB_LIGHTS).map(light => ({
      name: light.name, type: 'directional', color: light.color, intensity: light.intensity,
    }))}},
  }
  const rebuiltRevolver = makeNode({
    name: 'Rebuilt Revolver Template', id: 'lab-weapon-revolver-rebuild',
    translation: [-18, 1.55, -19], role: 'template',
    asset: {id: 'weapon-revolver-rebuild', file: 'revolver-rebuild.gltf'},
  })
  rebuiltRevolver.extras.weaponAsset = 'revolver-rebuild'
  result.nodes.push(rebuiltRevolver)
  result.scenes[0].nodes.push(result.nodes.length - 1)
  for (const prior of previousNodes) if ((prior.extras?.weaponAsset && prior.extras.weaponAsset !== 'revolver-rebuild') || prior.extras?.gltfUUID==='lab-weapon-swingout') {
    result.nodes.push(prior)
    result.scenes[0].nodes.push(result.nodes.length - 1)
  }
  return addWeaponReferences(result, {lab: true})
}

export function candidatesFromRegistry(registry) {
  return Object.entries(registry.files).filter(([, entry]) => entry.candidate?.shippable).map(([id, entry]) => ({
    id, file: entry.path.split('/').at(-1), ...entry.candidate,
  }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = new URL('../assets/weapons-lab.scene.gltf', import.meta.url)
  const previous = JSON.parse(await readFile(path, 'utf8'))
  const registry = JSON.parse(await readFile(new URL('../assets.json', import.meta.url), 'utf8'))
  const candidates = candidatesFromRegistry(registry)
  const document = labSceneDocument(previous, candidates)
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`)
  console.log(`Wrote ${document.nodes.length} generator-free lab nodes to assets/weapons-lab.scene.gltf`)
}
