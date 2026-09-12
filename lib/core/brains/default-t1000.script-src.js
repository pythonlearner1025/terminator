export const defaultT1000ScriptSource = `
export function tick(self, sense, act, mem) {
  const seen = sense.player
  const target = seen?.pos || sense.lastKnownPlayer?.pos || sense.sounds.at(-1)?.pos
  if (!target) {
    const wander = mem.wanderTarget
    if (!wander || Math.hypot(wander.x - self.pos.x, wander.z - self.pos.z) < 1) {
      mem.wanderTarget = sense.nav.randomPoint(7)
    }
    act.moveTo(mem.wanderTarget)
    return
  }
  act.moveTo(target)
  act.face(target)
  if (seen?.dist <= self.weapon.range) {
    act.stop()
    act.melee()
  }
}
`

export default defaultT1000ScriptSource
