// Physical bindings stay at the UI boundary. The input controller still owns mouse look.
export const ACTIONS = Object.freeze([
  ['forward', 'Forward', 'KeyW', 'combat'], ['backward', 'Backward', 'KeyS', 'combat'],
  ['left', 'Left', 'KeyA', 'combat'], ['right', 'Right', 'KeyD', 'combat'],
  ['sprint', 'Sprint', 'ShiftLeft', 'combat'], ['crouch', 'Crouch', 'ControlLeft', 'combat'],
  ['jump', 'Jump', 'Space', 'combat'],
  ['fire', 'Fire', 'Mouse0', 'combat'], ['aim', 'Aim', 'Mouse2', 'combat'],
  ['reload', 'Reload', 'KeyR', 'combat'], ['grenade', 'Grenade', 'KeyG', 'combat'],
  ['melee', 'Knife', 'KeyV', 'combat'], ['slot1', 'Pistol', 'Digit1', 'combat'],
  ['slot2', 'M4', 'Digit2', 'combat'], ['slot3', 'Shotgun', 'Digit3', 'combat'],
  ['slot4', 'Plasma', 'Digit4', 'combat'], ['slot5', 'Sniper', 'Digit5', 'combat'],
  ['slot6', 'Launcher', 'Digit6', 'combat'], ['lookLeft', 'Look left', 'ArrowLeft', 'combat'],
  ['lookRight', 'Look right', 'ArrowRight', 'combat'], ['lookUp', 'Look up', 'ArrowUp', 'combat'],
  ['lookDown', 'Look down', 'ArrowDown', 'combat'], ['pause', 'Pause', 'Escape', 'global'],
  ['trader', 'Trader', 'KeyE', 'intermission'], ['ready', 'Start wave', 'KeyR', 'intermission'],
  ['previous', 'Previous player', 'Mouse2', 'spectate'], ['next', 'Next player', 'Mouse0', 'spectate'],
].map(entry => Object.freeze(entry)))
export const DEFAULT_BINDINGS = Object.freeze(Object.fromEntries(ACTIONS.map(([id,,code]) => [id, code])))
export const validCode = code => typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Space|Escape|Tab|Enter|Backspace|Bracket(Left|Right)|Backquote|Minus|Equal|Semicolon|Quote|Comma|Period|Slash|Backslash|Mouse[0-4])$/.test(code)
const overlaps = (a, b) => a === b || a === 'global' || b === 'global'

export function rebind(bindings, action, code) {
  const row = ACTIONS.find(([id]) => id === action)
  if (!row || !validCode(code)) return {...bindings}
  const result = {...bindings}
  for (const [id,,,context] of ACTIONS) {
    if (id !== action && result[id] === code && overlaps(context, row[3])) result[id] = bindings[action]
  }
  result[action] = code
  return result
}
export function normalizeBindings(values = {}) {
  let result = {...DEFAULT_BINDINGS}
  if (!values || typeof values !== 'object') return result
  for (const [id] of ACTIONS) if (validCode(values[id])) result = rebind(result, id, values[id])
  return result
}
export function keyLabel(code) {
  return ({Mouse0:'Mouse 1',Mouse1:'Mouse 3',Mouse2:'Mouse 2',Mouse3:'Mouse 4',Mouse4:'Mouse 5',
    ShiftLeft:'L Shift',ShiftRight:'R Shift',ControlLeft:'L Ctrl',ControlRight:'R Ctrl',
    AltLeft:'L Alt',AltRight:'R Alt',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',
    BracketLeft:'[',BracketRight:']',Escape:'Esc',Space:'Space'}[code] || code.replace(/^(Key|Digit)/, ''))
}

export class BindingInput {
  constructor(input, bindings) {
    this.input = input
    this.bindings = bindings
    this.held = new Set()
    this.pulses = new Set()
    this.offs = []
    const on = (target, type, handler) => {
      target.addEventListener(type, handler)
      this.offs.push(() => target.removeEventListener(type, handler))
    }
    const down = (code, event) => {
      if (!this.active || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName)) return
      this.held.add(code)
      if (!event.repeat) for (const [action,,,context] of ACTIONS) {
        if (context === 'combat' && this.bindings[action] === code) this.pulses.add(action)
      }
      if (Object.values(this.bindings).includes(code)) event.preventDefault()
      if (/^Mouse[134]$/.test(code) && !input.locked && [this.bindings.fire,this.bindings.aim].includes(code)) {
        input.updateCursor?.(event)
        input.requestLock?.()
      }
    }
    on(window, 'keydown', event => down(event.code, event))
    on(window, 'keyup', event => this.held.delete(event.code))
    on(input.viewer.canvas, 'mousedown', event => down(`Mouse${event.button}`, event))
    on(input.viewer.canvas, 'auxclick', event => {
      if (this.active && Object.values(this.bindings).includes(`Mouse${event.button}`)) event.preventDefault()
    })
    on(window, 'mouseup', event => this.held.delete(`Mouse${event.button}`))
    on(window, 'blur', () => this.clear())
    on(input.viewer.canvas, 'mouseleave', () => {
      if (!input.locked) for (const code of this.held) if (code.startsWith('Mouse')) this.held.delete(code)
    })
  }
  clear() { this.held.clear(); this.pulses.clear() }
  setActive(active) { this.active = active; this.clear() }
  sample() {
    const input = this.input
    // Discard the legacy keyboard mapping before sampling mouse look.
    input.keys.clear()
    const base = input.sample()
    const held = action => this.held.has(this.bindings[action])
    const turn = Number(held('lookRight')) - Number(held('lookLeft'))
    input.yaw -= turn * .032
    if (turn) input.cursorAnchorYaw = input.yaw
    input.pitch = Math.max(-Math.PI / 2 + .05, Math.min(Math.PI / 2 - .05,
      input.pitch + (Number(held('lookUp')) - Number(held('lookDown'))) * .022))
    const slot = [1,2,3,4,5,6].find(index => this.pulses.has(`slot${index}`))
    const result = {...base, yaw:input.yaw, pitch:input.pitch,
      move:{x:Number(held('right'))-Number(held('left')),z:Number(held('forward'))-Number(held('backward'))},
      fire:held('fire'), aim:held('aim'), sprint:held('sprint'), crouch:held('crouch'),
      reload:this.pulses.has('reload'), jump:this.pulses.has('jump'), grenade:this.pulses.has('grenade'), melee:this.pulses.has('melee'),
      ready:false, switchTo:slot ?? base.switchTo ?? null,
    }
    this.pulses.clear()
    return result
  }
  dispose() { this.setActive(false); for (const off of this.offs) off() }
}
