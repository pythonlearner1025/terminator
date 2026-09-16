// Data-oriented presentation for the horde.
//
// A common unit (today: the T-600 Scout) owns no scene node. It owns a slot
// number. Everything the renderer needs for that unit lives in flat arrays
// indexed by that slot: one 4x4 world matrix in `instanceMatrix`, one tint in
// `instanceColor`, one slot id in the `instanceSlot` instanced attribute, and
// `boneCount` bone matrices in one shared bone texture. Thirty scouts are one
// draw call; the skinning runs on the GPU from that one texture.
//
// The pose still comes from the same procedural animator in units-animation.js.
// It runs on ONE hidden scratch rig that is never added to the scene. Before
// each instance is evaluated the scratch rig is loaded with that instance's
// bone transforms and animator state, and after evaluation both are written
// back out. The renderer never sees the scratch rig, so no per-unit subtree is
// walked for world matrices, built into a render list, or built again into the
// shadow-map render list.
import * as E from 'threepipe'
import {animateUnit, bindUnitRig, disposeUnitRig} from './units-animation.js'
import {clonePlacedUnitFigure} from './unit-assets.js'
import {combineOrmMaterial} from './orm-material.js'
import {holdStill} from './hidden-subtrees.js'
import {releaseMeshGeometry} from './mesh-release.js'

// Only `role: "common"` types are instanced. Specials keep their own rigs.
export const INSTANCED_UNIT_TYPES = new Set(['scout'])

// Per-instance animator scalars. Everything else the animator keeps between
// frames is an object and is swapped by reference instead of copied.
const POSE_SCALARS = ['rise', 'groundPitch', 'phase', 'move', 'aim', 'spin', 'recoil', 'hit', 'headshot',
  'death', 'stagger', 'heat', 'fallVelocity', 'fallAngle', 'fallSpin', 'crawl']
const BONE_FLOATS = 10 // position 3, quaternion 4, scale 3
const FLASH_SECONDS = .16

// One bone matrix is four RGBA texels. Keep the row width a multiple of four so
// no matrix straddles a row and `getBoneMatrix` can read it with four fetches.
export function boneTextureSize(matrices) {
  let size = Math.sqrt(matrices * 4)
  size = Math.ceil(size / 4) * 4
  return Math.max(size, 4)
}

// The shader patch. three 0.163 has no instanced skinning: `getBoneMatrix(i)`
// reads bone `i` of the one skeleton bound to the draw. This replacement reads
// bone `instanceSlot * boneCount + i` from one shared texture, so every
// instance in the draw gets its own pose. Everything else in the skinning path
// (skinbase, skinning_vertex, skinnormal) is unchanged and still works.
export function instancedSkinningPars(boneCount) {
  return `
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	attribute float instanceSlot;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = ( int( instanceSlot ) * ${boneCount} + int( i ) ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
`
}

export const INSTANCED_SKINNING_MARKER = 'int j = ( int( instanceSlot )'

// Both mounts below call this: the surface material through threepipe's
// material-extension hook (which runs inside its own onBeforeCompile and owns
// the program cache key), and the shadow depth material through three's plain
// onBeforeCompile. The patched source is identical either way.
export function patchInstancedSkinning(shader, boneCount) {
  const include = '#include <skinning_pars_vertex>'
  if (!shader.vertexShader.includes(include)) throw new Error('Instanced skinning patch found no skinning_pars_vertex include')
  shader.vertexShader = shader.vertexShader.replace(include, instancedSkinningPars(boneCount))
  return shader
}

// The renderer only uploads a bone texture and the bind matrices when
// `object.isSkinnedMesh` is true, and only draws instances when
// `object.isInstancedMesh` is true. This object is both. The skeleton it
// carries is shared by every LOD mesh and owns the one bone texture; its
// `update` is a no-op because this module writes the matrices itself.
class InstancedBoneSkeleton {
  constructor(texture, matrices) {
    this.boneTexture = texture
    this.boneMatrices = matrices
    this.bones = []
    this.boneInverses = []
  }
  update() {}
  dispose() { this.boneTexture?.dispose(); this.boneTexture = null }
}

class SkinnedInstancedMesh extends E.InstancedMesh {
  constructor(geometry, material, capacity, skeleton, bindMatrix) {
    super(geometry, material, capacity)
    this.isSkinnedMesh = true
    this.bindMode = 'detached'
    // Bone matrices are written in unit-local space (see `writeBones`), so the
    // shader must not map back through a mesh world matrix. The instance
    // matrix alone places the finished pose in the world.
    this.bindMatrix = bindMatrix.clone()
    this.bindMatrixInverse = new E.Matrix4()
    this.skeleton = skeleton
    this.count = 0
    this.frustumCulled = false
    this.instanceMatrix.setUsage(E.DynamicDrawUsage)
    this.instanceColor = new E.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3)
    this.instanceColor.setUsage(E.DynamicDrawUsage)
  }
  // Gameplay rays are resolved by the core. View rays resolve against instance
  // bounds in InstancedUnits.hit, never against a rig this mesh does not have.
  raycast() {}
}

const markRange = (attribute, count) => {
  attribute.clearUpdateRanges(); attribute.addUpdateRange(0, count); attribute.needsUpdate = true
}

function cloneContacts(contacts) {
  if (!contacts) return null
  return contacts.map(contact => ({...contact,
    anchor: contact.anchor.clone(), start: contact.start.clone(), end: contact.end.clone(),
    target: contact.target.clone(), desired: contact.desired.clone(),
    pad: contact.pad?.clone(), sole: contact.sole?.clone()}))
}

function cloneFoot(foot) {
  return {...foot, anchor: foot.anchor.clone(), start: foot.start.clone(), end: foot.end.clone(),
    target: foot.target.clone(), desired: foot.desired.clone()}
}

export class InstancedUnits {
  constructor(viewer, {source, type = 'scout', capacity = 40, materials, quality}) {
    this.viewer = viewer
    this.type = type
    this.capacity = capacity
    this.quality = quality

    // One hidden scratch rig. It is never added to the scene and never drawn.
    this.scratch = clonePlacedUnitFigure(source, type, 'high')
    this.scratch.name = `Instanced ${type} scratch rig`
    this.scratch.position.set(0, 0, 0); this.scratch.rotation.set(0, 0, 0)
    this.scratch.updateMatrixWorld(true)
    this.rig = bindUnitRig(this.scratch)
    this.bones = this.rig.mesh.skeleton.bones
    this.boneInverses = this.rig.mesh.skeleton.boneInverses
    this.boneCount = this.bones.length
    this.emitters = this.rig.eyes ? [...this.rig.eyes.children] : []

    const size = boneTextureSize(capacity * this.boneCount)
    this.boneMatrices = new Float32Array(size * size * 4)
    this.boneTextureBytes = this.boneMatrices.byteLength
    const texture = new E.DataTexture(this.boneMatrices, size, size, E.RGBAFormat, E.FloatType)
    texture.name = `Instanced ${type} bone palette ${size}x${size}`
    texture.needsUpdate = true
    this.skeleton = new InstancedBoneSkeleton(texture, this.boneMatrices)

    this.material = this.buildMaterial(materials)
    this.depthMaterial = this.buildDepthMaterial()

    const far = clonePlacedUnitFigure(source, type, 'far')
    const farMesh = far.getObjectByName('Combined articulated steel')
    this.root = new E.Group()
    this.root.name = `Instanced ${type} commons`
    this.high = new SkinnedInstancedMesh(this.instancedGeometry(this.rig.mesh.geometry), this.material,
      capacity, this.skeleton, this.rig.mesh.bindMatrix)
    this.high.name = `Instanced ${type} high figure`
    this.far = new SkinnedInstancedMesh(this.instancedGeometry(farMesh.geometry), this.material,
      capacity, this.skeleton, farMesh.bindMatrix)
    this.far.name = `Instanced ${type} far figure`
    // The near figure is 24,512 triangles and the far figure 11,004. Shadows
    // never need the near one, so only the far mesh casts. During the shadow
    // pass its count is raised to cover every live instance (see `packLists`),
    // then restored before the colour pass.
    this.high.castShadow = false; this.high.receiveShadow = true
    this.far.castShadow = true; this.far.receiveShadow = true
    for (const mesh of [this.high, this.far]) {
      mesh.customDepthMaterial = this.depthMaterial
      this.root.add(mesh)
    }
    this.far.onBeforeShadow = () => { if (this.live > 0) this.far.count = this.live }
    this.far.onAfterShadow = () => { if (this.live > 0) this.far.count = this.farCount }
    this.disposeFar = () => { for (const child of far.children) child.geometry?.dispose?.(); releaseMeshGeometry(far) }

    this.rest = new Float32Array(this.boneCount * BONE_FLOATS)
    this.readBones(this.rest)
    this.free = []
    this.matrix = new E.Matrix4(); this.rootInverse = new E.Matrix4(); this.bone = new E.Matrix4()
    // Every slot starts holding the rest pose, so warmup compiles and draws a
    // real figure instead of a collapsed one built from zeroed matrices.
    for (let slot = 0; slot < capacity; slot++) this.writeBones(slot)
    for (let slot = capacity - 1; slot >= 0; slot--) this.free.push(slot)
    this.instances = new Map()
    this.live = 0; this.farCount = 0; this.highCount = 0
    this.lostSlots = 0

    this.quaternion = new E.Quaternion(); this.scale = new E.Vector3(); this.position = new E.Vector3()
    this.color = new E.Color(); this.box = new E.Box3(); this.ray = new E.Ray(); this.point = new E.Vector3()
    this.localBounds = this.figureBounds(this.rig.mesh.geometry)
    this.stats = {poseMs: 0, posed: 0, maxPoseMs: 0, boneTextureBytes: this.boneTextureBytes,
      capacity, boneCount: this.boneCount, highTriangles: 0, farTriangles: 0, drawCalls: 0}
    this.triangles = {
      high: this.high.geometry.getAttribute('position').count / 3,
      far: this.far.geometry.getAttribute('position').count / 3,
    }
  }

  // The instanced draw needs its own `instanceSlot` attribute and its own
  // patched material, so it cannot reuse the template geometry object. The
  // clone keeps JOINTS_0 and WEIGHTS_0: skinning stays on the GPU.
  instancedGeometry(source) {
    const geometry = source.clone()
    for (const name of Object.keys(geometry.attributes)) {
      if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(name)) geometry.deleteAttribute(name)
    }
    if (!geometry.getAttribute('skinIndex')) throw new Error('Instanced unit geometry lost its JOINTS_0 attribute')
    if (!geometry.getAttribute('skinWeight')) throw new Error('Instanced unit geometry lost its WEIGHTS_0 attribute')
    const slots = new E.InstancedBufferAttribute(new Float32Array(this.capacity), 1)
    slots.setUsage(E.DynamicDrawUsage)
    geometry.setAttribute('instanceSlot', slots)
    return geometry
  }

  buildMaterial(materials) {
    const source = materials.metal
    const material = source.clone()
    material.name = `Instanced ${this.type} endoskeleton`
    // clone() keeps maps and userData but drops registered extensions, so the
    // shared-ORM sample has to be re-registered next to the skinning patch.
    combineOrmMaterial(material)
    material.userData.renderToGBuffer = false
    const boneCount = this.boneCount
    material.registerMaterialExtensions([{
      uuid: 'terminator-instanced-skinning',
      computeCacheKey: `terminator-instanced-skinning-${boneCount}`,
      priority: 100,
      shaderExtender(shader) { patchInstancedSkinning(shader, boneCount) },
    }])
    // The environment map is assigned when the HDR resolves, after this runs.
    material.envMap = source.envMap
    materials.ready?.then(() => {
      if (!this.material || this.material.envMap === source.envMap) return
      this.material.envMap = source.envMap
      this.material.needsUpdate = true
    }).catch(() => {})
    return material
  }

  // The shadow pass draws through `customDepthMaterial`, a separate program
  // that also needs the patched getBoneMatrix or every instance would cast the
  // first instance's pose. No point light in this project casts a shadow, so
  // no `customDistanceMaterial` is installed.
  buildDepthMaterial() {
    const boneCount = this.boneCount
    const material = new E.MeshDepthMaterial({depthPacking: E.RGBADepthPacking})
    material.name = `Instanced ${this.type} shadow depth`
    material.onBeforeCompile = shader => { patchInstancedSkinning(shader, boneCount) }
    material.customProgramCacheKey = () => `terminator-instanced-skinning-depth-${boneCount}`
    return material
  }

  figureBounds(geometry) {
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    // The rest pose is a crouched quadruped; widen it so a moving figure and a
    // reared melee pose both stay inside the view-ray volume.
    const box = geometry.boundingBox.clone()
    box.min.addScalar(-.25); box.max.addScalar(.25)
    box.max.y = Math.max(box.max.y, 1.5)
    return box
  }

  handles(unit) { return unit?.type === this.type }
  has(id) { return this.instances.has(id) }
  get(id) { return this.instances.get(id) }
  setQuality(quality) { this.quality = quality }

  readBones(target) {
    for (let i = 0; i < this.boneCount; i++) {
      const bone = this.bones[i], at = i * BONE_FLOATS
      bone.position.toArray(target, at)
      bone.quaternion.toArray(target, at + 3)
      bone.scale.toArray(target, at + 7)
    }
  }

  writePose(pose) {
    for (let i = 0; i < this.boneCount; i++) {
      const bone = this.bones[i], at = i * BONE_FLOATS
      bone.position.fromArray(pose, at)
      bone.quaternion.fromArray(pose, at + 3)
      bone.scale.fromArray(pose, at + 7)
    }
  }

  acquire(unit) {
    let instance = this.instances.get(unit.id)
    if (instance) return instance
    const slot = this.free.pop()
    if (slot === undefined) { this.lostSlots++; return null }
    const rig = this.rig
    instance = {
      id: unit.id, slot, unitType: unit.type,
      pose: new Float32Array(this.rest),
      scalars: new Float64Array(POSE_SCALARS.length),
      // `rig.targets` is deliberately absent. `rig.pose` is a closure over the
      // object bindUnitRig built, so swapping `rig.targets` would leave the
      // animator writing one object and reading another. It does not need to be
      // per-instance: animateUnit rewrites every target of a common on every
      // call, so a target never carries state from one frame to the next.
      flinches: Object.fromEntries(Object.keys(rig.flinches).map(name => [name, {life: 0, strength: 0, side: 0}])),
      feet: {Left: cloneFoot(rig.feet.Left), Right: cloneFoot(rig.feet.Right)},
      contacts: cloneContacts(rig.scoutContacts),
      severed: new Set(), states: new Set(), previous: new E.Vector3(unit.pos.x, unit.pos.y, unit.pos.z),
      eyesDead: false, eyePower: new Float32Array(this.emitters.length),
      eyeMatrices: Array.from({length: this.emitters.length}, () => new E.Matrix4()),
      eyesVisible: false,
      matrix: new E.Matrix4(), flash: 0, lastTick: null, lod: 'far',
      impact: {direction: new E.Vector3(), point: new E.Vector3(), weapon: null, headshot: false, tick: -1},
    }
    this.instances.set(unit.id, instance)
    return instance
  }

  release(id) {
    const instance = this.instances.get(id)
    if (!instance) return null
    this.instances.delete(id)
    this.free.push(instance.slot)
    return instance
  }

  loadState(instance) {
    const rig = this.rig
    for (let i = 0; i < POSE_SCALARS.length; i++) rig[POSE_SCALARS[i]] = instance.scalars[i]
    rig.eyesDead = instance.eyesDead
    rig.flinches = instance.flinches; rig.feet = instance.feet
    rig.scoutContacts = instance.contacts; rig.severed = instance.severed; rig.states = instance.states
    rig.previous = instance.previous
    this.writePose(instance.pose)
  }

  saveState(instance) {
    const rig = this.rig
    for (let i = 0; i < POSE_SCALARS.length; i++) instance.scalars[i] = rig[POSE_SCALARS[i]]
    instance.eyesDead = rig.eyesDead
    this.readBones(instance.pose)
  }

  // The bone palette is written in unit-local space: rootInverse cancels the
  // scratch rig's world placement, so the instance matrix alone positions the
  // finished pose. That is what lets one draw place thirty scouts.
  writeBones(slot) {
    this.rootInverse.copy(this.scratch.matrixWorld).invert()
    const base = slot * this.boneCount
    for (let i = 0; i < this.boneCount; i++) {
      this.bone.multiplyMatrices(this.rootInverse, this.bones[i].matrixWorld).multiply(this.boneInverses[i])
      this.bone.toArray(this.boneMatrices, (base + i) * 16)
    }
  }

  // Read the optic emitters while the scratch rig still holds this instance's
  // pose. Their materials are shared, so the power values must be taken now.
  readEyes(instance) {
    const eyes = this.rig.eyes
    instance.eyesVisible = Boolean(eyes?.visible)
    if (!instance.eyesVisible) return
    for (let i = 0; i < this.emitters.length; i++) {
      const emitter = this.emitters[i]
      emitter.updateMatrix()
      instance.eyeMatrices[i].multiplyMatrices(this.rootInverse, this.matrix.multiplyMatrices(emitter.parent.matrixWorld, emitter.matrix))
      instance.eyePower[i] = emitter.name === 'Eye Left' || emitter.name === 'Eye Right'
        ? emitter.material.emissiveIntensity / 8 : emitter.material.opacity
    }
  }

  // One evaluation of the shared animator for one instance.
  pose(instance, unit, dt, time, nav) {
    this.loadState(instance)
    this.scratch.position.set(unit.pos.x, unit.pos.y, unit.pos.z)
    this.scratch.rotation.y = unit.yaw
    this.scratch.updateMatrix()
    this.scratch.matrixWorld.copy(this.scratch.matrix)
    animateUnit(this.rig, unit, dt, time, nav)
    this.saveState(instance)
    this.writeBones(instance.slot)
    this.readEyes(instance)
    instance.matrix.copy(this.scratch.matrixWorld)
    this.stats.posed++
  }

  // The instance matrix for an instance that was not re-posed this tick. The
  // pose is unit-local, so it travels with the body exactly as a rig does.
  place(unit) {
    const instance = this.instances.get(unit.id)
    if (!instance) return null
    this.position.set(unit.pos.x, unit.pos.y, unit.pos.z)
    this.quaternion.setFromAxisAngle(UP, unit.yaw)
    instance.matrix.compose(this.position, this.quaternion, this.scratch.scale)
    return instance
  }

  sync(world, {player, frustum, cullSphere, dt, time, nav}) {
    const started = performance.now()
    const quality = this.quality
    const near = quality.instancedLodDistance ?? 12
    const highList = this.highList ||= []
    const farList = this.farList ||= []
    const hiddenList = this.hiddenList ||= []
    highList.length = 0; farList.length = 0; hiddenList.length = 0
    this.stats.posed = 0
    for (const unit of world.units) {
      if (!this.handles(unit) || !unit.alive) continue
      const instance = this.instances.get(unit.id)
      if (!instance) continue
      const distance = Math.hypot(unit.pos.x - player.pos.x, unit.pos.z - player.pos.z)
      cullSphere.center.set(unit.pos.x, unit.pos.y + 1, unit.pos.z)
      cullSphere.radius = 2.5
      const inView = frustum.intersectsSphere(cullSphere)
      const animationHz = !inView ? Math.min(12, quality.farAnimationHz)
        : distance <= quality.animationLodDistance ? quality.animationHz : quality.farAnimationHz
      const interval = Math.max(1, Math.round(60 / animationHz))
      // A new instance has never been posed, so its first frame always is.
      const elapsed = instance.lastTick === null ? interval : world.tick - instance.lastTick
      if (elapsed >= interval) {
        this.pose(instance, unit, Math.min(.1, elapsed / 60), time, nav)
        instance.lastTick = world.tick
      } else this.place(unit)
      if (instance.flash > 0) instance.flash = Math.max(0, instance.flash - dt / FLASH_SECONDS)
      // Off screen is neither LOD: the colour pass skips it, the shadow pass
      // still needs it, because a unit behind the player can cast into view.
      instance.lod = !inView ? 'hidden' : distance <= near ? 'high' : 'far'
      ;(instance.lod === 'high' ? highList : instance.lod === 'far' ? farList : hiddenList).push(instance)
    }
    this.packLists(highList, farList, hiddenList)
    const spent = performance.now() - started
    this.stats.poseMs = spent
    this.stats.maxPoseMs = Math.max(this.stats.maxPoseMs, spent)
    this.stats.highTriangles = this.highCount * this.triangles.high
    this.stats.farTriangles = this.farCount * this.triangles.far
    this.stats.drawCalls = (this.highCount > 0 ? 1 : 0) + (this.farCount > 0 ? 1 : 0)
    return spent
  }

  // The far mesh holds every live instance, distant ones first. The colour pass
  // draws only the distant prefix; the shadow pass raises the count to cover
  // the whole crowd so near units still cast, from the cheap figure.
  packLists(highList, farList, hiddenList = []) {
    this.highCount = highList.length
    this.farCount = farList.length
    this.live = farList.length + highList.length + hiddenList.length
    this.writeMesh(this.high, highList, this.highCount)
    this.packed = this.packed || []
    this.packed.length = 0
    for (const list of [farList, highList, hiddenList]) for (const instance of list) this.packed.push(instance)
    this.writeMesh(this.far, this.packed, this.live)
    this.far.count = this.farCount
    this.high.count = this.highCount
    this.high.visible = this.highCount > 0
    // Visible whenever anything is alive, even with a colour count of zero:
    // the shadow pass skips an invisible object, and it needs this mesh.
    this.far.visible = this.live > 0
    // With nothing alive the palette holds the rest pose and no draw reads it.
    if (this.live > 0) this.skeleton.boneTexture.needsUpdate = true
  }

  writeMesh(mesh, list, count) {
    if (!count) return
    const matrices = mesh.instanceMatrix.array, colors = mesh.instanceColor.array
    const slots = mesh.geometry.getAttribute('instanceSlot').array
    for (let i = 0; i < count; i++) {
      const instance = list[i]
      instance.matrix.toArray(matrices, i * 16)
      slots[i] = instance.slot
      const flash = 1 + instance.flash * 2.6
      colors[i * 3] = flash; colors[i * 3 + 1] = 1 + instance.flash * 1.4; colors[i * 3 + 2] = 1 + instance.flash
    }
    markRange(mesh.instanceMatrix, count * 16)
    markRange(mesh.instanceColor, count * 3)
    markRange(mesh.geometry.getAttribute('instanceSlot'), count)
  }

  // Optics stay instanced. Emitter matrices were captured in unit-local space,
  // so the instance matrix lifts them into the world without a scene node.
  emitOptics(optics) {
    for (const instance of this.instances.values()) {
      if (!instance.eyesVisible) continue
      for (let i = 0; i < this.emitters.length; i++) {
        const emitter = this.emitters[i]
        const lens = emitter.name === 'Eye Left' || emitter.name === 'Eye Right'
        this.matrix.multiplyMatrices(instance.matrix, instance.eyeMatrices[i])
        if (!lens) {
          const size = emitterSize(emitter)
          this.matrix.scale(this.scale.set(size[0], size[1], 1))
        }
        this.color.copy(lens ? WHITE : emitter.material.color)
        if (!optics.emit(lens ? 'lens' : 'glow', this.matrix, instance.eyePower[i], this.color)) return
      }
    }
  }

  flash(id) { const instance = this.instances.get(id); if (instance) instance.flash = 1 }

  // View-side rays for commons resolve against the instance volume, never
  // against a rig. The core already resolved which part gameplay hit.
  hit(instance, ray, result) {
    this.matrix.copy(instance.matrix).invert()
    this.ray.copy(ray).applyMatrix4(this.matrix)
    if (!this.ray.intersectBox(this.localBounds, this.point)) return null
    result.point.copy(this.point).applyMatrix4(instance.matrix)
    result.normal.copy(ray.direction).negate()
    return result
  }

  // Hand the instance's live pose to a real pooled rig so the ragdoll, the
  // wreck fade and the gore paths keep working exactly as they do for specials.
  handOff(instance, visual) {
    const pose = instance.pose, joints = visual.rig.mesh.skeleton.bones
    if (joints.length !== this.boneCount) throw new Error('Death rig skeleton does not match the instanced skeleton')
    for (let i = 0; i < this.boneCount; i++) {
      const bone = joints[i], at = i * BONE_FLOATS
      bone.position.fromArray(pose, at)
      bone.quaternion.fromArray(pose, at + 3)
      bone.scale.fromArray(pose, at + 7)
    }
    instance.matrix.decompose(visual.object.position, this.quaternion, visual.object.scale)
    visual.object.quaternion.copy(this.quaternion)
    visual.object.updateMatrixWorld(true)
    const rig = visual.rig
    for (let i = 0; i < POSE_SCALARS.length; i++) rig[POSE_SCALARS[i]] = instance.scalars[i]
    rig.eyesDead = instance.eyesDead
    visual.impact.direction.copy(instance.impact.direction)
    visual.impact.point.copy(instance.impact.point)
    visual.impact.weapon = instance.impact.weapon
    visual.impact.headshot = instance.impact.headshot
    visual.impact.tick = instance.impact.tick
    return visual
  }

  start(scene) {
    scene.add(this.root)
    // These three nodes never move. Saying so keeps three from marking them,
    // and everything under them, dirty on every render pass.
    this.releaseHold = holdStill([this.root, this.high, this.far])
    return this.root
  }

  report() {
    return {type: this.type, capacity: this.capacity, boneCount: this.boneCount,
      live: this.live, high: this.highCount, far: this.farCount, posed: this.stats.posed,
      poseMs: Math.round(this.stats.poseMs * 1000) / 1000,
      maxPoseMs: Math.round(this.stats.maxPoseMs * 1000) / 1000,
      boneTextureBytes: this.boneTextureBytes,
      boneTextureSize: this.skeleton.boneTexture?.image?.width ?? null,
      highTriangles: this.stats.highTriangles, farTriangles: this.stats.farTriangles,
      drawCalls: this.stats.drawCalls, lostSlots: this.lostSlots, nodes: this.countNodes()}
  }

  countNodes() { let count = 0; this.root.traverse(() => count++); return count }

  dispose() {
    this.releaseHold?.(); this.releaseHold = null
    this.root.removeFromParent()
    // Disposing the geometry is not enough: threepipe keeps a geometryUpdate
    // listener on it for as long as a mesh holds it, so the mesh, and the whole
    // instance table behind it, stays reachable. Clear the reference as well.
    for (const mesh of [this.high, this.far]) { mesh.geometry.dispose(); mesh.dispose?.(); releaseMeshGeometry(mesh) }
    this.disposeFar?.()
    this.material.dispose()
    this.depthMaterial.dispose()
    this.skeleton.dispose()
    disposeUnitRig(this.rig, this.scratch)
    releaseMeshGeometry(this.scratch)
    this.instances.clear(); this.free.length = 0
    this.high = this.far = this.material = this.depthMaterial = this.skeleton = null
    this.boneMatrices = null; this.scratch = null; this.rig = null
  }
}

const UP = new E.Vector3(0, 1, 0)
const WHITE = new E.Color(0xffffff)

function emitterSize(emitter) {
  let size = emitter.userData.unitOpticSize
  if (size) return size
  const parameters = emitter.geometry.parameters
  if (parameters?.width != null && parameters?.height != null) size = [parameters.width, parameters.height]
  else {
    emitter.geometry.computeBoundingBox()
    const box = emitter.geometry.boundingBox
    size = [box.max.x - box.min.x, box.max.y - box.min.y]
  }
  emitter.userData.unitOpticSize = size
  return size
}
