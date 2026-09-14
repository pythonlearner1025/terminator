// Deterministic, DOM-free near-field simulation. Positions are map/root-local metres.
export const EFFECTS_LIMITS = Object.freeze({fires: 12, vents: 12, sparks: 8, hazards: 8, maxParticleDiameter: 1.45})
const TAU = Math.PI * 2
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const smooth = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v) }
const fract = v => v - Math.floor(v)
export function effectsSeed(value) {
  let h = 2166136261
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}
export function effectsTime(world, preview = false) {
  if (preview) return 2
  if (Number.isFinite(world?.tick)) return world.tick / 60
  return Number.isFinite(world?.time) ? world.time : 0
}
function point(p) { return Array.isArray(p) ? [...p] : [p.x, p.y, p.z] }
function box(c) {
  const yaw = c.yaw || 0
  return {x:c.center.x, y:c.center.y, z:c.center.z, hx:c.size.x / 2, hy:c.size.y / 2, hz:c.size.z / 2, cos:Math.cos(yaw), sin:Math.sin(yaw)}
}
export function effectsClearance(x, y, z, solids, ceiling = Infinity) {
  let distance = ceiling - y
  for (const b of solids) {
    const dx = x - b.x, dz = z - b.z
    const qx = Math.abs(dx * b.cos - dz * b.sin) - b.hx
    const qy = Math.abs(y - b.y) - b.hy
    const qz = Math.abs(dx * b.sin + dz * b.cos) - b.hz
    // Conservative OBB exterior distance; zero in solids, including cover and floor.
    distance = Math.min(distance, Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)))
  }
  return Math.max(0, distance)
}
// Fit a horizontal disc or an upright card's bounding cylinder. Unlike a sphere,
// this leaves a flat fire bed in contact with the lid without entering the drum.
export function effectsCardFit(x, y, z, radius, halfHeight, solids, ceiling = Infinity) {
  let fit = halfHeight > 0 ? (ceiling - y) / halfHeight : y < ceiling ? 1 : 0
  for (const b of solids) {
    const dx = x - b.x, dz = z - b.z
    const qx = Math.abs(dx * b.cos - dz * b.sin) - b.hx
    const qz = Math.abs(dx * b.sin + dz * b.cos) - b.hz
    const horizontal = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) / radius
    const qy = Math.abs(y - b.y) - b.hy
    const vertical = halfHeight > 0 ? qy / halfHeight : qy > 0 ? 1 : 0
    fit = Math.min(fit, Math.max(horizontal, vertical))
  }
  return clamp(fit, 0, 1)
}
function confineSource(pos, solids) {
  for (const b of solids) {
    const dx = pos[0] - b.x, dz = pos[2] - b.z
    const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos, ly = pos[1] - b.y
    const ax = Math.abs(lx) - b.hx, ay = Math.abs(ly) - b.hy, az = Math.abs(lz) - b.hz
    if (Math.max(ax, ay, az) > .16) continue
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2
    const shift = .18 - [ax, ay, az][axis]
    if (axis === 0) { const s = (lx < 0 ? -1 : 1) * shift; pos[0] += s * b.cos; pos[2] -= s * b.sin }
    else if (axis === 1) pos[1] += (ly < 0 ? -1 : 1) * shift
    else { const s = (lz < 0 ? -1 : 1) * shift; pos[0] += s * b.sin; pos[2] += s * b.cos }
  }
}
export function buildEffectsEmitters(map = {}, refs = {}) {
  const colliders = (map.colliders || []).filter(c => c.center && c.size && c.blocksSight !== false)
  const emitters = []
  function add(kind, id, position, count, extra = {}) {
    const pos = point(position)
    const nearby = colliders.filter(c => Math.hypot(Math.max(0, Math.abs(pos[0] - c.center.x) - Math.hypot(c.size.x, c.size.z) / 2), Math.max(0, Math.abs(pos[2] - c.center.z) - Math.hypot(c.size.x, c.size.z) / 2)) < 5 && Math.abs(pos[1] - c.center.y) < c.size.y / 2 + 5)
    const solids = nearby.map(box)
    // Flame coordinates are the rim, not a volumetric source to push off a wall.
    // Its individual upright/horizontal cards receive orientation-aware fitting.
    if (kind !== 'flame') confineSource(pos, solids)
    // Service ceiling is inferred from the enclosing walls even before Architecture mounts its slab.
    // This also keeps the preview within the existing sunken room's envelope.
    let ceiling = Infinity
    if (pos[1] < -.5) for (const c of nearby) {
      const top = c.center.y + c.size.y / 2
      if (/wall/.test(c.kind) && top > pos[1] && top < .5) ceiling = Math.min(ceiling, top - .06)
    }
    // Move wall leaks into free space, using available clearance rather than a fixed world direction.
    let driftX = .45, driftZ = .1
    if (kind === 'steam') {
      const xp = effectsClearance(pos[0] + .6, pos[1], pos[2], solids, ceiling)
      const xm = effectsClearance(pos[0] - .6, pos[1], pos[2], solids, ceiling)
      driftX = xp >= xm ? .85 : -.85
      driftZ = .18
    }
    emitters.push({kind, id, pos, count, seed:effectsSeed(id), solids, ceiling, driftX, driftZ, ...extra})
  }
  const barrels = (map.colliders || []).filter(c => c.kind === 'barrel')
  const fires = refs.fires?.length ? refs.fires : barrels.map(c => ({id:c.id, pos:[c.center.x, c.center.y + c.size.y / 2, c.center.z]}))
  for (let i = 0; i < Math.min(fires.length, EFFECTS_LIMITS.fires); i++) {
    const fire = fires[i], id = fire.id || barrels[i]?.id || `barrel-${point(fire.pos).join(',')}`
    add('flame', `${id}/flame`, fire.pos, 9)
    const p = point(fire.pos); p[1] += .2
    add('smoke', `${id}/smoke`, p, 13)
    add('ember', `${id}/ember`, p, 3)
  }
  for (const [i, vent] of (map.environment?.vents || []).slice(0, EFFECTS_LIMITS.vents).entries()) add('steam', `vent-${vent.id || point(vent).join(',')}`, vent, 22, {sourceIndex:i})
  for (const spark of (map.environment?.sparks || []).slice(0, EFFECTS_LIMITS.sparks)) add('spark', `cable-${spark.id || point(spark).join(',')}`, spark, 7)
  for (const hazard of (map.hazardSlots || []).slice(0, EFFECTS_LIMITS.hazards)) add('hazard', `hazard-${hazard.id}`, hazard.pos, 24, {hazardId:hazard.id, size:hazard.size})
  return emitters
}
// out: x,y,z,width,height,angle,alpha,tile,r,g,b,orientation.
// orientation: 0 camera-facing, 1 horizontal bed, 2 upright cylindrical billboard.
// Caller reuses this typed array.
export function sampleEffectsParticle(emitter, index, time, out) {
  const {kind, pos, seed} = emitter
  const phase = fract(seed * 17 + index * .61803398875)
  const variation = fract(seed * 31 + index * .754877666)
  const angle = (phase + variation) * TAU
  let x = pos[0], y = pos[1], z = pos[2], width, height, rotation, alpha, tile, r, g, b
  let orientation = 0
  if (kind === 'flame') {
    const bed = index < 3
    const age = fract(time * (1.2 + variation * .55) + phase)
    const flutter = .82 + .12 * Math.sin(time * 9.7 + angle) + .06 * Math.sin(time * 17.1 + phase * 31)
    const spread = bed ? .105 : .07 + variation * .095
    x += Math.sin(angle) * spread + Math.sin(time * 3.7 + angle) * (bed ? .008 : .018)
    z += Math.cos(angle) * spread + Math.cos(time * 4.3 + angle) * (bed ? .008 : .018)
    // Reuse irregular density tiles instead of the tall pre-shaped candle tiles.
    tile = index % 4
    if (bed) {
      orientation = 1
      width = (.23 + variation * .045) * flutter
      height = .17 + variation * .035
      rotation = angle + Math.sin(time * 2.3 + phase * 11) * .25
      y += .012 + index * .002
      alpha = .52 + .1 * flutter
      r = .8; g = .105; b = .012
    } else {
      orientation = 2
      width = (.1 + variation * .08) * (1 - age * .3)
      height = (.13 + variation * .13) * flutter * (1 - age * .22)
      rotation = Math.sin(time * 5.7 + angle) * .38
      const halfHeight = (height * Math.abs(Math.cos(rotation)) + width * Math.abs(Math.sin(rotation))) / 2
      y += .008 + halfHeight + age * age * .035
      alpha = smooth(age * 8) * smooth((1 - age) * 4) * .57
      r = 1.15; g = .235 - age * .055; b = .026
    }
  } else if (kind === 'spark' || kind === 'ember') {
    const ember = kind === 'ember', period = ember ? 4.9 : 3.8 + seed
    const age = fract(time / period + seed * 9) * period - index * (ember ? .36 : .055)
    const live = age >= 0 && age < (ember ? 1.7 : .62)
    const t = Math.max(0, age)
    x += Math.sin(angle) * t * (ember ? .12 : .3)
    z += Math.cos(angle) * t * .22
    y += ember ? t * .46 : -.25 * t - t * t * 1.5
    width = ember ? .015 : .012; height = ember ? .036 : .045 + t * .07
    rotation = Math.sin(angle) * .32
    alpha = live ? smooth(t * 30) * smooth(((ember ? 1.7 : .62) - t) * 5) * .65 : 0
    tile = 7; r = ember ? 1.25 : .7; g = ember ? .4 : .95; b = ember ? .1 : 1.4
  } else {
    const steam = kind !== 'smoke', hazard = kind === 'hazard'
    const age = fract(time * (steam ? .19 : .13) + phase)
    const grow = smooth(age * 2)
    if (hazard) {
      x += Math.sin(angle) * emitter.size.x * .28
      z += Math.cos(angle) * emitter.size.z * .28
    }
    x += emitter.driftX * age + Math.sin(angle + age * 4) * (.06 + age * .13)
    z += emitter.driftZ * age + Math.cos(angle + age * 3) * (.06 + age * .12)
    y += .12 + age * (hazard ? 1.65 : steam ? 1.45 : 1.7)
    width = (steam ? .24 : .2) + grow * (steam ? .92 : .66)
    height = width * (steam ? 1.15 : 1.04)
    rotation = angle + age * (variation - .5) * 1.2
    alpha = smooth(age * 8) * smooth((1 - age) * 3) * (hazard ? .32 : steam ? .2 : .13)
    tile = index % 4
    r = steam ? .24 : .095; g = steam ? .34 : .135; b = steam ? .49 : .21
  }
  const radius = Math.hypot(width, height) / 2
  let fit
  if (orientation > 0) {
    const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation))
    const cardRadius = orientation === 1 ? radius : (width * c + height * s) / 2
    const halfHeight = orientation === 1 ? 0 : (height * c + width * s) / 2
    fit = effectsCardFit(x, y, z, cardRadius, halfHeight, emitter.solids, emitter.ceiling)
  } else fit = effectsClearance(x, y, z, emitter.solids, emitter.ceiling) * .94 / radius
  fit = Math.min(fit, 1, EFFECTS_LIMITS.maxParticleDiameter / Math.max(width, height))
  // Bound the entire oriented card (or free-facing sphere) before touching solids.
  width *= fit; height *= fit; alpha *= smooth(fit)
  out[0]=x; out[1]=y; out[2]=z; out[3]=width; out[4]=height; out[5]=rotation; out[6]=alpha; out[7]=tile; out[8]=r; out[9]=g; out[10]=b; out[11]=orientation
  return out
}
