import {GenericBlendTexturePass} from 'threepipe'

const STOCK = 'c = vec4(a.rgb * (1. - b.a) + b.rgb * b.a, 1.);'
const ASSOCIATED = 'c = vec4(a.rgb * (1. - b.a) + b.rgb, 1.);'
const installations = new WeakMap()
const noop = () => ({attached: false, sync() {}, dispose() {}})

/**
 * Threepipe 0.5.1 private-API bridge, guarded against its exact blend layout.
 * The linear transparent target already contains alpha-associated RGB. Retain
 * its existing coverage/background term and remove the second RGB alpha factor.
 * This does not repair additive alpha coverage or change transmission ordering.
 */
export function installV2Transparency({viewer, preview = false}) {
  if (preview || !viewer.renderManager?.rgbm) return noop()
  const main = viewer.renderManager.renderPass
  if (!main?.isExtendedRenderPass) throw new Error('Unsupported V2 transparent render pass')
  let record = installations.get(main)
  if (record && main._blendPass !== record.owned) throw new Error('V2 transparent compositor ownership changed')
  if (!record) {
    const original = main._blendPass
    const source = original?.material
    if (!original?.isExtendedShaderPass || !source || original.textureID !== 'tDiffuse' ||
      Object.keys(source.uniforms).sort().join(',') !== 'tDiffuse,tDiffuse2' ||
      Object.keys(source.defines).join(',') !== 'MAX_INTENSITY' ||
      source.materialExtensions?.length || Object.entries(source._listeners || {}).some(([type, list]) => type !== 'dispose' && list.length)) {
      throw new Error('Unsupported V2 transparent compositor configuration')
    }
    const owned = new GenericBlendTexturePass({}, STOCK, '', undefined, source.defines.MAX_INTENSITY)
    const release = () => {
      // Uniforms borrow pooled target textures. FullScreenQuad geometry is shared
      // by every engine pass: never call owned.dispose() or fsQuad.dispose().
      for (const uniform of Object.values(owned.uniforms)) uniform.value = null
      owned.material.setDirty()
      owned.material.dispose()
      owned.onDirty.length = 0
    }
    if (source.fragmentShader !== owned.material.fragmentShader || source.vertexShader !== owned.material.vertexShader ||
      original.render !== owned.render || original.overrideReadBuffer) {
      release()
      throw new Error('Unsupported V2 transparent compositor shader layout')
    }
    owned.material.fragmentShader = source.fragmentShader.replace(STOCK, ASSOCIATED)
    owned.material.name = 'V2 associated-alpha compositor'
    // Keep any explicit hooks and cache key behavior, with the owned receiver.
    // Original material descriptors, shader, uniform objects and callbacks stay intact.
    for (const key of ['onBeforeCompile', 'customProgramCacheKey', 'onBeforeRender', 'onAfterRender']) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key)
      if (descriptor) Object.defineProperty(owned.material, key, descriptor)
    }
    for (const key of ['enabled', 'clear', 'needsSwap', 'renderToScreen', 'useExistingRenderTarget']) owned[key] = original[key]
    for (const key of Object.keys(source.uniforms)) owned.uniforms[key].value = source.uniforms[key].value
    record = {original, owned, release, users: 0}
    main._blendPass = owned
    installations.set(main, record)
    viewer.setDirty()
  }
  record.users++
  let disposed = false
  return {
    attached: true,
    sync() {
      if (!disposed && main._blendPass !== record.owned) throw new Error('V2 transparent compositor displaced during Play')
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (--record.users) return
      if (main._blendPass === record.owned) main._blendPass = record.original
      installations.delete(main)
      record.release()
      viewer.setDirty()
    },
  }
}
