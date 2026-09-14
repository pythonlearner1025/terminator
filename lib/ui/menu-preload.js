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

// This list covers runtime-only requests otherwise discovered serially by
// MapView's HDR -> materials -> lighting -> effects chain and the unit views.
// URLs stay module-relative on published games. No models or scene copies.
export const MENU_IMAGE_ASSETS = Object.freeze([
  ...['photo-worn','substrate-rubble','photo-soffit','photo-spall','wall-aggregate'].flatMap(family =>
    [family === 'photo-spall' ? 'albedo.png' : 'albedo.jpg','normal.png','orm.png'].map(suffix => `v2/materials/${family}-${suffix}`)),
  'v2/effects/particles.png',
  ...['endoskeleton-albedo.jpg','endoskeleton-normal.png','endoskeleton-orm.png',
    'optic-albedo.png','optic-normal.png','optic-orm.png','optic-emissive.png',
    'impact-albedo.png','impact-normal.png','impact-orm.png'].map(file => `textures/units/${file}`),
  ...['liquid','hk'].flatMap(prefix => ['albedo.jpg','normal.png','orm.png'].map(suffix => `textures/roster/${prefix}-${suffix}`)),
  ...['albedo','normal','orm'].map(name => `textures/gore/fluid-${name}.png`),
  ...['smoke','scorch','muzzle','blast','hole','shockwave','muzzle-atlas'].map(name => `textures/weapons/fx-${name}.png`),
  ...['diff','nor_gl','arm'].map(name => `textures/map/concrete_wall_007_${name}_1k.jpg`),
].map(path => new URL(`../../assets/${path}`, import.meta.url).href))
export const MENU_BINARY_ASSETS = Object.freeze([
  new URL('../../assets/hdri/qwantani_moon_noon_puresky_2k.hdr', import.meta.url).href,
  new URL('../../assets/textures/units/studio_small_09_1k.hdr', import.meta.url).href,
])

// Browser image/HTTP caches can reuse these exact URLs. They are hints, not a
// readiness guarantee: actual runtime loaders and warmup remain authoritative.
export async function warmMenuAsset(url, {signal} = {}) {
  signal.throwIfAborted()
  if (!/\.(png|jpg)$/.test(new URL(url).pathname)) {
    const response = await fetch(url, {signal, cache:'force-cache', priority:'low'})
    if (!response.ok) throw new Error(`Menu asset HTTP ${response.status}: ${url}`)
    // Drain without retaining a second binary/decoded HDR in application memory.
    const reader = response.body?.getReader()
    if (reader) {try {while (!(await reader.read()).done) signal.throwIfAborted()} finally {reader.releaseLock()}}
    else await response.arrayBuffer()
    return
  }
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.fetchPriority = 'low'
  const abort = () => image.removeAttribute('src')
  signal.addEventListener('abort', abort, {once:true})
  try {
    image.src = url
    await image.decode()
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', abort)
    image.removeAttribute('src')
  }
}

// Three in-flight images at most; yield a painted frame between decode jobs.
// Promotion stops speculative launches immediately, without making Start wait
// for the whole list. Existing requests may finish/coalesce with runtime loads.
export function createMenuAssetQueue({assets = [...MENU_BINARY_ASSETS,...MENU_IMAGE_ASSETS],
  load = warmMenuAsset, concurrency = 3, onError = () => {},
  schedule = scheduleMenuPreparation} = {}) {
  const controller = new AbortController(), jobs = new Set()
  const stats = {total:assets.length, started:0, completed:0, failed:0, active:0, promoted:false, cancelled:false}
  let cursor = 0, running = false
  const launch = () => {
    if (controller.signal.aborted || stats.promoted || cursor >= assets.length) return
    const url = assets[cursor++]
    stats.started++;stats.active++
    Promise.resolve().then(() => {controller.signal.throwIfAborted();return load(url,{signal:controller.signal})}).then(() => {
      if (!controller.signal.aborted) stats.completed++
    }, error => {
      if (!controller.signal.aborted) {stats.failed++;onError(error)}
    }).finally(() => {stats.active--;enqueue()})
  }
  const enqueue = () => {
    if (controller.signal.aborted || stats.promoted || cursor >= assets.length) return
    const job = {cancel:null}
    jobs.add(job)
    job.cancel = schedule(() => {jobs.delete(job);launch()})
  }
  const clear = () => {for (const job of jobs) job.cancel();jobs.clear()}
  return {stats,
    start() {if(running)return;running=true;for(let i=0;i<Math.min(3,Math.max(1,concurrency));i++)enqueue()},
    promote() {stats.promoted=true;clear()},
    dispose() {stats.cancelled=true;controller.abort();clear()},
  }
}
