export const TAU = Math.PI * 2

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function copyVec(pos) {
  return {x: Number(pos?.x) || 0, y: Number(pos?.y) || 0, z: Number(pos?.z) || 0}
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), a.z - b.z)
}

export function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

export function normalizeAngle(angle) {
  let result = angle % TAU
  if (result > Math.PI) result -= TAU
  if (result < -Math.PI) result += TAU
  return result
}

export function moveAngle(current, target, maxStep) {
  const difference = normalizeAngle(target - current)
  return normalizeAngle(current + clamp(difference, -maxStep, maxStep))
}

export function directionFromAngles(yaw, pitch = 0) {
  const horizontal = Math.cos(pitch)
  return {
    x: Math.sin(yaw) * horizontal,
    y: Math.sin(pitch),
    z: Math.cos(yaw) * horizontal,
  }
}

export function yawTo(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

export function rayAabb(origin, direction, center, size, maxDistance = Infinity) {
  let near = 0
  let far = maxDistance
  for (const axis of ['x', 'y', 'z']) {
    const half = size[axis] / 2
    const min = center[axis] - half
    const max = center[axis] + half
    const component = direction[axis]
    if (Math.abs(component) < 1e-9) {
      if (origin[axis] < min || origin[axis] > max) return null
      continue
    }
    let first = (min - origin[axis]) / component
    let second = (max - origin[axis]) / component
    if (first > second) [first, second] = [second, first]
    near = Math.max(near, first)
    far = Math.min(far, second)
    if (near > far) return null
  }
  return near >= 0 && near <= maxDistance ? near : null
}

export function raySphere(origin, direction, center, radius, maxDistance = Infinity) {
  const ox = origin.x - center.x
  const oy = origin.y - center.y
  const oz = origin.z - center.z
  const projection = ox * direction.x + oy * direction.y + oz * direction.z
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const discriminant = projection * projection - c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const first = -projection - root
  const second = -projection + root
  const hit = first >= 0 ? first : second
  return hit >= 0 && hit <= maxDistance ? hit : null
}

export function pointInsideExpandedBox(pos, collider, radius = 0) {
  return Math.abs(pos.x - collider.center.x) <= collider.size.x / 2 + radius
    && Math.abs(pos.z - collider.center.z) <= collider.size.z / 2 + radius
}

export function round(value, places = 6) {
  const scale = 10 ** places
  return Math.round(value * scale) / scale
}
