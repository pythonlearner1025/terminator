import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class{}
const {Texture,Vector2}=await import('three')
const {createExactImageSourceCache,installExactImageSourceSharing,staticImageKind,exactImageBytesEqual}=await import('../../lib/view/v2/exact-image-source-cache.js')
let id=0
const imageBlobs=new Map()
const jpeg=value=>new Uint8Array([255,216,255,value,255,217])
function texture(bytes=jpeg(1)) {
 const image={immutable:true,src:`blob:fixture-${++id}`,naturalWidth:4,naturalHeight:4,complete:true}
 const t=new Texture(image);t.userData.__sourceBlob=new Blob([bytes]);imageBlobs.set(image.src,t.userData.__sourceBlob);t.needsUpdate=true;return t
}
const options={isImage:image=>image?.immutable&&image.complete,hasUploaded:()=>false,fetchBlob:async url=>{const blob=imageBlobs.get(url);assert(blob,'Unknown fixture image URL');return blob}}
const cache=extra=>createExactImageSourceCache({...options,...extra})
test('equal immutable payloads share Source, retaining independent Texture semantics',async()=>{
 const c=cache(),a=texture(),b=texture();a.name='first';b.name='different';b.colorSpace='srgb';b.flipY=true;b.offset=new Vector2(.2,.7);b.repeat=new Vector2(3,4);b.wrapS=1001;b.minFilter=1006
 const values=[b.uuid,b.name,b.colorSpace,b.flipY,b.offset.toArray(),b.repeat.toArray(),b.wrapS,b.minFilter,b.version]
 await c.process([a,b]);assert.equal(a.source,b.source)
 assert.deepEqual([b.uuid,b.name,b.colorSpace,b.flipY,b.offset.toArray(),b.repeat.toArray(),b.wrapS,b.minFilter,b.version],values)
 assert.equal(c.stats.shared,1);assert.equal(c.stats.reads,2)
 await c.process([a,b]);assert.equal(c.stats.reads,2)
 c.dispose();assert.equal(a.source,b.source);assert.equal(c.size,0)
})
test('same names do not conflate distinct bytes or animated/dynamic/unknown images',async()=>{
 const c=cache(),a=texture(jpeg(1)),b=texture(jpeg(2));a.name=b.name='same'
 const gif=texture(new TextEncoder().encode('GIF89a')),data=texture(),video=texture(),unknown=texture(new Uint8Array([1,2,3]));data.isDataTexture=true;video.isVideoTexture=true
 const originals=[a,b,gif,data,video,unknown].map(t=>t.source)
 await c.process([a,b,gif,data,video,unknown]);assert.deepEqual([a,b,gif,data,video,unknown].map(t=>t.source),originals);assert.equal(c.stats.shared,0)
 const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,97,99,84,76,0,0,0,0]);assert.equal(staticImageKind(png),null)
 const webp=new TextEncoder().encode('RIFF0000WEBPANIM0000');assert.equal(staticImageKind(webp),null)
})
test('never changes an uploaded texture or one uploaded while hashing',async()=>{
 const uploaded=new Set(),c=cache({hasUploaded:t=>uploaded.has(t)}),a=texture(),b=texture(),before=b.source
 uploaded.add(b);await c.process([a,b]);assert.equal(b.source,before);assert.equal(c.stats.skippedUploaded,1)
 const gate=Promise.withResolvers(),d=cache({hasUploaded:t=>uploaded.has(t),readBytes:async blob=>{await gate.promise;return blob.arrayBuffer()}}),x=texture(),y=texture(),original=y.source
 const pending=d.process([x,y]);uploaded.add(y);gate.resolve();await pending;assert.equal(y.source,original)
})
test('disposal prevents a pending alias and restores the importer method',async()=>{
 const gate=Promise.withResolvers(),a=texture(),b=texture(),before=b.source
 const original=async value=>value,importer={processRaw:original}
 const sharing=installExactImageSourceSharing(importer,{...options,readBytes:async blob=>{await gate.promise;return blob.arrayBuffer()}})
 const pending=importer.processRaw([a,b]);await Promise.resolve();sharing.dispose();gate.resolve()
 assert.equal(await pending instanceof Array,true);assert.equal(importer.processRaw,original);assert.equal(b.source,before)
 assert(sharing.stats.disposed)
})
test('cache stays bounded, invalidated images do not alias, import errors propagate',async()=>{
 const c=cache({maxEntries:2}),a=texture(),b=texture(jpeg(2)),d=texture(jpeg(3));await c.process([a,b,d]);assert.equal(c.size,2)
 b.source.data.src='blob:changed';const next=texture(jpeg(2));await c.process(next);assert.notEqual(next.source,b.source)
 const error=Error('required scene failed'),original=async()=>{throw error},importer={processRaw:original},sharing=installExactImageSourceSharing(importer,options)
 await assert.rejects(importer.processRaw({}),e=>e===error);sharing.dispose();assert.equal(importer.processRaw,original)
})
test('failed optional fingerprint retries without hiding a successful import',async()=>{
 let fail=true
 const c=cache({readBytes:blob=>{if(fail)throw Error('bytes unavailable');return blob.arrayBuffer()}}),a=texture(),b=texture()
 await c.process([a,b]);assert.notEqual(a.source,b.source);assert.equal(c.stats.failed,2)
 fail=false;await c.process([a,b]);assert.equal(a.source,b.source)
})
test('recursive importer calls keep receiver/result and await sharing before return',async()=>{
 let calls=0
 const a=texture(),b=texture(),root={isObject3D:true,traverse(fn){fn({material:{map:a,normalMap:b}})}}
 const importer={async processRaw(value){assert.equal(this,importer);calls++;return value==='outer'?this.processRaw(root):[value]}}
 const original=importer.processRaw,sharing=installExactImageSourceSharing(importer,options)
 const result=await importer.processRaw('outer');assert.equal(result[0],root);assert.equal(calls,2);assert.equal(a.source,b.source)
 sharing.dispose();assert.equal(importer.processRaw,original)
})
test('default image gate rejects scaled and mutable DOM image inputs',async()=>{
 const previous=globalThis.HTMLImageElement
 class Image {constructor(){this.src='blob:static';this.srcset='';this.complete=true;this.width=this.naturalWidth=4;this.height=this.naturalHeight=4}}
 globalThis.HTMLImageElement=Image
 try {
  const c=createExactImageSourceCache({hasUploaded:()=>false,fetchBlob:options.fetchBlob}),a=texture(),b=texture(),scaled=texture(),responsive=texture()
  for(const t of [a,b,scaled,responsive]){const src=t.image.src;t.source.data=new Image();t.image.src=src}
  scaled.image.width=2;responsive.image.srcset='different.png 2x'
  const before=[scaled.source,responsive.source]
  await c.process([a,b,scaled,responsive]);assert.equal(a.source,b.source);assert.deepEqual([scaled.source,responsive.source],before)
 } finally {if(previous===undefined)delete globalThis.HTMLImageElement;else globalThis.HTMLImageElement=previous}
})
test('static PNG is accepted but animated PNG and invalid cache bounds are rejected',()=>{
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
 assert.equal(staticImageKind(bytes),'png')
 const animated=Buffer.concat([bytes.subarray(0,8),Buffer.from([0,0,0,0,97,99,84,76,0,0,0,0]),bytes.subarray(8)])
 assert.equal(staticImageKind(animated),null);assert.throws(()=>cache({maxEntries:-1}),RangeError)
})
test('viewer plugin owns the importer wrapper and releases its viewer listener',async()=>{
 globalThis.window??={}
 const {default:Plugin}=await import('../../lib/view/v2/exact-image-source.plugin.js')
 const listeners=new Set(),original=async v=>[v],importer={processRaw:original},viewer={assetManager:{importer},renderManager:{webglRenderer:{properties:{get:()=>({})}}},console,
  addEventListener(type,listener){listeners.add(listener)},removeEventListener(type,listener){listeners.delete(listener)}}
 const plugin=new Plugin();plugin.onAdded(viewer)
 assert.notEqual(importer.processRaw,original);assert.equal(listeners.size,1)
 const value={};assert.equal((await importer.processRaw(value))[0],value);assert.equal(plugin.stats.imports,1)
 plugin.onRemove(viewer);assert.equal(importer.processRaw,original);assert.equal(listeners.size,0);assert(plugin.stats.disposed)
})
test('hash work is bounded across a concurrent import and all work remains a readiness gate',{timeout:2000},async()=>{
 let active=0,peak=0,finished=0;const release=[]
 const c=cache({hashConcurrency:4,readBytes:async blob=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>release.push(resolve));active--;finished++;return blob.arrayBuffer()}})
 let done=false;const pending=c.process(Array.from({length:10},(_,i)=>texture(jpeg(i)))).then(()=>{done=true})
 for(let i=0;finished<10;i++){
  await new Promise(setImmediate)
  if(i===0){assert.equal(active,4);assert.equal(done,false)}
  release.splice(0).forEach(resolve=>resolve())
 }
 await pending;assert.equal(finished,10);assert.equal(peak,4);assert.equal(c.stats.peakReads,4)
})
test('import render holds restore immediately on disposal, even with pending original work',async()=>{
 const gate=Promise.withResolvers(),importer={async processRaw(value){await gate.promise;return value}}
 let holds=0,releases=0
 const sharing=installExactImageSourceSharing(importer,{...options,holdRendering(){holds++;return()=>{holds--;releases++}}})
 const a=importer.processRaw({}),b=importer.processRaw({});assert.equal(holds,2)
 sharing.dispose();assert.equal(holds,0);assert.equal(releases,2)
 gate.resolve();await Promise.all([a,b]);assert.equal(releases,2)
})
test('byte comparison checks every byte including unaligned views and trailing bytes',()=>{
 for(const offset of [0,1,4])for(const length of [1,3,4,19,32]){
  const a=new Uint8Array(new ArrayBuffer(offset+length),offset,length),b=new Uint8Array(new ArrayBuffer(offset+length),offset,length)
  a.fill(173);b.set(a);assert(exactImageBytesEqual(a,b))
  for(let i=0;i<length;i++){b[i]^=1;assert.equal(exactImageBytesEqual(a,b),false);b[i]^=1}
 }
})
test('retained encoded bytes remain bounded and are cleared on plugin disposal',async()=>{
 const c=cache({maxCacheBytes:12}),images=[texture(jpeg(1)),texture(jpeg(2)),texture(jpeg(3))]
 await c.process(images);assert(c.stats.cacheBytes<=12);assert(c.stats.peakCacheBytes<=12);assert.equal(c.size,2)
 await c.process(texture(jpeg(1)));assert(c.stats.cacheBytes<=12)
 c.dispose();assert.equal(c.stats.cacheBytes,0)
})

test('stale importer blob metadata cannot conflate different decoded images',async()=>{
 const c=cache(),a=texture(jpeg(1)),b=texture(jpeg(2)),original=b.source
 b.userData.__sourceBlob=a.userData.__sourceBlob
 await c.process([a,b]);assert.equal(b.source,original);assert.notEqual(a.source,b.source)
 const remote=texture();remote.image.src='https://example.invalid/image.jpg'
 await c.process(remote);assert.equal(c.stats.reads,2)
})
