// Edit mode keeps placed asset roots unchanged. Play clones dynamic pieces and merges static meshes.
export function batchPlacedMap(api, source, runtimeRoot) {
  source.updateWorldMatrix(true, true)
  runtimeRoot.updateWorldMatrix(true, false)
  const inverse = source.matrixWorld.clone().invert()
  const materialGroups = new Map()
  const dynamic = []
  const hidden = []
  const placements = []

  source.traverse(object => {
    const piece = object.userData?.mapPiece
    if (!piece?.assetId) return
    placements.push(object)
  })
  const sharedMaterials = canonicalizePlacedMaterials(placements)

  for (const placement of placements) {
    hidden.push([placement, placement.visible])
    placement.visible = false
    if (isDynamic(placement.userData.mapPiece.role)) {
      const clone = placement.clone(true)
      clone.name = placement.name
      clone.userData = {...placement.userData}
      placement.updateWorldMatrix(true, true)
      const matrix = inverse.clone().multiply(placement.matrixWorld)
      matrix.decompose(clone.position, clone.quaternion, clone.scale)
      runtimeRoot.add(clone)
      dynamic.push(clone)
      continue
    }
    placement.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry || !mesh.material) return
      mesh.updateWorldMatrix(true, false)
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      geometry.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld))
      normalizeBatchGeometry(api, geometry)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.length !== 1) throw new Error(`Map piece ${placement.name} uses unsupported material groups`)
      const material = materials[0]
      const key = materialKey(material)
      const group = materialGroups.get(key) || {material, geometries: []}
      group.geometries.push(geometry)
      materialGroups.set(key, group)
    })
  }

  const batches = []
  for (const [key, {material, geometries}] of materialGroups) {
    const geometry = api.mergeGeometries(geometries, false)
    for (const item of geometries) item.dispose()
    if (!geometry) throw new Error(`Could not merge placed map material ${key}`)
    const mesh = new api.Mesh2(geometry, material)
    mesh.name = `Static placed map ${material.name || key}`
    mesh.castShadow = material.transparent !== true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    runtimeRoot.add(mesh)
    batches.push(mesh)
  }
  return {
    batches,
    dynamic,
    placements,
    sharedMaterials,
    restore() {
      for (const [object, visible] of hidden) object.visible = visible
    },
  }
}

function canonicalizePlacedMaterials(placements) {
  const canonical = new Map()
  const replaced = new Set()
  for (const placement of placements) placement.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material) return
    if (Array.isArray(mesh.material)) throw new Error(`Map piece ${placement.name} uses unsupported material groups`)
    const key = materialKey(mesh.material)
    const shared = canonical.get(key)
    if (!shared) {
      canonical.set(key, mesh.material)
      return
    }
    if (mesh.material === shared) return
    replaced.add(mesh.material)
    mesh.material = shared
  })
  const protectedTextures = new Set()
  for (const material of canonical.values()) for (const value of Object.values(material)) if (value?.isTexture) protectedTextures.add(value)
  const disposedTextures = new Set()
  for (const material of replaced) {
    for (const value of Object.values(material)) {
      if (!value?.isTexture || protectedTextures.has(value) || disposedTextures.has(value)) continue
      value.dispose()
      disposedTextures.add(value)
    }
    material.dispose()
  }
  return {materials: canonical.size, disposedMaterials: replaced.size, disposedTextures: disposedTextures.size}
}

function isDynamic(role) {
  return ['door', 'gate', 'hazard', 'flank', 'trader', 'fixture'].includes(role)
}

function materialKey(material) {
  return [
    material.name,
    material.transparent ? 'transparent' : 'opaque',
    material.side,
    material.map?.userData?.rootPath || material.map?.source?.data?.src || material.map?.name || '',
    // glTF texture transforms can differ between slabs that share an image/name.
    // Keep those materials separate so Play preserves the editor's texture scale.
    ...[material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap].map(textureKey),
  ].join('|')
}

function textureKey(texture) {
  if (!texture) return ''
  return JSON.stringify([
    texture.userData?.rootPath || texture.source?.data?.src || texture.name || '',
    texture.channel, texture.wrapS, texture.wrapT,
    texture.offset?.toArray(), texture.repeat?.toArray(), texture.center?.toArray(), texture.rotation,
    texture.matrixAutoUpdate === false ? texture.matrix?.elements : null,
  ])
}

function normalizeBatchGeometry(api, geometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name)
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new api.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
  }
  for (const name of ['position', 'normal', 'uv']) {
    const source = geometry.getAttribute(name)
    const values = new Float32Array(source.count * source.itemSize)
    for (let index = 0; index < source.count; index += 1) {
      for (let component = 0; component < source.itemSize; component += 1) {
        values[index * source.itemSize + component] = source.getComponent(index, component)
      }
    }
    geometry.setAttribute(name, new api.Float32BufferAttribute(values, source.itemSize))
  }
  geometry.morphAttributes = {}
  geometry.morphTargetsRelative = false
  geometry.clearGroups()
}
