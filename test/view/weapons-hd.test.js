import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {labSceneDocument,candidatesFromRegistry} from '../../tools/build-lab-scene.mjs'

test('HD lab rebuild keeps originals and places each derivative one metre beside its source',async()=>{
  const registry=JSON.parse(await readFile('assets.json','utf8'))
  const prior=JSON.parse(await readFile('assets/main.scene.gltf','utf8'))
  const result=labSceneDocument(prior,candidatesFromRegistry(registry))
  const rack=result.nodes.find(n=>n.name==='Candidates')
  const children=rack.children.map(i=>result.nodes[i])
  assert.equal(children.length,Object.values(registry.files).filter(e=>e.candidate?.shippable).length)
  for(const [weapon,slug] of [['shotgun','3dmodels-cc0'],['revolver','loafbrr-cc0']]) {
    const original=children.find(n=>n.name===`Candidate ${weapon} ${slug}`)
    const hd=children.find(n=>n.name===`Candidate ${weapon} ${slug}-hd`)
    assert.ok(original);assert.ok(hd)
    assert.deepEqual(hd.translation,[original.translation[0]+1,original.translation[1],original.translation[2]])
    assert.deepEqual(hd.rotation,original.rotation)
    assert.equal(hd.extras.candidate.derivedFrom,`candidate-${weapon}-${slug}`)
  }
})

test('HD assets use one primitive and three external 2048 textures',async()=>{
  for(const [weapon,slug] of [['shotgun','3dmodels-cc0'],['revolver','loafbrr-cc0']]) {
    const folder=`assets/models/weapons-candidates/${weapon}/${slug}-hd`
    const gltf=JSON.parse(await readFile(`${folder}/${slug}-hd.gltf`,'utf8'))
    assert.equal(gltf.meshes.length,1)
    assert.equal(gltf.meshes[0].primitives.length,1)
    assert.equal(gltf.materials.length,1)
    assert.equal(gltf.images.length,3)
    const material=gltf.materials[0]
    assert.ok(material.normalTexture)
    assert.ok(material.occlusionTexture)
    assert.ok(material.pbrMetallicRoughness.baseColorTexture)
    assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture)
    for(const image of gltf.images) {
      assert.ok(image.uri&&!image.uri.startsWith('data:'))
      const png=await readFile(`${folder}/${image.uri}`)
      assert.equal(png.toString('ascii',1,4),'PNG')
      assert.equal(png.readUInt32BE(16),2048);assert.equal(png.readUInt32BE(20),2048)
    }
    const primitive=gltf.meshes[0].primitives[0]
    const position=gltf.accessors[primitive.attributes.POSITION]
    const dimensions=position.max.map((v,i)=>v-position.min[i])
    assert.ok(Math.max(...dimensions)<=(weapon==='shotgun'?1.05:.35)*1.03)
    assert.ok(Math.min(...dimensions)<=.065)
    const triangles=gltf.accessors[primitive.indices].count/3
    assert.ok(triangles>=25000&&triangles<=40000,`Triangle count ${triangles}`)
  }
})

test('The two source candidates remain byte-identical to the initial checkpoint',async()=>{
  const hashes=JSON.parse(await readFile('tools/blender/hd/input-hashes.json','utf8'))
  for(const [path,hash] of Object.entries(hashes))
    assert.equal(createHash('sha256').update(await readFile(path)).digest('hex'),hash,path)
})
