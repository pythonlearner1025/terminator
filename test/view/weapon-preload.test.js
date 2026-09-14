import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {weaponSurfaceMaps}=await import('../../lib/view/weapons-materials.js')
test('failed optional preload recovers once, preserves borrowed textures and shares successful cache', async () => {
  const original=E.TextureLoader.prototype.load,requests=[]
  E.TextureLoader.prototype.load=function(url,loaded,progress,failed) {
    const texture=new E.Texture()
    requests.push({url,texture,loaded,failed})
    return texture
  }
  try {
    const first=weaponSurfaceMaps(),firstReady=first.ready
    const material=new E.PhysicalMaterial({map:first.albedo,normalMap:first.normal})
    let borrowedDisposals=0
    material.map.addEventListener('dispose',()=>borrowedDisposals++)
    assert.equal(weaponSurfaceMaps().ready,firstReady)
    assert.equal(requests.length,4)
    assert.equal(first.roughness,first.metalness);assert.equal(first.roughness,first.ao)
    assert.equal(first.roughness.colorSpace,E.NoColorSpace)
    assert(requests.some(r=>r.url.endsWith('/assets/v2/performance/weapon-orm.png')))
    requests[0].failed(Error('HTTP 503'))
    for(const request of requests.slice(1)){request.texture.image={width:8,height:8};request.loaded(request.texture)}
    await assert.rejects(firstReady,/503/)
    const successful=first.normal,failedPlaceholder=first.albedo
    const retry=weaponSurfaceMaps(),retryReady=retry.ready
    assert.equal(retry,first);assert.notEqual(retryReady,firstReady)
    assert.equal(weaponSurfaceMaps().ready,retryReady)
    assert.equal(requests.length,5,'only the failed atlas is retried')
    assert.equal(material.map,failedPlaceholder);assert.equal(retry.normal,successful)
    const request=requests[4],image={width:16,height:16}
    let temporaryDisposals=0
    request.texture.addEventListener('dispose',()=>temporaryDisposals++)
    request.texture.image=image;request.loaded(request.texture)
    await retryReady
    assert.equal(material.map,failedPlaceholder);assert.equal(material.map.image,image)
    assert.equal(material.map.colorSpace,E.SRGBColorSpace);assert.equal(material.map.anisotropy,4)
    assert.equal(borrowedDisposals,0);assert.equal(temporaryDisposals,1)
    assert.equal(weaponSurfaceMaps().ready,retryReady);assert.equal(requests.length,5)
    material.dispose()
  } finally {E.TextureLoader.prototype.load=original}
})
