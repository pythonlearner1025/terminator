export const defaultHeavyScriptSource = `
export function tick(self, sense, act, mem) {
  const target = sense.player?.pos || sense.lastKnownPlayer?.pos || sense.sounds.at(-1)?.pos
  if (!target) {
    const wander = mem.wanderTarget
    if (!wander || Math.hypot(wander.x - self.pos.x, wander.z - self.pos.z) < 1) {
      mem.wanderTarget = sense.nav.randomPoint(4)
    }
    act.moveTo(mem.wanderTarget)
    return
  }

  act.moveTo(target)
  act.aimAt(target)
  act.face(target)
  if (sense.player || sense.lastKnownPlayer) act.fire()
  if (sense.time - (mem.lastCalloutAt ?? -10) >= 5) {
    act.say('TARGET ACQUIRED')
    mem.lastCalloutAt = sense.time
  }
}
`

export default defaultHeavyScriptSource
