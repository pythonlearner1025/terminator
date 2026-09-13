// Editor walk-through. A WALK button over the viewport (or the V key) switches the editor camera
// to threepipe's first-person controls (WASD or arrows to move, mouse to look) and back.
// Registered in package.json under kite3d.plugins. The controls mode is set here, after the
// plugin is added, because the viewer applies its camera config before project plugins load.
// PlayerView clears camera.controlsMode during Play, so the button stays out of gameplay.
import {ThreeFirstPersonControlsPlugin} from 'threepipe'

const EYE_HEIGHT = 1.65
const WALK_MODE = 'threeFirstPerson'

export default class EditorWalkPlugin extends ThreeFirstPersonControlsPlugin {
  static PluginType = 'EditorWalkPlugin'

  onAdded(viewer) {
    super.onAdded(viewer)
    this._viewer = viewer
    this._previousMode = null
    this._onKey = (event) => {
      if (event.code !== 'KeyV' || event.repeat) return
      const target = event.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      this.toggle()
    }
    window.addEventListener('keydown', this._onKey)
    this._mountButton()
  }

  onRemove(viewer) {
    window.removeEventListener('keydown', this._onKey)
    if (this._place) { clearInterval(this._placeTimer); window.removeEventListener('resize', this._place) }
    this._button?.remove()
    this._button = null
    super.onRemove(viewer)
  }

  get walking() {
    return this._viewer?.scene.mainCamera.controlsMode === WALK_MODE
  }

  toggle() {
    const camera = this._viewer?.scene.mainCamera
    if (!camera) return
    // An empty mode means Play owns the camera. Leave gameplay alone.
    if (camera.controlsMode === '' && !this.walking) return
    if (this.walking) {
      camera.controlsMode = this._previousMode || 'orbit'
      this._previousMode = null
    } else {
      this._previousMode = camera.controlsMode || 'orbit'
      camera.controlsMode = WALK_MODE
      const controls = camera.controls
      if (controls) {
        controls.movementSpeed = 6
        controls.lookSpeed = 0.0035
        controls.lookVertical = true
        controls.constrainVertical = true
        controls.verticalMin = Math.PI * 0.15
        controls.verticalMax = Math.PI * 0.85
      }
      camera.position.y = Math.max(camera.position.y, EYE_HEIGHT)
      camera.setDirty?.()
    }
    this._syncButton()
    this._viewer.setDirty?.()
  }

  _mountButton() {
    const canvas = this._viewer.canvas
    if (!canvas) return
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('data-editor-walk', '')
    button.title = 'Walk the scene with WASD and the mouse (V)'
    button.style.cssText = 'position:fixed;z-index:2147483000;padding:6px 12px;border:1px solid rgba(255,255,255,.35);border-radius:4px;background:rgba(10,14,20,.82);color:#e8eef5;font:600 12px/1 system-ui,sans-serif;letter-spacing:.08em;cursor:pointer'
    button.addEventListener('click', () => this.toggle())
    document.body.appendChild(button)
    this._button = button
    // Pin the button to the canvas corner; the editor moves and resizes the viewport.
    this._place = () => {
      const rect = canvas.getBoundingClientRect()
      button.style.left = `${Math.round(rect.left + 12)}px`
      button.style.top = `${Math.round(rect.top + 12)}px`
      button.hidden = rect.width < 50 || rect.height < 50
    }
    this._place()
    this._placeTimer = setInterval(this._place, 500)
    window.addEventListener('resize', this._place)
    this._syncButton()
  }

  _syncButton() {
    if (!this._button) return
    this._button.textContent = this.walking ? 'EXIT WALK (V)' : 'WALK (V)'
  }
}
