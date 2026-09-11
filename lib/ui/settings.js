export const SETTINGS_KEY = 'terminator.settings.v1'
export const DEFAULT_SETTINGS = Object.freeze({sensitivity: 1, fov: 72, master: 80, music: 65, effects: 85, quality: 'high'})
export function loadSettings() {
  try { return normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) }
  catch { return {...DEFAULT_SETTINGS} }
}
export function normalizeSettings(values = {}) {
  const result = {...DEFAULT_SETTINGS}
  for (const [key, min, max] of [['sensitivity', .25, 3], ['fov', 60, 110], ['master', 0, 100], ['music', 0, 100], ['effects', 0, 100]]) {
    if (Number.isFinite(Number(values[key]))) result[key] = Math.max(min, Math.min(max, Number(values[key])))
  }
  if (['low', 'medium', 'high'].includes(values.quality)) result.quality = values.quality
  return result
}
export function saveSettings(values) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(values))); return true }
  catch { return false }
}
