import {SAMPLE_BANK} from './sample-bank.js'

const repeat = (count, spacing, offset = 0) => Array.from({length: count}, (_, index) => offset + index * spacing)
const pair = (first, second) => [first, second]

const gun = (freq, duration, crack, body) => ({
  duration,
  drive: 2.6,
  noise: [
    {color: 'high', gain: crack, decay: duration * 0.07},
    {color: 'low', gain: body, decay: duration * 0.34},
  ],
  tones: [
    {freq, endFreq: freq * 0.36, gain: body * 0.75, decay: duration * 0.22, end: duration},
    {freq: freq * 2.1, endFreq: freq * 0.8, gain: crack * 0.18, decay: duration * 0.08, end: duration * 0.35},
  ],
})

const mechanism = (freq, duration, times = [0]) => ({
  duration,
  drive: 1.7,
  pulses: [
    {times, freq, endFreq: freq * 0.55, gain: 0.55, duration: Math.min(0.09, duration / 2), decay: 0.025, noiseMix: 0.42, color: 'high'},
    {times: times.map((time) => time + 0.035), freq: freq * 0.55, gain: 0.27, duration: 0.07, decay: 0.02, noiseMix: 0.25},
  ],
})

const step = (freq, weight, metal = false) => ({
  duration: 0.24,
  drive: 1.5,
  noise: [{color: metal ? 'high' : 'low', gain: weight * 0.55, decay: 0.045}],
  tones: [
    {freq, endFreq: freq * 0.55, gain: weight, decay: 0.055, end: 0.2},
    ...(metal ? [{freq: freq * 5.2, endFreq: freq * 3.7, gain: weight * 0.22, decay: 0.09, end: 0.2}] : []),
  ],
})

const impact = (freq, metal = false) => ({
  duration: metal ? 0.38 : 0.24,
  drive: 2,
  noise: [{color: metal ? 'high' : 'low', gain: 0.7, decay: metal ? 0.12 : 0.055}],
  tones: metal
    ? [{freq, gain: 0.42, decay: 0.16, end: 0.38}, {freq: freq * 1.61, gain: 0.2, decay: 0.22, end: 0.38}]
    : [{freq, endFreq: freq * 0.5, gain: 0.36, decay: 0.06, end: 0.2}],
})

const sound = (bus, gain, voices, variants, extra = {}) => Object.freeze({bus, gain, voices, variants: Object.freeze(variants), ...extra})

const SYNTH_CATALOG = Object.freeze({
  pistol_9mm: sound('effects', 0.72, 6, pair(gun(155, 0.24, 0.92, 0.65), gun(172, 0.22, 0.86, 0.61))),
  m4_rifle: sound('effects', 0.56, 10, pair(gun(112, 0.19, 0.78, 0.72), gun(124, 0.17, 0.74, 0.68))),
  shotgun_fire: sound('effects', 0.92, 4, pair(gun(72, 0.58, 1.08, 1.15), gun(64, 0.64, 1.02, 1.22))),
  shotgun_pump: sound('effects', 0.48, 3, pair(mechanism(340, 0.42, [0, 0.2]), mechanism(305, 0.45, [0, 0.23]))),
  plasma_bolt: sound('effects', 0.56, 10, pair(
    {duration: 0.34, drive: 1.8, tones: [{freq: 1450, endFreq: 210, gain: 0.64, decay: 0.18, end: 0.34, wave: 'saw'}, {freq: 92, endFreq: 58, gain: 0.32, decay: 0.3, end: 0.34}], noise: [{color: 'high', gain: 0.2, decay: 0.1}]},
    {duration: 0.3, drive: 1.8, tones: [{freq: 1680, endFreq: 250, gain: 0.58, decay: 0.16, end: 0.3, wave: 'triangle'}, {freq: 108, endFreq: 62, gain: 0.3, decay: 0.27, end: 0.3}], noise: [{color: 'high', gain: 0.23, decay: 0.085}]},
  )),
  minigun_spinup: sound('effects', 0.42, 3, pair(
    {duration: 1.05, drive: 1.4, tones: [{freq: 24, endFreq: 92, gain: 0.52, decay: 2, sustain: 0.85, end: 1.05, wave: 'saw', tremolo: 11, tremoloDepth: 0.52}], noise: [{color: 'low', gain: 0.28, decay: 1.5, sustain: 0.8}]},
    {duration: 1.0, drive: 1.4, tones: [{freq: 28, endFreq: 104, gain: 0.48, decay: 2, sustain: 0.85, end: 1, wave: 'triangle', tremolo: 12, tremoloDepth: 0.5}], noise: [{color: 'low', gain: 0.3, decay: 1.5, sustain: 0.8}]},
  )),
  minigun_loop: sound('effects', 0.48, 4, pair(
    {duration: 1.2, fadeEdges: 0.025, drive: 2.1, hum: 54, humGain: 0.18, pulses: [{times: repeat(15, 0.08), freq: 82, endFreq: 44, gain: 0.44, duration: 0.065, decay: 0.022, noiseMix: 0.5}]},
    {duration: 1.2, fadeEdges: 0.025, drive: 2.1, hum: 59, humGain: 0.17, pulses: [{times: repeat(16, 0.075), freq: 88, endFreq: 48, gain: 0.42, duration: 0.06, decay: 0.02, noiseMix: 0.52}]},
  ), {loop: true}),
  minigun_spindown: sound('effects', 0.4, 3, pair(
    {duration: 0.86, tones: [{freq: 98, endFreq: 22, gain: 0.5, decay: 0.9, sustain: 0.25, end: 0.86, wave: 'saw', tremolo: 9, tremoloDepth: 0.46}], noise: [{color: 'low', gain: 0.2, decay: 0.7}]},
    {duration: 0.92, tones: [{freq: 108, endFreq: 25, gain: 0.46, decay: 0.9, sustain: 0.22, end: 0.92, wave: 'triangle', tremolo: 10, tremoloDepth: 0.48}], noise: [{color: 'low', gain: 0.22, decay: 0.72}]},
  )),
  reload_pistol: sound('effects', 0.38, 3, pair(mechanism(520, 0.72, [0, 0.26, 0.53]), mechanism(470, 0.76, [0, 0.29, 0.56]))),
  reload_m4: sound('effects', 0.42, 3, pair(mechanism(390, 0.95, [0, 0.34, 0.7]), mechanism(420, 0.9, [0, 0.31, 0.65]))),
  reload_shotgun: sound('effects', 0.44, 5, pair(mechanism(310, 0.48, [0, 0.23]), mechanism(285, 0.51, [0, 0.25]))),
  reload_plasma: sound('effects', 0.4, 3, pair(
    {duration: 0.88, tones: [{freq: 260, endFreq: 920, gain: 0.34, decay: 0.8, sustain: 0.4, end: 0.72, wave: 'triangle'}], pulses: [{times: [0, 0.62], freq: 780, gain: 0.4, duration: 0.08, decay: 0.02, noiseMix: 0.15}]},
    {duration: 0.94, tones: [{freq: 230, endFreq: 840, gain: 0.36, decay: 0.86, sustain: 0.4, end: 0.76, wave: 'saw'}], pulses: [{times: [0, 0.67], freq: 720, gain: 0.42, duration: 0.08, decay: 0.02, noiseMix: 0.15}]},
  )),
  dry_fire: sound('effects', 0.34, 3, pair(mechanism(650, 0.1), mechanism(580, 0.11))),
  knife_swing: sound('effects', 0.38, 4, pair(
    {duration: 0.24, noise: [{color: 'high', gain: 0.62, attack: 0.025, decay: 0.065, start: 0.025, end: 0.24}], tones: [{freq: 260, endFreq: 120, gain: 0.15, attack: 0.02, decay: 0.08, end: 0.22}]},
    {duration: 0.27, noise: [{color: 'high', gain: 0.58, attack: 0.03, decay: 0.075, start: 0.035, end: 0.27}], tones: [{freq: 310, endFreq: 135, gain: 0.13, attack: 0.02, decay: 0.09, end: 0.24}]},
  )),
  knife_hit: sound('effects', 0.56, 4, pair(impact(780, true), impact(690, true))),
  grenade_throw: sound('effects', 0.32, 3, pair(mechanism(260, 0.31, [0, 0.13]), mechanism(295, 0.32, [0, 0.15]))),
  grenade_explosion: sound('effects', 0.95, 5, pair(gun(43, 1.45, 1.1, 1.4), gun(38, 1.62, 1.04, 1.5))),
  footstep_concrete: sound('effects', 0.3, 8, pair(step(88, 0.7, false), step(78, 0.73, false))),
  footstep_metal: sound('effects', 0.3, 8, pair(step(115, 0.62, true), step(128, 0.58, true))),
  servo_scout: sound('effects', 0.32, 10, pair(step(150, 0.45, true), step(172, 0.42, true))),
  servo_endo: sound('effects', 0.42, 10, pair(step(92, 0.72, true), step(104, 0.68, true))),
  servo_heavy: sound('effects', 0.58, 8, pair(step(56, 1, true), step(63, 0.95, true))),
  plasma_impact_concrete: sound('effects', 0.5, 8, pair(impact(120, false), impact(138, false))),
  plasma_impact_player: sound('effects', 0.58, 8, pair(
    {duration: 0.3, drive: 2, noise: [{color: 'high', gain: 0.68, decay: 0.08}], tones: [{freq: 220, endFreq: 72, gain: 0.58, decay: 0.14, end: 0.3}]},
    {duration: 0.34, drive: 2, noise: [{color: 'high', gain: 0.62, decay: 0.1}], tones: [{freq: 250, endFreq: 80, gain: 0.54, decay: 0.16, end: 0.34}]},
  )),
  sparks_metal: sound('effects', 0.34, 12, pair(impact(1320, true), impact(1570, true))),
  headshot_clang: sound('effects', 0.62, 6, pair(impact(940, true), impact(1080, true))),
  unit_death: sound('effects', 0.65, 8, pair(
    {duration: 1.1, drive: 1.7, pulses: [{times: [0, 0.18, 0.42, 0.69], freq: 84, endFreq: 42, gain: 0.76, duration: 0.3, decay: 0.09, noiseMix: 0.48, color: 'low'}]},
    {duration: 1.2, drive: 1.7, pulses: [{times: [0, 0.24, 0.51, 0.78], freq: 76, endFreq: 38, gain: 0.8, duration: 0.32, decay: 0.1, noiseMix: 0.5, color: 'low'}]},
  )),
  spawn_gate: sound('effects', 0.62, 6, pair(
    {duration: 1.2, tones: [{freq: 48, endFreq: 96, gain: 0.52, decay: 1.1, sustain: 0.35, end: 0.95, wave: 'saw'}], noise: [{color: 'low', gain: 0.38, decay: 0.8}], pulses: [{times: [0, 0.92], freq: 170, gain: 0.44, duration: 0.18, decay: 0.05, noiseMix: 0.55}]},
    {duration: 1.28, tones: [{freq: 42, endFreq: 88, gain: 0.55, decay: 1.2, sustain: 0.34, end: 1.02, wave: 'triangle'}], noise: [{color: 'low', gain: 0.4, decay: 0.85}], pulses: [{times: [0, 1], freq: 155, gain: 0.46, duration: 0.18, decay: 0.05, noiseMix: 0.55}]},
  )),
  heavy_stomp: sound('effects', 0.7, 6, pair(gun(34, 0.7, 0.35, 1.2), gun(30, 0.78, 0.32, 1.28))),
  scout_screech: sound('effects', 0.58, 4, pair(
    {duration: 0.82, drive: 2, tones: [{freq: 420, endFreq: 1580, gain: 0.58, attack: 0.025, decay: 0.55, end: 0.82, wave: 'saw'}, {freq: 740, endFreq: 330, gain: 0.25, decay: 0.7, end: 0.82}]},
    {duration: 0.76, drive: 2, tones: [{freq: 510, endFreq: 1710, gain: 0.54, attack: 0.02, decay: 0.5, end: 0.76, wave: 'triangle'}, {freq: 810, endFreq: 360, gain: 0.27, decay: 0.64, end: 0.76}]},
  )),
  skynet_static: sound('effects', 0.38, 4, pair(
    {duration: 0.42, drive: 2.4, noise: [{color: 'high', gain: 0.78, decay: 0.16, flutter: 31, flutterDepth: 0.65}], tones: [{freq: 58, gain: 0.18, decay: 0.32, end: 0.42, wave: 'square'}]},
    {duration: 0.48, drive: 2.4, noise: [{color: 'high', gain: 0.72, decay: 0.19, flutter: 27, flutterDepth: 0.62}], tones: [{freq: 64, gain: 0.16, decay: 0.36, end: 0.48, wave: 'square'}]},
  )),
  typewriter_tick: sound('effects', 0.17, 12, pair(mechanism(1080, 0.055), mechanism(890, 0.06))),
  wave_klaxon: sound('effects', 0.58, 3, pair(
    {duration: 1.55, tones: [{freq: 230, gain: 0.44, attack: 0.05, decay: 1.4, sustain: 0.7, end: 0.7, wave: 'square'}, {freq: 196, gain: 0.44, attack: 0.05, decay: 1.4, sustain: 0.7, start: 0.78, end: 1.48, wave: 'square'}]},
    {duration: 1.6, tones: [{freq: 244, gain: 0.42, attack: 0.05, decay: 1.4, sustain: 0.68, end: 0.72, wave: 'square'}, {freq: 204, gain: 0.44, attack: 0.05, decay: 1.4, sustain: 0.68, start: 0.81, end: 1.53, wave: 'square'}]},
  )),
  wave_clear: sound('music', 0.55, 2, pair(
    {duration: 1.7, stereo: true, tones: [{freq: 146.8, gain: 0.26, decay: 1.4, end: 1.7, pan: -0.3}, {freq: 220, gain: 0.25, decay: 1.2, start: 0.22, end: 1.7, pan: 0.3}, {freq: 293.7, gain: 0.23, decay: 1, start: 0.46, end: 1.7}]},
    {duration: 1.8, stereo: true, tones: [{freq: 164.8, gain: 0.25, decay: 1.5, end: 1.8, pan: -0.3}, {freq: 246.9, gain: 0.24, decay: 1.25, start: 0.24, end: 1.8, pan: 0.3}, {freq: 329.6, gain: 0.22, decay: 1.05, start: 0.5, end: 1.8}]},
  )),
  trader_open: sound('effects', 0.42, 3, pair(mechanism(420, 0.7, [0, 0.2, 0.48]), mechanism(380, 0.74, [0, 0.23, 0.51]))),
  cash_register: sound('effects', 0.48, 4, pair(
    {duration: 0.72, pulses: [{times: [0, 0.09, 0.18], freq: 880, gain: 0.42, duration: 0.08, decay: 0.025, noiseMix: 0.12}, {time: 0.36, freq: 1320, gain: 0.5, duration: 0.3, decay: 0.16, noiseMix: 0.04}]},
    {duration: 0.76, pulses: [{times: [0, 0.1, 0.21], freq: 820, gain: 0.44, duration: 0.08, decay: 0.025, noiseMix: 0.12}, {time: 0.39, freq: 1470, gain: 0.48, duration: 0.3, decay: 0.17, noiseMix: 0.04}]},
  )),
  ui_hover: sound('effects', 0.14, 5, pair(
    {duration: 0.07, tones: [{freq: 720, endFreq: 910, gain: 0.35, decay: 0.035, end: 0.07}]},
    {duration: 0.075, tones: [{freq: 660, endFreq: 850, gain: 0.34, decay: 0.038, end: 0.075}]},
  )),
  ui_click: sound('effects', 0.24, 5, pair(mechanism(760, 0.1), mechanism(690, 0.11))),
  low_health_heartbeat: sound('effects', 0.48, 2, pair(
    {duration: 1.05, fadeEdges: 0.012, tones: [{freq: 48, endFreq: 39, gain: 0.72, decay: 0.09, end: 0.3}, {freq: 52, endFreq: 42, gain: 0.58, decay: 0.08, start: 0.24, end: 0.53}]},
    {duration: 0.94, fadeEdges: 0.012, tones: [{freq: 52, endFreq: 41, gain: 0.7, decay: 0.085, end: 0.28}, {freq: 56, endFreq: 44, gain: 0.56, decay: 0.075, start: 0.22, end: 0.49}]},
  ), {loop: true}),
  ambient_bed: sound('music', 0.52, 2, pair(
    {duration: 8, stereo: true, fadeEdges: 0.16, hum: 31, humGain: 0.055, noise: [{color: 'brown', gain: 0.11, decay: 9, sustain: 0.92, flutter: 0.12, flutterDepth: 0.5, pan: -0.3}, {color: 'high', gain: 0.026, decay: 9, sustain: 0.9, flutter: 0.27, flutterDepth: 0.7, pan: 0.45}], pulses: [{times: [1.1, 2.8, 5.2, 6.6], freq: 64, gain: 0.11, duration: 0.34, decay: 0.08, noiseMix: 0.8, color: 'low', pan: -0.55}]},
    {duration: 8, stereo: true, fadeEdges: 0.16, hum: 28, humGain: 0.06, noise: [{color: 'brown', gain: 0.105, decay: 9, sustain: 0.92, flutter: 0.1, flutterDepth: 0.52, pan: 0.32}, {color: 'high', gain: 0.024, decay: 9, sustain: 0.9, flutter: 0.31, flutterDepth: 0.68, pan: -0.48}], pulses: [{times: [0.7, 3.4, 4.7, 7.1], freq: 59, gain: 0.12, duration: 0.36, decay: 0.09, noiseMix: 0.78, color: 'low', pan: 0.58}]},
  ), {loop: true, channel: 'ambient'}),
  combat_music: sound('music', 0.62, 2, pair(
    {duration: 4, stereo: true, fadeEdges: 0.04, drive: 1.35, hum: 46, humGain: 0.09, pulses: [{times: repeat(8, 0.5), freq: 62, endFreq: 41, gain: 0.42, duration: 0.2, decay: 0.07, noiseMix: 0.25}, {times: repeat(16, 0.25, 0.125), freq: 180, gain: 0.16, duration: 0.055, decay: 0.018, noiseMix: 0.55, color: 'high', pan: 0.45}], tones: [{freq: 92, gain: 0.12, decay: 5, sustain: 0.85, end: 4, wave: 'saw', tremolo: 2, tremoloDepth: 0.45, pan: -0.35}]},
    {duration: 4, stereo: true, fadeEdges: 0.04, drive: 1.35, hum: 43, humGain: 0.1, pulses: [{times: repeat(8, 0.5, 0.25), freq: 58, endFreq: 38, gain: 0.44, duration: 0.21, decay: 0.075, noiseMix: 0.25}, {times: repeat(16, 0.25), freq: 165, gain: 0.17, duration: 0.055, decay: 0.018, noiseMix: 0.56, color: 'high', pan: -0.45}], tones: [{freq: 86, gain: 0.13, decay: 5, sustain: 0.84, end: 4, wave: 'saw', tremolo: 2, tremoloDepth: 0.44, pan: 0.35}]},
  ), {loop: true, channel: 'combat'}),
})

// Keep legacy IDs and emergency recipes; the encoded sample bank is the normal path.
const catalog = {...SYNTH_CATALOG}
for (const [name, bank] of Object.entries(SAMPLE_BANK)) {
  const original = SYNTH_CATALOG[name]
  const {files, ...settings} = bank
  catalog[name] = Object.freeze({
    bus: 'effects', gain: 0.45, voices: 8, ...original, ...settings,
    variants: Object.freeze(files.map((file, i) => ({file, fallback: original?.variants[i % original.variants.length]}))),
  })
}
catalog.minigun_loop = Object.freeze({...catalog.minigun_loop, voices: 12})
for (const name of ['ui_hover', 'ui_click', 'typewriter_tick', 'cash_register', 'trader_open', 'skynet_static']) {
  catalog[name] = Object.freeze({...catalog[name], bus: 'ui'})
}
export const SOUND_CATALOG = Object.freeze(catalog)
export const SOUND_NAMES = Object.freeze(Object.keys(SOUND_CATALOG))

for (const [name, definition] of Object.entries(SOUND_CATALOG)) {
  if (definition.variants.length < 2) throw new Error(`Sound ${name} needs at least two variations`)
}
