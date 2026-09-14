import {publishGameTelemetry, registerGameValidation} from '@kite3d/engine'
import {EntityComponentPlugin} from 'threepipe'

export async function main({viewer}) {
  window.viewer = viewer
  const components = viewer.getPlugin(EntityComponentPlugin)
  const game = {
    get manager() { return components?.getComponentOfType('GameManager') || null },
    get world() { return this.manager?.world || null },
    get phase() { return this.world?.phase || 'stopped' },
  }
  window.terminator = game
  publishGameTelemetry({state: 'ready', game: 'Terminator: human vs Skynet', coreTickRate: 60})
  registerGameValidation(async () => {
    const manager = game.manager
    // Validation must exercise the match adapters and their assets, rather
    // than accepting a main-menu boot with no V2 content mounted.
    if (manager?.world && !manager.viewsStarted) manager.startViews()
    await manager?.mapView?.ready
    await manager?.visualWarmup
    const requiredNodes = ['Game Manager', 'Map', 'Unit T-600 Scout', 'Unit T-800 Endo', 'Unit T-800 Heavy', 'Player Start']
    const nodesPresent = requiredNodes.every((name) => viewer.scene.modelRoot.getObjectByName(name)
      || viewer.scene.modelRoot.getObjectByName(name.replaceAll(' ', '_')))
    const authoredPieces = manager?.mapView?.batching?.placements?.length || 0
    const runtimeBatches = manager?.mapView?.batching?.batches?.length || 0
    const systemsReady = Boolean(manager?.world && manager?.hud && manager?.mapView && manager?.unitView && manager?.playerView)
      && authoredPieces > 0 && runtimeBatches > 0
    const v2Modules = manager?.mapView?.v2Handles?.length || 0
    const v2Error = manager?.mapView?.v2Error?.message || null
    const v2TransparencyReady = !viewer.renderManager?.rgbm || manager?.mapView?.v2Transparency?.attached === true
    const v2Ready = !v2Error && v2Modules === 5 && v2TransparencyReady
    return {
      status: nodesPresent && systemsReady && v2Ready ? 'pass' : 'fail',
      summary: nodesPresent && systemsReady && v2Ready ? 'Headless world and view adapters are running.' : 'Required authored nodes or runtime systems are missing.',
      checks: {nodesPresent, systemsReady, authoredPieces, runtimeBatches, v2Modules, v2Error, v2TransparencyReady, tickRate: 60},
    }
  })
}

export async function onError(error) {
  console.error('[Terminator] Project failed to start', error)
}
