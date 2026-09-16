import {readFile, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {NodeIO} from '@gltf-transform/core'

globalThis.ImageData ??= class {}
const {Box3, Vector3, Matrix4} = await import('three')
const lists = ['buffers', 'bufferViews', 'accessors', 'samplers', 'images', 'textures', 'materials', 'meshes', 'nodes']

// Rubble has a single authored visible-volume box which can be shorter than
// the nominal asset envelope. Keep its offset so a shorter fit stays grounded.
export function selectedPropFitBounds(family, entry) {
  const shape = family === 'rubble' && entry.collider?.shapes?.length === 1 ? entry.collider.shapes[0] : null
  if (shape?.shape === 'box' && !shape.yaw) return {size:{...shape.size}, center:{x:0, y:0, z:0, ...shape.offset}}
  return {size:{...entry.size}, center:{x:0, y:0, z:0}}
}

// Targeted repair of an already imported visual: no blanket rebuild, no source
// mesh/texture changes, and no edits to authored placement or anchor transforms.
export async function refitSelectedProp(root, id) {
  const selection = JSON.parse(await readFile(resolve(root, 'assets/sources/selected-assets.json'), 'utf8'))
  const asset = selection.assets.find(asset => asset.preparedModel && asset.targets.includes(id))
  if (!asset || asset.family !== 'rubble') throw new Error(`No bounded rubble refit for ${id}`)
  const manifest = JSON.parse(await readFile(resolve(root, 'assets.json'), 'utf8')).files
  const entry = JSON.parse(await readFile(resolve(root, 'lib/core/data/map-piece-registry.json'), 'utf8')).assets[id]
  const path = resolve(root, manifest[id].path), target = JSON.parse(await readFile(path, 'utf8'))
  const parent = target.nodes[target.scenes[target.scene || 0].nodes[0]]
  if (parent.extras?.selectedSource?.id !== asset.id) throw new Error(`Selected source mismatch for ${id}`)
  const wrappers = (parent.children || []).map(i => target.nodes[i]).filter(node => /^Selected rubble \d+-\d+$/.test(node.name))
  if (wrappers.length !== parent.extras.selectedSource.tileCount || !wrappers.every(node => node.matrix && !node.translation && !node.rotation && !node.scale)) throw new Error(`Unexpected fitted hierarchy for ${id}`)
  const {size, center} = selectedPropFitBounds(asset.family, entry)
  const current = await geometryBounds(root, target, dirname(path))
  const extent = current.getSize(new Vector3()), origin = current.getCenter(new Vector3())
  if (['x','y','z'].every(axis => Math.abs(extent[axis] - size[axis]) < 1e-8 && Math.abs(origin[axis] - center[axis]) < 1e-8)) return {changed:false, id}
  const scale = new Vector3(size.x, size.y, size.z).divide(extent)
  if (!scale.toArray().every(v => Number.isFinite(v) && v > 0)) throw new Error(`Invalid refit bounds for ${id}`)
  const correction = new Matrix4().makeTranslation(center.x, center.y, center.z)
    .multiply(new Matrix4().makeScale(...scale.toArray()))
    .multiply(new Matrix4().makeTranslation(...origin.clone().negate().toArray()))
  for (const node of wrappers) node.matrix = correction.clone().multiply(new Matrix4().fromArray(node.matrix)).toArray()
  parent.extras.selectedSource = {...parent.extras.selectedSource, fitBounds:[size.x,size.y,size.z], fitCenter:[center.x,center.y,center.z]}
  await writeFile(path, JSON.stringify(target, null, 2) + '\n')
  return {changed:true, id, scale:scale.toArray(), fitBounds:[size.x,size.y,size.z], fitCenter:[center.x,center.y,center.z]}
}

export async function applySelectedProps(root) {
  const path = resolve(root, 'assets/sources/selected-assets.json')
  const selection = JSON.parse(await readFile(path, 'utf8'))
  const manifest = JSON.parse(await readFile(resolve(root, 'assets.json'), 'utf8')).files
  const registry = JSON.parse(await readFile(resolve(root, 'lib/core/data/map-piece-registry.json'), 'utf8')).assets
  let changed = 0
  for (const asset of selection.assets.filter(a => a.preparedModel)) {
    const source = JSON.parse(await readFile(resolve(root, asset.preparedModel), 'utf8'))
    const bounds = await geometryBounds(root, source)
    for (const id of asset.targets) {
      const targetPath = resolve(root, manifest[id].path)
      const target = JSON.parse(await readFile(targetPath, 'utf8'))
      const rootIndex = target.scenes[target.scene || 0].nodes[0]
      const parent = target.nodes[rootIndex]
      if (parent.extras?.selectedSource?.id === asset.id) continue
      const {size, center:fitCenter} = selectedPropFitBounds(asset.family, registry[id])
      if (!size || !['rubble', 'truck', 'barrel', 'container', 'supply', 'sandbags', 'generator', 'spool'].includes(asset.family)) throw new Error(`No prop fit adapter for ${id}`)
      // Retain original names, transforms, extras and node indices as stable anchors.
      // Only their mesh references are replaced by the selected visual geometry.
      for (const node of target.nodes) delete node.mesh
      const sourceSize = bounds.getSize(new Vector3())
      const yaw = (sourceSize.x > sourceSize.z) !== (size.x > size.z) && asset.family !== 'spool' && asset.family !== 'barrel' ? Math.PI / 2 : 0
      const rotation = new Matrix4().makeRotationY(yaw)
      const rotated = bounds.clone().applyMatrix4(rotation)
      const extent = rotated.getSize(new Vector3()), center = rotated.getCenter(new Vector3())
      const tilesX = asset.family === 'rubble' ? Math.max(1, Math.ceil(size.x / 3.5)) : 1
      const tilesZ = asset.family === 'rubble' ? Math.max(1, Math.ceil(size.z / 3.5)) : 1
      const tileSize = new Vector3(size.x / tilesX, size.y, size.z / tilesZ)
      const scale = tileSize.clone().divide(extent)
      if (![...scale.toArray()].every(value => Number.isFinite(value) && value > 0)) throw new Error(`Invalid imported bounds: ${id}`)
      const offset = appendDocument(target, source)
      const sourceRoots = source.scenes[source.scene || 0].nodes.map(index => index + offset.nodes)
      const importedNodes = target.nodes.slice(offset.nodes)
      for (let x = 0; x < tilesX; x++) for (let z = 0; z < tilesZ; z++) {
        let children = sourceRoots
        if (x || z) {
          const delta = target.nodes.length - offset.nodes
          children = sourceRoots.map(index => index + delta)
          for (const node of importedNodes) {
            const copy = structuredClone(node)
            if (copy.children) copy.children = copy.children.map(index => index + delta)
            target.nodes.push(copy)
          }
        }
        const translation = new Vector3(-size.x / 2 + tileSize.x * (x + .5) + fitCenter.x, fitCenter.y, -size.z / 2 + tileSize.z * (z + .5) + fitCenter.z)
        const transform = new Matrix4().makeTranslation(...translation.toArray())
          .multiply(new Matrix4().makeScale(...scale.toArray()))
          .multiply(new Matrix4().makeTranslation(...center.clone().negate().toArray()))
          .multiply(rotation)
        const index = target.nodes.length
        target.nodes.push({name: `Selected ${asset.family} ${x + 1}-${z + 1}`, matrix: transform.toArray(), children})
        parent.children = [...(parent.children || []), index]
      }
      parent.extras = {...parent.extras, selectedSource: {id: asset.id, family: asset.family, source: asset.url, tileCount: tilesX * tilesZ, fitBounds: [size.x, size.y, size.z], fitCenter:[fitCenter.x,fitCenter.y,fitCenter.z]}}
      await writeFile(targetPath, JSON.stringify(target, null, 2) + '\n')
      changed++
    }
    asset.integration = 'model'
  }
  await writeFile(path, JSON.stringify(selection, null, 2) + '\n')
  return {changed}
}

async function geometryBounds(root, source, directory = root) {
  const clean = structuredClone(source)
  delete clean.extensions; delete clean.extensionsUsed; delete clean.extensionsRequired
  delete clean.images; delete clean.textures; delete clean.materials
  for (const mesh of clean.meshes) for (const primitive of mesh.primitives) delete primitive.material
  const resources = {}
  for (const buffer of clean.buffers) resources[buffer.uri] = new Uint8Array(await readFile(buffer.uri.startsWith('/kite3d/') ? resolve(root, buffer.uri.slice(8)) : resolve(directory, buffer.uri)))
  const doc = await new NodeIO().readJSON({json: clean, resources})
  const bounds = new Box3(), point = new Vector3()
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]
  const visit = node => {
    if (node.getMesh()) {
      const matrix = new Matrix4().fromArray(node.getWorldMatrix())
      for (const primitive of node.getMesh().listPrimitives()) {
        const positions = primitive.getAttribute('POSITION').getArray()
        for (let index = 0; index < positions.length; index += 3) bounds.expandByPoint(point.fromArray(positions, index).applyMatrix4(matrix))
      }
    }
    for (const child of node.listChildren()) visit(child)
  }
  for (const node of scene?.listChildren() || []) visit(node)
  return bounds
}

function appendDocument(target, source) {
  const offset = Object.fromEntries(lists.map(key => [key, target[key]?.length || 0]))
  const incoming = structuredClone(source)
  for (const view of incoming.bufferViews || []) view.buffer += offset.buffers
  for (const accessor of incoming.accessors || []) {
    if (accessor.bufferView !== undefined) accessor.bufferView += offset.bufferViews
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView += offset.bufferViews
      accessor.sparse.values.bufferView += offset.bufferViews
    }
  }
  for (const image of incoming.images || []) if (image.bufferView !== undefined) image.bufferView += offset.bufferViews
  for (const texture of incoming.textures || []) {
    if (texture.source !== undefined) texture.source += offset.images
    if (texture.sampler !== undefined) texture.sampler += offset.samplers
  }
  for (const material of incoming.materials || []) offsetTextureInfos(material, offset.textures)
  for (const mesh of incoming.meshes || []) for (const primitive of mesh.primitives) {
    for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] += offset.accessors
    if (primitive.indices !== undefined) primitive.indices += offset.accessors
    if (primitive.material !== undefined) primitive.material += offset.materials
    for (const target of primitive.targets || []) for (const key of Object.keys(target)) target[key] += offset.accessors
  }
  for (const node of incoming.nodes || []) {
    if (node.mesh !== undefined) node.mesh += offset.meshes
    if (node.children) node.children = node.children.map(index => index + offset.nodes)
  }
  for (const key of lists) if (incoming[key]) target[key] = [...(target[key] || []), ...incoming[key]]
  for (const key of ['extensionsUsed', 'extensionsRequired']) if (incoming[key]) target[key] = [...new Set([...(target[key] || []), ...incoming[key]])]
  return offset
}

function offsetTextureInfos(value, offset) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith('Texture') && child?.index !== undefined) child.index += offset
    else offsetTextureInfos(child, offset)
  }
}
