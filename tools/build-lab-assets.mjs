#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {writeModelAsset} from './lib/model-asset.mjs'

globalThis.ImageData ??= class {}
const THREE = await import('three')
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = new URL('../assets.json', import.meta.url)
const scenePath = new URL('../assets/main.scene.gltf', import.meta.url)
const LAB_TYPES = ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']
const LAB_LABELS = ['Scout', 'Endo', 'Heavy', 'T-1000', 'HK-Aerial', 'HK-Tank']
const LAB_LANES = [-21.7, -19.8, -17.7, -15.6, -12.4, -7.3]
const LAB_PLATES = [-21, -18, -15, -12, -9, -6]

export async function buildLabAssets() {
  const document = JSON.parse(await readFile(scenePath, 'utf8'))
  if (!(document.nodes || []).some(node => /Lab[_ ]Manager/.test(node.name || ''))) {
    throw new Error('tools/build-lab-assets.mjs only runs against the Weapons Lab scene')
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = 1
  manifest.files ||= {}
  for (const asset of labAssets()) await writeModelAsset({
    projectRoot, manifest, ...asset,
    generator: 'Terminator tools/build-lab-assets.mjs with glTF-Transform 4.5.0 and three.js',
  })
  rewriteLabScene(document)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(scenePath, `${JSON.stringify(document, null, 2)}\n`)
  console.log('Wrote three lab fixture assets and replaced lab Generator nodes with placed assets')
}

function labAssets() {
  const materials = {
    concrete: new THREE.MeshStandardMaterial({name: 'Lab concrete', color: 0x89959c, metalness: .05, roughness: .9}),
    steel: new THREE.MeshStandardMaterial({name: 'Lab worn steel', color: 0x657177, metalness: .75, roughness: .67}),
    marking: new THREE.MeshStandardMaterial({name: 'Lab range markings', color: 0xc68b38, metalness: .12, roughness: .72}),
    sign: new THREE.MeshStandardMaterial({name: 'Lab distance sign', color: 0x172229, metalness: .18, roughness: .78}),
    text: new THREE.MeshStandardMaterial({name: 'Lab distance sign lettering', color: 0xd5e1dd, metalness: .08, roughness: .62}),
  }
  return [
    {assetId: 'lab-range-shell', directory: 'assets/models/lab/range-shell', slug: 'range-shell', object: rangeShell(materials)},
    {assetId: 'lab-firing-line', directory: 'assets/models/lab/firing-line', slug: 'firing-line', object: labFiringLine(materials)},
    {assetId: 'lab-turntable', directory: 'assets/models/lab/turntable', slug: 'turntable', object: turntable(materials)},
  ]
}

function rangeShell(materials) {
  const root = new THREE.Group()
  root.name = 'Weapons Lab Range Asset'
  root.userData.labFixtureAsset = 'range-shell'
  for (const [name, position, size] of [
    ['Lab floor', [7, -.2, -13], [60, .4, 20]],
    ['Lab backstop', [36.8, 3, -13], [.4, 6, 20]],
    ['Lab north wall', [7, 2, -3.2], [60, 4, .4]],
    ['Lab south wall', [7, 2, -22.8], [60, 4, .4]],
  ]) addBox(root, name, size, position, materials.concrete)
  for (const x of [-18, -8, 2, 12, 22, 32]) {
    addBox(root, `Distance band ${x + 18}m`, [.07, .008, 19], [x, .005, -13], materials.marking)
    addDistanceMarker(root, x + 18, [x, 2.7, -22.56], materials)
  }
  for (const z of LAB_LANES) addBox(root, 'Lane stripe', [53, .009, .035], [9, .008, z - .7], materials.marking)
  for (let x = -20; x < 37; x += 5) {
    addBox(root, 'North wall joint', [.045, 4, .055], [x, 2, -3.44], materials.steel)
    addBox(root, 'South wall joint', [.045, 4, .055], [x, 2, -22.56], materials.steel)
  }
  return root
}

function addDistanceMarker(parent, distance, position, materials) {
  const marker = new THREE.Group()
  marker.name = `Distance marker ${distance} m`
  marker.position.fromArray(position)
  parent.add(marker)
  addBox(marker, 'Sign board', [2.4, .6, .035], [0, 0, 0], materials.sign)
  const digits = String(distance)
  digits.split('').forEach((digit, index) => addSevenSegment(marker, digit, (index - (digits.length - 1) / 2) * .3 - .12, materials.text))
  addBox(marker, 'Metres label left', [.035, .20, .018], [.37, -.03, .028], materials.text, [0, 0, -.45])
  addBox(marker, 'Metres label right', [.035, .20, .018], [.51, -.03, .028], materials.text, [0, 0, .45])
}

function addSevenSegment(parent, digit, x, material) {
  const active = {
    0: 'abcedf', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
    5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  }[digit] || ''
  const segments = {
    a: [0, .18, 0], b: [.09, .09, Math.PI / 2], c: [.09, -.09, Math.PI / 2],
    d: [0, -.18, 0], e: [-.09, -.09, Math.PI / 2], f: [-.09, .09, Math.PI / 2], g: [0, 0, 0],
  }
  for (const key of new Set(active)) {
    const [dx, dy, rotation] = segments[key]
    addBox(parent, `Digit ${digit} segment ${key}`, [.15, .025, .018], [x + dx, dy, .028], material, [0, 0, rotation])
  }
}

function labFiringLine(materials) {
  const root = new THREE.Group()
  root.name = 'Lab Firing Line Asset'
  root.userData.labFixtureAsset = 'firing-line'
  addBox(root, 'Firing line inlay', [.16, .015, 19], [0, .012, 0], materials.marking)
  addBox(root, 'Firing mat', [2, .025, 2], [-.7, .017, 0], materials.steel)
  return root
}

function turntable(materials) {
  const root = new THREE.Group()
  root.name = 'Lab Turntable Asset'
  root.userData.labFixtureAsset = 'turntable'
  addBox(root, 'Turntable plinth', [.8, .08, .8], [0, .04, 0], materials.steel)
  addBox(root, 'Turntable column', [.24, .87, .24], [0, .50, 0], materials.steel)
  addMesh(root, 'Weapon turntable surface', new THREE.CylinderGeometry(.64, .64, .08, 48), materials.steel, [0, .98, 0])
  addBox(root, 'Weapon rest', [.10, .10, .28], [0, 1.06, 0], materials.marking)
  return root
}

function rewriteLabScene(document) {
  for (const [name, assetId] of [['Range', 'lab-range-shell'], ['Firing_Line', 'lab-firing-line'], ['Turntable', 'lab-turntable']]) {
    const node = document.nodes.find(candidate => candidate.name === name || candidate.name === name.replaceAll('_', ' '))
    if (!node) throw new Error(`Weapons Lab scene is missing ${name}`)
    placeAsset(node, assetId, 'f.gltf', 'direct')
  }
  filterNodes(document, node => !/^Plates$/.test(node.name || '') && !/^Targets[_ ](?:10|20|40)m$/.test(node.name || ''))
  for (const [index, type] of LAB_TYPES.entries()) {
    const label = LAB_LABELS[index]
    const node = document.nodes.find(candidate => candidate.name === `Unit Template ${label}` || candidate.name === `Unit_Template_${label}`)
    if (!node) throw new Error(`Weapons Lab scene is missing Unit Template ${label}`)
    placeAsset(node, `unit-${type}`, `${type}.gltf`, 'template')
    node.extras.unitTemplateType = type
  }
  for (const [index, z] of LAB_PLATES.entries()) appendRootNode(document, placedNode({
    name: `Plate ${index + 1}`, id: `lab-plate-${index + 1}`, assetId: 'range-steel-target', file: 'f.gltf',
    translation: [-3, 0, z], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], role: 'direct',
  }))
  for (const row of [10, 20, 40]) for (const [index, type] of LAB_TYPES.entries()) appendRootNode(document, placedNode({
    name: `${row}m ${LAB_LABELS[index]} Target`, id: `lab-${row}-${type}`, assetId: `unit-${type}`, file: `${type}.gltf`,
    translation: [-18 + row, type === 'hkaerial' ? 4 : 0, LAB_LANES[index]],
    rotation: [0, -Math.SQRT1_2, 0, Math.SQRT1_2], role: 'template', unitTemplateType: type,
  }))
  document.asset.generator = 'tools/build-lab-assets.mjs; all visible fixtures are placed glTF assets'
}

function placeAsset(node, assetId, file, role) {
  node.extras ||= {}
  node.extras.gltfUUID ||= `lab-${node.name.toLowerCase().replaceAll(' ', '-')}`
  node.extras.kite3dAuthoring = {...node.extras.kite3dAuthoring, role, id: node.extras.kite3dAuthoring?.id || node.extras.gltfUUID}
  node.extras.rootPath = `/kite3d/@${assetId}/${file}`
  node.extras.sProperties = ['visible', 'name', 'position', 'quaternion', 'scale']
  node.extras.rootPathOptions = {...node.extras.rootPathOptions, createUniqueNames: false}
  for (const [id, component] of Object.entries(node.extras.EntityComponentPlugin || {})) {
    if (component.type === 'Generator') delete node.extras.EntityComponentPlugin[id]
  }
  if (!Object.keys(node.extras.EntityComponentPlugin || {}).length) delete node.extras.EntityComponentPlugin
}

function placedNode({name, id, assetId, file, translation, rotation, role, unitTemplateType}) {
  const node = {name, translation, rotation, extras: {
    gltfUUID: id, kite3dAuthoring: {role, id}, rootPath: `/kite3d/@${assetId}/${file}`,
    rootPathOptions: {createUniqueNames: false}, sProperties: ['visible', 'name', 'position', 'quaternion', 'scale'],
  }}
  if (unitTemplateType) node.extras.unitTemplateType = unitTemplateType
  return node
}

function appendRootNode(document, node) {
  document.nodes.push(node)
  document.scenes[document.scene || 0].nodes.push(document.nodes.length - 1)
}

function filterNodes(document, keep) {
  const oldNodes = document.nodes
  const kept = oldNodes.map((node, index) => ({node, index})).filter(({node}) => keep(node))
  const remap = new Map(kept.map(({index}, next) => [index, next]))
  document.nodes = kept.map(({node}) => {
    if (!node.children) return node
    return {...node, children: node.children.filter(index => remap.has(index)).map(index => remap.get(index))}
  })
  for (const scene of document.scenes || []) scene.nodes = (scene.nodes || []).filter(index => remap.has(index)).map(index => remap.get(index))
}

function addBox(parent, name, size, position, material, rotation = [0, 0, 0]) {
  return addMesh(parent, name, new THREE.BoxGeometry(...size), material, position, rotation)
}

function addMesh(parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.position.fromArray(position)
  mesh.rotation.fromArray(rotation)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildLabAssets()
