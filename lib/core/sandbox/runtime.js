import RELEASE_SYNC from '#quickjs-release-sync'
import {newQuickJSWASMModuleFromVariant} from '#quickjs-core'

export const CONTEXT_MEMORY_LIMIT_BYTES = 256 * 1024
export const MEM_LIMIT_BYTES = 4 * 1024
export const FUEL_OPERATION_BUDGET = 10_000
export const OPERATIONS_PER_INTERRUPT_CHECK = 1_000
export const INTERRUPT_CHECK_BUDGET = FUEL_OPERATION_BUDGET / OPERATIONS_PER_INTERRUPT_CHECK

export const NAV_FUEL_COSTS = Object.freeze({
  canSee: 200,
  pathTo: 800,
  coverNear: 1_200,
  randomPoint: 100,
})

const quickJSModulePromise = newQuickJSWASMModuleFromVariant(RELEASE_SYNC)
const nodeRuntime = typeof process !== 'undefined' && Boolean(process.versions?.node)
let QuickJS
let quickJSLoadError
if (nodeRuntime) QuickJS = await quickJSModulePromise
else quickJSModulePromise.then(
  (module) => { QuickJS = module },
  (error) => { quickJSLoadError = error },
)
const reportedTicks = new Set()
const textEncoder = new TextEncoder()

const LOCKDOWN_SOURCE = `
for (const name of [
  'Date', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'process', 'require',
  'window', 'document', 'navigator', 'location', 'self'
]) {
  Object.defineProperty(globalThis, name, {
    value: undefined,
    writable: false,
    enumerable: false,
    configurable: false,
  })
}
Object.defineProperty(Math, 'random', {
  value: undefined,
  writable: false,
  enumerable: false,
  configurable: false,
})
`

const SETUP_SOURCE = `
(() => {
  const parse = JSON.parse.bind(JSON)
  const stringify = JSON.stringify.bind(JSON)
  const arrayIsArray = Array.isArray.bind(Array)
  const arrayIncludes = Function.call.bind(Array.prototype.includes)
  const arrayPush = Function.call.bind(Array.prototype.push)
  const arrayPop = Function.call.bind(Array.prototype.pop)
  const objectKeys = Object.keys.bind(Object)
  const objectCreate = Object.create.bind(Object)
  const getPrototypeOf = Object.getPrototypeOf.bind(Object)
  const objectPrototype = Object.prototype
  const numberIsFinite = Number.isFinite.bind(Number)
  const ScriptError = Error
  const toPlainJson = (value, ancestors = []) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') {
      if (!numberIsFinite(value)) throw new ScriptError('Value is not JSON serializable')
      return value
    }
    if (typeof value !== 'object') throw new ScriptError('Value is not JSON serializable')
    if (arrayIncludes(ancestors, value)) throw new ScriptError('Value is not JSON serializable')
    const array = arrayIsArray(value)
    const prototype = getPrototypeOf(value)
    if (!array && prototype !== objectPrototype && prototype !== null) {
      throw new ScriptError('Value is not a plain JSON object')
    }
    arrayPush(ancestors, value)
    const output = array ? [] : objectCreate(null)
    for (const key of objectKeys(value)) output[key] = toPlainJson(value[key], ancestors)
    arrayPop(ancestors)
    return output
  }
  return (tick, init, hostRand, hostCanSee, hostPathTo, hostCoverNear, hostRandomPoint) => {
  let initialized = false
  const mem = {}
  const callHost = (fn, args) => {
    const value = parse(fn(stringify(toPlainJson(args))))
    if (value && value.__unitScriptHostError) throw new ScriptError(value.__unitScriptHostError)
    return value
  }
  return (selfJson, senseJson) => {
    const self = parse(selfJson)
    const sense = parse(senseJson)
    sense.rand = hostRand
    sense.nav.canSee = (pos) => callHost(hostCanSee, [pos])
    sense.nav.pathTo = (pos) => callHost(hostPathTo, [pos])
    sense.nav.coverNear = (pos, fromPos, radius) => callHost(hostCoverNear, [pos, fromPos, radius])
    sense.nav.randomPoint = (radius) => callHost(hostRandomPoint, [radius])

    const actions = []
    const add = (name, args = []) => arrayPush(actions, {name, args: toPlainJson(args)})
    const act = {
      moveTo: (pos) => add('moveTo', [pos]),
      stop: () => add('stop'),
      face: (pos) => add('face', [pos]),
      fire: () => add('fire'),
      aimAt: (pos) => add('aimAt', [pos]),
      melee: () => add('melee'),
      crouch: (on) => add('crouch', [!!on]),
      say: (text) => add('say', [text]),
      broadcast: (data) => add('broadcast', [data]),
    }

    if (!initialized) {
      if (typeof init === 'function') init(self, mem)
      initialized = true
    }
    tick(self, sense, act, mem)
    return stringify({actions, mem: toPlainJson(mem)})
  }
}
})()
`

export class UnitScriptError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UnitScriptError'
  }
}

export class FuelExhaustedError extends Error {
  constructor(message = 'Unit script fuel exhausted') {
    super(message)
    this.name = 'FuelExhaustedError'
  }
}

export class UnitScriptRuntime {
  constructor({unitType, rev, source}) {
    this.unitType = unitType
    this.rev = rev
    this.source = source
    this.runtime = null
    this.context = null
    this.currentSense = null
    this.interruptChecks = 0
    this.navOperations = 0
    this.fuelActive = false
    this.fuelExhausted = false
    this.lastFuel = Object.freeze({interruptChecks: 0, navOperations: 0, operations: 0, exhausted: false})
    this.runHandle = null
    this.setupHandle = null
    this.disposed = false
    if (QuickJS) this.initialize()
  }

  initialize() {
    if (this.disposed) throw new UnitScriptError('Unit script runtime is disposed')
    if (this.runHandle) return
    this.runtime = QuickJS.newRuntime()
    this.runtime.setMemoryLimit(CONTEXT_MEMORY_LIMIT_BYTES)
    this.context = this.runtime.newContext()
    this.runtime.setInterruptHandler(() => this.handleInterrupt())

    try {
      this.evaluateTrusted(LOCKDOWN_SOURCE, 'unit-lockdown.js').dispose()
      this.setupHandle = this.evaluateTrusted(SETUP_SOURCE, 'unit-runner.js')
      this.installScript()
    } catch (error) {
      this.destroy()
      throw error
    }
  }

  ensureReady() {
    if (this.disposed) throw new UnitScriptError('Unit script runtime is disposed')
    if (this.runHandle) return true
    if (quickJSLoadError) {
      throw new UnitScriptError(`Could not load QuickJS: ${String(quickJSLoadError?.message || quickJSLoadError)}`)
    }
    if (!QuickJS) return false
    this.initialize()
    return true
  }

  handleInterrupt() {
    if (!this.fuelActive) return false
    this.interruptChecks += 1
    if (this.fuelUsed() > FUEL_OPERATION_BUDGET) this.fuelExhausted = true
    return this.fuelExhausted
  }

  fuelUsed() {
    return this.interruptChecks * OPERATIONS_PER_INTERRUPT_CHECK + this.navOperations
  }

  resetFuel() {
    this.interruptChecks = 0
    this.navOperations = 0
    this.fuelExhausted = false
    this.fuelActive = true
  }

  finishFuel() {
    this.fuelActive = false
    this.lastFuel = Object.freeze({
      interruptChecks: this.interruptChecks,
      navOperations: this.navOperations,
      operations: this.fuelUsed(),
      exhausted: this.fuelExhausted,
    })
  }

  chargeNav(name) {
    this.navOperations += NAV_FUEL_COSTS[name]
    if (this.fuelUsed() > FUEL_OPERATION_BUDGET) this.fuelExhausted = true
    return !this.fuelExhausted
  }

  evaluateTrusted(source, filename) {
    const result = this.context.evalCode(source, filename)
    return this.unwrap(result, `Could not initialize sandbox: ${filename}`)
  }

  unwrap(result, prefix) {
    if (result.error) {
      const value = this.context.dump(result.error)
      result.error.dispose()
      throw new UnitScriptError(`${prefix}: ${formatQuickJSError(value)}`)
    }
    return result.value
  }

  installScript() {
    this.resetFuel()
    const moduleResult = this.context.evalCode(this.source, `${this.unitType}-rev-${this.rev}.mjs`, {type: 'module'})
    this.finishFuel()
    if (this.fuelExhausted) {
      disposeResult(moduleResult)
      throw new FuelExhaustedError('Unit script fuel exhausted during module initialization')
    }
    const moduleExports = this.unwrap(moduleResult, 'Could not parse unit script')
    let tickHandle
    let initHandle
    try {
      tickHandle = this.context.getProp(moduleExports, 'tick')
      if (this.context.typeof(tickHandle) !== 'function') {
        throw new UnitScriptError('Unit script must export function tick')
      }
      initHandle = this.context.getProp(moduleExports, 'init')
      if (this.context.typeof(initHandle) !== 'undefined' && this.context.typeof(initHandle) !== 'function') {
        throw new UnitScriptError('Unit script init export must be a function')
      }
      this.runHandle = this.createRunner(tickHandle, initHandle)
    } finally {
      initHandle?.dispose()
      tickHandle?.dispose()
      moduleExports.dispose()
    }
  }

  createRunner(tickHandle, initHandle) {
    const hostHandles = [
      this.context.newFunction('senseRand', () => this.context.newNumber(this.currentSense.rand())),
      this.createNavFunction('canSee'),
      this.createNavFunction('pathTo'),
      this.createNavFunction('coverNear'),
      this.createNavFunction('randomPoint'),
    ]
    try {
      const result = this.context.callFunction(
        this.setupHandle,
        this.context.undefined,
        tickHandle,
        initHandle,
        ...hostHandles,
      )
      return this.unwrap(result, 'Could not create unit script runner')
    } finally {
      for (const handle of hostHandles) handle.dispose()
      this.setupHandle.dispose()
      this.setupHandle = null
    }
  }

  createNavFunction(name) {
    return this.context.newFunction(`nav_${name}`, (argsJsonHandle) => {
      if (!this.chargeNav(name)) return this.context.newString('null')
      try {
        const args = JSON.parse(this.context.getString(argsJsonHandle))
        const value = this.currentSense.nav[name](...args)
        return this.context.newString(JSON.stringify(value ?? null))
      } catch (error) {
        return this.context.newString(JSON.stringify({
          __unitScriptHostError: String(error?.message || error),
        }))
      }
    })
  }

  tick(self, sense, act, mem) {
    if (!this.ensureReady()) return
    const selfJson = JSON.stringify(self)
    const senseJson = JSON.stringify(sense)
    const selfHandle = this.context.newString(selfJson)
    const senseHandle = this.context.newString(senseJson)
    this.currentSense = sense
    this.resetFuel()
    let result
    try {
      result = this.context.callFunction(this.runHandle, this.context.undefined, selfHandle, senseHandle)
    } finally {
      this.finishFuel()
      this.currentSense = null
      senseHandle.dispose()
      selfHandle.dispose()
    }

    if (this.fuelExhausted) {
      disposeResult(result)
      throw new FuelExhaustedError()
    }
    const resultHandle = this.unwrap(result, 'Unit script tick failed')
    let payload
    try {
      payload = JSON.parse(this.context.getString(resultHandle))
    } catch (error) {
      throw new UnitScriptError(`Unit script returned invalid JSON: ${String(error?.message || error)}`)
    } finally {
      resultHandle.dispose()
    }

    const memJson = JSON.stringify(payload.mem)
    const memBytes = textEncoder.encode(memJson).byteLength
    if (memBytes > MEM_LIMIT_BYTES) {
      throw new UnitScriptError(`Unit script mem is ${memBytes} bytes; limit is ${MEM_LIMIT_BYTES} bytes`)
    }
    replaceObject(mem, payload.mem)
    for (const action of payload.actions) {
      const fn = act[action.name]
      if (typeof fn === 'function') fn(...action.args)
    }

    const reportKey = `${this.unitType}:${this.rev}`
    if (!reportedTicks.has(reportKey)) {
      reportedTicks.add(reportKey)
      console.info(`[Terminator sandbox] ${this.unitType} rev ${this.rev} ticked in QuickJS`)
    }
  }

  destroy() {
    if (this.setupHandle) {
      this.setupHandle.dispose()
      this.setupHandle = null
    }
    if (this.runHandle) {
      this.runHandle.dispose()
      this.runHandle = null
    }
    if (this.context?.alive) this.context.dispose()
    if (this.runtime?.alive) this.runtime.dispose()
    this.disposed = true
  }
}

export function sandboxReady() {
  return Boolean(QuickJS)
}

export function sandboxLoadError() {
  return quickJSLoadError || null
}

export function validateScriptSource({unitType, rev = 1, source}) {
  const script = new UnitScriptRuntime({unitType, rev, source})
  if (!script.ensureReady()) throw new UnitScriptError('QuickJS is still loading')
  script.destroy()
  return true
}

export function calibrateInterruptChecks(iterations = 1_000) {
  if (!QuickJS) throw new UnitScriptError('QuickJS is still loading')
  const runtime = QuickJS.newRuntime()
  runtime.setMemoryLimit(CONTEXT_MEMORY_LIMIT_BYTES)
  let checks = 0
  runtime.setInterruptHandler(() => {
    checks += 1
    return false
  })
  const context = runtime.newContext()
  const result = context.evalCode(`for (let i = 0; i < ${Math.max(0, Math.floor(iterations))}; i += 1) {}`)
  disposeResult(result)
  context.dispose()
  runtime.dispose()
  return checks
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key]
  for (const [key, value] of Object.entries(source)) {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  }
}

function disposeResult(result) {
  if (!result) return
  if (result.error) result.error.dispose()
  else result.value.dispose()
}

function formatQuickJSError(value) {
  if (value && typeof value === 'object') {
    const name = value.name ? `${value.name}: ` : ''
    return `${name}${value.message || JSON.stringify(value)}`
  }
  return String(value)
}
