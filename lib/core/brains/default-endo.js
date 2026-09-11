export function tick(self, sense, act, mem) {
  const seen = sense.player
  if (seen) {
    mem.lastCoverAt ??= -10
    let destination = seen.pos
    if (sense.time - mem.lastCoverAt >= 2) {
      destination = sense.nav.coverNear(self.pos, seen.pos, 8) || seen.pos
      mem.cover = destination
      mem.lastCoverAt = sense.time
    } else if (mem.cover) {
      destination = mem.cover
    }
    if (seen.dist > 12) act.moveTo(destination)
    else act.stop()
    act.aimAt(seen.pos)
    act.face(seen.pos)
    act.fire()
    return
  }

  const target = sense.lastKnownPlayer?.pos || sense.sounds.at(-1)?.pos
  if (target) {
    act.moveTo(target)
    act.face(target)
  } else {
    const wander = mem.wanderTarget
    if (!wander || Math.hypot(wander.x - self.pos.x, wander.z - self.pos.z) < 1) {
      mem.wanderTarget = sense.nav.randomPoint(6)
    }
    act.moveTo(mem.wanderTarget)
  }
}
