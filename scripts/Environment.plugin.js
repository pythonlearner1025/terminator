import {AViewerPluginSync, Group} from 'threepipe'

export const EDITOR_ENVIRONMENT_INTENSITY = 0.4

export default class EnvironmentPlugin extends AViewerPluginSync {
  static PluginType = 'TerminatorEnvironment'

  enabled = true
  environment = null
  ready = Promise.resolve()

  onAdded(viewer) {
    super.onAdded(viewer)
    // The editor needs candidate references. Play does not. Avoid loading the
    // large comparison rack into a short-lived runtime viewer.
    const runtimeCanvas = viewer.canvas?.classList?.contains('game-canvas-overlay')
      || viewer.canvas?.id === 'kite3d-canvas' || viewer.canvas?.id === 'playable'
    if (viewer.assetManager?.importer && !viewer.getPlugin('PickingPlugin') && runtimeCanvas) {
      const importer = viewer.assetManager.importer
      const camera = viewer.scene.mainCamera
      camera.autoNearFar = false
      camera.near = 0.05
      camera.far = 180
      camera.updateProjectionMatrix()
      if (viewer.canvas?.classList?.contains('game-canvas-overlay')) {
        viewer.renderEnabled = false
        this.enableRuntimeRender = () => {
          if (!viewer.getPlugin('EntityComponentPlugin')?.running || !window.terminator?.manager?.started) return
          viewer.removeEventListener('preFrame', this.enableRuntimeRender)
          viewer.renderEnabled = true
          viewer.setDirty()
        }
        viewer.addEventListener('preFrame', this.enableRuntimeRender)
      }
      this.importSingle = importer.importSingle
      importer.importSingle = (path, options) => String(path).startsWith('/kite3d/@candidate-')
        ? Promise.resolve(new Group())
        : this.importSingle.call(importer, path, options)
      this.hideRuntimeSources = event => event.data?.traverse?.(object => {
        if (object.userData?.candidate || object.userData?.weaponAsset || object.name==='Swingout Revolver Template'
          || object.userData?.rootPath?.startsWith('/kite3d/@unit-')) object.visible = false
      })
      importer.addEventListener('processRaw', this.hideRuntimeSources)
    }
    viewer.addEventListener('preFrame', this.applyEditorEnvironment)
    const scene = viewer.scene
    this.saved = {
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
    }
    this.ready = viewer.import(new URL('../assets/hdri/qwantani_moon_noon_puresky_2k.hdr', import.meta.url).href).then(texture => {
      if (this._viewer !== viewer) {
        texture?.dispose()
        return
      }
      this.environment = texture
      this.applyEditorEnvironment()
    }).catch(error => {
      if (this._viewer === viewer) console.error('[Environment] HDR failed to load', error)
    })
  }

  applyEditorEnvironment = () => {
    const viewer = this._viewer
    if (!viewer || !this.environment || viewer.getPlugin('EntityComponentPlugin')?.running) return
    const scene = viewer.scene
    if (scene.environment === this.environment && scene.environmentIntensity === EDITOR_ENVIRONMENT_INTENSITY) return
    scene.environment = this.environment
    scene.environmentIntensity = EDITOR_ENVIRONMENT_INTENSITY
    viewer.setDirty()
  }

  onRemove(viewer) {
    viewer.removeEventListener('preFrame', this.applyEditorEnvironment)
    if (this.enableRuntimeRender) viewer.removeEventListener('preFrame', this.enableRuntimeRender)
    if (this.hideRuntimeSources) viewer.assetManager.importer.removeEventListener('processRaw', this.hideRuntimeSources)
    if (this.importSingle) viewer.assetManager.importer.importSingle = this.importSingle
    this.hideRuntimeSources = null
    this.enableRuntimeRender = null
    this.importSingle = null
    if (viewer.scene.environment === this.environment) Object.assign(viewer.scene, this.saved)
    this.environment?.dispose()
    this.environment = null
    this.saved = null
    viewer.setDirty()
    super.onRemove(viewer)
  }
}
