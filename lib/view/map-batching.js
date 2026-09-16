import {releaseMesh} from './mesh-release.js'
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
      const group = materialGroups.get(key) || {material: sharedMaterials.byKey.get(key), geometries: [], entries: [], count: 0}
      // Record ownership at the append site, in the exact normalized draw order.
      const piece = placement.userData.mapPiece
      const count = geometry.getAttribute('position').count
      if (!Number.isInteger(count) || count % 3) throw new Error(`Non-triangle source draw for ${piece.id}`)
      if (count) group.entries.push({start: group.count, count, pieceId: piece.id,
        nodeId: piece.nodeId ?? null, assetId: piece.assetId, role: piece.role})
      group.count += count
      group.geometries.push(geometry)
      materialGroups.set(key, group)
    })
  }

  const batches = []
  for (const [key, {material, geometries, entries, count}] of materialGroups) {
    const geometry = api.mergeGeometries(geometries, false)
    for (const item of geometries) item.dispose()
    if (!geometry) throw new Error(`Could not merge placed map material ${key}`)
    if (geometry.getAttribute('position').count !== count) {
      geometry.dispose()
      throw new Error(`Incomplete source ranges for material ${key}`)
    }
    geometry.userData = {...geometry.userData, mapSourceRanges: {version: 1, unit: 'draw-elements', entries}}
    const mesh = new api.Mesh2(geometry, material)
    mesh.name = `Static placed map ${material.name || key}`
    mesh.castShadow = material.transparent !== true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    runtimeRoot.add(mesh)
    batches.push(mesh)
  }
  // The rewrite injects nested asset contents while their authored root stays
  // registered. Removing that root tears down the injected hierarchy, so keep
  // authored placements attached and hidden while Play owns the visible batch.
  let restored = false
  return {
    batches,
    dynamic,
    placements,
    sharedMaterials,
    restore() {
      if (restored) return
      restored = true
      for (const [object, visible] of hidden) object.visible = visible
    },
    dispose() {
      this.restore()
      for (const mesh of batches) {mesh.geometry.dispose(); releaseMesh(mesh)}
    },
  }
}

function canonicalizePlacedMaterials(placements) {
  const canonical = new Map()
  for (const placement of placements) placement.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material) return
    if (Array.isArray(mesh.material)) throw new Error(`Map piece ${placement.name} uses unsupported material groups`)
    const key = materialKey(mesh.material)
    if (!canonical.has(key)) canonical.set(key, mesh.material)
  })
  return {byKey: canonical, materials: canonical.size, disposedMaterials: 0, disposedTextures: 0}
}

function isDynamic(role) {
  return ['door', 'gate', 'hazard', 'flank', 'trader', 'fixture'].includes(role)
}

// Two placed pieces share a batch only when one material can stand for both.
// The old key was the material name plus five texture slots, which merged two
// materials that happened to share a name and split identical materials that
// did not. Key on what the shader actually reads: every render-state flag,
// every PBR factor, every texture slot, and the userData flags the game's own
// passes branch on. The name is a label, not an identity.
const FLAGS = ['side', 'transparent', 'opacity', 'alphaTest', 'alphaHash', 'depthWrite', 'depthTest', 'blending',
  'premultipliedAlpha', 'wireframe', 'flatShading', 'vertexColors', 'toneMapped', 'dithering', 'forceSinglePass',
  'shadowSide', 'alphaToCoverage', 'fog', 'normalMapType', 'combine', 'wireframeLinewidth']
const FACTORS = ['emissiveIntensity', 'roughness', 'metalness', 'envMapIntensity', 'aoMapIntensity', 'lightMapIntensity',
  'bumpScale', 'displacementScale', 'displacementBias', 'reflectivity', 'refractionRatio', 'ior', 'iridescence',
  'iridescenceIOR', 'sheen', 'sheenRoughness', 'clearcoat', 'clearcoatRoughness', 'transmission', 'thickness',
  'attenuationDistance', 'specularIntensity', 'anisotropy', 'anisotropyRotation', 'dispersion']
const COLORS = ['color', 'emissive', 'sheenColor', 'attenuationColor', 'specularColor']
const VECTORS = ['normalScale', 'clearcoatNormalScale', 'iridescenceThicknessRange']
const TEXTURE_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap',
  'bumpMap', 'displacementMap', 'lightMap', 'envMap', 'specularMap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'sheenColorMap', 'sheenRoughnessMap',
  'iridescenceMap', 'iridescenceThicknessMap', 'specularColorMap', 'specularIntensityMap', 'anisotropyMap']
// Flags the project's own render passes and shader extensions read off a material.
const USER_DATA_FLAGS = ['renderToGBuffer', 'ssaoDisabled', 'ssaoCastDisabled', 'separateEnvMapIntensity']

function materialKey(material) {
  return JSON.stringify([
    material.type,
    material.constructor?.name || '',
    FLAGS.map(key => material[key] ?? null),
    FACTORS.map(key => material[key] ?? null),
    COLORS.map(key => material[key]?.getHex?.() ?? null),
    VECTORS.map(key => material[key]?.toArray?.() ?? null),
    // glTF texture transforms can differ between slabs that share an image/name.
    // Keep those materials separate so Play preserves the editor's texture scale.
    TEXTURE_SLOTS.map(key => textureKey(material[key])),
    USER_DATA_FLAGS.map(key => material.userData?.[key] ?? null),
    // A material extension rewrites the shader; two materials with different
    // extension sets are different programs whatever their factors say.
    (material.materialExtensions || []).map(extension => extension.uuid || extension.computeCacheKey || '').sort(),
  ])
}

function textureKey(texture) {
  if (!texture) return ''
  return JSON.stringify([
    texture.userData?.rootPath || texture.source?.data?.src || texture.name || '',
    texture.channel, texture.wrapS, texture.wrapT, texture.magFilter, texture.minFilter,
    texture.colorSpace, texture.flipY, texture.anisotropy, texture.premultiplyAlpha,
    texture.offset?.toArray(), texture.repeat?.toArray(), texture.center?.toArray(), texture.rotation,
    texture.matrixAutoUpdate === false ? texture.matrix?.elements : null,
  ])
}

function normalizeBatchGeometry(api, geometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (!['position', 'normal', 'uv', 'uv1', 'uv2', 'color'].includes(name)) geometry.deleteAttribute(name)
  }
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
  if (!geometry.getAttribute('uv')) {
    geometry.setAttribute('uv', new api.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2))
  }
  for (const name of ['uv1', 'uv2']) {
    if (!geometry.getAttribute(name)) geometry.setAttribute(name, geometry.getAttribute('uv').clone())
  }
  // Imported glTF materials can enable vertex colors (including vertex alpha).
  // Dropping that attribute leaves their shader with zero color and black props.
  const sourceColor = geometry.getAttribute('color')
  const colors = new Float32Array(geometry.getAttribute('position').count * 4).fill(1)
  if (sourceColor) for (let index = 0; index < sourceColor.count; index++) {
    for (let component = 0; component < sourceColor.itemSize; component++) colors[index * 4 + component] = sourceColor.getComponent(index, component)
  }
  geometry.setAttribute('color', new api.Float32BufferAttribute(colors, 4))
  for (const name of ['position', 'normal', 'uv', 'uv1', 'uv2']) {
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
