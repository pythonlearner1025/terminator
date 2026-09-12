import {distance} from './math.js'
import {colliderSurfacesAt, pointInsideColliderFootprint, staticColliders} from './collision.js'

const EPSILON = 1e-6

export class NavGrid {
  constructor(map, dynamicColliders = []) {
    this.map = map
    this.spec = map.navGrid
    this.walkable = map.walkable || deriveWalkable(map)
    this.maxStep = this.walkable.maxStep ?? 0.5
    this.agentHeight = this.walkable.agentHeight ?? 2
    this.colliderById = new Map(staticColliders(map).map((collider) => [collider.id, collider]))
    this.surfaceSpecs = this.walkable.surfaces
      .map((surface) => ({...surface, source: this.colliderById.get(surface.collider)}))
      .filter((surface) => surface.source)
    this.surfaceColliderIds = new Set(this.surfaceSpecs.map((surface) => surface.collider))
    this.nodes = []
    this.cellNodes = []
    this.blocked = new Uint8Array(0)
    this.rebuild(dynamicColliders)
  }

  rebuild(dynamicColliders = []) {
    this.nodes = []
    this.cellNodes = Array.from({length: this.spec.width * this.spec.height}, () => [])
    for (let z = 0; z < this.spec.height; z += 1) {
      for (let x = 0; x < this.spec.width; x += 1) {
        const point = this.rawCellCenter(x, z)
        for (const surface of this.walkableSurfacesAt(point)) {
          const node = {
            index: this.nodes.length,
            x,
            z,
            y: surface.y,
            layer: surface.id,
            level: surface.level,
            colliderId: surface.colliderId,
          }
          this.nodes.push(node)
          this.cellNodes[this.index(x, z)].push(node.index)
        }
      }
    }

    this.blocked = new Uint8Array(this.nodes.length)
    const blockers = [...staticColliders(this.map).filter((item) => item.navBlock), ...dynamicColliders]
    for (const node of this.nodes) {
      const point = this.nodePoint(node)
      if (blockers.some((collider) => this.colliderBlocksNode(collider, node, point))) {
        this.blocked[node.index] = 1
        continue
      }
      const overhead = this.nodesAt(node.x, node.z).some((other) => (
        other.y > node.y + EPSILON
        && other.y < node.y + this.agentHeight - EPSILON
        && !this.isMovementHole(other.colliderId, point, this.spec.agentRadius)
      ))
      if (overhead) this.blocked[node.index] = 1
    }
  }

  index(x, z) {
    return z * this.spec.width + x
  }

  inBounds(cell) {
    return cell.x >= 0 && cell.x < this.spec.width && cell.z >= 0 && cell.z < this.spec.height
  }

  isBlocked(cell) {
    if (!this.inBounds(cell)) return true
    const node = this.resolveNode(cell)
    return !node || this.blocked[node.index] === 1
  }

  worldToCell(pos) {
    const cell = {
      x: Math.max(0, Math.min(this.spec.width - 1, Math.floor((pos.x - this.spec.origin.x) / this.spec.cellSize))),
      z: Math.max(0, Math.min(this.spec.height - 1, Math.floor((pos.z - this.spec.origin.z) / this.spec.cellSize))),
      y: Number(pos.y) || 0,
    }
    const node = this.closestNode(cell.x, cell.z, cell.y)
    if (node) cell.layer = node.layer
    return cell
  }

  cellCenter(cell) {
    const node = this.resolveNode(cell)
    return node ? this.nodePoint(node) : this.rawCellCenter(cell.x, cell.z, Number(cell.y) || 0)
  }

  cellsAt(cell, {openOnly = false} = {}) {
    if (!this.inBounds(cell)) return []
    const desiredY = Number(cell.y) || 0
    return this.nodesAt(cell.x, cell.z)
      .filter((node) => !openOnly || this.blocked[node.index] === 0)
      .sort((a, b) => Math.abs(a.y - desiredY) - Math.abs(b.y - desiredY) || a.index - b.index)
      .map((node) => ({x: node.x, z: node.z, y: node.y, layer: node.layer}))
  }

  nearestOpen(cell) {
    const desiredY = Number(cell.y) || 0
    for (let radius = 0; radius < 8; radius += 1) {
      let best = null
      for (let z = cell.z - radius; z <= cell.z + radius; z += 1) {
        for (let x = cell.x - radius; x <= cell.x + radius; x += 1) {
          if (radius > 0 && Math.abs(x - cell.x) !== radius && Math.abs(z - cell.z) !== radius) continue
          if (!this.inBounds({x, z})) continue
          for (const node of this.nodesAt(x, z)) {
            if (this.blocked[node.index] || Math.abs(node.y - desiredY) > this.maxStep + EPSILON) continue
            const score = Math.abs(node.y - desiredY)
            if (!best || score < best.score || (score === best.score && node.index < best.node.index)) best = {node, score}
          }
        }
      }
      if (best) return {x: best.node.x, z: best.node.z, y: best.node.y, layer: best.node.layer}
    }
    return null
  }

  findPath(startPos, endPos) {
    const start = this.nearestOpen(this.worldToCell(startPos))
    const goal = this.nearestOpen(this.worldToCell(endPos))
    if (!start || !goal) return null
    const startNode = this.resolveNode(start)
    const goalNode = this.resolveNode(goal)
    if (!startNode || !goalNode) return null

    const cameFrom = new Int32Array(this.nodes.length)
    const g = new Float64Array(this.nodes.length)
    cameFrom.fill(-1)
    g.fill(Infinity)
    g[startNode.index] = 0
    const open = new MinHeap()
    open.push(startNode.index, this.heuristic(startNode, goalNode))
    const closed = new Uint8Array(this.nodes.length)

    while (open.length) {
      const currentIndex = open.pop()
      if (closed[currentIndex]) continue
      if (currentIndex === goalNode.index) return this.reconstruct(cameFrom, currentIndex)
      closed[currentIndex] = 1
      const current = this.nodes[currentIndex]
      for (const neighbor of this.neighbors(current)) {
        if (closed[neighbor.index] || this.blocked[neighbor.index]) continue
        const score = g[currentIndex] + distance(this.nodePoint(current), this.nodePoint(neighbor))
        if (score >= g[neighbor.index]) continue
        cameFrom[neighbor.index] = currentIndex
        g[neighbor.index] = score
        open.push(neighbor.index, score + this.heuristic(neighbor, goalNode))
      }
    }
    return null
  }

  reconstruct(cameFrom, currentIndex) {
    const path = []
    while (currentIndex >= 0) {
      path.push(this.nodePoint(this.nodes[currentIndex]))
      currentIndex = cameFrom[currentIndex]
    }
    return path.reverse()
  }

  pathDistance(path) {
    if (!path?.length) return 0
    let total = 0
    for (let index = 1; index < path.length; index += 1) total += distance(path[index - 1], path[index])
    return total
  }

  supportAt(pos, currentY, {radius = 0, maxAbove = this.maxStep, maxBelow = this.maxStep} = {}) {
    let best = null
    for (const surface of this.walkableSurfacesAt(pos, radius)) {
      if (surface.y > currentY + maxAbove + EPSILON || surface.y < currentY - maxBelow - EPSILON) continue
      if (!best || surface.y > best.y) best = surface
    }
    return best
  }

  landingSurface(pos, fromY, toY, radius = 0) {
    let best = null
    for (const surface of this.walkableSurfacesAt(pos, radius)) {
      if (surface.y > fromY + EPSILON || surface.y < toY - EPSILON) continue
      if (!best || surface.y > best.y) best = surface
    }
    return best
  }

  walkableSurfacesAt(pos, radius = 0) {
    const matches = []
    for (const surface of this.surfaceSpecs) {
      const collider = surface.source
      if (this.isMovementHole(surface.collider, pos, radius)) continue
      if (!pointInsideColliderFootprint(pos, collider, radius)) continue
      matches.push({
        id: surface.collider,
        colliderId: surface.collider,
        level: surface.level || surface.collider,
        y: this.surfaceHeight(surface, pos),
      })
    }
    matches.sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))
    const clusters = []
    for (const match of matches) {
      const cluster = clusters.at(-1)
      if (!cluster || match.y - cluster.baseY > EPSILON) {
        clusters.push({baseY: match.y, surface: match})
      } else if (match.y >= cluster.surface.y) {
        cluster.surface = match
      }
    }
    return clusters.map(({surface}) => surface)
  }

  isMovementHole(colliderId, pos, radius = 0) {
    return (this.walkable.movementHoles || []).some((hole) => (
      hole.collider === colliderId
      && pos.x - radius >= hole.minX
      && pos.x + radius <= hole.maxX
      && pos.z - radius >= hole.minZ
      && pos.z + radius <= hole.maxZ
    ))
  }

  isSurfaceCollider(colliderId) {
    return this.surfaceColliderIds.has(colliderId)
  }

  surfaceHeight(surface, pos) {
    const collider = surface.source
    if (surface.height === 'stairTread') return collider.center.y + (this.walkable.heightRules?.stairTreadOffset ?? 0.25)
    if (surface.height === 'ramp') {
      const value = surface.axis === 'z' ? pos.z : pos.x
      const span = surface.to - surface.from || 1
      const ratio = Math.max(0, Math.min(1, (value - surface.from) / span))
      return surface.low + (surface.high - surface.low) * ratio
    }
    return collider.center.y + collider.size.y / 2
  }

  colliderBlocksNode(collider, node, point) {
    if (collider.id === node.colliderId) return false
    if (collider.kind === 'stair' && this.isSurfaceCollider(collider.id)) return false
    if (this.isMovementHole(collider.id, point, this.spec.agentRadius)) return false
    return colliderSurfacesAt(point, collider, this.spec.agentRadius)
      .some(({bottom, top}) => top > node.y + EPSILON && bottom < node.y + this.agentHeight - EPSILON)
  }

  neighbors(node) {
    const result = []
    const adjacent = [
      {x: node.x + 1, z: node.z},
      {x: node.x - 1, z: node.z},
      {x: node.x, z: node.z + 1},
      {x: node.x, z: node.z - 1},
    ]
    for (const cell of adjacent) {
      if (!this.inBounds(cell)) continue
      for (const candidate of this.nodesAt(cell.x, cell.z)) {
        if (Math.abs(candidate.y - node.y) <= this.maxStep + EPSILON) result.push(candidate)
      }
    }
    for (const candidate of this.nodesAt(node.x, node.z)) {
      if (candidate.index !== node.index && Math.abs(candidate.y - node.y) <= this.maxStep + EPSILON) result.push(candidate)
    }
    return result
  }

  heuristic(a, b) {
    return (Math.abs(a.x - b.x) + Math.abs(a.z - b.z)) * this.spec.cellSize
  }

  nodesAt(x, z) {
    return this.cellNodes[this.index(x, z)].map((nodeIndex) => this.nodes[nodeIndex])
  }

  closestNode(x, z, y, layer) {
    let best = null
    for (const node of this.nodesAt(x, z)) {
      if (layer && node.layer === layer) return node
      const score = Math.abs(node.y - y)
      if (!best || score < best.score || (score === best.score && node.index < best.node.index)) best = {node, score}
    }
    return best?.node || null
  }

  resolveNode(cell) {
    return this.closestNode(cell.x, cell.z, Number(cell.y) || 0, cell.layer)
  }

  rawCellCenter(x, z, y = 0) {
    return {
      x: this.spec.origin.x + (x + 0.5) * this.spec.cellSize,
      y,
      z: this.spec.origin.z + (z + 0.5) * this.spec.cellSize,
    }
  }

  nodePoint(node) {
    return this.rawCellCenter(node.x, node.z, node.y)
  }
}

class MinHeap {
  constructor() {
    this.items = []
    this.order = 0
  }

  get length() {
    return this.items.length
  }

  push(value, priority) {
    const item = {value, priority, order: this.order++}
    this.items.push(item)
    let index = this.items.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (!before(item, this.items[parent])) break
      this.items[index] = this.items[parent]
      index = parent
    }
    this.items[index] = item
  }

  pop() {
    const root = this.items[0]
    const tail = this.items.pop()
    if (this.items.length) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= this.items.length) break
        let child = left
        if (right < this.items.length && before(this.items[right], this.items[left])) child = right
        if (!before(this.items[child], tail)) break
        this.items[index] = this.items[child]
        index = child
      }
      this.items[index] = tail
    }
    return root.value
  }
}

function before(a, b) {
  return a.priority < b.priority || (a.priority === b.priority && a.order < b.order)
}

function deriveWalkable(map) {
  return {
    maxStep: 0.5,
    agentHeight: 2,
    gravity: 18,
    surfaces: map.colliders.filter(({kind}) => kind === 'floor').map(({id}) => ({collider: id, height: 'top'})),
    movementHoles: [],
  }
}
