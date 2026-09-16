import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

globalThis.ImageData ??= class {}
globalThis.window ??= {}

test('editor environment plugin registers, lights Edit mode, and survives Play ownership', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.ok(packageJson.kite3d.plugins.includes('./scripts/Environment.plugin.js'))

  const {default: EnvironmentPlugin, EDITOR_ENVIRONMENT_INTENSITY} = await import('../../scripts/Environment.plugin.js')
  const editorTexture = texture('editor')
  const viewer = fakeViewer(editorTexture)
  const plugin = new EnvironmentPlugin()

  plugin.onAdded(viewer)
  await plugin.ready

  assert.equal(EnvironmentPlugin.PluginType, 'TerminatorEnvironment')
  assert.equal(viewer.scene.environment, editorTexture)
  assert.equal(viewer.scene.environmentIntensity, EDITOR_ENVIRONMENT_INTENSITY)

  viewer.scene.environment = null
  viewer.scene.environmentIntensity = 1
  viewer.dispatch('preFrame')
  assert.equal(viewer.scene.environment, editorTexture)
  assert.equal(viewer.scene.environmentIntensity, EDITOR_ENVIRONMENT_INTENSITY)

  const saved = {
    environment: viewer.scene.environment,
    environmentIntensity: viewer.scene.environmentIntensity,
  }
  const playTexture = texture('play')
  viewer.components.running = true
  viewer.scene.environment = playTexture
  viewer.scene.environmentIntensity = 0.32
  viewer.dispatch('preFrame')
  assert.equal(viewer.scene.environment, playTexture)

  viewer.components.running = false
  Object.assign(viewer.scene, saved)
  playTexture.dispose()
  assert.equal(viewer.scene.environment, editorTexture)
  assert.equal(viewer.scene.environmentIntensity, EDITOR_ENVIRONMENT_INTENSITY)

  plugin.onRemove(viewer)
  assert.equal(viewer.scene.environment, null)
  assert.equal(viewer.scene.environmentIntensity, 1)
  assert.equal(editorTexture.disposed, true)
})

function texture(name) {
  return {name, disposed: false, dispose() { this.disposed = true }}
}

function fakeViewer(environment) {
  const listeners = new Map()
  const components = {running: false}
  return {
    components,
    scene: {environment: null, environmentIntensity: 1},
    import: async url => {
      assert.match(url, /assets\/hdri\/qwantani_moon_noon_puresky_2k\.hdr$/)
      return environment
    },
    addEventListener(type, listener) { listeners.set(type, listener) },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type)
    },
    dispatch(type) { listeners.get(type)?.({type}) },
    getPlugin(type) { return type === 'EntityComponentPlugin' ? components : null },
    setDirty() {},
  }
}
