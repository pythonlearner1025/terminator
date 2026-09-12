// Batch static children in an animated local frame. Signals, lids, arcs and lights retain identity.
export function batchLocalMeshes(api, root, protectedNodes = new Set()) {
  root.updateWorldMatrix(true, true)
  const inverse = root.matrixWorld.clone().invert(), batches = new Map()
  function collect(node) {
    for (const child of [...node.children]) {
      if (protectedNodes.has(child) || child.isPoints || child.isLight || child.isLine) continue
      if (!child.isMesh) { collect(child); continue }
      if (child.material.transparent) continue
      const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone())
      geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld))
      if (!batches.has(child.material)) batches.set(child.material, [])
      batches.get(child.material).push(geometry)
      child.geometry.dispose(); child.removeFromParent()
    }
  }
  collect(root)
  for (const [material, geometries] of batches) {
    const geometry = api.mergeGeometries(geometries, false)
    for (const part of geometries) part.dispose()
    if (!geometry) throw new Error(`Cannot batch ${root.name}: ${material.name}`)
    const mesh = new api.Mesh2(geometry, material)
    mesh.name = `${root.name} ${material.name}`
    mesh.castShadow = true; mesh.receiveShadow = true
    root.add(mesh)
  }
}

export function bevelMapBox(api, size) {
  const geometry = new api.BoxGeometry(...size, 2, 2, 2)
  const radius = Math.min(.035, Math.min(...size) * .08)
  const positions = geometry.attributes.position, normals = geometry.attributes.normal
  for (let i = 0; i < positions.count; i++) {
    const p = [positions.getX(i), positions.getY(i), positions.getZ(i)]
    const inset = p.map((v, axis) => Math.max(-size[axis] / 2 + radius, Math.min(size[axis] / 2 - radius, v)))
    const d = p.map((v, axis) => v - inset[axis]), length = Math.hypot(...d)
    const n = d.map(v => v / length)
    positions.setXYZ(i, ...inset.map((v, axis) => v + n[axis] * radius))
    normals.setXYZ(i, ...n)
  }
  return geometry
}
