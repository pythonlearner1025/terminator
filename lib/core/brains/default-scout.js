export function tick(self, sense, act, mem) {
  const seen = sense.player
  if (seen) {
    mem.lastSide ??= sense.rand() < 0.5 ? -1 : 1
    const dx = seen.pos.x - self.pos.x
    const dz = seen.pos.z - self.pos.z
    if (seen.dist <= self.weapon.range) {
      act.stop()
      act.face(seen.pos)
      act.melee()
      return
    }
    const length = Math.hypot(dx, dz) || 1
    const flank = Math.min(3, seen.dist * 0.25)
    act.moveTo({
      x: seen.pos.x + (-dz / length) * flank * mem.lastSide,
      y: seen.pos.y,
      z: seen.pos.z + (dx / length) * flank * mem.lastSide,
    })
    act.face(seen.pos)
    return
  }

  const target = sense.lastKnownPlayer?.pos || sense.sounds.at(-1)?.pos
  if (target) {
    act.moveTo(target)
    act.face(target)
  } else {
    const wander = mem.wanderTarget
    if (!wander || Math.hypot(wander.x - self.pos.x, wander.z - self.pos.z) < 1) {
      mem.wanderTarget = sense.nav.randomPoint(8)
    }
    act.moveTo(mem.wanderTarget)
  }
}
