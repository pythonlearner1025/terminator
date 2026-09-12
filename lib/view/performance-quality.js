export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low', renderScale: .65, shadowMapSize: 512, gbufferScale: .25,
    ssaoScale: .25, ssaoSamples: 4, bloomScale: .3, particleDensity: .35,
    lodDistance: 9, animationLodDistance: 12, animationHz: 15, farAnimationHz: 15,
  }),
  medium: Object.freeze({
    id: 'medium', renderScale: .85, shadowMapSize: 1024, gbufferScale: .375,
    ssaoScale: .375, ssaoSamples: 6, bloomScale: .4, particleDensity: .65,
    lodDistance: 18, animationLodDistance: 22, animationHz: 24, farAnimationHz: 20,
  }),
  high: Object.freeze({
    id: 'high', renderScale: 1, shadowMapSize: 2048, gbufferScale: .5,
    ssaoScale: .5, ssaoSamples: 8, bloomScale: .5, particleDensity: 1,
    lodDistance: 30, animationLodDistance: 32, animationHz: 30, farAnimationHz: 30,
  }),
})

export function getQualityPreset(id) {
  return QUALITY_PRESETS[id] || QUALITY_PRESETS.high
}

export function applyPerformanceQuality(manager, id) {
  const preset = getQualityPreset(id)
  const renderManager = manager.ctx.viewer.renderManager
  manager.mapView?.setQuality(preset)
  manager.unitView?.setQuality(preset)
  renderManager.renderScale = preset.renderScale
  renderManager.setSize(undefined, undefined, true)
  manager.performanceQuality = preset
  manager.ctx.viewer.setDirty(manager)
  return preset
}
