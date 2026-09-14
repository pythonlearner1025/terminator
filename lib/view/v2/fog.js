// Installed Three/Threepipe output shaders encode RGBM before native fog.
// This helper belongs only on explicitly owned runtime material instances.
const installations = new WeakMap()
const CACHE_KEY = '|v2-linear-scene-fog-1'
const skipped = Object.freeze({attached: false, dispose() {}})

function relocateFog(shader) {
  const source = shader.fragmentShader
  const names = ['opaque_fragment', 'fog_fragment', 'tonemapping_fragment',
    'colorspace_fragment', 'premultiplied_alpha_fragment', 'dithering_fragment']
  const chunks = names.map(name => [...source.matchAll(new RegExp(`#include\\s*<${name}>`, 'g'))])
  // Non-color auxiliary shaders have no stock output chain to repair.
  if (chunks.every(matches => matches.length === 0)) return
  if (chunks.some(matches => matches.length !== 1)) {
    throw new Error('V2 linear fog: expected one native fog and stock color output chain')
  }
  const [opaque, fog, tone, output, premultiply, dither] = chunks.map(matches => matches[0].index)
  const linearOrder = opaque < fog && fog < tone && tone < output
  const nativeOrder = opaque < tone && tone < output && output < fog && fog < premultiply
  if (!(linearOrder || nativeOrder) || !(output < premultiply && premultiply < dither)) {
    throw new Error('V2 linear fog: unsupported color/fog/alpha output order')
  }
  if (linearOrder) return // An upstream hook already repaired this shader.
  const fogInclude = chunks[1][0][0]
  const toneInclude = chunks[2][0][0]
  shader.fragmentShader = source.replace(fogInclude, '')
    .replace(toneInclude, `${fogInclude}\n\t${toneInclude}`)
}

/**
 * Install AFTER the caller's shader hooks, on its owned runtime clone only.
 * Does not enable fog. fog=false is an untouched no-op. Call dispose before
 * releasing a reusable clone; material.dispose also detaches automatically.
 * Intended for opaque world materials; does not repair RGBM alpha blending.
 */
export function installV2LinearFog(material, {owned = false} = {}) {
  if (owned !== true) throw new Error('V2 linear fog requires an explicitly owned runtime material')
  if (!material?.isMaterial) throw new TypeError('V2 linear fog requires a material')
  if (installations.has(material)) return installations.get(material)
  if (material.fog !== true) return skipped
  if (!(material.isMeshStandardMaterial || material.isMeshBasicMaterial)) {
    throw new TypeError('V2 linear fog supports Physical/Standard/Basic materials only')
  }
  const compile = material.onBeforeCompile
  const cacheKey = material.customProgramCacheKey
  const compileDescriptor = Object.getOwnPropertyDescriptor(material, 'onBeforeCompile')
  const keyDescriptor = Object.getOwnPropertyDescriptor(material, 'customProgramCacheKey')
  if (typeof compile !== 'function' || typeof cacheKey !== 'function' ||
      !Object.isExtensible(material) ||
      [compileDescriptor, keyDescriptor].some(d => d && (!d.configurable || d.get || d.set))) {
    throw new TypeError('V2 linear fog requires replaceable material shader methods')
  }
  let active = true
  let cachedBase, cachedKey
  function onBeforeCompile(shader, renderer) {
    compile.call(this, shader, renderer)
    // A later factory may copy this hook to a different material. It must opt
    // that clone in separately; never transfer ownership through a callback.
    if (active && this === material && this.fog === true) relocateFog(shader)
  }
  // Three's default customProgramCacheKey uses this.onBeforeCompile.toString().
  // Retain that exact contribution, including keys supplied by existing hooks.
  Object.defineProperty(onBeforeCompile, 'toString', {value: () => compile.toString()})
  function customProgramCacheKey() {
    const base = cacheKey.call(this)
    if (!active || this !== material) return base
    if (base !== cachedBase || cachedKey === undefined) {
      cachedBase = base
      cachedKey = base + CACHE_KEY
    }
    return cachedKey
  }
  const handle = {
    get attached() { return active },
    dispose() {
      if (!active) return
      active = false
      material.removeEventListener('dispose', handle.dispose)
      // Preserve later wrappers; if they retained ours, it is now inert.
      for (const [name, wrapper, descriptor] of [
        ['onBeforeCompile', onBeforeCompile, compileDescriptor],
        ['customProgramCacheKey', customProgramCacheKey, keyDescriptor],
      ]) {
        if (material[name] !== wrapper) continue
        if (descriptor) Object.defineProperty(material, name, descriptor)
        else delete material[name]
      }
      installations.delete(material)
      material.needsUpdate = true
    },
  }
  Object.defineProperty(material, 'onBeforeCompile', {
    value: onBeforeCompile, configurable: true, writable: true,
    enumerable: compileDescriptor?.enumerable ?? true,
  })
  Object.defineProperty(material, 'customProgramCacheKey', {
    value: customProgramCacheKey, configurable: true, writable: true,
    enumerable: keyDescriptor?.enumerable ?? true,
  })
  installations.set(material, handle)
  material.addEventListener('dispose', handle.dispose)
  material.needsUpdate = true
  return handle
}
