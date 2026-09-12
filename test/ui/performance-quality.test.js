import test from 'node:test'
import assert from 'node:assert/strict'
import {getQualityPreset, QUALITY_PRESETS} from '../../lib/view/performance-quality.js'

test('quality presets map every performance knob to ordered concrete values', () => {
  const low = QUALITY_PRESETS.low
  const medium = QUALITY_PRESETS.medium
  const high = QUALITY_PRESETS.high
  for (const key of ['renderScale', 'shadowMapSize', 'gbufferScale', 'ssaoScale', 'ssaoSamples', 'bloomScale', 'particleDensity', 'lodDistance', 'animationLodDistance', 'animationHz']) {
    assert.equal(Number.isFinite(low[key]), true, `${key} is numeric`)
    assert.equal(low[key] <= medium[key], true, `${key} low <= medium`)
    assert.equal(medium[key] <= high[key], true, `${key} medium <= high`)
  }
  assert.equal(high.renderScale, 1)
  assert.equal(high.gbufferScale, .2)
  assert.equal(high.lodDistance, 5)
  assert.equal(high.animationHz, 30)
  assert.equal(high.ssaoEnabled, true)
  assert.equal(low.farAnimationHz <= medium.farAnimationHz, true)
  assert.equal(medium.farAnimationHz <= high.farAnimationHz, true)
})

test('unknown quality values fail safe to high', () => {
  assert.equal(getQualityPreset('cinematic'), QUALITY_PRESETS.high)
})
