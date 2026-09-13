#!/usr/bin/env node
import {readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {writeModelAsset} from './lib/model-asset.mjs'

globalThis.ImageData ??= class {}
const THREE = await import('three')
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const manifestPath = new URL('../assets.json', import.meta.url)

export async function buildRangeAssets() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = 1
  manifest.files ||= {}
  const materials = {
    steel: new THREE.MeshStandardMaterial({name: 'Range worn steel', color: 0x68747a, metalness: .78, roughness: .64}),
    dark: new THREE.MeshStandardMaterial({name: 'Range dark steel', color: 0x1a2226, metalness: .72, roughness: .76}),
    line: new THREE.MeshStandardMaterial({name: 'Range firing line', color: 0xb67528, metalness: .24, roughness: .7}),
  }
  const assets = [
    {assetId: 'range-steel-target', directory: 'assets/models/range/steel-target', slug: 'steel-target', object: steelTarget(materials)},
    {assetId: 'range-firing-line', directory: 'assets/models/range/firing-line', slug: 'firing-line', object: firingLine(materials)},
  ]
  for (const asset of assets) await writeModelAsset({
    projectRoot, manifest, ...asset,
    generator: 'Terminator tools/build-range-assets.mjs with glTF-Transform 4.5.0 and three.js',
  })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Wrote ${assets.length} range fixture assets under assets/models/range`)
}

function steelTarget(materials) {
  const root = new THREE.Group()
  root.name = 'Range Steel Target Asset'
  root.userData.rangeFixtureAsset = 'steel-target'
  const stand = new THREE.Group()
  stand.name = 'Range Target Stand'
  root.add(stand)
  const rod = new THREE.BoxGeometry(.055, 1, .055)
  const foot = new THREE.BoxGeometry(.75, .05, .6)
  for (const x of [-.42, .42]) {
    addMesh(stand, 'Target stand leg', rod, materials.dark, [x, .99, 0], [0, 0, 0], [1, 1.98, 1])
    addMesh(stand, 'Target stand foot', foot, materials.dark, [x, .03, 0])
  }
  addMesh(stand, 'Target stand beam', rod, materials.dark, [0, 2, 0], [0, 0, Math.PI / 2], [1, 1.05, 1])

  const pivot = new THREE.Group()
  pivot.name = 'Plate Pivot'
  pivot.position.y = 1.8
  stand.add(pivot)
  const shape = new THREE.Shape()
  const points = [[-.25, -.8], [.25, -.8], [.29, -.70], [.29, -.2], [.25, -.12], [.11, -.12], [.11, .10], [.08, .14], [-.08, .14], [-.11, .10], [-.11, -.12], [-.25, -.12], [-.29, -.2], [-.29, -.70]]
  points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  const plate = new THREE.ExtrudeGeometry(shape, {depth: .012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .004, bevelThickness: .003})
  addMesh(pivot, 'Suspended steel silhouette', plate, materials.steel)
  for (const x of [-.2, .2]) addMesh(pivot, 'Plate suspension strap', rod, materials.dark, [x, 0, .035], [0, 0, 0], [.5, .35, .5])
  return root
}

function firingLine(materials) {
  const root = new THREE.Group()
  root.name = 'Range Firing Line Asset'
  root.userData.rangeFixtureAsset = 'firing-line'
  addMesh(root, 'Range firing line', new THREE.BoxGeometry(.1, .015, 18), materials.line)
  return root
}

function addMesh(parent, name, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.position.fromArray(position)
  mesh.rotation.fromArray(rotation)
  mesh.scale.fromArray(scale)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildRangeAssets()
