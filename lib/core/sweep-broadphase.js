import {colliderBounds, sweepSphereCollider} from './collision.js'

const CELL_SIZE = 8
const sameVector = (a, b) => a?.x === b?.x && a?.y === b?.y && a?.z === b?.z
const samePrimitive = (a, b) => a.shape === b.shape && a.axis === b.axis && a.yaw === b.yaw
  && a.radius === b.radius && a.height === b.height && sameVector(a.center, b.center)
  && sameVector(a.offset, b.offset) && sameVector(a.size, b.size)
const copyPrimitive = p => ({shape:p.shape, axis:p.axis, yaw:p.yaw, radius:p.radius, height:p.height,
  center:p.center && {...p.center}, offset:p.offset && {...p.offset}, size:p.size && {...p.size}})

/** A batch-scoped query index with live geometry validation before each batch.
 * Bounds use the same normalized primitives as the narrow phase. No source
 * objects are frozen or modified, and no ray/sweep result is cached.
 */
export class SweepBroadphase {
  constructor() {
    this.records = new WeakMap()
    this.colliders = []
    this.bounds = []
    this.cells = new Map()
    this.candidates = []
    this.visited = new Uint32Array(0)
    this.stamp = 0
  }

  prepare(colliders) {
    let changed = colliders.length !== this.colliders.length
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i], parts = Array.isArray(c.shapes) ? c.shapes : null
      let record = this.records.get(c) || (this.colliders[i] && this.records.get(this.colliders[i]))
      if (!record || !samePrimitive(c, record.source) || Boolean(parts) !== Boolean(record.parts)
        || (parts && (parts.length !== record.parts.length || parts.some((p, j) => !samePrimitive(p, record.parts[j]))))) {
        record = {source:copyPrimitive(c), parts:parts?.map(copyPrimitive), bounds:colliderBounds(c)}
        changed = true
      }
      // Dynamic door records are freshly allocated each batch. Equivalent
      // geometry at the same source index can retain its cells and bounds.
      this.records.set(c, record)
      if (this.bounds[i] !== record.bounds) changed = true
      this.colliders[i] = c
      this.bounds[i] = record.bounds
    }
    this.colliders.length = colliders.length
    if (!changed) return this
    this.bounds.length = colliders.length
    this.visited = new Uint32Array(colliders.length)
    this.cells.clear()
    for (let i = 0; i < colliders.length; i++) {
      const b = this.bounds[i]
      if (!b) continue
      for (let z = Math.floor(b.min.z / CELL_SIZE); z <= Math.floor(b.max.z / CELL_SIZE); z++) {
        for (let x = Math.floor(b.min.x / CELL_SIZE); x <= Math.floor(b.max.x / CELL_SIZE); x++) {
          const key = `${x}:${z}`
          let cell = this.cells.get(key)
          if (!cell) this.cells.set(key, cell = [])
          cell.push(i)
        }
      }
    }
    return this
  }

  sweep(origin, movement, radius) {
    // The existing approximation expands boxes in rotated local coordinates.
    // sqrt(2) padding bounds that expansion; epsilon retains boundary contacts.
    const padding = radius * Math.SQRT2 + Math.sqrt(1e-9)
    const minX = Math.min(origin.x, origin.x + movement.x) - padding
    const maxX = Math.max(origin.x, origin.x + movement.x) + padding
    const minY = Math.min(origin.y, origin.y + movement.y) - padding
    const maxY = Math.max(origin.y, origin.y + movement.y) + padding
    const minZ = Math.min(origin.z, origin.z + movement.z) - padding
    const maxZ = Math.max(origin.z, origin.z + movement.z) + padding
    this.stamp = (this.stamp + 1) >>> 0
    if (this.stamp === 0) {this.visited.fill(0); this.stamp = 1}
    const candidates = this.candidates
    candidates.length = 0
    for (let z = Math.floor(minZ / CELL_SIZE); z <= Math.floor(maxZ / CELL_SIZE); z++) {
      for (let x = Math.floor(minX / CELL_SIZE); x <= Math.floor(maxX / CELL_SIZE); x++) {
        const cell = this.cells.get(`${x}:${z}`)
        if (!cell) continue
        for (const i of cell) {
          if (this.visited[i] === this.stamp) continue
          this.visited[i] = this.stamp
          const b = this.bounds[i]
          if (b.max.x < minX || b.min.x > maxX || b.max.y < minY || b.min.y > maxY || b.max.z < minZ || b.min.z > maxZ) continue
          candidates.push(i)
        }
      }
    }
    // The first collider wins equal fractions in the original loop.
    candidates.sort((a, b) => a - b)
    let closest = null
    for (const i of candidates) {
      const hit = sweepSphereCollider(origin, movement, radius, this.colliders[i])
      if (hit && (!closest || hit.fraction < closest.fraction)) closest = hit
    }
    return closest
  }
}
