// CPU-only recovery for ten imported children whose editor deletions were not saved.
// Run: node tools/preserve-editor-rubble-deletions.mjs (safe to repeat).
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const assetId = 'map-rubble-1x1p5x12-zh655b';
const assetPath = new URL('assets/models/map/rubble-1x1p5x12-zh655b/rubble-1x1p5x12-zh655b.gltf', root);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const scene = readJson(new URL(readJson(new URL('package.json', root)).mainScene, root));
const referencesAsset = (value) => typeof value === 'string'
  ? value.includes('rubble-1x1p5x12-zh655b')
  : value !== null && typeof value === 'object' && Object.values(value).some(referencesAsset);
const instances = scene.nodes.filter(referencesAsset);
assert.equal(instances.length, 1, 'Expected exactly one scene node referencing this asset');
assert.equal(instances[0].name.replaceAll('_', ' '), 'Rubble bank 1');
assert.equal(instances[0].extras.rootPath, `/kite3d/@${assetId}/f.gltf`);
assert.equal(instances[0].extras.mapPiece.assetId, assetId);

// Reject repeated node paths as well as cycles: one referencing node must mean one instance.
function reachable(document, roots) {
  const seen = new Set();
  function visit(index) {
    assert(document.nodes[index], `Missing node ${index}`);
    assert(!seen.has(index), `Repeated node path at ${index}`);
    seen.add(index);
    for (const child of document.nodes[index].children ?? []) visit(child);
  }
  roots.forEach(visit);
  return seen;
}
const sceneRoots = scene.scenes[scene.scene ?? 0].nodes;
assert(reachable(scene, sceneRoots).has(scene.nodes.indexOf(instances[0])), 'Instance must be reachable');

const original = readFileSync(assetPath, 'utf8');
const asset = JSON.parse(original);
assert.equal(original, JSON.stringify(asset, null, 2) + '\n', 'Refuse unrelated JSON formatting changes');
assert.equal(asset.nodes.length, 43, 'Expected the original 43-node asset');
assert.equal(asset.scenes.length, 1);
const roots = asset.scenes[asset.scene ?? 0].nodes;
const before = reachable(asset, roots);
const meshCount = (indices) => [...indices].filter((i) => asset.nodes[i].mesh !== undefined).length;
const beforeMeshes = meshCount(before);
const targets = [
  {name: 'Selected rubble 1-3', lod: 26, leaves: [27, 28, 29, 30, 31]},
  {name: 'Selected rubble 1-4', lod: 36, leaves: [37, 38, 39, 40, 41]},
];
let removed = 0;
for (const {name, lod, leaves} of targets) {
  const groups = asset.nodes.filter((node) => node.name === name);
  assert.equal(groups.length, 1, `Expected exactly one ${name}`);
  const groupIndex = asset.nodes.indexOf(groups[0]);
  assert(before.has(groupIndex), `${name} must be reachable`);
  const descendants = reachable(asset, [groupIndex]);
  assert.deepEqual([...descendants].filter((i) => asset.nodes[i].name === 'LOD3'), [lod]);
  for (const [offset, index] of leaves.entries()) {
    const leaf = asset.nodes[index];
    assert.equal(leaf.name, `LOD3_TextureAtlas_${1001 + offset}_0`);
    assert(Number.isInteger(leaf.mesh) && asset.meshes[leaf.mesh], 'Expected a valid mesh');
    assert.equal((leaf.children ?? []).length, 0, 'Only mesh leaves may be detached');
    const parents = asset.nodes.flatMap((node, i) => (node.children ?? []).includes(index) ? [i] : []);
    assert.deepEqual(parents, asset.nodes[lod].children === undefined ? [] : [lod]);
  }
  if (asset.nodes[lod].children === undefined) {
    assert(leaves.every((i) => !before.has(i)), 'Previously detached leaves must remain unreachable');
    assert.equal(meshCount(descendants), 0);
  } else {
    assert.deepEqual(asset.nodes[lod].children, leaves, `${name} must have exactly the five expected leaves`);
    assert.equal(meshCount(descendants), 5);
    removed += leaves.length;
  }
}
assert(removed === 0 || removed === 10, 'Refuse a partially modified asset');
for (const {lod} of targets) delete asset.nodes[lod].children;
const after = reachable(asset, roots);
assert.equal(beforeMeshes - meshCount(after), removed);
assert.deepEqual([...before].filter((i) => !after.has(i)), removed ? targets.flatMap((t) => t.leaves) : []);

// Restore just the two child arrays in a comparison copy to prove all other data is intact.
const restored = structuredClone(asset);
const baseline = JSON.parse(original);
for (const {lod} of targets) {
  if (baseline.nodes[lod].children !== undefined) restored.nodes[lod].children = baseline.nodes[lod].children;
}
assert.deepEqual(restored, baseline, 'Unexpected changes outside the ten leaf edges');
if (removed) writeFileSync(assetPath, JSON.stringify(asset, null, 2) + '\n');
console.log(`${removed ? 'Removed 10 leaf edges' : 'Already applied'}; reachable meshes ${beforeMeshes} -> ${meshCount(after)}; all 43 nodes and other asset data preserved.`);
