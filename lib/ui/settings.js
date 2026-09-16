import {DEFAULT_BINDINGS, normalizeBindings} from './bindings.js'
import {getDifficulty} from '../core/data/difficulty.js'
import {QUALITY_IDS} from '../view/performance-quality.js'
export {QUALITY_IDS}
export const SETTINGS_KEY = 'terminator.settings.v1'
export const DEFAULT_SETTINGS = Object.freeze({sensitivity: 1, fov: 72, hud: 72, master: 80, music: 65, effects: 85, quality: 'high', difficulty:'normal', crosshair:false, hitStop:false, bindings:DEFAULT_BINDINGS, controlsSeen:false})
export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }
  catch { return normalizeSettings() }
}
export function normalizeSettings(values = {}) {
  if (!values || typeof values !== 'object') values = {}
  const result = {...DEFAULT_SETTINGS}
  for (const [key, min, max] of [['sensitivity', .25, 3], ['fov', 60, 110], ['master', 0, 100], ['music', 0, 100], ['effects', 0, 100]]) {
    if (Number.isFinite(Number(values[key]))) result[key] = Math.max(min, Math.min(max, Number(values[key])))
  }
  if (QUALITY_IDS.includes(values.quality)) result.quality = values.quality
  result.difficulty = getDifficulty(values.difficulty).id
  result.bindings = normalizeBindings(values.bindings)
  result.crosshair = values.crosshair === true
  result.hitStop = values.hitStop === true
  result.controlsSeen = values.controlsSeen === true
  return result
}
export function saveSettings(values) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(values))); return true }
  catch { return false }
}
