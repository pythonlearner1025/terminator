import {pointInsideExpandedBox, planarDistance} from './math.js'

export class NavGrid {
  constructor(map, dynamicColliders = []) {
    this.map = map
    this.spec = map.navGrid
    this.blocked = new Uint8Array(this.spec.width * this.spec.height)
    this.rebuild(dynamicColliders)
  }

  rebuild(dynamicColliders = []) {
    this.blocked.fill(0)
    const colliders = [...this.map.colliders.filter((item) => item.navBlock), ...dynamicColliders]
    for (let z = 0; z < this.spec.height; z += 1) {
      for (let x = 0; x < this.spec.width; x += 1) {
        const point = this.cellCenter({x, z})
        if (colliders.some((collider) => pointInsideExpandedBox(point, collider, this.spec.agentRadius))) {
          this.blocked[this.index(x, z)] = 1
        }
      }
    }
  }

  index(x, z) {
    return z * this.spec.width + x
  }

  inBounds(cell) {
    return cell.x >= 0 && cell.x < this.spec.width && cell.z >= 0 && cell.z < this.spec.height
  }

  isBlocked(cell) {
    return !this.inBounds(cell) || this.blocked[this.index(cell.x, cell.z)] === 1
  }

  worldToCell(pos) {
    return {
      x: Math.max(0, Math.min(this.spec.width - 1, Math.floor((pos.x - this.spec.origin.x) / this.spec.cellSize))),
      z: Math.max(0, Math.min(this.spec.height - 1, Math.floor((pos.z - this.spec.origin.z) / this.spec.cellSize))),
    }
  }

  cellCenter(cell) {
    return {
      x: this.spec.origin.x + (cell.x + 0.5) * this.spec.cellSize,
      y: 0,
      z: this.spec.origin.z + (cell.z + 0.5) * this.spec.cellSize,
    }
  }

  nearestOpen(cell) {
    if (!this.isBlocked(cell)) return cell
    for (let radius = 1; radius < 8; radius += 1) {
      for (let z = cell.z - radius; z <= cell.z + radius; z += 1) {
        for (let x = cell.x - radius; x <= cell.x + radius; x += 1) {
          const candidate = {x, z}
          if (this.inBounds(candidate) && !this.isBlocked(candidate)) return candidate
        }
      }
    }
    return null
  }

  findPath(startPos, endPos) {
    const start = this.nearestOpen(this.worldToCell(startPos))
    const goal = this.nearestOpen(this.worldToCell(endPos))
    if (!start || !goal) return null
    const startIndex = this.index(start.x, start.z)
    const goalIndex = this.index(goal.x, goal.z)
    const open = [startIndex]
    const openSet = new Uint8Array(this.blocked.length)
    const closed = new Uint8Array(this.blocked.length)
    const cameFrom = new Int32Array(this.blocked.length)
    const g = new Float64Array(this.blocked.length)
    const f = new Float64Array(this.blocked.length)
    cameFrom.fill(-1)
    g.fill(Infinity)
    f.fill(Infinity)
    openSet[startIndex] = 1
    g[startIndex] = 0
    f[startIndex] = heuristic(start, goal)

    while (open.length) {
      let bestAt = 0
      for (let index = 1; index < open.length; index += 1) {
        if (f[open[index]] < f[open[bestAt]]) bestAt = index
      }
      const currentIndex = open.splice(bestAt, 1)[0]
      openSet[currentIndex] = 0
      if (currentIndex === goalIndex) return this.reconstruct(cameFrom, currentIndex)
      closed[currentIndex] = 1
      const current = {x: currentIndex % this.spec.width, z: Math.floor(currentIndex / this.spec.width)}
      for (const neighbor of neighbors(current)) {
        if (this.isBlocked(neighbor)) continue
        const neighborIndex = this.index(neighbor.x, neighbor.z)
        if (closed[neighborIndex]) continue
        const score = g[currentIndex] + 1
        if (score >= g[neighborIndex]) continue
        cameFrom[neighborIndex] = currentIndex
        g[neighborIndex] = score
        f[neighborIndex] = score + heuristic(neighbor, goal)
        if (!openSet[neighborIndex]) {
          openSet[neighborIndex] = 1
          open.push(neighborIndex)
        }
      }
    }
    return null
  }

  reconstruct(cameFrom, currentIndex) {
    const path = []
    while (currentIndex >= 0) {
      path.push(this.cellCenter({
        x: currentIndex % this.spec.width,
        z: Math.floor(currentIndex / this.spec.width),
      }))
      currentIndex = cameFrom[currentIndex]
    }
    return path.reverse()
  }

  pathDistance(path) {
    if (!path?.length) return 0
    let total = 0
    for (let index = 1; index < path.length; index += 1) total += planarDistance(path[index - 1], path[index])
    return total
  }
}

function neighbors(cell) {
  return [
    {x: cell.x + 1, z: cell.z},
    {x: cell.x - 1, z: cell.z},
    {x: cell.x, z: cell.z + 1},
    {x: cell.x, z: cell.z - 1},
  ]
}

function heuristic(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
}
