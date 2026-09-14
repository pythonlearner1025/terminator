// Keep projection state off the world/snapshot and allow discarded worlds to GC.
const projections = new WeakMap()

// Internal, borrowed result: callers must not mutate the returned array.
export function recentEventsFor(world, now) {
  const log = world.eventLog
  const length = log.length
  let state = projections.get(world)
  // World.emit keeps prefixes immutable. World.applySnapshot clones replacement
  // suffixes, so their last previously consumed object changes even if a
  // truncate + reappend restores (or exceeds) the old length between calls.
  if (!state || state.log !== log || length < state.length
    || (state.length > 0 && log[state.length - 1] !== state.boundary)
    || !(now >= state.now)) {
    state = {log, length: 0, now, boundary: undefined, recent: []}
    projections.set(world, state)
  }
  if (now !== state.now) {
    // Timestamps need not be ordered. Preserve log order and the exact original
    // subtraction predicate, including future timestamps and the 5s boundary.
    // Expired entries cannot qualify again until time rewinds (rebuild above).
    state.recent = state.recent.filter((event) => now - event.t <= 5)
  }
  for (let index = state.length; index < length; index++) {
    // Array.filter skips holes; keep that behavior on rebuilds/appends too.
    if (!(index in log)) continue
    const event = log[index]
    if (now - event.t <= 5) state.recent.push(event)
  }
  state.length = length
  state.boundary = length > 0 ? log[length - 1] : undefined
  state.now = now
  return state.recent
}
