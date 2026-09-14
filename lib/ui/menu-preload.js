// Yield a painted menu before doing optional preparation. Cancellation clears
// every scheduler handle; an immediate PLAY can consume the same caches first.
export function scheduleMenuPreparation(work, {onError = () => {}} = {}) {
  let cancelled = false, frame = 0, idle = 0, timer = 0
  const run = () => {
    if (cancelled) return
    try { Promise.resolve(work()).catch(error => {if (!cancelled) onError(error)}) }
    catch (error) {onError(error)}
  }
  frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      if (cancelled) return
      if (globalThis.requestIdleCallback) idle = requestIdleCallback(run, {timeout: 250})
      else timer = setTimeout(run, 0)
    })
  })
  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
    if (idle) globalThis.cancelIdleCallback?.(idle)
    clearTimeout(timer)
  }
}
