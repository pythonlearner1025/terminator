/** Add only the V2 Generator node; preserve all existing node/component IDs and extensions. */
import {readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const root = process.cwd()
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const scenePath = resolve(root, pkg.mainScene)
const scene = JSON.parse(await readFile(scenePath, 'utf8'))
const id = 'terminator-v2-environment-preview'
let index = scene.nodes.findIndex(node => node.extras?.gltfUUID === id)
if (index < 0) {
  index = scene.nodes.length
  scene.nodes.push({name: 'V2 Environment Preview', extras: {
    gltfUUID: id,
    kite3dAuthoring: {role: 'generator', id},
    EntityComponentPlugin: {'terminator-v2-preview-generator': {type: 'Generator', state: {module: 'generators/v2-preview.js', params: {}}}},
  }})
  scene.scenes[scene.scene || 0].nodes.push(index)
}
await writeFile(scenePath, JSON.stringify(scene, null, 2) + '\n')
console.log(`V2 preview node ${index}; existing node and component records preserved`)
