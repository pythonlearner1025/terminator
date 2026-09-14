import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {detachAuthoredRoot}=await import('../../lib/view/authored-detachment.js')
test('detached preview keeps its complete borrowed hierarchy and restores order across repeated Play', () => {
 const parent=new E.Group(),before=new E.Group(),preview=new E.Group(),after=new E.Group(),mesh=new E.Object3D()
 preview.add(mesh);parent.add(before,preview,after);preview.position.set(1,2,3);preview.userData={gltfUUID:'stable',rootPath:'preview.gltf'}
 const data=JSON.stringify(preview.userData)
 for(let cycle=0;cycle<3;cycle++){
  const attachment=detachAuthoredRoot(preview)
  assert.equal(preview.parent,null);assert.equal(mesh.parent,preview);assert.deepEqual(preview.children,[mesh])
  assert.deepEqual(parent.children,[before,after]);assert.equal(JSON.stringify(preview.userData),data)
  attachment.restore();attachment.restore()
  assert.deepEqual(parent.children,[before,preview,after]);assert.deepEqual(preview.position.toArray(),[1,2,3])
 }
})
test('restoration preserves unrelated additions and respects siblings moved elsewhere during Play', () => {
 const parent=new E.Group(),preview=new E.Group(),sibling=new E.Group(),added=new E.Group(),other=new E.Group()
 parent.add(sibling,preview);const attachment=detachAuthoredRoot(preview)
 other.add(sibling);parent.add(added);attachment.restore()
 assert.deepEqual(parent.children,[preview,added]);assert.equal(sibling.parent,other)
})
