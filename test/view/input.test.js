import assert from 'node:assert/strict'
import test from 'node:test'
import {InputController} from '../../lib/view/input.js'

test('input maps keys five and six and both wheel directions', () => {
  const previousWindow = globalThis.window
  const previousDocument = globalThis.document
  globalThis.window = new EventTarget()
  globalThis.document = new EventTarget()
  document.pointerLockElement = null
  document.exitPointerLock = () => {}
  const canvas = new EventTarget()
  canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 800, height: 600})
  canvas.requestPointerLock = () => Promise.resolve()
  const input = new InputController({canvas})
  const dispatch = (target, type, fields) => {
    const event = new Event(type, {cancelable: true})
    Object.assign(event, fields)
    target.dispatchEvent(event)
  }
  try {
    input.start()
    dispatch(window, 'keydown', {code: 'Digit5', repeat: false})
    assert.equal(input.sample().switchTo, 5)
    dispatch(window, 'keydown', {code: 'Digit6', repeat: false})
    assert.equal(input.sample().switchTo, 6)
    dispatch(canvas, 'wheel', {deltaY: 1})
    assert.equal(input.sample().switchTo, 'next')
    dispatch(canvas, 'wheel', {deltaY: -1})
    assert.equal(input.sample().switchTo, 'previous')
  } finally {
    input.stop()
    globalThis.window = previousWindow
    globalThis.document = previousDocument
  }
})
