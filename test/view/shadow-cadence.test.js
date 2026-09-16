import test from 'node:test'
import assert from 'node:assert/strict'
import {installShadowCadence} from '../../lib/view/shadow-cadence.js'

// Threepipe asks for a shadow redraw on every frame it renders. This stub
// reproduces that: preRender listeners run, then the frame reads needsUpdate.
function viewerStub() {
  const listeners = new Map()
  const shadowMap = {enabled: true, autoUpdate: true, needsUpdate: false}
  const viewer = {
    renderManager: {webglRenderer: {shadowMap}},
    addEventListener(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]) },
    removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)) },
    setDirty() {},
  }
  const frame = () => {
    shadowMap.needsUpdate = true
    for (const fn of listeners.get('preRender') || []) fn()
    const drawn = shadowMap.autoUpdate || shadowMap.needsUpdate
    shadowMap.needsUpdate = false
    return drawn
  }
  const drawnOf = count => Array.from({length: count}, frame).filter(Boolean).length
  return {viewer, shadowMap, drawnOf, listeners}
}

test('interval 1 leaves every frame drawing its shadows', () => {
  const {viewer, shadowMap, drawnOf} = viewerStub()
  const cadence = installShadowCadence(viewer)
  assert.equal(cadence.interval, 1)
  assert.equal(shadowMap.autoUpdate, true, 'nothing is touched at interval 1')
  assert.equal(drawnOf(20), 20)
  cadence.dispose()
})

test('interval 2 drops every other redraw and going back restores all of them', () => {
  const {viewer, drawnOf} = viewerStub()
  const cadence = installShadowCadence(viewer)
  cadence.setInterval(2)
  assert.equal(cadence.interval, 2)
  assert.equal(drawnOf(20), 10, 'half the frames redraw the shadow map')
  cadence.setInterval(1)
  assert.equal(drawnOf(20), 20, 'back to every frame')
  cadence.dispose()
})

test('installing twice on one viewer reuses the same cadence', () => {
  const {viewer, listeners} = viewerStub()
  const first = installShadowCadence(viewer)
  assert.equal(installShadowCadence(viewer), first)
  assert.equal(listeners.get('preRender').length, 1)
  first.dispose()
  assert.equal(listeners.get('preRender').length, 0)
  assert.notEqual(installShadowCadence(viewer), first, 'a disposed cadence is not handed out again')
})

test('a viewer with no WebGL renderer has no shadow map to pace', () => {
  assert.equal(installShadowCadence({renderManager: {}}), null)
  assert.equal(installShadowCadence(undefined), null)
})
