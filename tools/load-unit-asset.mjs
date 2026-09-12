import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const UNIT_ASSET_TYPES = ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank', 'soldier']

const root = fileURLToPath(new URL('../', import.meta.url))
const cache = new Map()

export function loadUnitAsset(type) {
  if (!UNIT_ASSET_TYPES.includes(type)) throw new Error(`Unknown unit asset type: ${type}`)
  let loading = cache.get(type)
  if (!loading) {
    loading = load(type)
    cache.set(type, loading)
  }
  return loading
}

export async function loadUnitFigure(type, detail = 'high') {
  const source = await loadUnitAsset(type)
  globalThis.window ??= {}
  const {clonePlacedUnitFigure} = await import('../lib/view/unit-assets.js')
  return clonePlacedUnitFigure(source, type, detail)
}

async function load(type) {
  globalThis.ImageData ??= class ImageData {}
  globalThis.self ??= globalThis
  globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(eventType, init = {}) { this.type = eventType; Object.assign(this, init) }
  }
  const [{GLTFLoader}, manifest] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    readFile(resolve(root, 'assets.json'), 'utf8').then(JSON.parse),
  ])
  const entry = manifest.files?.[`unit-${type}`]
  if (!entry?.path || !entry.files) throw new Error(`assets.json is missing unit-${type}`)
  const document = JSON.parse(await readFile(resolve(root, entry.path), 'utf8'))
  for (const buffer of document.buffers || []) {
    const projectPath = entry.files[buffer.uri]
    if (!projectPath) throw new Error(`unit-${type} does not map ${buffer.uri}`)
    const bytes = await readFile(resolve(root, projectPath))
    buffer.uri = `data:application/octet-stream;base64,${bytes.toString('base64')}`
  }
  // Collider and unit tests do not need decoded pixels. Material texture URIs are
  // checked directly in the glTF document by the round-trip test.
  delete document.images
  delete document.textures
  for (const material of document.materials || []) {
    delete material.normalTexture
    delete material.occlusionTexture
    delete material.emissiveTexture
    delete material.pbrMetallicRoughness?.baseColorTexture
    delete material.pbrMetallicRoughness?.metallicRoughnessTexture
  }
  const result = await new Promise((accept, reject) => {
    new GLTFLoader().parse(JSON.stringify(document), '', accept, reject)
  })
  result.scene.traverse(object => {
    if (typeof object.userData.name === 'string') object.name = object.userData.name
    const extras = object.userData.gltfExtensions?.WEBGI_object3d_extras
    if (extras?.visible !== undefined) object.visible = extras.visible
  })
  return result.scene
}
