// Per-session timings in the page's performance clock, also emitted for DevTools.
// These are CPU/wait spans, not a claim about GPU execution or transferred bytes.
export function createStartupProfile() {
  const profile = {startedAt: performance.now(), spans: [], marks: {}}
  profile.mark = name => {
    const at = performance.now()
    profile.marks[name] = at
    performance.mark?.(`terminator:${name}`)
  }
  profile.measure = (name, work) => {
    const start = performance.now()
    const finish = status => {
      const end = performance.now()
      if (profile.spans.length < 100) profile.spans.push({name, start, end, ms: end-start, status})
      performance.measure?.(`terminator:${name}`, {start, end})
    }
    try {
      const result = work()
      if (result?.then) return Promise.resolve(result).then(value => {finish('ready'); return value}, error => {finish('failed'); throw error})
      finish('ready')
      return result
    } catch (error) {finish('failed'); throw error}
  }
  // Navigation start is on the same performance clock as DOM event.timeStamp.
  // Never substitute an automation intent or manager start for a missing click.
  profile.navigationAt = performance.getEntriesByType?.('navigation')?.[0]?.startTime ?? 0
  profile.attempts = []
  profile.beginMatch = (trigger, eventAt) => {
    const now = performance.now()
    if (profile.attempt?.status === 'preparing') return profile.attempt
    const clickAt = trigger === 'dom-start-click' && Number.isFinite(eventAt) && eventAt >= profile.startedAt && eventAt <= now ? eventAt : null
    const attempt = {trigger, clickAt, requestedAt:now, status:'preparing'}
    profile.attempt = attempt
    profile.attempts.push(attempt)
    if (profile.attempts.length > 20) profile.attempts.shift()
    if (clickAt !== null) profile.mark('start-click')
    return attempt
  }
  profile.inputReady = () => {
    const attempt = profile.attempt
    if (!attempt || attempt.status !== 'preparing') return
    const at = performance.now()
    Object.assign(attempt, {status:'ready', inputReadyAt:at,
      clickToInputReadyMs:attempt.clickAt === null ? null : at-attempt.clickAt,
      requestToInputReadyMs:at-attempt.requestedAt,
      navigationToInputReadyMs:at-profile.navigationAt,
      managerToInputReadyMs:at-profile.startedAt})
    profile.mark('input-ready')
  }
  profile.failMatch = error => {
    if (profile.attempt?.status === 'preparing') Object.assign(profile.attempt,{status:'failed',error:String(error?.message || error),endedAt:performance.now()})
  }
  profile.cancelMatch = () => {
    if (profile.attempt?.status === 'preparing') Object.assign(profile.attempt,{status:'cancelled',endedAt:performance.now()})
  }
  return profile
}
