export const defaultHkTankScriptSource = `
export function tick(self, sense, act, mem) {
  const seen = sense.player
  const target = seen?.pos || sense.lastKnownPlayer?.pos || sense.sounds.at(-1)?.pos
  if (!target) {
    const wander = mem.wanderTarget
    if (!wander || Math.hypot(wander.x - self.pos.x, wander.z - self.pos.z) < 1) {
      mem.wanderTarget = sense.nav.randomPoint(4)
    }
    act.moveTo(mem.wanderTarget)
    return
  }
  if (!seen || seen.dist > 18) act.moveTo(target)
  else act.stop()
  act.aimAt(target)
  act.face(target)
  if (seen) act.fire()
  if (sense.time - (mem.lastCalloutAt ?? -10) >= 5) {
    act.say('EXTERMINATION PROTOCOL')
    mem.lastCalloutAt = sense.time
  }
}
`

export default defaultHkTankScriptSource
