const EPSILON = 1e-9

export function staticColliders(map) {
  return [...map.colliders, ...(map.trader?.navBlock || map.trader?.blocksSight ? [map.trader] : [])]
}

export function colliderPrimitives(collider) {
  if (!collider) return []
  if (!Array.isArray(collider.shapes)) return [normalizePrimitive(collider, collider.center, collider.yaw || 0)]
  return collider.shapes.map(part => normalizePrimitive(part, collider.center, collider.yaw || 0))
}

export function pointInsideColliderFootprint(pos, collider, radius = 0) {
  if (axisAlignedBox(collider)) return boxFootprint(pos, collider, radius)
  for (const part of queryPrimitives(collider, pos, radius, null, true)) {
    if (pointInsidePrimitiveFootprint(pos, part, radius)) return true
  }
  return false
}

export function colliderSurfacesAt(pos, collider, radius = 0) {
  // Most expanded walls miss a query. Reject them before allocating normalized primitives.
  if (axisAlignedBox(collider) && !boxFootprint(pos, collider, radius)) return []
  const surfaces = []
  for (const part of queryPrimitives(collider, pos, radius, null, true)) {
    if (pointInsidePrimitiveFootprint(pos, part, radius)) surfaces.push({part, ...primitiveVerticalRange(part)})
  }
  return surfaces
}

export function rayCollider(origin, direction, collider, maxDistance = Infinity) {
  if (axisAlignedBox(collider)) {
    const hit = rayBoxLocal({x: origin.x - collider.center.x, y: origin.y - collider.center.y, z: origin.z - collider.center.z}, direction, collider.size, maxDistance)
    return hit ? {...hit, part: normalizePrimitive(collider, collider.center, 0), collider} : null
  }
  let closest = null
  for (const part of queryPrimitives(collider, origin, 0, direction, false, maxDistance)) {
    const hit = rayPrimitive(origin, direction, part, maxDistance)
    if (hit && (!closest || hit.distance < closest.distance)) closest = {...hit, part, collider}
  }
  return closest
}

export function sweepSphereCollider(origin, movement, radius, collider) {
  if (axisAlignedBox(collider)) {
    const hit = rayBoxLocal({x: origin.x - collider.center.x, y: origin.y - collider.center.y, z: origin.z - collider.center.z}, movement,
      {x: collider.size.x + 2 * radius, y: collider.size.y + 2 * radius, z: collider.size.z + 2 * radius}, 1)
    return hit ? {fraction: hit.distance, normal: hit.normal, part: normalizePrimitive(collider, collider.center, 0), collider} : null
  }
  let closest = null
  for (const source of queryPrimitives(collider, origin, radius * Math.SQRT2, movement)) {
    const part = expandPrimitive(source, radius)
    const hit = rayPrimitive(origin, movement, part, 1)
    if (hit && hit.distance >= 0 && hit.distance <= 1 && (!closest || hit.distance < closest.fraction)) {
      closest = {fraction: hit.distance, normal: hit.normal, part: source, collider}
    }
  }
  return closest
}

export function sphereIntersectsCollider(center, radius, collider) {
  if (axisAlignedBox(collider)) return sphereIntersectsPrimitive(center, radius, collider)
  for (const part of queryPrimitives(collider, center, radius)) {
    if (sphereIntersectsPrimitive(center, radius, part)) return true
  }
  return false
}

export function colliderBounds(collider) {
  const result = {min: {x: Infinity, y: Infinity, z: Infinity}, max: {x: -Infinity, y: -Infinity, z: -Infinity}}
  const parts = colliderPrimitives(collider)
  if (!parts.length) return null
  for (const part of parts) {
    const bounds = primitiveBounds(part)
    for (const axis of ['x', 'y', 'z']) {
      result.min[axis] = Math.min(result.min[axis], bounds.min[axis])
      result.max[axis] = Math.max(result.max[axis], bounds.max[axis])
    }
  }
  return result
}

/** Conservative, allocation-light compound broad phase. Read the live source on
 * every query: editor/map mutations need no cache invalidation. Normalize only
 * candidate parts, retaining source order and the original narrow phase.
 * Planar queries deliberately ignore height. Sweep padding includes the rotated
 * local box expansion used by the existing sphere-sweep approximation.
 */
function* queryPrimitives(collider, point, radius = 0, movement = null, planar = false, distance = 1) {
  if (!collider) return
  if (!Array.isArray(collider.shapes)) {
    yield normalizePrimitive(collider, collider.center, collider.yaw || 0)
    return
  }
  // Unbounded rays retain the general path (0 * Infinity must not produce NaN).
  if (!Number.isFinite(distance)) { yield* colliderPrimitives(collider); return }
  const endX = point.x + (movement?.x || 0) * distance
  const endY = point.y + (movement?.y || 0) * distance
  const endZ = point.z + (movement?.z || 0) * distance
  const padding = radius + Math.sqrt(EPSILON)
  const minX = Math.min(point.x, endX) - padding, maxX = Math.max(point.x, endX) + padding
  const minY = Math.min(point.y, endY) - padding, maxY = Math.max(point.y, endY) + padding
  const minZ = Math.min(point.z, endZ) - padding, maxZ = Math.max(point.z, endZ) + padding
  const yaw = collider.yaw || 0, cos = Math.cos(yaw), sin = Math.sin(yaw), base = collider.center
  for (const part of collider.shapes) {
    const offset = part.offset
    const x = offset ? base.x + (offset.x || 0) * cos + (offset.z || 0) * sin : part.center?.x
    const y = offset ? base.y + (offset.y || 0) : part.center?.y
    const z = offset ? base.z - (offset.x || 0) * sin + (offset.z || 0) * cos : part.center?.z
    let sx, sy, sz
    if (part.shape === 'sphere') sx = sy = sz = part.radius * 2
    else if (part.shape === 'cylinder') {
      sx = sy = sz = part.radius * 2
      const axis = part.axis || 'y'
      if (axis === 'x') sx = part.height
      else if (axis === 'z') sz = part.height
      else sy = part.height
    } else { sx = part.size.x; sy = part.size.y; sz = part.size.z }
    const c = Math.abs(part.yaw ? Math.cos(yaw + part.yaw) : cos)
    const s = Math.abs(part.yaw ? Math.sin(yaw + part.yaw) : sin)
    const halfX = (sx * c + sz * s) / 2, halfZ = (sx * s + sz * c) / 2
    if (x + halfX < minX || x - halfX > maxX || z + halfZ < minZ || z - halfZ > maxZ ||
      (!planar && (y + sy / 2 < minY || y - sy / 2 > maxY))) continue
    yield normalizePrimitive(part, base, yaw)
  }
}

function axisAlignedBox(collider) {
  return collider && !Array.isArray(collider.shapes) && !collider.yaw && !collider.offset
    && (!collider.shape || collider.shape === 'box')
}

function boxFootprint(pos, collider, radius) {
  const x = Math.max(Math.abs(pos.x - collider.center.x) - collider.size.x / 2, 0)
  const z = Math.max(Math.abs(pos.z - collider.center.z) - collider.size.z / 2, 0)
  return x * x + z * z <= radius * radius + EPSILON
}

function normalizePrimitive(part, base, baseYaw) {
  const offset = part.offset || {x: 0, y: 0, z: 0}
  const cos = Math.cos(baseYaw), sin = Math.sin(baseYaw)
  return {
    ...part,
    shape: part.shape || 'box',
    center: part.offset ? {
      x: base.x + (offset.x || 0) * cos + (offset.z || 0) * sin,
      y: base.y + (offset.y || 0),
      z: base.z - (offset.x || 0) * sin + (offset.z || 0) * cos,
    } : {...part.center},
    yaw: baseYaw + (part.yaw || 0),
  }
}

function pointInsidePrimitiveFootprint(pos, part, radius) {
  const local = localPlanar(pos, part)
  if (part.shape === 'sphere' || (part.shape === 'cylinder' && (part.axis || 'y') === 'y')) {
    const primitiveRadius = part.radius
    return local.x * local.x + local.z * local.z <= (primitiveRadius + radius) ** 2 + EPSILON
  }
  let halfX
  let halfZ
  if (part.shape === 'cylinder') {
    halfX = (part.axis === 'x' ? part.height : part.radius * 2) / 2
    halfZ = (part.axis === 'z' ? part.height : part.radius * 2) / 2
  } else {
    halfX = part.size.x / 2
    halfZ = part.size.z / 2
  }
  const outsideX = Math.max(Math.abs(local.x) - halfX, 0)
  const outsideZ = Math.max(Math.abs(local.z) - halfZ, 0)
  return outsideX * outsideX + outsideZ * outsideZ <= radius * radius + EPSILON
}

function primitiveVerticalRange(part) {
  let half
  if (part.shape === 'sphere') half = part.radius
  else if (part.shape === 'cylinder') half = (part.axis || 'y') === 'y' ? part.height / 2 : part.radius
  else half = part.size.y / 2
  return {bottom: part.center.y - half, top: part.center.y + half}
}

function sphereIntersectsPrimitive(center, radius, part) {
  const local = localPoint(center, part)
  if (part.shape === 'sphere') {
    const reach = radius + part.radius
    return local.x ** 2 + local.y ** 2 + local.z ** 2 <= reach ** 2 + EPSILON
  }
  if (part.shape === 'cylinder') {
    const axis = part.axis || 'y'
    const radial = axis === 'x' ? ['y', 'z'] : axis === 'z' ? ['x', 'y'] : ['x', 'z']
    const radialDistance = Math.hypot(local[radial[0]], local[radial[1]])
    const radialOutside = Math.max(0, radialDistance - part.radius)
    const axialOutside = Math.max(0, Math.abs(local[axis]) - part.height / 2)
    return radialOutside ** 2 + axialOutside ** 2 <= radius ** 2 + EPSILON
  }
  let squared = 0
  for (const axis of ['x', 'y', 'z']) {
    const outside = Math.max(0, Math.abs(local[axis]) - part.size[axis] / 2)
    squared += outside ** 2
  }
  return squared <= radius ** 2 + EPSILON
}

function rayPrimitive(origin, direction, part, maxDistance) {
  if (part.shape === 'sphere') return raySpherePrimitive(origin, direction, part, maxDistance)
  const localOrigin = localPoint(origin, part)
  const localDirection = localDirectionFor(direction, part)
  const localHit = part.shape === 'cylinder'
    ? rayCylinderLocal(localOrigin, localDirection, part, maxDistance)
    : rayBoxLocal(localOrigin, localDirection, part.size, maxDistance)
  if (!localHit) return null
  return {distance: localHit.distance, normal: worldDirection(localHit.normal, part)}
}

function rayBoxLocal(origin, direction, size, maxDistance) {
  let near = 0
  let far = maxDistance
  let hitAxis = null
  let hitSign = 0
  for (const axis of ['x', 'y', 'z']) {
    const half = size[axis] / 2
    const delta = direction[axis]
    if (Math.abs(delta) < EPSILON) {
      if (origin[axis] < -half || origin[axis] > half) return null
      continue
    }
    let enter = (-half - origin[axis]) / delta
    let exit = (half - origin[axis]) / delta
    let sign = -1
    if (enter > exit) {
      [enter, exit] = [exit, enter]
      sign = 1
    }
    if (enter > near) {
      near = enter
      hitAxis = axis
      hitSign = sign
    }
    far = Math.min(far, exit)
    if (near > far) return null
  }
  if (near < 0 || near > maxDistance) return null
  const normal = {x: 0, y: 0, z: 0}
  if (hitAxis) normal[hitAxis] = hitSign
  return {distance: near, normal}
}

function raySpherePrimitive(origin, direction, part, maxDistance) {
  const ox = origin.x - part.center.x
  const oy = origin.y - part.center.y
  const oz = origin.z - part.center.z
  const a = direction.x ** 2 + direction.y ** 2 + direction.z ** 2
  const b = 2 * (ox * direction.x + oy * direction.y + oz * direction.z)
  const c = ox * ox + oy * oy + oz * oz - part.radius ** 2
  const discriminant = b * b - 4 * a * c
  if (a < EPSILON || discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const first = (-b - root) / (2 * a)
  const second = (-b + root) / (2 * a)
  const distance = first >= 0 ? first : second
  if (distance < 0 || distance > maxDistance) return null
  const point = {x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance}
  const inverse = 1 / part.radius
  return {distance, normal: {x: (point.x - part.center.x) * inverse, y: (point.y - part.center.y) * inverse, z: (point.z - part.center.z) * inverse}}
}

function rayCylinderLocal(origin, direction, part, maxDistance) {
  const axis = part.axis || 'y'
  const radial = axis === 'x' ? ['y', 'z'] : axis === 'z' ? ['x', 'y'] : ['x', 'z']
  const half = part.height / 2
  const candidates = []
  const a = direction[radial[0]] ** 2 + direction[radial[1]] ** 2
  const b = 2 * (origin[radial[0]] * direction[radial[0]] + origin[radial[1]] * direction[radial[1]])
  const c = origin[radial[0]] ** 2 + origin[radial[1]] ** 2 - part.radius ** 2
  const discriminant = b * b - 4 * a * c
  if (a > EPSILON && discriminant >= 0) {
    const root = Math.sqrt(discriminant)
    for (const distance of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      const axial = origin[axis] + direction[axis] * distance
      if (distance >= 0 && distance <= maxDistance && Math.abs(axial) <= half + EPSILON) {
        const normal = {x: 0, y: 0, z: 0}
        normal[radial[0]] = (origin[radial[0]] + direction[radial[0]] * distance) / part.radius
        normal[radial[1]] = (origin[radial[1]] + direction[radial[1]] * distance) / part.radius
        candidates.push({distance, normal})
      }
    }
  }
  if (Math.abs(direction[axis]) > EPSILON) {
    for (const sign of [-1, 1]) {
      const distance = (sign * half - origin[axis]) / direction[axis]
      const first = origin[radial[0]] + direction[radial[0]] * distance
      const second = origin[radial[1]] + direction[radial[1]] * distance
      if (distance >= 0 && distance <= maxDistance && first * first + second * second <= part.radius ** 2 + EPSILON) {
        const normal = {x: 0, y: 0, z: 0}
        normal[axis] = sign
        candidates.push({distance, normal})
      }
    }
  }
  candidates.sort((a, b) => a.distance - b.distance)
  return candidates[0] || null
}

function expandPrimitive(part, radius) {
  if (part.shape === 'sphere') return {...part, radius: part.radius + radius}
  if (part.shape === 'cylinder') return {...part, radius: part.radius + radius, height: part.height + radius * 2}
  return {...part, size: {x: part.size.x + radius * 2, y: part.size.y + radius * 2, z: part.size.z + radius * 2}}
}

function primitiveBounds(part) {
  if (part.shape === 'sphere') return boundsFromSize(part.center, {x: part.radius * 2, y: part.radius * 2, z: part.radius * 2})
  if (part.shape === 'cylinder') {
    const axis = part.axis || 'y'
    const size = {x: part.radius * 2, y: part.radius * 2, z: part.radius * 2}
    size[axis] = part.height
    if (axis !== 'y' && part.yaw) {
      const cos = Math.abs(Math.cos(part.yaw)), sin = Math.abs(Math.sin(part.yaw))
      ;[size.x, size.z] = [size.x * cos + size.z * sin, size.x * sin + size.z * cos]
    }
    return boundsFromSize(part.center, size)
  }
  const cos = Math.abs(Math.cos(part.yaw || 0)), sin = Math.abs(Math.sin(part.yaw || 0))
  return boundsFromSize(part.center, {x: part.size.x * cos + part.size.z * sin, y: part.size.y, z: part.size.x * sin + part.size.z * cos})
}

function boundsFromSize(center, size) {
  return {
    min: {x: center.x - size.x / 2, y: center.y - size.y / 2, z: center.z - size.z / 2},
    max: {x: center.x + size.x / 2, y: center.y + size.y / 2, z: center.z + size.z / 2},
  }
}

function localPlanar(point, part) {
  const dx = point.x - part.center.x
  const dz = point.z - part.center.z
  const cos = Math.cos(part.yaw || 0), sin = Math.sin(part.yaw || 0)
  return {x: dx * cos - dz * sin, z: dx * sin + dz * cos}
}

function localPoint(point, part) {
  const planar = localPlanar(point, part)
  return {x: planar.x, y: point.y - part.center.y, z: planar.z}
}

function localDirectionFor(direction, part) {
  const cos = Math.cos(part.yaw || 0), sin = Math.sin(part.yaw || 0)
  return {x: direction.x * cos - direction.z * sin, y: direction.y, z: direction.x * sin + direction.z * cos}
}

function worldDirection(direction, part) {
  const cos = Math.cos(part.yaw || 0), sin = Math.sin(part.yaw || 0)
  return {x: direction.x * cos + direction.z * sin, y: direction.y, z: -direction.x * sin + direction.z * cos}
}
