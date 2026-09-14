import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile, writeFile, mkdir, mkdtemp, symlink, rm} from 'node:fs/promises'
import {resolve, dirname, join} from 'node:path'
import {Document, NodeIO} from '@gltf-transform/core'
import {measureVisualBounds} from '../../tools/collider-fit.mjs'
import {refitSelectedProp, selectedPropFitBounds} from '../../tools/lib/selected-props.mjs'
globalThis.ImageData ??= class {}
const E = await import('three')
const root = resolve(new URL('../..', import.meta.url).pathname)
const id = 'map-rubble-1x1p5x12-zh655b'
const json = async path => JSON.parse(await readFile(path, 'utf8'))

// Deliberately sparse triangle: some accessor-AABB corners are empty space.
// A rotated source plus inverse placement must still give the original triangle.
test('visual fit measures actual vertices through source AND placement transforms', () => {
  const doc = new Document(), buffer = doc.createBuffer()
  const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0,0,0, 2,0,0, 0,1,0])).setBuffer(buffer)
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION',positions))
  const rotation = new E.Quaternion().setFromAxisAngle(new E.Vector3(0,0,1),Math.PI/4)
  const node = doc.createNode('rotated imported mesh').setMesh(mesh).setRotation(rotation.toArray())
  const scene = doc.createScene().addChild(node);doc.getRoot().setDefaultScene(scene)
  const first = measureVisualBounds(E,doc)
  assert.ok(Math.abs(first.max.y-Math.SQRT2)<1e-12,'empty AABB corner must not inflate Y to 2.121')
  const placement = new E.Matrix4().makeTranslation(3,4,5).multiply(new E.Matrix4().makeRotationZ(-Math.PI/4))
  const actual = measureVisualBounds(E,doc,placement)
  for(const axis of ['x','y','z']) {
    assert.ok(Math.abs(actual.min[axis]-{x:3,y:4,z:5}[axis])<1e-12)
    assert.ok(Math.abs(actual.max[axis]-{x:5,y:5,z:5}[axis])<1e-12)
  }
})

test('targeted divider repair preserves anchors, mesh data, textures and unknown extras; rerun is a no-op', async () => {
  await mkdir(join(root,'.kite3d'),{recursive:true})
  const temp = await mkdtemp(join(root,'.kite3d/prop-fit-test-'))
  try {
    for(const file of ['assets.json','lib/core/data/map-piece-registry.json','assets/sources/selected-assets.json']){
      await mkdir(dirname(join(temp,file)),{recursive:true});await writeFile(join(temp,file),await readFile(join(root,file)))
    }
    const registry = await json(join(root,'lib/core/data/map-piece-registry.json'))
    assert.deepEqual(selectedPropFitBounds('rubble',registry.assets[id]),{size:{x:1,y:1.353,z:12},center:{x:0,y:-.0735,z:0}})
    const path = (await json(join(root,'assets.json'))).files[id].path
    const source = await json(join(root,path)), parent = source.nodes[0]
    // Recreate the original nominal-height fit without relying on git or a saved test log.
    const fitted = parent.extras.selectedSource
    const correction = new E.Matrix4().makeScale(1,1.5/fitted.fitBounds[1],1)
      .multiply(new E.Matrix4().makeTranslation(0,-(fitted.fitCenter?.[1]||0),0))
    for(const node of source.nodes.filter(n=>/^Selected rubble \d+-\d+$/.test(n.name))) node.matrix=correction.clone().multiply(new E.Matrix4().fromArray(node.matrix)).toArray()
    fitted.fitBounds=[1,1.5,12];delete fitted.fitCenter
    parent.extras.userAuthored={stable:true};parent.extras.gltfUUID='preserve-authored-anchor'
    source.nodes[1].extras.EntityComponentPlugin={'persistent-id':{type:'Custom',state:{value:7}}}
    for(const buffer of source.buffers){
      const rel = buffer.uri.startsWith('/kite3d/')?buffer.uri.slice(8):join(dirname(path),buffer.uri)
      await mkdir(dirname(join(temp,rel)),{recursive:true});await symlink(join(root,rel),join(temp,rel))
    }
    await mkdir(dirname(join(temp,path)),{recursive:true});await writeFile(join(temp,path),JSON.stringify(source,null,2)+'\n')
    const result = await refitSelectedProp(temp,id)
    assert.equal(result.changed,true);assert.ok(Math.abs(result.scale[1]-.902)<1e-12)
    const after = await json(join(temp,path)), normalized = structuredClone(after)
    normalized.nodes[0].extras.selectedSource=source.nodes[0].extras.selectedSource
    for(let i=0;i<source.nodes.length;i++)if(/^Selected rubble \d+-\d+$/.test(source.nodes[i].name)){
      for(let j=0;j<16;j++)if(j!==5&&j!==13)assert.equal(after.nodes[i].matrix[j],source.nodes[i].matrix[j])
      normalized.nodes[i].matrix=source.nodes[i].matrix
    }
    assert.deepEqual(normalized,source,'only generated Y fit and owned fit metadata may change')
    const clean = structuredClone(after),resources={}
    for(const buffer of clean.buffers){const rel=buffer.uri.startsWith('/kite3d/')?buffer.uri.slice(8):join(dirname(path),buffer.uri);resources[buffer.uri]=new Uint8Array(await readFile(join(temp,rel)))}
    delete clean.extensions;delete clean.extensionsUsed;delete clean.extensionsRequired;delete clean.images;delete clean.textures;delete clean.materials
    for(const mesh of clean.meshes)for(const primitive of mesh.primitives)delete primitive.material
    const document = await new NodeIO().readJSON({json:clean,resources})
    const bounds = measureVisualBounds(E,document,new E.Matrix4().makeTranslation(0,.75,0))
    for(const axis of ['x','y','z']){
      assert.ok(Math.abs(bounds.min[axis]-{x:-.5,y:0,z:-6}[axis])<1e-12)
      assert.ok(Math.abs(bounds.max[axis]-{x:.5,y:1.353,z:6}[axis])<1e-12)
    }
    const bytes = await readFile(join(temp,path))
    assert.equal((await refitSelectedProp(temp,id)).changed,false)
    assert.deepEqual(await readFile(join(temp,path)),bytes)
  } finally {await rm(temp,{recursive:true,force:true})}
})
