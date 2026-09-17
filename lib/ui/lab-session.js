import {BindingInput} from './bindings.js'
import {RangePanel} from './range.js'
import {loadSettings} from './settings.js'

// Dedicated Play session for the weapons lab. Input, HUD and the range commands only.
// The lab is a weapons range, so it carries the range panel without the `range=1`
// flag the main scene needs. F1 hides it, and the panel lists the authored clips
// of the held rig, because reviewing those clips is what the lab is for.
export class WeaponsLabSession {
  constructor(manager) {
    this.manager = manager; this.range = manager.range; this.rangeEnabled = true; this.sandboxEnabled = true
    this.screens = {route: null, settings: loadSettings()}
    this.rangePanel = new RangePanel(manager, {clips: true})
    this.bindings = new BindingInput(manager.input, this.screens.settings.bindings)
    this.setInput(true)
    manager.input.mouseSensitivity = .0022 * this.screens.settings.sensitivity
    manager.input.fov = this.screens.settings.fov
  }
  setInput(active) {
    const m = this.manager
    this.bindings?.setActive(active && !m.rangeView.inspecting)
    if (active && !m.rangeView.inspecting) m.input.start({yaw: m.world.player.yaw, pitch: m.world.player.pitch})
    else m.input.stop()
  }
  sample() {
    const m = this.manager, p = m.world.player
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)
    const input = typing || m.rangeView.inspecting ? {yaw: p.yaw, pitch: p.pitch} : this.bindings.sample()
    if (m.range.firePulse) {input.fire = true; m.range.firePulse = false}
    return m.range.input(input, m.rangeView.inspecting ? m.rangeView.loop : null)
  }
  sync(view) {
    this.manager.hud.render(view, {presentationTimeMs: this.manager.world.time * 1000})
    this.rangePanel.sync()
  }
  dispose() {this.rangePanel.dispose(); this.bindings.dispose()}
}
