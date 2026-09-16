// `lodDistance` swaps geometry on a per-unit rig. `instancedLodDistance` is the
// same choice for instanced commons, where the swap costs nothing per unit: the
// instance only moves between two draws, so the near figure can reach further.
export const QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({
    id: 'low', renderScale: .65, shadowMapSize: 512, gbufferScale: .125,
    ssaoScale: .125, ssaoSamples: 2, ssaoEnabled: false, bloomScale: .18, particleDensity: .35,
    lodDistance: 4, animationLodDistance: 4, animationHz: 15, farAnimationHz: 15,
    instancedLodDistance: 6,
  }),
  medium: Object.freeze({
    id: 'medium', renderScale: .85, shadowMapSize: 768, gbufferScale: .2,
    ssaoScale: .2, ssaoSamples: 2, ssaoEnabled: false, bloomScale: .2, particleDensity: .6,
    lodDistance: 5, animationLodDistance: 6, animationHz: 24, farAnimationHz: 20,
    instancedLodDistance: 9,
  }),
  high: Object.freeze({
    id: 'high', renderScale: 1, shadowMapSize: 1024, gbufferScale: .2,
    ssaoScale: .2, ssaoSamples: 2, ssaoEnabled: true, bloomScale: .2, particleDensity: .65,
    lodDistance: 5, animationLodDistance: 7, animationHz: 30, farAnimationHz: 24,
    instancedLodDistance: 12,
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
