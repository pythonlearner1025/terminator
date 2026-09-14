import test from 'node:test'
import assert from 'node:assert/strict'
import {sampleImageUploadArm,loadProbeDOMImage} from '../../tools/v2/image-upload-arms.mjs'

function fixture() {
  let clock=100
  const events=[],blob=new Blob(['encoded']),image={kind:'dom'},bitmap={kind:'bitmap',close(){events.push('close-bitmap')}}
  const options={blob,imageOptions:{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'},now:()=>clock,
    async loadDOMImage(input){assert.equal(input,blob);events.push('decode-dom');clock+=7;return {image,release(){events.push('release-dom')}}},
    async createBitmap(input,options){assert.deepEqual(options,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});events.push(input===blob?'decode-blob':'convert-dom');clock+=input===blob?5:3;return bitmap},
    upload(input){events.push('upload-'+input.kind);clock+=11;return {ms:11,finishedAt:clock,pixels:new Uint8Array([1,2,3,4])}}}
  return {events,options}
}

test('all three timings include their own preparation, without hidden DOM decode',async()=>{
  for(const [kind,total,dom,conversion,direct] of [['dom',18,7,0,0],['bitmap',21,7,3,0],['directBlob',16,0,0,5]]){
    const f=fixture(),r=await sampleImageUploadArm(kind,f.options)
    assert.equal(r.decodeAndUploadMs,total);assert.equal(r.uploadMs,11)
    assert.equal(r.domDecodeMs,dom);assert.equal(r.domToBitmapMs,conversion);assert.equal(r.bitmapDecodeMs,direct)
    assert.equal(r.prepareMs,total-11);assert.deepEqual(r.pixels,new Uint8Array([1,2,3,4]))
    assert.equal(f.events.includes('decode-dom'),kind!=='directBlob')
    assert.equal(f.events.includes('release-dom'),kind!=='directBlob')
    assert.equal(f.events.includes('close-bitmap'),kind!=='dom')
  }
})

test('upload failure closes every created probe object',async()=>{
  for(const kind of ['dom','bitmap','directBlob']){
    const f=fixture();f.options.upload=()=>{throw Error('GL failure')}
    await assert.rejects(sampleImageUploadArm(kind,f.options),/GL failure/)
    assert.equal(f.events.includes('release-dom'),kind!=='directBlob')
    assert.equal(f.events.includes('close-bitmap'),kind!=='dom')
  }
})

test('conversion failure releases its fresh DOM image; unsupported arms do no work',async()=>{
  const f=fixture();f.options.createBitmap=async()=>{throw Error('decode failure')}
  await assert.rejects(sampleImageUploadArm('bitmap',f.options),/decode failure/)
  assert.deepEqual(f.events,['decode-dom','release-dom'])
  const next=fixture();await assert.rejects(sampleImageUploadArm('unknown',next.options),/Unknown/);assert.deepEqual(next.events,[])
})

test('fresh DOM loader revokes its own URL after success and decode failure',async()=>{
  const oldImage=globalThis.Image,create=URL.createObjectURL,revoke=URL.revokeObjectURL
  const urls=[],revoked=[];let fail=false
  URL.createObjectURL=()=>{const url='blob:probe-'+urls.length;urls.push(url);return url}
  URL.revokeObjectURL=url=>revoked.push(url)
  globalThis.Image=class {async decode(){if(fail)throw Error('invalid image')}}
  try {
    const a=await loadProbeDOMImage(new Blob());assert.equal(a.image.src,urls[0]);assert.deepEqual(revoked,[])
    a.release();a.release();assert.equal(a.image.src,'');assert.deepEqual(revoked,[urls[0]])
    fail=true;await assert.rejects(loadProbeDOMImage(new Blob()),/invalid image/);assert.deepEqual(revoked,urls)
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;if(oldImage===undefined)delete globalThis.Image;else globalThis.Image=oldImage}
})
