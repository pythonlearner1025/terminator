import {Matrix4} from 'threepipe'

const identity = new Matrix4().elements
const equal = (a, b, offset = 0) =>
  a[0] === b[offset + 0] && a[1] === b[offset + 1] && a[2] === b[offset + 2] && a[3] === b[offset + 3] &&
  a[4] === b[offset + 4] && a[5] === b[offset + 5] && a[6] === b[offset + 6] && a[7] === b[offset + 7] &&
  a[8] === b[offset + 8] && a[9] === b[offset + 9] && a[10] === b[offset + 10] && a[11] === b[offset + 11] &&
  a[12] === b[offset + 12] && a[13] === b[offset + 13] && a[14] === b[offset + 14] && a[15] === b[offset + 15]

// Only the settled record owns these instance methods. No baked geometry,
// texture, material, shader variant, or global renderer/prototype changes.
export function cacheSettledPose(root) {
  const restores = [], clearData = [], skeletons = new Set()
  let active = true
  const stats = {skinUpdates: 0, skinSkips: 0}
  function own(object, key, wrap) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    const original = object[key], replacement = wrap(original)
    object[key] = replacement
    restores.push(() => {
      if (object[key] !== replacement) return
      if (descriptor) Object.defineProperty(object, key, descriptor)
      else delete object[key]
    })
  }
  root.traverse(node => {
    if (node.isSkinnedMesh && node.skeleton) skeletons.add(node.skeleton)
  })
  for (const skeleton of skeletons) own(skeleton, 'update', original => {
    // Float64 snapshots compare the exact native inputs, including inverse
    // edits, late gore scale changes, and root movement during fade. Geometry
    // deformation remains independent; native transforms run without changes.
    let inputs = new Float64Array(0), output = null, texture = null
    clearData.push(() => { inputs = output = texture = null })
    return function() {
      if (!active || this !== skeleton) return original.call(this)
      const count = this.bones.length, length = count * 32
      let changed = inputs.length !== length || output !== this.boneMatrices || texture !== this.boneTexture
      for (let i = 0; !changed && i < count; i++) {
        changed = !equal(this.bones[i]?.matrixWorld.elements || identity, inputs, i * 32) ||
          !equal(this.boneInverses[i].elements, inputs, i * 32 + 16)
      }
      if (!changed) { stats.skinSkips++; return }
      original.call(this)
      if (inputs.length !== length) inputs = new Float64Array(length)
      for (let i = 0; i < count; i++) {
        inputs.set(this.bones[i]?.matrixWorld.elements || identity, i * 32)
        inputs.set(this.boneInverses[i].elements, i * 32 + 16)
      }
      output = this.boneMatrices; texture = this.boneTexture; stats.skinUpdates++
    }
  })
  skeletons.clear()
  return {
    stats,
    dispose() {
      active = false
      for (const restore of restores) restore()
      for (const clear of clearData) clear()
      restores.length = 0
      clearData.length = 0
    },
  }
}
