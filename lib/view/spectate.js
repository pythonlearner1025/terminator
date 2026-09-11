// Camera presentation only. Called after PlayerView.sync; never changes player state.
export class SpectateView {
  constructor(viewer) {
    this.viewer = viewer
    this.targetId = null
    this.active = false
    this.onMouse = event => {
      if (!this.active || !this.enabled || ![0, 2].includes(event.button)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.cycle(event.button === 0 ? 1 : -1)
    }
    this.onContext = event => { if (this.active && this.enabled) event.preventDefault() }
    this.beforeRender = () => {
      if (!this.active) return
      const object = this.playersView?.visuals?.get(this.targetId)?.object
      if (object) { this.hiddenBody = {object, visible: object.visible}; object.visible = false }
      if (this.hiddenGun) this.hiddenGun.gun.visible = false
    }
    this.afterRender = () => { if (this.hiddenBody) { this.hiddenBody.object.visible = this.hiddenBody.visible; this.hiddenBody = null } }
    viewer.canvas.addEventListener('mousedown', this.onMouse, true)
    viewer.canvas.addEventListener('contextmenu', this.onContext)
    viewer.addEventListener('preRender', this.beforeRender)
    viewer.addEventListener('postRender', this.afterRender)
  }
  cycle(direction) {
    if (!this.candidates?.length) return
    const index = this.candidates.findIndex(player => player.id === this.targetId)
    this.targetId = this.candidates[(index + direction + this.candidates.length) % this.candidates.length].id
    this.follow()
  }
  sync(world, localPlayerId, playerView, enabled = true, playersView = null) {
    this.enabled = enabled
    this.playerView = playerView
    this.playersView = playersView
    const local = world.getPlayer(localPlayerId)
    this.candidates = [...world.players.values()].filter(player => player.id !== localPlayerId && player.alive && player.connected !== false)
    this.active = Boolean(local && !local.alive && world.phase !== 'ended' && this.candidates.length)
    if (!this.active) { this.reset(); return null }
    if (!this.candidates.some(player => player.id === this.targetId)) this.targetId = this.candidates[0].id
    const gun = playerView?.gun
    if (gun) {
      if (!this.hiddenGun) this.hiddenGun = {gun, visible: gun.visible}
      gun.visible = false
    }
    this.follow()
    const target = this.candidates.find(player => player.id === this.targetId)
    return {id: target.id, name: target.name, index: this.candidates.indexOf(target) + 1, count: this.candidates.length}
  }
  follow() {
    const target = this.candidates?.find(player => player.id === this.targetId)
    const camera = this.playerView?.camera
    if (!this.active || !target || !camera) return
    // Eye camera avoids chase-camera wall clipping in the compound's narrow passages.
    camera.position.set(target.pos.x, target.pos.y + (target.crouch ? 1.12 : 1.65), target.pos.z)
    camera.rotation.set(target.pitch || 0, target.yaw + Math.PI, 0, 'YXZ')
    camera.updateMatrixWorld()
    camera.setDirty?.({source: 'Terminator SpectateView'})
  }
  reset() {
    this.afterRender()
    if (this.hiddenGun) { this.hiddenGun.gun.visible = this.hiddenGun.visible; this.hiddenGun = null }
    this.active = false
    this.targetId = null
  }
  dispose() {
    this.reset()
    this.viewer.canvas.removeEventListener('mousedown', this.onMouse, true)
    this.viewer.canvas.removeEventListener('contextmenu', this.onContext)
    this.viewer.removeEventListener('preRender', this.beforeRender)
    this.viewer.removeEventListener('postRender', this.afterRender)
    this.candidates = []
    this.playerView = null
    this.playersView = null
  }
}
