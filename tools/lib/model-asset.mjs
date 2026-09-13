import {Accessor, Document, NodeIO} from '@gltf-transform/core'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {relative, resolve} from 'node:path'

export async function writeModelAsset({projectRoot, manifest, assetId, directory, slug, object, generator}) {
  const outputDirectory = resolve(projectRoot, directory)
  const gltfPath = resolve(outputDirectory, `${slug}.gltf`)
  const binPath = resolve(outputDirectory, `${slug}.bin`)
  await mkdir(outputDirectory, {recursive: true})

  const document = new Document()
  const buffer = document.createBuffer(`${object.name} geometry`).setURI(`${slug}.bin`)
  const materialCache = new Map()
  document.createScene(object.name).addChild(exportNode(object))
  await new NodeIO().write(gltfPath, document)

  const json = JSON.parse(await readFile(gltfPath, 'utf8'))
  json.asset.generator = generator
  await writeFile(gltfPath, `${JSON.stringify(json, null, 2)}\n`)

  const projectGltf = projectPath(projectRoot, gltfPath)
  const projectBin = projectPath(projectRoot, binPath)
  manifest.files[assetId] = {
    path: projectGltf,
    files: {'f.gltf': projectGltf, [`${slug}.bin`]: projectBin},
  }
  return {gltfPath, binPath}

  function exportNode(source) {
    const node = document.createNode(source.name || 'Asset node')
    node.setTranslation(source.position.toArray())
    node.setRotation(source.quaternion.toArray())
    node.setScale(source.scale.toArray())
    if (!source.visible) node.setExtras({...(source.userData || {}), visible: false})
    else if (Object.keys(source.userData || {}).length) node.setExtras({...source.userData})
    if (source.isMesh) {
      const primitive = document.createPrimitive()
      for (const [attributeName, semantic, type] of [
        ['position', 'POSITION', Accessor.Type.VEC3],
        ['normal', 'NORMAL', Accessor.Type.VEC3],
        ['uv', 'TEXCOORD_0', Accessor.Type.VEC2],
      ]) {
        const attribute = source.geometry.getAttribute(attributeName)
        if (!attribute) continue
        primitive.setAttribute(semantic, document.createAccessor(`${source.name} ${semantic}`, buffer)
          .setType(type).setArray(new Float32Array(attribute.array)))
      }
      if (source.geometry.index) {
        const values = source.geometry.index.array
        const IndexArray = values.length > 65535 ? Uint32Array : Uint16Array
        primitive.setIndices(document.createAccessor(`${source.name} indices`, buffer)
          .setType(Accessor.Type.SCALAR).setArray(new IndexArray(values)))
      }
      primitive.setMaterial(exportMaterial(source.material))
      node.setMesh(document.createMesh(source.name || 'Asset mesh').addPrimitive(primitive))
    }
    for (const child of source.children) node.addChild(exportNode(child))
    return node
  }

  function exportMaterial(source) {
    if (materialCache.has(source)) return materialCache.get(source)
    const color = source.color?.toArray() || [1, 1, 1]
    const material = document.createMaterial(source.name || 'Asset material')
      .setBaseColorFactor([...color, source.opacity ?? 1])
      .setMetallicFactor(source.metalness ?? 0)
      .setRoughnessFactor(source.roughness ?? 1)
    if (source.emissive) material.setEmissiveFactor(source.emissive.toArray())
    if (source.transparent) material.setAlphaMode('BLEND')
    if (source.side === 2) material.setDoubleSided(true)
    materialCache.set(source, material)
    return material
  }
}

function projectPath(root, path) {
  return relative(root, path).split('\\').join('/')
}
