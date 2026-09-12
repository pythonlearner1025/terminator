// Presentation-only probes. The World's existing sight blockers remain authoritative.
export function roomAt(position = {}) {
  const {x = 0, y = 0, z = 0} = position
  if (x < -19 && x > -29 && z > -4 && z < 4 && y < 3) return 'tunnel'
  if (Math.abs(x) < 14 && z > 17 && z < 27 && y < 6) return 'building'
  return 'outside'
}

export function probeAcoustics(world, listener, source) {
  const distance = Math.hypot(source.x - listener.x, (source.y || 0) - (listener.y || 0), source.z - listener.z)
  return {distance, blocked: distance > 1 && world?.lineOfSight ? !world.lineOfSight(listener, source) : false}
}

export function createRoomImpulse(context) {
  const rate = context.sampleRate
  const buffer = context.createBuffer(2, Math.ceil(rate * 0.72), rate)
  let seed = 2029
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let low = 0
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      low += (((seed >>> 0) / 2147483648 - 1) - low) * 0.22
      data[i] = i > rate * 0.018 ? low * Math.exp(-9 * i / data.length) * 0.28 : 0
    }
    for (const [time, gain] of [[0.027, 0.7], [0.043, 0.48], [0.071, 0.32], [0.113, 0.19]]) {
      data[Math.floor((time + channel * 0.003) * rate)] += gain
    }
  }
  return buffer
}
