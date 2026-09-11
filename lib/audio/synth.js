const TAU = Math.PI * 2

export function renderSynthBuffer(context, recipe, seed = 1) {
  const sampleRate = context.sampleRate || 48000
  const duration = Math.max(0.02, Number(recipe.duration) || 0.2)
  const channels = recipe.stereo ? 2 : 1
  const length = Math.max(1, Math.ceil(duration * sampleRate))
  const buffer = context.createBuffer(channels, length, sampleRate)

  for (let channel = 0; channel < channels; channel += 1) {
    const output = buffer.getChannelData(channel)
    const random = mulberry32((seed + channel * 0x9e3779b9) >>> 0)
    const noiseState = {low: 0, brown: 0, previous: 0}
    for (let index = 0; index < length; index += 1) {
      const t = index / sampleRate
      let value = 0
      for (const tone of recipe.tones || []) value += renderTone(tone, t, channel)
      for (const noise of recipe.noise || []) value += renderNoise(noise, t, random, noiseState, channel)
      for (const pulse of recipe.pulses || []) value += renderPulse(pulse, t, random, noiseState, channel)
      if (recipe.hum) value += Math.sin(TAU * recipe.hum * t) * (recipe.humGain || 0.04)
      if (recipe.drive) value = Math.tanh(value * recipe.drive) / Math.tanh(recipe.drive)
      if (recipe.fadeEdges) value *= edgeFade(t, duration, recipe.fadeEdges)
      output[index] = clamp(value * (recipe.gain ?? 1), -1, 1)
    }
  }
  return buffer
}

function renderTone(tone, t, channel) {
  const start = tone.start || 0
  const end = tone.end ?? Number.POSITIVE_INFINITY
  if (t < start || t >= end) return 0
  const local = t - start
  const span = Math.max(0.001, (tone.end ?? (start + 1)) - start)
  const progress = clamp(local / span, 0, 1)
  const startFrequency = tone.freq || 100
  const endFrequency = tone.endFreq ?? startFrequency
  const frequency = startFrequency * Math.pow(Math.max(0.001, endFrequency / startFrequency), progress)
  const phase = TAU * frequency * local + (tone.phase || 0) + channel * (tone.stereoPhase || 0)
  const oscillator = wave(phase, tone.wave || 'sine')
  const envelope = attackDecay(local, tone.attack || 0.001, tone.decay ?? span, tone.sustain ?? 0)
  const tremolo = tone.tremolo ? 1 - (tone.tremoloDepth ?? 0.3) * (0.5 + Math.sin(TAU * tone.tremolo * t) * 0.5) : 1
  const pan = stereoPan(tone.pan || 0, channel)
  return oscillator * envelope * tremolo * pan * (tone.gain ?? 0.25)
}

function renderNoise(noise, t, random, state, channel) {
  const start = noise.start || 0
  const end = noise.end ?? Number.POSITIVE_INFINITY
  if (t < start || t >= end) return 0
  const local = t - start
  const white = random() * 2 - 1
  state.low += (white - state.low) * (noise.smooth ?? 0.08)
  state.brown = clamp((state.brown + white * 0.025) / 1.02, -1, 1)
  let sample = white
  if (noise.color === 'low') sample = state.low * 3
  else if (noise.color === 'brown') sample = state.brown * 2.4
  else if (noise.color === 'high') sample = white - state.previous
  state.previous = white
  const envelope = attackDecay(local, noise.attack || 0.001, noise.decay ?? Math.max(0.02, end - start), noise.sustain ?? 0)
  const flutter = noise.flutter ? 1 - (noise.flutterDepth ?? 0.45) * (0.5 + Math.sin(TAU * noise.flutter * t) * 0.5) : 1
  return sample * envelope * flutter * stereoPan(noise.pan || 0, channel) * (noise.gain ?? 0.2)
}

function renderPulse(pulse, t, random, state, channel) {
  const times = pulse.times || [pulse.time || 0]
  let value = 0
  for (const start of times) {
    if (t < start) continue
    const local = t - start
    const duration = pulse.duration || 0.12
    if (local >= duration) continue
    const frequency = (pulse.freq || 80) + (pulse.endFreq - (pulse.freq || 80) || 0) * local / duration
    const tonal = wave(TAU * frequency * local, pulse.wave || 'sine')
    const white = random() * 2 - 1
    state.low += (white - state.low) * (pulse.smooth ?? 0.12)
    const noise = pulse.color === 'low' ? state.low * 2.5 : pulse.color === 'high' ? white - state.previous : white
    state.previous = white
    const envelope = attackDecay(local, pulse.attack || 0.001, pulse.decay || duration * 0.7, 0)
    const mix = tonal * (1 - (pulse.noiseMix ?? 0.25)) + noise * (pulse.noiseMix ?? 0.25)
    value += mix * envelope * stereoPan(pulse.pan || 0, channel) * (pulse.gain ?? 0.4)
  }
  return value
}

function attackDecay(t, attack, decay, sustain) {
  if (t < 0) return 0
  const rise = attack > 0 ? Math.min(1, t / attack) : 1
  return rise * (sustain + (1 - sustain) * Math.exp(-t / Math.max(0.001, decay)))
}

function wave(phase, shape) {
  const sine = Math.sin(phase)
  if (shape === 'square') return sine >= 0 ? 1 : -1
  if (shape === 'saw') return 2 * ((phase / TAU) - Math.floor(phase / TAU + 0.5))
  if (shape === 'triangle') return 2 * Math.abs(2 * ((phase / TAU) - Math.floor(phase / TAU + 0.5))) - 1
  return sine
}

function stereoPan(pan, channel) {
  if (channel === 0) return Math.sqrt((1 - clamp(pan, -1, 1)) * 0.5)
  return Math.sqrt((1 + clamp(pan, -1, 1)) * 0.5)
}

function edgeFade(t, duration, edge) {
  const amount = Math.max(0.001, Math.min(duration / 2, edge))
  return Math.min(1, t / amount, (duration - t) / amount)
}

function mulberry32(seed) {
  let state = seed || 1
  return () => {
    state |= 0
    state = state + 0x6d2b79f5 | 0
    let value = Math.imul(state ^ state >>> 15, 1 | state)
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}
