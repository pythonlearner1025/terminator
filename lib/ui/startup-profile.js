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
  return profile
}
