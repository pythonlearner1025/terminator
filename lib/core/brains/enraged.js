// Native brain for enraged units. World refreshes lastKnownPlayer to the nearest
// living player on every brain tick, so this brain never loses the player.
// A body reads only the intent its attack rule uses: melee bodies read melee and
// ranged bodies read fire. Asking for both keeps this brain free of a type list.
export function tick(self, sense, act) {
  const target = sense.player?.pos || sense.lastKnownPlayer?.pos
  if (!target) {
    act.stop()
    return
  }
  act.moveTo(target)
  act.face(target)
  act.aimAt(target)
  act.melee()
  act.fire()
}
