import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {NavGrid} from '../../lib/core/nav.js'
import {buildMapFromPlacements, defaultMap} from '../../lib/core/map.js'

const root = new URL('../../', import.meta.url)
const [scene, rules, registry, manifest] = await Promise.all([
  readJson('assets/main.scene.gltf'),
  readJson('lib/core/data/map.json'),
  readJson('lib/core/data/map-piece-registry.json'),
  readJson('assets.json'),
])

function authoredPlacements() {
  return scene.nodes.filter(node => node.extras?.mapPiece).map(node => {
    const transform = nodeTransform(node)
    return {...node.extras.mapPiece, name: node.name, ...transform}
  })
}

test('the authored map reproduces every migrated collider within five centimetres', () => {
  const placements = authoredPlacements()
  const map = buildMapFromPlacements(rules, registry, placements)
  assert.equal(placements.length, defaultMap.mapPieces.length)
  assert.equal(map.colliders.length, defaultMap.colliders.length)
  const expected = new Map(defaultMap.colliders.map(collider => [collider.id, collider]))
  for (const actual of map.colliders) compareCollider(actual, expected.get(actual.id), .05)
  compareCollider(map.trader, defaultMap.trader, .05)
})

test('every placed node has a registered nested asset reference', () => {
  const placements = scene.nodes.filter(node => node.extras?.mapPiece)
  assert.ok(placements.length > 200)
  for (const node of placements) {
    const id = node.extras.mapPiece.assetId
    assert.equal(node.extras.rootPath, `/kite3d/@${id}/f.gltf`)
    assert.ok(manifest.files[id]?.files?.['f.gltf'])
    assert.deepEqual(node.extras.sProperties, ['visible', 'name', 'position', 'quaternion', 'scale'])
    assert.doesNotMatch(node.name, /Static Map|Preview/)
  }
})

test('moving an authored sandbag moves its collider and changes rebuilt navigation', () => {
  const placements = authoredPlacements()
  const sandbag = placements.find(item => item.name === 'Sandbag stack 1')
  assert.ok(sandbag)
  const original = buildMapFromPlacements(rules, registry, placements)
  const movedPlacements = structuredClone(placements)
  movedPlacements.find(item => item.nodeId === sandbag.nodeId).translation[0] += 1
  const moved = buildMapFromPlacements(rules, registry, movedPlacements)
  const before = original.colliders.find(item => item.id === sandbag.id)
  const after = moved.colliders.find(item => item.id === sandbag.id)
  assert.equal(after.center.x, before.center.x + 1)
  const beforeNav = new NavGrid(original)
  const afterNav = new NavGrid(moved)
  assert.ok(beforeNav.blocked.some((value, index) => value !== afterNav.blocked[index]))
})

function compareCollider(actual, expected, tolerance) {
  assert.ok(expected, `missing expected collider ${actual?.id}`)
  for (const axis of ['x', 'y', 'z']) {
    assert.ok(Math.abs(actual.center[axis] - expected.center[axis]) <= tolerance, `${actual.id} center.${axis}`)
    assert.ok(Math.abs(actual.size[axis] - expected.size[axis]) <= tolerance, `${actual.id} size.${axis}`)
  }
  assert.ok(Math.abs((actual.yaw || 0) - (expected.yaw || 0)) <= 1e-5, `${actual.id} yaw`)
  assert.deepEqual(actual.shapes || [], expected.shapes || [])
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'))
}

function nodeTransform(node) {
  if (!node.matrix) return {
    translation: node.translation || [0, 0, 0],
    quaternion: node.rotation || [0, 0, 0, 1],
    scale: node.scale || [1, 1, 1],
  }
  const m = node.matrix
  const scale = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])]
  const yaw = Math.atan2(m[8] / scale[2], m[10] / scale[2])
  return {translation: [m[12], m[13], m[14]], rotation: [0, yaw, 0], scale}
}
