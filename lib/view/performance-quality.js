import {installShadowCadence} from './shadow-cadence.js'

// `low`, `medium` and `high` trade image size for speed: they shrink the render
// scale, the shadow map and the effect buffers. `performance` does not. It
// keeps the sharp full-scale image, the `high` bloom and the `high` particle
// density, and buys frames back from work the player does not look at: the
// SSAO gbuffer pass, half-rate shadow updates, and a smaller, cheaper crowd of
// live ragdolls.
//
// `shadowInterval` is the number of frames between shadow map redraws.
// `ragdollActiveBudget` is how many wrecks stay in the physics solver.
// `ragdollStepHz` is the fixed rate of that solver.
// A preset that omits the three keeps today's behaviour: every frame, eight
// wrecks, 60 Hz.
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low', renderScale: .65, shadowMapSize: 512, gbufferScale: .125,
    ssaoScale: .125, ssaoSamples: 2, ssaoEnabled: false, bloomScale: .18, particleDensity: .35,
    lodDistance: 4, animationLodDistance: 4, animationHz: 15, farAnimationHz: 15,
  }),
  medium: Object.freeze({
    id: 'medium', renderScale: .85, shadowMapSize: 768, gbufferScale: .2,
    ssaoScale: .2, ssaoSamples: 2, ssaoEnabled: false, bloomScale: .2, particleDensity: .6,
    lodDistance: 5, animationLodDistance: 6, animationHz: 24, farAnimationHz: 20,
  }),
  performance: Object.freeze({
    id: 'performance', renderScale: 1, shadowMapSize: 1024, gbufferScale: .2,
    ssaoScale: .2, ssaoSamples: 2, ssaoEnabled: false, bloomScale: .2, particleDensity: .65,
    lodDistance: 5, animationLodDistance: 7, animationHz: 30, farAnimationHz: 24,
    shadowInterval: 2, ragdollActiveBudget: 4, ragdollStepHz: 30,
  }),
  high: Object.freeze({
    id: 'high', renderScale: 1, shadowMapSize: 1024, gbufferScale: .2,
    ssaoScale: .2, ssaoSamples: 2, ssaoEnabled: true, bloomScale: .2, particleDensity: .65,
    lodDistance: 5, animationLodDistance: 7, animationHz: 30, farAnimationHz: 24,
  }),
})

export const QUALITY_IDS = Object.freeze(Object.keys(QUALITY_PRESETS))

export function getQualityPreset(id) {
  return QUALITY_PRESETS[id] || QUALITY_PRESETS.high
}

export function applyPerformanceQuality(manager, id) {
  const preset = getQualityPreset(id)
  const renderManager = manager.ctx.viewer.renderManager
  manager.mapView?.setQuality(preset)
  manager.unitView?.setQuality(preset)
  // The other half of the preset lives on the ragdoll pool. Optional call: a
  // pool without the options keeps its own defaults.
  manager.unitView?.ragdolls?.setOptions?.({activeBudget: preset.ragdollActiveBudget, stepHz: preset.ragdollStepHz})
  renderManager.renderScale = preset.renderScale
  renderManager.setSize(undefined, undefined, true)
  manager.shadowCadence = installShadowCadence(manager.ctx.viewer)
  manager.shadowCadence?.setInterval(preset.shadowInterval ?? 1)
  manager.performanceQuality = preset
  manager.ctx.viewer.setDirty(manager)
  return preset
}
