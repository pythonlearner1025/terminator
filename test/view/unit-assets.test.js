import test from 'node:test'
import assert from 'node:assert/strict'
import {access, readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {NodeIO} from '@gltf-transform/core'
import {loadUnitFigure, UNIT_ASSET_TYPES} from '../../tools/load-unit-asset.mjs'
import {measureColliderFit} from '../../tools/collider-fit.mjs'

const root = resolve(new URL('../..', import.meta.url).pathname)
const manifest = JSON.parse(await readFile(resolve(root, 'assets.json'), 'utf8'))
const units = JSON.parse(await readFile(resolve(root, 'lib/core/data/units.json'), 'utf8'))
const expected = {
  scout: {high: 73794, far: 33270, materials: ['Endoskeleton 1K worn metal atlas', 'Machined red optical glass', 'Optical scattering'], nodes: ['Eye Left', 'Eye Right', 'Eye Emitters']},
  endo: {high: 76734, far: 35394, materials: ['Endoskeleton 1K worn metal atlas', 'Machined red optical glass', 'Optical scattering'], nodes: ['Eye Left', 'Eye Right', 'Eye Emitters']},
  heavy: {high: 81526, far: 37018, materials: ['Endoskeleton 1K worn metal atlas', 'Machined red optical glass', 'Optical scattering'], nodes: ['Eye Left', 'Eye Right', 'Eye Emitters', 'Barrels']},
  t1000: {high: 89484, far: 36156, materials: ['Mimetic polyalloy 1K'], nodes: ['Palm Left', 'Palm Right', 'Blade Left', 'Blade Right']},
  hkaerial: {high: 26508, far: 14724, materials: ['Hunter Killer optical glass', 'Hunter Killer worn armor 1K'], nodes: ['Roster running lights', 'Searchlight', 'Turret']},
  hktank: {high: 53868, far: 27444, materials: ['Hunter Killer optical glass', 'Hunter Killer worn armor 1K'], nodes: ['Roster running lights', 'Core', 'Cannon Left', 'Cannon Right']},
  soldier: {high: 46553, materials: ['Resistance olive worn fatigues', 'Resistance warm headlamp lens'], nodes: ['Headlamp Lens', 'Headlamp Target', 'Soldier fatigues and equipment']},
}

test('the scene exposes seven named unit asset instances without unit generators', async () => {
  const scene = JSON.parse(await readFile(resolve(root, 'assets/main.scene.gltf'), 'utf8'))
  const names = {
    scout: 'Unit T-600 Scout', endo: 'Unit T-800 Endo', heavy: 'Unit T-800 Heavy',
    t1000: 'Unit T-1000', hkaerial: 'Unit HK-Aerial', hktank: 'Unit HK-Tank',
    soldier: 'Unit Resistance Soldier',
  }
  for (const type of UNIT_ASSET_TYPES) {
    const node = scene.nodes.find(candidate => candidate.name === names[type])
    assert.ok(node, `${type}: placed scene node`)
    assert.equal(node.extras.rootPath, `/kite3d/@unit-${type}/${type}.gltf`)
    assert.equal(node.extras.kite3dAuthoring.role, 'template')
    assert.equal(node.extras.unitTemplateType, type)
    assert.equal(node.extras.rootPathOptions.createUniqueNames, false)
    assert.ok(!Object.values(node.extras.EntityComponentPlugin || {}).some(component => component.type === 'Generator'))
  }
  assert.ok(!scene.nodes.some(node => /^Unit[_ ]Template/.test(node.name || '')))
})

test('placed unit files round-trip with stable geometry, rigs, parts, materials, and textures', async () => {
  for (const type of UNIT_ASSET_TYPES) {
    const entry = manifest.files[`unit-${type}`]
    assert.equal(entry.path, `assets/models/units/${type}/${type}.gltf`)
    const json = JSON.parse(await readFile(resolve(root, entry.path), 'utf8'))
    assert.equal(json.buffers.length, 1)
    assert.equal(json.buffers[0].uri, `${type}.bin`)
    for (const uri of [json.buffers[0].uri, ...(json.images || []).map(image => image.uri)]) {
      assert.ok(entry.files[uri], `${type}: manifest mapping for ${uri}`)
      await access(resolve(root, entry.files[uri]))
    }
    assert.deepEqual((json.materials || []).map(material => material.name).sort(), expected[type].materials.toSorted())
    assert.ok((json.images || []).every(image => /^textures\/(units|roster)\//.test(image.uri)), `${type}: external texture URIs`)

    const transformJson = structuredClone(json)
    stripOptionalExtensionsAndTextures(transformJson)
    const binary = new Uint8Array(await readFile(resolve(root, entry.files[`${type}.bin`])))
    const io = new NodeIO()
    const first = await io.readJSON({json: transformJson, resources: {[`${type}.bin`]: binary}})
    const second = await io.readJSON(await io.writeJSON(first))
    assert.equal(second.getRoot().listNodes().length, json.nodes.length, `${type}: glTF Transform node round-trip`)

    for (const detail of type === 'soldier' ? ['high'] : ['high', 'far']) {
      const figure = await loadUnitFigure(type, detail)
      const nodes = [], bones = [], skinned = []
      let vertices = 0
      figure.traverse(object => {
        nodes.push(object.name)
        if (object.isBone) bones.push(object.name.replaceAll('_', ' '))
        if (object.isSkinnedMesh) skinned.push(object)
        if (object.isMesh) vertices += object.geometry.attributes.position.count
      })
      assert.equal(vertices, expected[type][detail], `${type} ${detail}: vertex count`)
      const anatomy = figure.userData.unitAnatomy || figure.userData.soldierAnatomy
      assert.deepEqual(new Set(bones), new Set(anatomy.joints), `${type} ${detail}: bone names`)
      for (const mesh of skinned) {
        assert.deepEqual(new Set(mesh.skeleton.bones.map(bone => bone.name.replaceAll('_', ' '))), new Set(anatomy.joints))
        assert.equal(mesh.geometry.attributes.skinIndex.count, mesh.geometry.attributes.position.count)
        assert.equal(mesh.geometry.attributes.skinWeight.count, mesh.geometry.attributes.position.count)
      }
      for (const name of expected[type].nodes) assert.ok(nodes.includes(name), `${type} ${detail}: ${name}`)
      for (const part of expectedParts(type)) assert.ok(bones.includes(part), `${type} ${detail}: part ${part}`)
      if (type === 'soldier') assert.ok(skinned[0].geometry.attributes.soldierSurface)
    }
  }
})

test('loaded asset anatomy remains inside authored pose volumes', async () => {
  const rows = (await measureColliderFit()).units
  assert.equal(rows.length, 12)
  for (const row of rows) {
    assert.ok(row.outerCm <= 5, `${row.type} ${row.pose}: outer ${row.outerCm}cm`)
    assert.ok(row.missingCm <= 5, `${row.type} ${row.pose}: missing ${row.missingCm}cm`)
    assert.ok(row.headOuterCm <= 5, `${row.type} ${row.pose}: head ${row.headOuterCm}cm`)
  }
})

function expectedParts(type) {
  const parts = Object.keys(units.types[type]?.parts || {})
  if (!parts.includes('Limbs')) return parts
  return parts.filter(part => part !== 'Limbs').concat([
    'Upper Arm Left', 'Forearm Left', 'Upper Arm Right', 'Forearm Right',
    'Thigh Left', 'Shin Left', 'Thigh Right', 'Shin Right',
  ])
}

function stripOptionalExtensionsAndTextures(json) {
  delete json.extensions
  delete json.extensionsUsed
  delete json.extensionsRequired
  delete json.images
  delete json.textures
  for (const node of json.nodes || []) delete node.extensions
  for (const material of json.materials || []) {
    delete material.extensions
    delete material.normalTexture
    delete material.occlusionTexture
    delete material.emissiveTexture
    delete material.pbrMetallicRoughness?.baseColorTexture
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture
  }
}
