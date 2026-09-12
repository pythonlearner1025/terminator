const BLOCKED_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
  'KeyR', 'KeyG', 'KeyV', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space',
])

const controllers = new WeakMap()
const AIM_SENSITIVITY = 0.6

// PlayerView supplies effective core aim, including reload and quick-action suppression.
export function syncAimInput(viewer, aiming) {
  const input = controllers.get(viewer)
  if (input) input.aiming = aiming
  return input?.fov ?? 72
}

export class InputController {
  constructor(viewer, {mouseSensitivity = 0.0022, fov = 72} = {}) {
    this.viewer = viewer
    controllers.set(viewer, this)
    this.mouseSensitivity = mouseSensitivity
    this.fov = fov
    this.yaw = 0
    this.pitch = 0
    this.keys = new Set()
    this.fire = false
    this.aim = false
    this.aiming = false
    this.locked = false
    this.lockDenied = false
    this.cursor = null
    this.cursorAnchorYaw = 0
    this.cursorAnchorPitch = 0
    this.cursorScale = 1
    this.pulses = new Set()
    this.listeners = []
    this.lastLockAttempt = 0
    this.active = false
    this.lockRequestId = 0
  }

  start({yaw = 0, pitch = 0} = {}) {
    this.stop()
    this.active = true
    this.yaw = yaw
    this.pitch = pitch
    this.cursorAnchorYaw = yaw
    this.cursorAnchorPitch = pitch
    this.cursorScale = 1
    const canvas = this.viewer.canvas
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options)
      this.listeners.push(() => target.removeEventListener(type, handler, options))
    }
    on(canvas, 'mousedown', (event) => {
      if (event.button !== 0 && event.button !== 2) return
      event.preventDefault()
      if (event.button === 2) this.aim = true
      else this.fire = true
      if (this.locked) return
      this.updateCursor(event)
      this.requestLock()
    })
    on(window, 'mouseup', (event) => {
      if (event.button === 0) this.fire = false
      if (event.button === 2) this.aim = false
    })
    on(canvas, 'contextmenu', (event) => event.preventDefault())
    on(canvas, 'wheel', (event) => {
      event.preventDefault()
      if (event.deltaY !== 0) this.pulses.add(`switch:${event.deltaY > 0 ? 'next' : 'previous'}`)
    }, {passive: false})
    on(document, 'mousemove', (event) => {
      if (this.locked) {
        const sensitivity = this.mouseSensitivity * (this.aiming ? AIM_SENSITIVITY : 1)
        this.yaw -= event.movementX * sensitivity
        this.pitch = clamp(this.pitch - event.movementY * sensitivity, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
      } else {
        this.updateCursor(event)
      }
    })
    on(canvas, 'mouseleave', () => {
      if (!this.locked) { this.cursor = null; this.fire = false; this.aim = false }
    })
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas
      if (this.locked) this.lockDenied = false
      else {
        this.cursorAnchorYaw = this.yaw
        this.cursorAnchorPitch = this.pitch
        this.cursor = null
        this.fire = false
        this.aim = false
      }
    })
    on(document, 'pointerlockerror', () => { this.lockDenied = true })
    on(window, 'keydown', (event) => {
      if (isEditable(event.target)) return
      this.keys.add(event.code)
      if (!event.repeat) {
        if (event.code === 'KeyR') this.pulses.add('reload')
        else if (event.code === 'KeyG') this.pulses.add('grenade')
        else if (event.code === 'KeyV') this.pulses.add('melee')
        else if (event.code === 'Space') this.pulses.add('jump')
        else if (event.code === 'KeyE') this.pulses.add('ready')
        else if (/^Digit[1-6]$/.test(event.code)) this.pulses.add(`switch:${event.code.slice(5)}`)
      }
      if (BLOCKED_KEYS.has(event.code)) event.preventDefault()
    })
    on(window, 'keyup', (event) => this.keys.delete(event.code))
    on(window, 'blur', () => {
      this.keys.clear()
      this.fire = false
      this.aim = false
      this.aiming = false
    })
  }

  stop() {
    this.active = false
    this.lockRequestId += 1
    for (const off of this.listeners) off()
    this.listeners.length = 0
    this.keys.clear()
    this.pulses.clear()
    this.fire = false
    this.aim = false
    this.aiming = false
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
      aim: this.aim,
      reload: this.pulses.has('reload'),
      switchTo: switchPulse ? numericOrString(switchPulse.slice(7)) : null,
      sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      crouch: this.keys.has('ControlLeft') || this.keys.has('ControlRight'),
      jump: this.pulses.has('jump'),
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
    if (turn) this.cursorAnchorYaw = this.yaw
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
    const previous = this.cursor
    const normalizedX = x / rect.width * 2 - 1
    const normalizedY = y / rect.height * 2 - 1
    const verticalFov = this.fov * Math.PI / 180
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * (rect.width / Math.max(1, rect.height)))
    const scale = this.aiming ? AIM_SENSITIVITY : 1
    // Reanchor at the previous cursor when zoom changes, avoiding an aim jump.
    if (previous && (scale !== 1 || this.cursorScale !== 1)) {
      this.cursorAnchorYaw = this.yaw + (previous.x / previous.width * 2 - 1) * horizontalFov * 0.5 * scale
      this.cursorAnchorPitch = this.pitch + (previous.y / previous.height * 2 - 1) * verticalFov * 0.5 * scale
    }
    this.cursor = {x, y, width: rect.width, height: rect.height}
    this.cursorScale = scale
    this.yaw = this.cursorAnchorYaw - normalizedX * horizontalFov * 0.5 * scale
    this.pitch = clamp(this.cursorAnchorPitch - normalizedY * verticalFov * 0.5 * scale, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
  }

  requestLock() {
    if (!this.active) return Promise.resolve(false)
    const now = performance.now()
    if (this.lockDenied && now - this.lastLockAttempt < 3000) return Promise.resolve(false)
    this.lastLockAttempt = now
    const requestId = ++this.lockRequestId
    const canvas = this.viewer.canvas
    const attempt = (options) => {
      try {
        const result = options ? canvas.requestPointerLock(options) : canvas.requestPointerLock()
        return result && typeof result.then === 'function' ? result : Promise.resolve()
      } catch (error) {
        return Promise.reject(error)
      }
    }
    return attempt({unadjustedMovement: true})
      .catch((error) => error?.name === 'NotSupportedError' ? attempt() : Promise.reject(error))
      .then(() => {
        if (!this.active || requestId !== this.lockRequestId) {
          if (document.pointerLockElement === canvas) document.exitPointerLock()
          return false
        }
        return true
      })
      .catch(() => { this.lockDenied = true; return false })
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function isEditable(target) {
  const tag = target?.tagName?.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable === true
}

function numericOrString(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : value
}
