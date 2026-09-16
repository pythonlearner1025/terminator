// getBoundingClientRect forces the browser to flush pending style and layout.
// The HUD, the screen effects and the scope each read the canvas box every
// frame, and the HUD writes to the DOM between those reads, so each read paid
// for a fresh layout of the whole overlay.
//
// The canvas box only changes when the window or a surrounding panel resizes,
// so one observed measurement serves every reader. A slow poll covers the rare
// move that changes position without changing size.
const MOVE_POLL_MS = 250
const cache = new WeakMap()

export function canvasRect(canvas, now = performance.now()) {
  let entry = cache.get(canvas)
  if (!entry) {
    entry = {rect: canvas.getBoundingClientRect(), readAt: now, stale: false}
    const invalidate = () => { entry.stale = true }
    if (typeof ResizeObserver === 'function') {
      entry.observer = new ResizeObserver(invalidate)
      entry.observer.observe(canvas)
    }
    globalThis.addEventListener?.('resize', invalidate)
    globalThis.addEventListener?.('scroll', invalidate, true)
    cache.set(canvas, entry)
    return entry.rect
  }
  if (entry.stale || now - entry.readAt >= MOVE_POLL_MS) {
    entry.rect = canvas.getBoundingClientRect()
    entry.readAt = now
    entry.stale = false
  }
  return entry.rect
}

// Tests and teardown need a way back to an unobserved canvas.
export function forgetCanvasRect(canvas) {
  const entry = cache.get(canvas)
  entry?.observer?.disconnect()
  cache.delete(canvas)
}
