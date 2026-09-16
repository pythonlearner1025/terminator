// A shadow-casting light costs a whole extra render: its own render list, its
// own scene draw, its own state changes. three.js redraws a shadow map when
// `shadowMap.autoUpdate` is on, or when `shadowMap.needsUpdate` is set for one
// frame. Threepipe drives the second form: it asks for a redraw on every frame
// it renders, so the game pays the shadow cost every frame.
//
// This hook counts viewer frames and lets only every `interval`-th request
// through, by clearing `needsUpdate` on the frames in between. Interval 1
// touches nothing and is the stock every-frame behaviour. Interval 2 halves
// the shadow cost and leaves the shadow one frame stale.
//
// It covers any number of casting lights, because three.js redraws them all in
// one pass; there is no per-light update order to rotate through.
const CADENCE = Symbol.for('terminator.shadowCadence')

// Returns null when the viewer has no WebGL renderer to pace, which is what a
// headless or stubbed viewer looks like. There is no shadow map to skip there.
export function installShadowCadence(viewer) {
  const existing = viewer?.[CADENCE]
  if (existing) return existing
  const renderer = viewer?.renderManager?.webglRenderer
  if (!renderer?.shadowMap) return null
  const stockAutoUpdate = renderer.shadowMap.autoUpdate
  let interval = 1, frames = 0, disposed = false
  const preRender = () => {
    if (interval <= 1) return
    // three.js clears needsUpdate once the shadow pass has run, so the flag is
    // set fresh on each frame that owes an update.
    renderer.shadowMap.needsUpdate = frames % interval === 0
    frames += 1
  }
  viewer.addEventListener('preRender', preRender)
  const cadence = {
    get interval() { return interval },
    get frames() { return frames },
    setInterval(value) {
      const next = Math.max(1, Math.round(Number(value) || 1))
      if (next === interval || disposed) return interval
      interval = next
      frames = 0
      renderer.shadowMap.autoUpdate = interval <= 1 ? stockAutoUpdate : false
      // Going back to every-frame updates must not leave the last skipped
      // frame's map on screen for one more frame.
      renderer.shadowMap.needsUpdate = true
      viewer.setDirty?.()
      return interval
    },
    dispose() {
      if (disposed) return
      disposed = true
      viewer.removeEventListener('preRender', preRender)
      renderer.shadowMap.autoUpdate = stockAutoUpdate
      renderer.shadowMap.needsUpdate = true
      delete viewer[CADENCE]
    },
  }
  Object.defineProperty(viewer, CADENCE, {value: cadence, configurable: true, enumerable: false, writable: true})
  return cadence
}
