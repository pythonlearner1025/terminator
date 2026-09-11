const BLOCKED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'KeyR', 'KeyG', 'KeyV', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
])

export class InputController {
  constructor(viewer, {mouseSensitivity = 0.0022, fov = 72} = {}) {
    this.viewer = viewer
    this.mouseSensitivity = mouseSensitivity
    this.fov = fov
    this.yaw = 0
    this.pitch = 0
    this.keys = new Set()
    this.fire = false
    this.locked = false
    this.lockDenied = false
    this.cursor = null
    this.cursorAnchorYaw = 0
    this.pulses = new Set()
    this.listeners = []
    this.lastLockAttempt = 0
  }

  start({yaw = 0, pitch = 0} = {}) {
    this.stop()
    this.yaw = yaw
    this.pitch = pitch
    this.cursorAnchorYaw = yaw
    const canvas = this.viewer.canvas
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options)
      this.listeners.push(() => target.removeEventListener(type, handler, options))
    }
    on(canvas, 'mousedown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      this.updateCursor(event)
      this.fire = true
      if (!this.locked) this.requestLock()
    })
    on(window, 'mouseup', (event) => {
      if (event.button === 0) this.fire = false
    })
    on(canvas, 'contextmenu', (event) => event.preventDefault())
    on(document, 'mousemove', (event) => {
      if (this.locked) {
        this.yaw -= event.movementX * this.mouseSensitivity
        this.pitch = clamp(this.pitch - event.movementY * this.mouseSensitivity, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
      } else {
        this.updateCursor(event)
      }
    })
    on(canvas, 'mouseleave', () => { if (!this.locked) this.cursor = null })
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas
      if (this.locked) this.lockDenied = false
      else this.cursorAnchorYaw = this.yaw
    })
    on(document, 'pointerlockerror', () => { this.lockDenied = true })
    on(window, 'keydown', (event) => {
      if (isEditable(event.target)) return
      this.keys.add(event.code)
      if (!event.repeat) {
        if (event.code === 'KeyR') this.pulses.add('reload')
        else if (event.code === 'KeyG') this.pulses.add('grenade')
        else if (event.code === 'KeyV') this.pulses.add('melee')
        else if (event.code === 'KeyE') this.pulses.add('ready')
        else if (/^Digit[1-4]$/.test(event.code)) this.pulses.add(`switch:${event.code.slice(5)}`)
      }
      if (BLOCKED_KEYS.has(event.code)) event.preventDefault()
    })
    on(window, 'keyup', (event) => this.keys.delete(event.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.fire = false
    })
  }

  stop() {
    for (const off of this.listeners) off()
    this.listeners.length = 0
    this.keys.clear()
    this.pulses.clear()
    this.fire = false
    this.cursor = null
    const canvas = this.viewer?.canvas
    if (canvas && document.pointerLockElement === canvas) document.exitPointerLock()
    this.locked = false
  }

  sample() {
    if (!this.locked) this.turnWithKeys()
    const moveX = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0)
    const moveZ = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0)
    const switchPulse = [...this.pulses].find((value) => value.startsWith('switch:'))
    const result = {
      move: {x: moveX, z: moveZ},
      yaw: this.yaw,
      pitch: this.pitch,
      fire: this.fire,
      reload: this.pulses.has('reload'),
      switchTo: switchPulse ? Number(switchPulse.slice(7)) : null,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('ControlRight'),
      grenade: this.pulses.has('grenade'),
      melee: this.pulses.has('melee'),
      ready: this.pulses.has('ready'),
    }
    this.pulses.clear()
    return result
  }

  turnWithKeys() {
    const turn = (this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('ArrowLeft') ? 1 : 0)
    const look = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0)
    this.yaw -= turn * 0.032
    this.cursorAnchorYaw = this.yaw
    this.pitch = clamp(this.pitch + look * 0.022, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
  }

  updateCursor(event) {
    const rect = this.viewer.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      this.cursor = null
      return
    }
    this.cursor = {x, y, width: rect.width, height: rect.height}
    const normalizedX = x / rect.width * 2 - 1
    const normalizedY = y / rect.height * 2 - 1
    const verticalFov = this.fov * Math.PI / 180
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (rect.width / Math.max(1, rect.height)))
    this.yaw = this.cursorAnchorYaw - normalizedX * horizontalFov * 0.5
    this.pitch = clamp(-normalizedY * verticalFov * 0.5, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
  }

  requestLock() {
    const now = performance.now()
    if (this.lockDenied && now - this.lastLockAttempt < 3000) return
    this.lastLockAttempt = now
    const canvas = this.viewer.canvas
    const attempt = (options) => {
      try {
        const result = options ? canvas.requestPointerLock(options) : canvas.requestPointerLock()
        return result && typeof result.then === 'function' ? result : Promise.resolve()
      } catch (error) {
        return Promise.reject(error)
      }
    }
    attempt({unadjustedMovement: true})
      .catch((error) => error?.name === 'NotSupportedError' ? attempt() : Promise.reject(error))
      .catch(() => { this.lockDenied = true })
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isEditable(target) {
  const tag = target?.tagName?.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
}
