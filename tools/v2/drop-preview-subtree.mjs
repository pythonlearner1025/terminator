#!/usr/bin/env node
// Turn the authored "V2 Environment Preview" node into a stand-in.
//
// The node used to carry `extras.rootPath`, so every editor load imported
// `assets/v2/performance/preview-019/preview.gltf`: 341 meshes and 121.3 MB of
// vertex data that Play never draws. Play borrowed that geometry when the baked
// map key matched, and rebuilt the same geometry from the recipes
// (`assets/v2/architecture/*.json`, `assets/v2/ground/fragments.json`) when it
// did not. `test/view/baked-environment.test.js` proves both paths produce
// byte-identical triangles, so dropping the import costs nothing visible.
//
// What stays: the node, its name, `gltfUUID`, `kite3dAuthoring` and
// `kite3dBakedFrom`. The authoring rule wants a stopped-mode representation of
// every meaningful system; a named empty group is one, and the bake provenance
// stays readable in the scene file.
//
//   node tools/v2/drop-preview-subtree.mjs [--check]
import {readFile, writeFile} from 'node:fs/promises'

const UUID = 'terminator-v2-environment-preview'
const scenePath = new URL('../../assets/main.scene.gltf', import.meta.url)
const check = process.argv.includes('--check')

const text = await readFile(scenePath, 'utf8')
const document = JSON.parse(text)
const node = document.nodes.find(item => item.extras?.gltfUUID === UUID)
if (!node) throw new Error(`Scene has no node with gltfUUID ${UUID}`)

const had = ['rootPath', 'rootPathOptions'].filter(key => key in node.extras)
if (check) {
  if (had.length) throw new Error(`V2 Environment Preview still imports ${node.extras.rootPath}`)
  console.log('ok: V2 Environment Preview is a stand-in')
  process.exit(0)
}
if (!had.length) {
  console.log('already a stand-in; nothing to do')
  process.exit(0)
}

// Merge extras, never replace them: components and stable ids live here.
const extras = {...node.extras}
for (const key of had) delete extras[key]
extras.v2PreviewStandIn = 'Runtime builds this from the baked recipes; see tools/v2/drop-preview-subtree.mjs'
node.extras = extras
if (node.children?.length) throw new Error('Preview node has authored children; refusing to drop them')

// The editor writes stable, pretty JSON with two-space indent and a newline.
await writeFile(scenePath, JSON.stringify(document, null, 2) + '\n')
console.log(`dropped ${had.join(', ')} from "${node.name}"`)
