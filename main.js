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
  registerGameValidation(() => {
    const manager = game.manager
    const requiredNodes = ['Game Manager', 'Map', 'Unit T-600 Scout', 'Unit T-800 Endo', 'Unit T-800 Heavy', 'Player Start']
    const nodesPresent = requiredNodes.every((name) => viewer.scene.modelRoot.getObjectByName(name)
      || viewer.scene.modelRoot.getObjectByName(name.replaceAll(' ', '_')))
    const authoredPieces = manager?.mapView?.batching?.placements?.length || 0
    const runtimeBatches = manager?.mapView?.batching?.batches?.length || 0
    const systemsReady = Boolean(manager?.world && manager?.hud && manager?.mapView && manager?.unitView && manager?.playerView)
      && authoredPieces > 0 && runtimeBatches > 0
    return {
      status: nodesPresent && systemsReady ? 'pass' : 'fail',
      summary: nodesPresent && systemsReady ? 'Headless world and view adapters are running.' : 'Required authored nodes or runtime systems are missing.',
      checks: {nodesPresent, systemsReady, authoredPieces, runtimeBatches, tickRate: 60},
    }
  })
}

export async function onError(error) {
  console.error('[Terminator] Project failed to start', error)
}
