/** Reuse the game's settled preFrame transforms across one compositor frame.
 * Geometry/material passes do not animate this game's scene. Explicit matrix
 * updates still work, and objectUpdate invalidates reuse between passes.
 */
export function optimizeFrameRendering(viewer) {
  const scene = viewer.scene, renderer = viewer.renderManager.webglRenderer
  const original = renderer.render, originalModes = renderer.renderWithModes
  const stats = {matrixPassesReused: 0, emptyTransmissionPassesSkipped: 0}
  let lastCamera = null, listRevision = -1
  let active = false, disposed = false, revision = 0, settled = -1, depth = 0, outerAuto = true
  const begin = () => { active = true; settled = -1; listRevision = -1; lastCamera = null }
  const end = () => { active = false }
  const invalidate = () => { revision++ }
  function render(object, ...args) {
    if (disposed || !active || object !== scene) return original.call(this, object, ...args)
    const auto = scene.matrixWorldAutoUpdate
    if (!depth) outerAuto = auto
    const updating = depth ? outerAuto : auto
    const version = revision
    const reuse = depth === 0 && settled === version
    scene.matrixWorldAutoUpdate = reuse ? false : updating
    depth++
    try {
      const result = original.call(this, object, ...args)
      if (updating && !reuse) settled = version
      if (auto && reuse) stats.matrixPassesReused++
      lastCamera = args[0]; listRevision = version
      return result
    } finally {
      depth--
      scene.matrixWorldAutoUpdate = auto
    }
  }
  function renderWithModes(modes, ...args) {
    // The RGBM pass always requests transmission, even when the preceding
    // scene render built an empty transmissive list. No material/geometry is
    // removed: newly visible transmissive objects retain the normal path.
    if (!disposed && active && !depth && listRevision === revision && lastCamera
      && lastCamera === scene.renderCamera && modes.transmissionRender === true
      && modes.opaqueRender === false && modes.transparentRender === false
      && modes.backgroundRender === false && modes.shadowMapRender === false
      && renderer.info.autoReset && renderer.renderLists.get(scene, 0).transmissive.length === 0) {
      renderer.info.reset()
      renderer.info.render.frame++
      stats.emptyTransmissionPassesSkipped++
      return
    }
    return originalModes.call(this, modes, ...args)
  }
  renderer.render = render
  if (typeof originalModes === 'function' && renderer.renderLists?.get) renderer.renderWithModes = renderWithModes
  viewer.addEventListener('preRender', begin)
  viewer.addEventListener('postRender', end)
  scene.addEventListener('objectUpdate', invalidate)
  return {
    invalidate, stats,
    dispose() {
      if (disposed) return
      disposed = true; active = false
      viewer.removeEventListener('preRender', begin)
      viewer.removeEventListener('postRender', end)
      scene.removeEventListener('objectUpdate', invalidate)
      if (renderer.render === render) renderer.render = original
      if (renderer.renderWithModes === renderWithModes) renderer.renderWithModes = originalModes
    },
  }
}
