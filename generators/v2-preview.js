import rules from '../lib/core/data/map.json' with {type: 'json'}
import registry from '../lib/core/data/map-piece-registry.json' with {type: 'json'}
import {scenePlacements} from '../lib/core/map.js'
import {buildV2PlayableMap} from '../lib/core/v2-map.js'
import {mountV2Architecture} from '../lib/view/v2/architecture.js'
import {mountV2Ground} from '../lib/view/v2/ground.js'

// Runtime creates its own independent copy. Let the module release its owned
// resources before the engine's generic Generator disposal visits borrowed maps.
export default async function generate({node, viewer, engine}) {
  const source = viewer.scene.modelRoot.getObjectByName('Map')
  if (!source) throw new Error('V2 preview requires the authored Map')
  const root = new engine.Group()
  root.name = 'V2 stopped ruined architecture'
  node.add(root)
  const map = buildV2PlayableMap(rules, registry, scenePlacements(source))
  const handles = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const handle of handles.reverse()) handle.dispose()
    handles.length = 0
  }
  root.addEventListener('removed', () => {
    if (!root.userData.v2PreviewDetached) dispose()
  })
  try {
    const context = {viewer, root, map, refs: {}, preview: true}
    const architecture = mountV2Architecture(context)
    handles.push(architecture)
    await architecture.ready
    if (disposed) return root
    if (architecture.root?.userData?.aggregateFragments?.length) throw new Error('Ground would duplicate the architecture preview fine field')
    const ground = mountV2Ground(context)
    handles.push(ground)
    await ground.ready
    if (disposed) return root
  } catch (error) { dispose(); root.removeFromParent(); throw error }
  // Kite3D's authoring camera can retain the plugin's [0,0,10] initial pose
  // after glTF import. Honor the existing saved overview, without editing it.
  // EditModePlugin is absent from the actual Play runtime.
  const editMode = viewer.getPlugin?.('EditModePlugin')
  const savedCamera = viewer.scene.modelRoot.getObjectByName('Saved Overview Camera')
    || viewer.scene.modelRoot.getObjectByName('Saved_Overview_Camera')
  if (editMode && savedCamera?.isCamera) {
    for (const camera of [viewer.scene.defaultCamera, editMode.cameraPerspective]) {
      camera.position.copy(savedCamera.position)
      camera.quaternion.copy(savedCamera.quaternion)
      camera.target?.set(0, 0, 0)
      camera.setDirty?.({source: 'V2 saved overview', change: 'transform'})
    }
  }
  return root
}
