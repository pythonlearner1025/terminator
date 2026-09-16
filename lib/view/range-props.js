import {RANGE_START} from '../core/range.js'
import {releaseSubtree} from './mesh-release.js'

export const RANGE_PLATES = Object.freeze([-25, -22.5, -20, -17.5, -15, -10].map((z, index) =>
  Object.freeze({id: `range-plate-${index + 1}`, x: RANGE_START.x + 15, y: 1.8, z})))

// Range mode places file-backed fixtures at Play. The range is not authored Bunker 7 content.
export function createRangeProps(engine, viewer) {
  const root = new engine.Group()
  root.name = 'Range steel targets and firing line'
  root.plates = RANGE_PLATES.map(spec => ({...spec, pivot: new engine.Group(), lastHit: -Infinity, hits: 0}))
  let disposed = false
  root.disposeRangeProps = () => { disposed = true }
  root.ready = Promise.all([
    viewer.import('/kite3d/@range-steel-target/f.gltf', {cacheAsset: false}),
    viewer.import('/kite3d/@range-firing-line/f.gltf', {cacheAsset: false}),
  ]).then(([targetAsset, lineAsset]) => {
    if (!targetAsset || !lineAsset) throw new Error('Range fixture assets did not load')
    if (disposed) {
      disposeImported(targetAsset)
      disposeImported(lineAsset)
      return root
    }
    for (const plate of root.plates) {
      const stand = targetAsset.clone(true)
      stand.name = plate.id
      stand.position.set(plate.x, 0, plate.z)
      stand.rotation.y = Math.PI / 2
      const pivot = stand.getObjectByName('Plate Pivot') || stand.getObjectByName('Plate_Pivot')
      if (!pivot) throw new Error('Range steel target asset is missing Plate Pivot')
      plate.pivot = pivot
      root.add(stand)
    }
    lineAsset.name = 'Range firing line'
    lineAsset.position.set(RANGE_START.x, .012, -18)
    root.add(lineAsset)
    return root
  })
  return root
}

function disposeImported(root) {
  const resources = new Set()
  root.traverse(object => {
    if (object.geometry) resources.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) resources.add(material)
  })
  for (const resource of resources) resource.dispose?.()
  releaseSubtree(root)
}
