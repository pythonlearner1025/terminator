import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

globalThis.ImageData ??= class {}
const sourceRoot = process.env.V2_REVIEW_SOURCE_ROOT
const source = path => import(pathToFileURL(resolve(sourceRoot, path)))

// These are the actual collider seeds used by the production mount, not random
// replacement geometry. Keep them fixed when rechecking owner revisions.
function colliderRandom(id) {
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}

for (const id of ['wall_s_w', 'exp_old_west_inner_s']) {
  test(`review R4-GEOMETRY-1: ${id} has closed outer faces at its crown/end junction`, {
    skip: !sourceRoot && 'Set V2_REVIEW_SOURCE_ROOT to a pinned source extraction',
  }, async () => {
    const {defaultMap} = await source('lib/core/map.js')
    const {wallMorphology} = await source('lib/view/v2/architecture-morphology.js')
    const c = defaultMap.colliders.find(c => c.id === id)
    assert.ok(c, 'Regression must use the actual wall collider')
    const thickness = Math.min(c.size.x, c.size.z)
    const {triangles} = wallMorphology({
      length: Math.max(c.size.x, c.size.z), height: c.size.y, thickness,
      random: colliderRandom(id), topOpen: true, detail: false,
    })
    const edges = new Map()
    let front = -Infinity, back = Infinity
    for (const {a, b, c} of triangles) {
      const points = [a, b, c]
      for (const p of points) { front = Math.max(front, p[2]); back = Math.min(back, p[2]) }
      for (let i = 0; i < 3; i++) {
        const p = points[i], q = points[(i + 1) % 3]
        const key = [JSON.stringify(p), JSON.stringify(q)].sort().join('|')
        const entry = edges.get(key) || {p, q, count: 0}
        entry.count++; edges.set(key, entry)
      }
    }
    assert.ok(front > back, 'Must inspect a volume, not an empty or planar fixture')
    // Internal aggregate stones deliberately have open embedded bases. The
    // outermost front/back planes must join the cavity lips and wall returns.
    // Exact coordinate equality: these vertices are shared by construction.
    const unclosed = [...edges.values()].filter(({p, q, count}) => count === 1 &&
      ((p[2] === front && q[2] === front) || (p[2] === back && q[2] === back)))
    assert.deepEqual(unclosed, [], 'Crown/side contour must triangulate without unclosed outer face edges')
  })
}

test('review R4-SAMPLERS-1: ready binds each floor and soffit channel to its loaded family', {
  skip: !sourceRoot && 'Set V2_REVIEW_SOURCE_ROOT to a pinned source extraction',
}, async () => {
  globalThis.window ??= {}
  const E = await import('threepipe'), THREE = await import('three')
  const {mountV2Materials} = await source('lib/view/v2/materials.js')
  const root = new E.Group(), original = new E.PhysicalMaterial({name: 'Map ground'})
  const mesh = new E.Mesh2(new E.BoxGeometry(), original); root.add(mesh)
  const loaded = new Map(), disposals = new Map()
  const h = mountV2Materials({root, loadTexture: async url => {
    const texture = new E.Texture()
    loaded.set(url.split('/').at(-1), texture); disposals.set(texture, 0)
    texture.addEventListener('dispose', () => disposals.set(texture, disposals.get(texture) + 1))
    return texture
  }})
  try {
    await h.ready
    const shader = {...THREE.ShaderLib.physical, uniforms: {}}
    mesh.material.onBeforeCompile(shader, {})
    assert.equal(loaded.size, 9)
    for (const [uniform, file] of [
      ['v2Albedo', 'photo-worn-albedo.jpg'], ['v2PhotoNormal', 'photo-worn-normal.png'], ['v2Surface', 'photo-worn-orm.png'],
      ['v2GroundAlbedo', 'substrate-rubble-albedo.jpg'], ['v2GroundNormal', 'substrate-rubble-normal.png'], ['v2GroundSurface', 'substrate-rubble-orm.png'],
      ['v2SoffitAlbedo', 'photo-soffit-albedo.jpg'], ['v2SoffitNormal', 'photo-soffit-normal.png'], ['v2SoffitSurface', 'photo-soffit-orm.png'],
    ]) assert.equal(shader.uniforms[uniform].value, loaded.get(file), `${uniform} must bind ${file}, not another ready texture family`)
  } finally {
    h.dispose(); h.dispose()
    assert.equal(mesh.material, original)
    for (const count of disposals.values()) assert.equal(count, 1)
    mesh.geometry.dispose(); original.dispose()
  }
})
