import {EntityComponentPlugin} from 'threepipe'

export async function main({viewer}) {
  window.viewer = viewer
  const components = viewer.getPlugin(EntityComponentPlugin)
  window.terminator = {
    get manager() { return components?.getComponentOfType('WeaponsLab') || components?.getComponentOfType('GameManager') || null },
    get world() { return this.manager?.world || null },
    get phase() { return this.world?.phase || 'stopped' },
  }
}

export async function onError(error) {
  console.error('[Terminator] Project failed to start', error)
}
