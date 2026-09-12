export const defaultHkAerialScriptSource = `
export function tick(self, sense, act, mem) {
  const seen = sense.player
  const target = seen?.pos || sense.lastKnownPlayer?.pos || sense.sounds.at(-1)?.pos
  if (!target) {
    const wander = mem.wanderTarget
    if (!wander || Math.hypot(wander.x - self.pos.x, wander.z - self.pos.z) < 1) {
      const angle = sense.rand() * Math.PI * 2
      mem.wanderTarget = {x: self.pos.x + Math.sin(angle) * 10, y: 4.5, z: self.pos.z + Math.cos(angle) * 10}
    }
    act.moveTo(mem.wanderTarget)
    return
  }

  mem.orbitSide ??= sense.rand() < 0.5 ? -1 : 1
  const dx = self.pos.x - target.x
  const dz = self.pos.z - target.z
  const distance = Math.hypot(dx, dz) || 1
  const orbitRadius = Math.max(12.5, Math.min(24.5, distance))
  const radialX = dx / distance
  const radialZ = dz / distance
  const tangentX = -radialZ * mem.orbitSide
  const tangentZ = radialX * mem.orbitSide
  const scale = orbitRadius / Math.hypot(orbitRadius, 3)
  act.moveTo({
    x: target.x + (radialX * orbitRadius + tangentX * 3) * scale,
    y: 4.75 + Math.sin(sense.time * 0.7) * 0.75,
    z: target.z + (radialZ * orbitRadius + tangentZ * 3) * scale,
  })
  act.aimAt(target)
  act.face(target)
  if (seen && seen.dist >= 12 && seen.dist <= 25) act.fire()
}
`

export default defaultHkAerialScriptSource
