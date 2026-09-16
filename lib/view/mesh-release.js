// Dropping a mesh is not enough to let go of it.
//
// threepipe upgrades every object that enters the scene and, from then on, the
// mesh's `geometry` property is an accessor: assigning a geometry adds a
// `geometryUpdate` listener to it, and the listener is removed only when that
// same mesh is later given a *different* geometry. A mesh that is simply
// forgotten is still reachable from the geometry's listener list, and the
// geometry stays in the renderer's list for the life of the page. A heap
// snapshot of a long match showed 752 geometries carrying 2,615 such callbacks
// and retaining 773 dead objects, and it was the only shape that grew with
// play time.
//
// Clearing the reference removes the listener and lets both sides go. Call it
// on any mesh, or any subtree, that a dispose or stop path is about to drop.
// It is a no-op on a mesh three never upgraded and on one already cleared.
export function releaseMeshGeometry(object) {
  if (!object) return 0
  let released = 0
  const clear = node => {
    if (!node || !(node.isMesh || node.isLine || node.isPoints) || !node.geometry) return
    node.geometry = null
    released += 1
  }
  if (typeof object.traverse === 'function') object.traverse(clear)
  else clear(object)
  return released
}

// How many meshes a geometry still holds open. Tests assert this is zero after
// a release; nothing in the game reads it.
export function geometryListeners(geometry) {
  return geometry?._listeners?.geometryUpdate?.length || 0
}
