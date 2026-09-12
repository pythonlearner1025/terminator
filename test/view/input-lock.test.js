import assert from 'node:assert/strict'
import test from 'node:test'
import {InputController} from '../../lib/view/input.js'

test('a screen stop cancels an in-flight pointer-lock request', async () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  const fakeWindow = new EventTarget()
  const fakeDocument = new EventTarget()
  const canvas = new EventTarget()
  let finishLock
  let exits = 0
  canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 100, height: 100})
  canvas.requestPointerLock = () => new Promise(resolve => { finishLock = resolve })
  fakeDocument.pointerLockElement = null
  fakeDocument.exitPointerLock = () => { exits += 1; fakeDocument.pointerLockElement = null }
  globalThis.window = fakeWindow
  globalThis.document = fakeDocument
  try {
    const input = new InputController({canvas})
    input.start()
    const pending = input.requestLock()
    input.stop()
    fakeDocument.pointerLockElement = canvas
    finishLock()
    assert.equal(await pending, false)
    assert.equal(exits, 1)
    assert.equal(input.active, false)
  } finally {
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})
