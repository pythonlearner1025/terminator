import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {weaponFixture} from './weapon-assets-fixture.mjs'
globalThis.window ??= {}
const T = await import('three')
const {GLTFLoader} = await import('three/addons/loaders/GLTFLoader.js')
const {Group, Vector3} = await import('threepipe')
const {instantiateWeaponRigs} = await import('../../lib/view/weapon-assets.js')
const {WeaponAnimation, applySightAim} = await import('../../lib/view/weapons-animation.js')

// The rebuilt revolver is the only rig that carries its own sight geometry, and
// it is the default pistol, so it needs the real asset here. The base fixture
// has no revolver-rebuild, so load it next to the fixture and index both.
async function loadRebuild() {
  const dir = new URL('../../assets/models/weapons/revolver-rebuild/', import.meta.url)
  const gltf = JSON.parse(await readFile(new URL('revolver-rebuild.gltf', dir), 'utf8'))
  for (const buffer of gltf.buffers) buffer.uri = 'data:application/octet-stream;base64,' + (await readFile(new URL(buffer.uri, dir))).toString('base64')
  for (const material of gltf.materials || []) {
    for (const key of ['normalTexture', 'occlusionTexture', 'emissiveTexture']) delete material[key]
    delete material.pbrMetallicRoughness?.baseColorTexture
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture
  }
  const asset = await new GLTFLoader().parseAsync(JSON.stringify(gltf), '')
  asset.scene.animations = asset.animations
  const root = new T.Group()
  root.add(weaponFixture, asset.scene)
  return root
}
const modelRoot = await loadRebuild()
// The view calls applySightAim on every rig it builds, from the WeaponAnimation
// constructor and from WeaponView.selectVariant. Do the same here.
function rigFor(id) {
  const rig = instantiateWeaponRigs(new Group(), modelRoot, undefined, {ids: [id]})[id]
  applySightAim(rig)
  return rig
}

// The pose weapons-animation.js holds at aimAmount 1: the hip offset is gone and
// the sight offset owns the root.
function aimPose(rig) {
  rig.root.position.set(0, -(rig.sight.height || 0), -(rig.sight.distance || 0))
  rig.root.rotation.set(rig.sight.pitch || 0, 0, 0)
  rig.root.updateMatrixWorld(true)
  return rig
}
function sightTop(rig, name) {
  const object = rig.root.getObjectByName(name)
  const point = new Vector3(), vertices = []
  object.traverse(node => {
    if (!node.isMesh) return
    const attribute = node.geometry.attributes.position
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i)
      node.localToWorld(point)
      vertices.push(point.clone())
    }
  })
  const top = Math.max(...vertices.map(v => v.y)), edge = vertices.filter(v => v.y > top - 1e-5)
  return edge.reduce((sum, v) => sum.add(v), new Vector3()).multiplyScalar(1 / edge.length)
}

test('a rig with sight geometry aims along its own sight line', () => {
  const rig = aimPose(rigFor('revolver-rebuild'))
  for (const name of ['RearSight', 'FrontSight']) {
    const point = sightTop(rig, name)
    // The camera sits at the origin looking down -Z, so the sight line is on the
    // view axis when both tips have no x and no y left.
    assert.ok(Math.abs(point.x) < 1e-4, `${name} x ${point.x}`)
    assert.ok(Math.abs(point.y) < 1e-4, `${name} y ${point.y}`)
    assert.ok(point.z < 0, `${name} sits in front of the eye`)
  }
})

test('the aim offset scales with the rig, and the sight nodes set height and pitch', () => {
  const rig = rigFor('revolver-rebuild')
  const authored = rig.root.userData.viewModel.sight, scale = rig.root.userData.viewModel.scale
  assert.equal(scale, 0.75)
  assert.equal(rig.sight.distance, authored.distance * scale)
  // Geometry and the authored numbers must agree; either drifting is the bug
  // that put the gun 1.2 m from the eye with its sights above the reticle.
  assert.ok(Math.abs(rig.sight.height - authored.height * scale) < 1e-6, `height ${rig.sight.height}`)
  assert.ok(Math.abs(rig.sight.pitch - authored.pitch) < 1e-5, `pitch ${rig.sight.pitch}`)
})

test('a rig without sight nodes keeps its authored aim offset', () => {
  const rig = rigFor('pistol')
  const authored = rig.root.userData.viewModel.sight
  assert.equal(rig.root.getObjectByName('FrontSight'), undefined)
  assert.equal(rig.root.scale.x, 1)
  assert.equal(rig.sight.height, authored.height)
  assert.equal(rig.sight.distance, authored.distance)
  assert.equal(rig.sight.pitch ?? 0, authored.pitch ?? 0)
})

test('the view applies the rule to every rig it builds', () => {
  const rigs = instantiateWeaponRigs(new Group(), modelRoot, undefined, {ids: ['revolver-rebuild', 'pistol', 'knife']})
  const before = rigs['revolver-rebuild'].sight
  new WeaponAnimation(rigs, {update() {}, fire() {}, eject() {}})
  assert.notEqual(rigs['revolver-rebuild'].sight, before)
  assert.equal(rigs['revolver-rebuild'].sight.distance, 0.4 * 0.75)
  assert.equal(rigs.pistol.sight.distance, rigs.pistol.root.userData.viewModel.sight.distance)
  // A knife has no sights at all, and the rule leaves it alone.
  assert.equal(applySightAim(rigs.knife), null)
  assert.equal(rigs.knife.sight, undefined)
})
