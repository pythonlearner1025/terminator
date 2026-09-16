import test from 'node:test'
import assert from 'node:assert/strict'
import {QUALITY_PRESETS, QUALITY_IDS, getQualityPreset} from '../../lib/view/performance-quality.js'
import {normalizeSettings} from '../../lib/ui/settings.js'

globalThis.ImageData ??= class {}
globalThis.window ??= {addEventListener(){}, removeEventListener(){}, matchMedia: () => ({matches: false})}
globalThis.document ??= {createElement: () => ({style: {setProperty(){}}, dataset: {}, classList: {add(){}},
  append(){}, addEventListener(){}, setAttribute(){}, querySelector: () => null}), head: {appendChild(){}, append(){}}}
const {Screens} = await import('../../lib/ui/screens.js')

test('the performance preset keeps the sharp image and pays for it elsewhere', () => {
  const preset = getQualityPreset('performance')
  const high = QUALITY_PRESETS.high
  assert.equal(preset, QUALITY_PRESETS.performance, 'performance is a real preset, not a fall back to high')
  assert.equal(preset.id, 'performance')
  assert.equal(preset.renderScale, 1, 'renders at full resolution')
  assert.equal(preset.ssaoEnabled, false, 'no SSAO gbuffer pass')
  assert.equal(preset.shadowMapSize, 1024, 'same shadow map size as high')
  assert.equal(preset.shadowInterval, 2, 'shadow maps redraw every other frame')
  assert.equal(preset.bloomScale, high.bloomScale, 'bloom as high')
  assert.equal(preset.particleDensity, high.particleDensity, 'particle density as high')
  assert.equal(preset.ragdollActiveBudget, 4, 'four live ragdolls')
  assert.equal(preset.ragdollStepHz, 30, 'ragdoll physics at 30 Hz')
})

test('high is untouched by the new preset', () => {
  assert.deepEqual(QUALITY_PRESETS.high, {
    id: 'high', renderScale: 1, shadowMapSize: 1024, gbufferScale: .2,
    ssaoScale: .2, ssaoSamples: 2, ssaoEnabled: true, bloomScale: .2, particleDensity: .65,
    lodDistance: 5, animationLodDistance: 7, animationHz: 30, farAnimationHz: 24,
    instancedLodDistance: 12,
  })
})

// `performance` renders at full scale, so the crowd it draws is the crowd
// `high` draws. Only the three levers above separate them.
test('performance keeps the high LOD distances, near rig and instanced alike', () => {
  const preset = QUALITY_PRESETS.performance, high = QUALITY_PRESETS.high
  assert.equal(preset.lodDistance, high.lodDistance)
  assert.equal(preset.animationLodDistance, high.animationLodDistance)
  assert.equal(preset.instancedLodDistance, high.instancedLodDistance)
})

test('performance is selectable in settings and listed in the quality menu', () => {
  assert.equal(QUALITY_IDS.includes('performance'), true)
  assert.equal(normalizeSettings({quality: 'performance'}).quality, 'performance')
  assert.equal(normalizeSettings({quality: 'ultra'}).quality, 'high', 'an unknown id still falls back')
  const screen = {root: {innerHTML: ''}, settings: {...normalizeSettings({quality: 'performance'}), hud: 72},
    formatSetting: Screens.prototype.formatSetting}
  Screens.prototype.settingsScreen.call(screen)
  for (const id of QUALITY_IDS) {
    assert.match(screen.root.innerHTML, new RegExp(`<option value="${id}"`), `${id} is an option`)
  }
  assert.match(screen.root.innerHTML, /<option value="performance" selected>PERFORMANCE<\/option>/)
})
