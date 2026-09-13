import {readFile, writeFile, access} from 'node:fs/promises'
import {resolve} from 'node:path'

const maps = {diff: 'hangar_concrete_floor_diff_1k.jpg', nor_gl: 'hangar_concrete_floor_nor_gl_1k.jpg', arm: 'hangar_concrete_floor_arm_1k.jpg'}

/** Patch the saved model assets, preserving scene IDs, transforms and geometry. */
export async function applySelectedFloor(root) {
  for (const file of Object.values(maps)) await access(resolve(root, 'assets/textures/map', file))
  const manifest = JSON.parse(await readFile(resolve(root, 'assets.json'), 'utf8'))
  const registry = JSON.parse(await readFile(resolve(root, 'lib/core/data/map-piece-registry.json'), 'utf8'))
  const selected = JSON.parse(await readFile(resolve(root, 'assets/sources/selected-assets.json'), 'utf8')).assets.find(a => a.family === 'floor')
  let changed = 0
  for (const id of selected.targets) {
    const spec = registry.assets[id]
    if (spec?.kind !== 'floor' || !manifest.files[id]) throw new Error(`Selected floor asset is missing: ${id}`)
    const path = resolve(root, manifest.files[id].path)
    const before = await readFile(path, 'utf8')
    const gltf = JSON.parse(before)
    const scale = [spec.size.x / 2, spec.size.z / 2]
    for (const material of gltf.materials || []) {
      const pbr = material.pbrMetallicRoughness
      if (!pbr?.baseColorTexture || !pbr.metallicRoughnessTexture || !material.normalTexture || !material.occlusionTexture) throw new Error(`Floor asset lacks PBR texture slots: ${id}`)
      pbr.baseColorFactor = [0.65, 0.65, 0.65, 1]
      pbr.metallicFactor = 0
      pbr.roughnessFactor = 1
      for (const [info, channel] of [[pbr.baseColorTexture, 'diff'], [material.normalTexture, 'nor_gl'], [pbr.metallicRoughnessTexture, 'arm'], [material.occlusionTexture, 'arm']]) {
        const texture = gltf.textures[info.index]
        const image = gltf.images[texture.source]
        image.name = maps[channel]
        image.uri = `/kite3d/assets/textures/map/${maps[channel]}`
        // The slab top uses X/Z UV axes. Repeat at the source's two-meter scale.
        info.extensions = {...info.extensions, KHR_texture_transform: {...info.extensions?.KHR_texture_transform, scale}}
      }
    }
    gltf.extensionsUsed = [...new Set([...(gltf.extensionsUsed || []), 'KHR_texture_transform'])]
    const after = JSON.stringify(gltf, null, 2) + '\n'
    if (after !== before) { await writeFile(path, after); changed++ }
  }
  return {floorAssets: selected.targets.length, changed}
}
