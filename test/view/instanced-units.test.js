import test from 'node:test'
import assert from 'node:assert/strict'
// Use the collider tool's DOM and texture shims. Geometry and animation remain real.
import {measureRosterParts} from '../../tools/collider-fit.mjs'
await measureRosterParts()
const E = await import('threepipe')
const {loadUnitAsset} = await import('../../tools/load-unit-asset.mjs')
const {defaultMap} = await import('../../lib/core/map.js')
const {NavGrid} = await import('../../lib/core/nav.js')
const {unitMaterials} = await import('../../lib/view/unit-materials.js')
const {getQualityPreset} = await import('../../lib/view/performance-quality.js')
const {bindUnitRig, animateUnit} = await import('../../lib/view/units-animation.js')
const {clonePlacedUnitFigure} = await import('../../lib/view/unit-assets.js')
const {InstancedUnits, boneTextureSize, patchInstancedSkinning, INSTANCED_SKINNING_MARKER} =
  await import('../../lib/view/instanced-units.js')
const {UnitView, TEMPLATE_NAMES} = await import('../../lib/view/units.js')
const {releaseMeshGeometry, geometryListeners} = await import('../../lib/view/mesh-release.js')

const scoutSource = await loadUnitAsset('scout')
const nav = new NavGrid(defaultMap)
const quality = getQualityPreset('high')

function system(capacity = 40) {
  const scene = new E.Scene()
  const made = new InstancedUnits({scene}, {source: scoutSource, type: 'scout', capacity,
    materials: unitMaterials(E), quality})
  made.start(scene)
  return {scene, system: made}
}

const scout = (id, x, z, extra = {}) => ({id, type: 'scout', pos: {x, y: 0, z}, yaw: .2,
  vel: {x: 0, z: 5}, alive: true, intent: {}, maxHp: 90, ...extra})

function camera() {
  const view = new E.PerspectiveCamera(54, 16 / 9, .1, 200)
  view.position.set(0, 2, -6); view.lookAt(0, 1, 40)
  view.updateProjectionMatrix(); view.updateMatrixWorld(true)
  return view
}

function syncArgs(units) {
  const lens = camera()
  const frustum = new E.Frustum().setFromProjectionMatrix(
    new E.Matrix4().multiplyMatrices(lens.projectionMatrix, lens.matrixWorldInverse))
  return {units, args: {player: {pos: {x: 0, y: 0, z: -6}}, frustum, cullSphere: new E.Sphere(),
    dt: 1 / 60, time: 0, nav}}
}

test('a slot is taken once, returned on release, and a full table falls back instead of failing', () => {
  const {system: units} = system(4)
  const taken = ['a', 'b', 'c', 'd'].map(id => units.acquire(scout(id, 0, 3)))
  const slots = taken.map(instance => instance.slot)
  assert.equal(new Set(slots).size, 4, 'each live common holds its own slot')
  assert.equal(units.free.length, 0)
  assert.equal(units.acquire(scout('e', 0, 3)), null, 'a full slot table reports no slot')
  assert.equal(units.lostSlots, 1)
  assert.equal(units.acquire(scout('a', 0, 3)), taken[0], 'an existing unit keeps its slot')
  const released = units.release('b')
  assert.equal(released, taken[1])
  assert.equal(units.has('b'), false)
  assert.deepEqual(units.free, [released.slot])
  assert.equal(units.acquire(scout('e', 0, 3)).slot, released.slot, 'the freed slot is reused')
  assert.equal(units.release('missing'), null)
  units.dispose()
})

test('the bone texture holds capacity x boneCount matrices, four texels each, one slot per unit', () => {
  const {system: units} = system(40)
  assert.equal(units.boneCount, 28, 'the scout rig has 28 joints')
  const size = units.skeleton.boneTexture.image.width
  assert.equal(size, boneTextureSize(40 * 28))
  assert.equal(size % 4, 0, 'a row width that is a multiple of four keeps a matrix inside one row')
  assert.ok(size * size >= 40 * 28 * 4, 'every slot has four texels per bone')
  assert.equal(units.skeleton.boneTexture.format, E.RGBAFormat)
  assert.equal(units.skeleton.boneTexture.type, E.FloatType)
  assert.equal(units.boneMatrices.length, size * size * 4)
  assert.equal(units.boneTextureBytes, size * size * 4 * 4)

  const {units: list, args} = syncArgs([scout('near', 0, 4), scout('far', 0, 26)])
  for (const unit of list) units.acquire(unit)
  units.sync({tick: 1, units: list}, args)
  const near = units.get('near'), far = units.get('far')
  const at = (instance, bone) => units.boneMatrices.slice(
    (instance.slot * units.boneCount + bone) * 16, (instance.slot * units.boneCount + bone) * 16 + 16)
  assert.notDeepEqual([...at(near, 3)], [...at(far, 3)], 'two slots hold two independent poses')
  assert.ok(units.boneMatrices.every(Number.isFinite))
  // Nothing outside the live slots is touched by a sync: every unused slot
  // still holds the rest palette written when the table was built.
  const spare = slot => [...units.boneMatrices.slice(slot * units.boneCount * 16, (slot + 1) * units.boneCount * 16)]
  assert.deepEqual(spare(38), spare(39), 'two unused slots still hold the same rest pose')
  assert.notDeepEqual(spare(38), new Array(units.boneCount * 16).fill(0), 'the rest palette is not a zero matrix')
  units.dispose()
})

test('the surface and the shadow depth material both read bone instanceSlot * boneCount + i', () => {
  const {system: units} = system(8)
  const source = () => ({vertexShader: '#include <skinning_pars_vertex>\nvoid main(){}',
    fragmentShader: 'void main(){}', uniforms: {}})
  const extension = units.material.materialExtensions.find(item => item.uuid === 'terminator-instanced-skinning')
  assert.ok(extension, 'the surface material carries the instanced skinning extension')
  const surface = source(); extension.shaderExtender(surface)
  const depth = source(); units.depthMaterial.onBeforeCompile(depth)
  for (const [name, shader] of [['surface', surface], ['depth', depth]]) {
    assert.ok(shader.vertexShader.includes(INSTANCED_SKINNING_MARKER), `${name} getBoneMatrix is offset by the instance`)
    assert.ok(shader.vertexShader.includes('attribute float instanceSlot;'), `${name} declares the instanced slot attribute`)
    assert.ok(shader.vertexShader.includes(`* ${units.boneCount} +`), `${name} strides by the bone count`)
    assert.ok(!shader.vertexShader.includes('#include <skinning_pars_vertex>'), `${name} replaced the stock chunk`)
  }
  assert.ok(units.material.customProgramCacheKey().includes('terminator-instanced-skinning'))
  assert.equal(units.depthMaterial.customProgramCacheKey(), `terminator-instanced-skinning-depth-${units.boneCount}`)
  assert.equal(units.high.customDepthMaterial, units.depthMaterial)
  assert.equal(units.far.customDepthMaterial, units.depthMaterial)
  // The patch must never silently do nothing if three moves the chunk.
  assert.throws(() => patchInstancedSkinning({vertexShader: 'void main(){}'}, 28), /skinning_pars_vertex/)
  units.dispose()
})

test('LOD follows distance, and the shadow pass always draws the far figure for the whole crowd', () => {
  const {system: units} = system(40)
  const near = [scout('n0', -1, 3), scout('n1', 1, 5)]
  const far = [scout('f0', -1, 22), scout('f1', 1, 30)]
  const behind = [scout('b0', 0, -20)]
  const {units: list, args} = syncArgs([...near, ...far, ...behind])
  for (const unit of list) units.acquire(unit)
  units.sync({tick: 1, units: list}, args)
  assert.equal(quality.instancedLodDistance, 12)
  for (const unit of near) assert.equal(units.get(unit.id).lod, 'high', `${unit.id} inside 12 m uses the high figure`)
  for (const unit of far) assert.equal(units.get(unit.id).lod, 'far', `${unit.id} uses the far figure`)
  for (const unit of behind) assert.equal(units.get(unit.id).lod, 'hidden', `${unit.id} is off screen and draws no colour`)
  assert.equal(units.highCount, 2)
  assert.equal(units.farCount, 2)
  assert.equal(units.live, 5)
  assert.equal(units.high.count, 2, 'the colour pass draws only the near instances from the high mesh')
  assert.equal(units.far.count, 2, 'the colour pass draws only the visible distant instances')
  assert.equal(units.high.castShadow, false, 'the heavy figure never enters a shadow map')
  assert.equal(units.far.castShadow, true)
  units.far.onBeforeShadow()
  assert.equal(units.far.count, 5, 'the shadow pass covers every live instance from the cheap figure')
  units.far.onAfterShadow()
  assert.equal(units.far.count, 2)
  // The far mesh packs visible distant instances first, so raising the count for
  // the shadow pass adds the near and the off-screen ones without a second draw.
  const slots = units.far.geometry.getAttribute('instanceSlot').array
  assert.deepEqual([...slots.slice(0, 2)].sort(), far.map(u => units.get(u.id).slot).sort())
  assert.deepEqual([...slots.slice(0, 5)].sort(), [...far, ...behind, ...near].map(u => units.get(u.id).slot).sort())
  units.dispose()
})

test('the instanced bone palette reproduces the world skinning of an equivalent rig', () => {
  const scene = new E.Scene()
  // Step the palette and the rig on the same schedule so only the maths differ.
  const units = new InstancedUnits({scene}, {source: scoutSource, type: 'scout', capacity: 4,
    materials: unitMaterials(E), quality: {...quality, animationHz: 60, farAnimationHz: 60, animationLodDistance: 1e4}})
  units.start(scene)
  const unit = scout('parity', 3, 7)
  const instance = units.acquire(unit)
  const rig = bindUnitRig(clonePlacedUnitFigure(scoutSource, 'scout', 'high'))
  rig.object.position.set(unit.pos.x, unit.pos.y, unit.pos.z)
  rig.object.rotation.y = unit.yaw
  rig.previous.set(unit.pos.x, unit.pos.y, unit.pos.z)
  const {units: list, args} = syncArgs([unit])
  for (let tick = 1; tick <= 24; tick++) {
    units.sync({tick, units: list}, {...args, time: tick / 60})
    animateUnit(rig, unit, 1 / 60, tick / 60, nav)
  }
  rig.object.updateMatrixWorld(true)

  const geometry = rig.mesh.geometry
  const position = geometry.getAttribute('position')
  const index = geometry.getAttribute('skinIndex'), weight = geometry.getAttribute('skinWeight')
  const bone = new E.Matrix4(), accumulated = new E.Matrix4(), skinned = new E.Vector4()
  const skin = (matrixFor, vertex) => {
    const elements = accumulated.elements.fill(0)
    for (let slot = 0; slot < 4; slot++) {
      const w = weight.getComponent(vertex, slot)
      if (!w) continue
      matrixFor(index.getComponent(vertex, slot), bone)
      for (let i = 0; i < 16; i++) elements[i] += bone.elements[i] * w
    }
    skinned.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex), 1)
    skinned.applyMatrix4(rig.mesh.bindMatrix).applyMatrix4(accumulated)
    return new E.Vector3(skinned.x, skinned.y, skinned.z)
  }
  const fromRig = vertex => skin((id, out) =>
    out.multiplyMatrices(rig.mesh.skeleton.bones[id].matrixWorld, rig.mesh.skeleton.boneInverses[id]), vertex)
  const fromPalette = vertex => {
    const world = skin((id, out) =>
      out.fromArray(units.boneMatrices, (instance.slot * units.boneCount + id) * 16), vertex)
    return world.applyMatrix4(instance.matrix)
  }
  let worst = 0
  for (let vertex = 0; vertex < position.count; vertex += 911) {
    worst = Math.max(worst, fromRig(vertex).distanceTo(fromPalette(vertex)))
  }
  assert.ok(worst < 1e-4, `instanced skinning lands on the rig, worst gap ${worst.toExponential(2)} m`)
  assert.ok(fromRig(0).length() > 1, 'the compared vertex is really placed in the world')
  units.dispose()
})

test('the hand-off copies the instance pose and placement onto a real rig', () => {
  const {system: units} = system(4)
  const unit = scout('dying', -2, 9)
  const instance = units.acquire(unit)
  const {units: list, args} = syncArgs([unit])
  for (let tick = 1; tick <= 12; tick++) units.sync({tick, units: list}, {...args, time: tick / 60})
  const object = clonePlacedUnitFigure(scoutSource, 'scout', 'high')
  const visual = {object, rig: bindUnitRig(object), unitType: 'scout',
    impact: {direction: new E.Vector3(), point: new E.Vector3(), weapon: null, headshot: false, tick: -1}}
  instance.impact.weapon = 'shotgun'; instance.impact.headshot = true; instance.impact.tick = 7
  instance.impact.point.set(1, 2, 3); instance.impact.direction.set(0, 0, 1)
  units.handOff(instance, visual)
  const bones = visual.rig.mesh.skeleton.bones
  for (let i = 0; i < bones.length; i++) {
    assert.deepEqual(bones[i].position.toArray().map(v => +v.toFixed(6)),
      [...instance.pose.slice(i * 10, i * 10 + 3)].map(v => +v.toFixed(6)), `${bones[i].name} position`)
    assert.deepEqual(bones[i].quaternion.toArray().map(v => +v.toFixed(6)),
      [...instance.pose.slice(i * 10 + 3, i * 10 + 7)].map(v => +v.toFixed(6)), `${bones[i].name} rotation`)
  }
  assert.ok(bones.some(bone => Math.abs(bone.quaternion.x) > .01), 'the copied pose is a posed one, not the rest pose')
  assert.ok(Math.abs(object.position.x - unit.pos.x) < 1e-5 && Math.abs(object.position.z - unit.pos.z) < 1e-5)
  assert.ok(Math.abs(object.scale.x - units.scratch.scale.x) < 1e-6, 'the figure keeps its authored scale')
  assert.equal(visual.impact.weapon, 'shotgun')
  assert.equal(visual.impact.headshot, true)
  assert.equal(visual.rig.phase, instance.scalars[2], 'the gait phase travels with the corpse')
  units.dispose()
})

// ------------------------------------------------------------ integration

async function view() {
  const scene = new E.Scene()
  scene.modelRoot = new E.Group(); scene.add(scene.modelRoot)
  scene.mainCamera = camera()
  for (const [type, name] of Object.entries(TEMPLATE_NAMES)) {
    const source = (await loadUnitAsset(type)).clone(); source.name = name; scene.modelRoot.add(source)
  }
  globalThis.window.addEventListener ??= () => {}
  globalThis.window.removeEventListener ??= () => {}
  return new UnitView({scene, addEventListener() {}, removeEventListener() {}})
}

function world(units) {
  return {map: defaultMap, nav, tick: 0, eventLog: [], maxAlive: 32,
    units, unitById: new Map(units.map(unit => [unit.id, unit])),
    player: {id: 'player', pos: {x: 0, y: 0, z: -6}, yaw: 0, pitch: 0}}
}

test('sixteen commons add no node to the units runtime root, and render as two draws', async () => {
  const unitView = await view()
  try {
    const state = world([])
    unitView.start(state)
    const before = []; unitView.root.traverse(node => before.push(node))
    state.units = Array.from({length: 16}, (_, i) => scout('mob-' + i, (i % 4) * 1.4 - 2, 4 + Math.floor(i / 4) * 1.4))
    state.unitById = new Map(state.units.map(unit => [unit.id, unit]))
    for (let tick = 1; tick <= 6; tick++) { state.tick = tick; unitView.sync(state) }
    const after = []; unitView.root.traverse(node => after.push(node))
    assert.equal(after.length, before.length, 'the units runtime root gained no scene node')
    assert.equal(unitView.visuals.size, 0, 'no common owns a rig')
    const [report] = unitView.instancedReport()
    assert.equal(report.live, 16)
    assert.equal(report.high + report.far, 16)
    assert.equal(report.drawCalls, 2, 'sixteen scouts are two instanced draws')
    assert.equal(report.nodes, 3, 'the instanced root holds only its two LOD meshes')
    assert.ok(report.poseMs >= 0)
    const system = unitView.instancedList[0]
    // setQuality still reaches the horde: a lower preset pulls the near figure in.
    unitView.setQuality(getQualityPreset('low'))
    assert.equal(system.quality.id, 'low')
    assert.equal(system.quality.instancedLodDistance, 6)
    unitView.setQuality(quality)
    assert.equal(system.quality.instancedLodDistance, 12)
    assert.equal(system.root.parent, unitView.viewer.scene, 'the instanced root lives outside modelRoot')
    assert.equal(system.root.matrixAutoUpdate, false, 'a root that never moves is held still')
    assert.equal(system.high.matrixAutoUpdate, false)
    assert.equal(system.far.matrixAutoUpdate, false)
  } finally { unitView.stop() }
})

test('a common that dies hands its pose to a pooled rig and frees its slot', async () => {
  const unitView = await view()
  try {
    const victim = scout('victim', 0, 5)
    const state = world([victim])
    unitView.start(state)
    for (let tick = 1; tick <= 8; tick++) { state.tick = tick; unitView.sync(state) }
    const system = unitView.instancedList[0]
    const instance = system.get('victim')
    assert.ok(instance, 'a live common owns an instance')
    const freeBefore = system.free.length
    const pose = Float32Array.from(instance.pose)
    const slot = instance.slot

    victim.alive = false; victim.diedAtTick = state.tick
    state.eventLog.push({type: 'kill', unitId: 'victim', tick: state.tick, weapon: 'm4',
      headshot: true, pos: {x: 0, y: .8, z: 5}, direction: {x: 0, y: 0, z: 1}})
    state.tick += 1
    unitView.sync(state)

    assert.equal(system.has('victim'), false, 'the slot is released on death')
    assert.equal(system.free.length, freeBefore + 1)
    assert.ok(system.free.includes(slot))
    const visual = unitView.visuals.get('victim')
    assert.ok(visual, 'the corpse is a pooled rig again')
    assert.ok(visual.ragdoll, 'the rig went straight into the ragdoll system')
    assert.equal(unitView.ragdolls.records.size, 1)
    assert.equal(visual.rig.mesh.skeleton.bones.length, system.boneCount)
    assert.ok(Math.hypot(visual.object.position.x - victim.pos.x, visual.object.position.z - victim.pos.z) < .01,
      'the corpse rig stands where the instance stood')
    assert.equal(visual.impact.weapon, 'm4')
    assert.equal(visual.impact.headshot, true)
    assert.ok(pose.some(Number.isFinite))
  } finally { unitView.stop() }
})

test('stop removes the instanced roots and disposes every GPU resource they own', async () => {
  const unitView = await view()
  try {
    const state = world([scout('a', 0, 4), scout('b', 1, 6)])
    unitView.start(state)
    state.tick = 1; unitView.sync(state)
    const system = unitView.instancedList[0]
    const disposed = new Set()
    for (const item of [system.high.geometry, system.far.geometry, system.material,
      system.depthMaterial, system.skeleton.boneTexture]) {
      item.addEventListener?.('dispose', () => disposed.add(item))
    }
    const skeleton = system.skeleton
    const root = system.root
    unitView.stop()
    assert.equal(root.parent, null, 'the instanced root left the scene')
    assert.equal(disposed.size, 5, 'both geometries, both materials and the bone texture are disposed')
    assert.equal(skeleton.boneTexture, null, 'the shared skeleton dropped the bone palette')
    assert.equal(unitView.instancedList.length, 0)
    assert.equal(unitView.instanced, null)
  } finally { unitView.stop() }
})

test('a disposed or recycled mesh leaves no geometryUpdate listener on its old geometry', async () => {
  // threepipe only installs the listener on an object it has upgraded, which is
  // every object the real viewer sees. Upgrade the fixtures the same way.
  const geometry = new E.BoxGeometry(1, 1, 1), swapped = new E.BoxGeometry(1, 1, 1)
  const mesh = new E.Mesh(geometry, new E.UnlitMaterial())
  E.iObjectCommons.upgradeObject3D.call(mesh)
  assert.equal(geometryListeners(geometry), 1, 'holding a geometry registers one listener on it')
  mesh.geometry = swapped
  assert.equal(geometryListeners(geometry), 0, 'a recycled mesh releases the geometry it left')
  assert.equal(geometryListeners(swapped), 1)
  assert.equal(releaseMeshGeometry(mesh), 1)
  assert.equal(geometryListeners(swapped), 0, 'a dropped mesh releases its last geometry')
  assert.equal(releaseMeshGeometry(mesh), 0, 'releasing twice is a no-op')

  const unitView = await view()
  try {
    const state = world([scout('a', 0, 4)])
    unitView.start(state)
    state.tick = 1; unitView.sync(state)
    const system = unitView.instancedList[0]
    const held = [system.high, system.far, unitView.fx.decalMesh, unitView.fx.emberMesh,
      unitView.fx.gore.stainMesh, unitView.fx.gore.stumpMesh, ...unitView.fx.poolList.map(pool => pool.mesh)]
    const geometries = held.map(mesh => mesh.geometry)
    for (const mesh of held) E.iObjectCommons.upgradeObject3D.call(mesh)
    for (const [index, item] of geometries.entries()) {
      assert.ok(geometryListeners(item) >= 1, `${held[index].name} holds its geometry before stop`)
    }
    unitView.stop()
    for (const [index, item] of geometries.entries()) {
      assert.equal(geometryListeners(item), 0, `${held[index].name} let go of its geometry on stop`)
    }
  } finally { unitView.stop() }
})
