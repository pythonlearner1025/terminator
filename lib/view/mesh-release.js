// Dropping a mesh is not enough to free it.
//
// threepipe subscribes every mesh to its own geometry. `iObjectCommons.setGeometry`
// adds a `geometryUpdate` listener that closes over the mesh, and removes that
// listener only when the same mesh is later given a different geometry. A mesh
// that is simply removed from its parent stays in
// `geometry._listeners.geometryUpdate` for as long as the geometry lives, so
// every shared, pooled or still-drawn geometry keeps a chain of dead meshes,
// and each dead mesh keeps its materials, textures and children. A heap
// snapshot of a long match showed 752 geometries carrying 2,615 such callbacks
// and retaining 773 dead objects, and it was the only shape that grew with
// play time.
//
// `removeFromParent()` does clear the viewer's own bookkeeping
// (`Object3DManager` drops the mesh from `geometry.appliedMeshes` and the
// geometry from `_geometries` when the last mesh leaves), but it never touches
// the listener. Clearing the geometry reference is what unsubscribes the mesh.
//
// Call these in stop and dispose paths, after any `geometry.dispose()` the path
// already does, since the reference is gone afterwards. They are no-ops on a
// mesh three never upgraded and on one already cleared.

/** Unsubscribe one mesh from its geometry. Returns the geometry it held. */
export function releaseMesh(object) {
  if (!object?.isMesh && !object?.isLine && !object?.isPoints) return null
  const geometry = object.geometry
  if (!geometry) return null
  // The property setter is threepipe's own unsubscribe path: it removes the
  // listener, clears `_currentGeometry`, and lets Object3DManager drop the mesh
  // from `appliedMeshes` when the mesh is still registered.
  object.geometry = undefined
  return geometry
}

/** Unsubscribe every mesh in a subtree. Returns how many were released. */
export function releaseSubtree(root) {
  if (!root?.traverse) return 0
  // traverse() reads children, not geometry, so clearing as we go is safe.
  let released = 0
  root.traverse(object => {
    if (releaseMesh(object)) released += 1
  })
  return released
}

// Same job, for a caller that holds one object and does not care whether it is
// a single mesh or the root of a subtree. Returns how many meshes were
// released, so a caller can assert the release happened.
export function releaseMeshGeometry(object) {
  if (!object) return 0
  if (object.traverse) return releaseSubtree(object)
  return releaseMesh(object) ? 1 : 0
}

// How many meshes a geometry still holds open. Tests assert this is zero after
// a release; nothing in the game reads it.
export function geometryListeners(geometry) {
  return geometry?._listeners?.geometryUpdate?.length || 0
}
