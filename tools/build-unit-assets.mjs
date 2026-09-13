#!/usr/bin/env node
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'

globalThis.ImageData ??= class ImageData {}
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.({target: this})
    }, error => this.onerror?.(error))
  }
}

const THREE = await import('three')
const {GLTFExporter} = await import('three/addons/exporters/GLTFExporter.js')
const {createUnitFigure} = await import('./lib/unit-figure.js')
const {createRosterFigure} = await import('./lib/roster-figure.js')
const {createSoldierFigure} = await import('./lib/soldier-figure.js')

const root = fileURLToPath(new URL('../', import.meta.url))
const assetsPath = resolve(root, 'assets.json')
const io = new NodeIO()
const E = {
  ...THREE,
  Mesh2: THREE.Mesh,
  PhysicalMaterial: THREE.MeshPhysicalMaterial,
  UnlitMaterial: THREE.MeshBasicMaterial,
}

const specs = [
  {type: 'scout', label: 'T-600 Scout', family: 'endo'},
  {type: 'endo', label: 'T-800 Endo', family: 'endo'},
  {type: 'heavy', label: 'T-800 Heavy', family: 'endo'},
  {type: 't1000', label: 'T-1000', family: 'liquid'},
  {type: 'hkaerial', label: 'HK-Aerial', family: 'hk'},
  {type: 'hktank', label: 'HK-Tank', family: 'hk'},
  {type: 'soldier', label: 'Resistance Soldier', family: 'soldier'},
]

const manifest = JSON.parse(await readFile(assetsPath, 'utf8'))
manifest.version ||= 1
manifest.files ||= {}

for (const spec of specs) {
  const directory = resolve(root, 'assets/models/units', spec.type)
  const gltfPath = resolve(directory, `${spec.type}.gltf`)
  const binPath = resolve(directory, `${spec.type}.bin`)
  await mkdir(directory, {recursive: true})

  const materials = buildMaterials()
  const asset = new THREE.Group()
  asset.name = `${spec.label} Asset`
  asset.userData = {unitAsset: true, unitTemplateType: spec.type}

  const high = createFigure(spec, 1, materials)
  high.name = `${spec.label} High`
  high.userData.unitTemplateType ||= spec.type
  high.userData.unitAssetDetail = 'high'
  prepareDirectionalLights(high)
  asset.add(high)

  if (spec.type !== 'soldier') {
    const far = createFigure(spec, 0, materials)
    far.name = `${spec.label} Far`
    far.userData.unitTemplateType ||= spec.type
    far.userData.unitAssetDetail = 'far'
    far.visible = false
    asset.add(far)
  }

  const exporter = new GLTFExporter()
  const glb = new Uint8Array(await exporter.parseAsync(asset, {
    binary: true,
    onlyVisible: false,
    animations: [],
  }))
  const {json, resources} = await io.binaryToJSON(glb)
  json.asset.generator = 'Terminator build-unit-assets.mjs using Three.js and glTF Transform'
  json.buffers[0].uri = `${spec.type}.bin`
  addAssetTextures(json, spec.family)
  hideFarFigure(json)

  const binary = Object.values(resources)[0]
  if (!binary) throw new Error(`${spec.type}: GLTFExporter produced no binary resource`)
  await writeFile(gltfPath, `${JSON.stringify(json, null, 2)}\n`)
  await writeFile(binPath, binary)

  const projectGltf = projectPath(gltfPath)
  const projectBin = projectPath(binPath)
  const files = {[`${spec.type}.gltf`]: projectGltf, [`${spec.type}.bin`]: projectBin}
  for (const uri of referencedImageUris(json)) files[uri] = `assets/${uri}`
  manifest.files[`unit-${spec.type}`] = {path: projectGltf, files}
}

await writeFile(assetsPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${specs.length} placed unit assets under assets/models/units`)

function createFigure(spec, detail, materials) {
  if (spec.family === 'endo') return createUnitFigure(E, spec.type, {detail, materials: materials.unit})
  if (spec.family === 'liquid' || spec.family === 'hk') {
    return createRosterFigure(E, spec.type, {detail, materials: materials.roster})
  }
  return createSoldierFigure(E, 'olive', {materials: materials.soldier})
}

function buildMaterials() {
  const unit = {
    metal: new THREE.MeshStandardMaterial({name: 'Endoskeleton 1K worn metal atlas', color: 0xffffff, metalness: 1, roughness: 1}),
    eye: new THREE.MeshStandardMaterial({name: 'Machined red optical glass', color: 0x4b0803, emissive: 0xff3322, emissiveIntensity: 3, metalness: .65, roughness: .5}),
    halo: new THREE.MeshBasicMaterial({name: 'Optical scattering', color: 0xff1203, transparent: true, opacity: .35, depthWrite: false, side: THREE.DoubleSide}),
    textureBytes: 0,
  }
  const roster = {
    chrome: new THREE.MeshStandardMaterial({name: 'Mimetic polyalloy 1K', color: 0xffffff, metalness: 1, roughness: 1}),
    armor: new THREE.MeshStandardMaterial({name: 'Hunter Killer worn armor 1K', color: 0xffffff, metalness: 1, roughness: 1}),
    light: new THREE.MeshStandardMaterial({name: 'Hunter Killer optical glass', color: 0x5b0d08, emissive: 0xff2815, emissiveIntensity: 3, metalness: .3, roughness: .35}),
  }
  const soldier = {
    olive: new THREE.MeshStandardMaterial({name: 'Resistance olive worn fatigues', color: 0xffffff, vertexColors: true, metalness: .05, roughness: .94}),
    gray: new THREE.MeshStandardMaterial({name: 'Resistance gray worn fatigues', color: 0xffffff, vertexColors: true, metalness: .05, roughness: .94}),
    lamp: new THREE.MeshStandardMaterial({name: 'Resistance warm headlamp lens', color: 0xffecc5, emissive: 0xffd49a, emissiveIntensity: 2.4, roughness: .24, metalness: .25}),
  }
  return {unit, roster, soldier}
}

function prepareDirectionalLights(figure) {
  figure.updateMatrixWorld(true)
  const lights = []
  figure.traverse(object => { if (object.isSpotLight) lights.push(object) })
  for (const object of lights) {
    const target = figure.getObjectByName(`${object.name} Target`)
    if (!target) continue
    const worldTarget = new THREE.Vector3()
    target.getWorldPosition(worldTarget)
    object.lookAt(worldTarget)
    object.add(target)
    target.position.set(0, 0, -1)
    target.quaternion.identity()
    target.scale.set(1, 1, 1)
  }
}

function addAssetTextures(json, family) {
  const cache = new Map()
  const texture = (uri, name = uri) => {
    if (cache.has(uri)) return cache.get(uri)
    json.images ||= []
    json.textures ||= []
    const source = json.images.push({name, uri}) - 1
    const index = json.textures.push({name, source}) - 1
    cache.set(uri, index)
    return index
  }
  const assign = (materialName, maps) => {
    const material = (json.materials || []).find(item => item.name === materialName)
    if (!material) throw new Error(`Exported material is missing: ${materialName}`)
    material.pbrMetallicRoughness ||= {}
    if (maps.albedo) material.pbrMetallicRoughness.baseColorTexture = {index: texture(maps.albedo)}
    if (maps.orm) {
      const index = texture(maps.orm)
      material.pbrMetallicRoughness.metallicRoughnessTexture = {index}
      material.occlusionTexture = {index}
    }
    if (maps.normal) material.normalTexture = {index: texture(maps.normal), scale: maps.normalScale ?? 1}
    if (maps.emissive) {
      material.emissiveTexture = {index: texture(maps.emissive)}
      material.emissiveFactor ||= [1, .05, .02]
    }
  }

  if (family === 'endo') {
    assign('Endoskeleton 1K worn metal atlas', unitMaps('endoskeleton'))
    assign('Machined red optical glass', {...unitMaps('optic'), emissive: 'textures/units/optic-emissive.png', normalScale: .55})
  } else if (family === 'liquid') {
    assign('Mimetic polyalloy 1K', rosterMaps('liquid', .34))
  } else if (family === 'hk') {
    assign('Hunter Killer worn armor 1K', rosterMaps('hk'))
    assign('Hunter Killer optical glass', {...unitMaps('optic'), emissive: 'textures/units/optic-emissive.png'})
  } else if (family === 'soldier') {
    assign('Resistance olive worn fatigues', {orm: 'textures/units/endoskeleton-orm.png'})
    assign('Resistance warm headlamp lens', {...unitMaps('optic'), emissive: 'textures/units/optic-emissive.png'})
  }
}

function unitMaps(prefix) {
  return {
    albedo: `textures/units/${prefix}-albedo.${prefix === 'endoskeleton' ? 'jpg' : 'png'}`,
    normal: `textures/units/${prefix}-normal.png`,
    orm: `textures/units/${prefix}-orm.png`,
  }
}

function rosterMaps(prefix, normalScale = 1) {
  return {
    albedo: `textures/roster/${prefix}-albedo.jpg`,
    normal: `textures/roster/${prefix}-normal.png`,
    orm: `textures/roster/${prefix}-orm.png`,
    normalScale,
  }
}

function hideFarFigure(json) {
  let hidden = false
  for (const node of json.nodes || []) {
    if (node.extras?.unitAssetDetail !== 'far') continue
    node.extensions ||= {}
    node.extensions.WEBGI_object3d_extras = {visible: false}
    hidden = true
  }
  if (hidden) json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'WEBGI_object3d_extras'])]
}

function referencedImageUris(json) {
  return [...new Set((json.images || []).map(image => image.uri).filter(Boolean))]
}

function projectPath(path) {
  return relative(root, path).split('\\').join('/')
}
