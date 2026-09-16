import test from 'node:test'
import assert from 'node:assert/strict'
const {canvasRect, forgetCanvasRect} = await import('../../lib/view/canvas-rect.js')

function stubCanvas(box = {x: 0, y: 0, width: 800, height: 600}) {
  let reads = 0
  const observers = []
  const canvas = {
    box,
    get reads() { return reads },
    getBoundingClientRect() { reads += 1; return {...canvas.box} },
  }
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe() {}
    disconnect() {}
  }
  return {canvas, observers}
}

test('the canvas box is measured once per frame burst, not once per reader', () => {
  const {canvas} = stubCanvas()
  let clock = 1000
  assert.equal(canvasRect(canvas, clock).width, 800)
  assert.equal(canvas.reads, 1)
  // The HUD, the screen effects and the scope all read inside the same frame.
  for (let frame = 0; frame < 60; frame += 1) {
    clock += 3
    canvasRect(canvas, clock); canvasRect(canvas, clock); canvasRect(canvas, clock)
  }
  assert.equal(canvas.reads, 1, '180 reads in 180 ms forced one layout')
  forgetCanvasRect(canvas)
})

test('a resize, and then a slow move, both reach the readers', () => {
  const {canvas, observers} = stubCanvas()
  let clock = 0
  canvasRect(canvas, clock)
  canvas.box = {x: 0, y: 0, width: 1024, height: 768}
  observers[0].callback()
  assert.equal(canvasRect(canvas, clock).width, 1024, 'a resize invalidates at once')

  // A panel can move the canvas without resizing it. The poll catches that.
  canvas.box = {x: 40, y: 10, width: 1024, height: 768}
  assert.equal(canvasRect(canvas, clock).x, 0, 'inside the poll window the cached box is reused')
  clock += 250
  assert.equal(canvasRect(canvas, clock).x, 40, 'the box is remeasured at least four times a second')
  forgetCanvasRect(canvas)
})
