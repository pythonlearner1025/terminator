import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {LIGHTING_NOISE_BAKE as manifest} from '../lib/view/v2/lighting-noise-baked-manifest.js'
import {createLightingNoiseLoader} from '../lib/view/v2/lighting-noise-baked.js'
import * as noise from '../lib/view/v2/lighting-noise.js'
globalThis.ImageData??=class{}
globalThis.window??={}
const E=await import('threepipe')
const {mountV2Lighting}=await import('../lib/view/v2/lighting.js')
const {defaultMap}=await import('../lib/core/map.js')
const base=new URL('../',import.meta.url)
const compressed=await readFile(new URL('assets/v2/lighting-baked/production.rgba.gz',base))
const hash=data=>createHash('sha256').update(data).digest('hex')
const response=()=>new Response(compressed,{status:200})
const fixture=()=>{const scene=new E.Scene(),root=new E.Group();scene.add(root);return {root,map:defaultMap,viewer:{scene,getPlugin(){},setDirty(){}}}}

test('lossless lighting bundle preserves every production RGBA byte and source recipe',async()=>{
 assert.equal(hash(await readFile(new URL(manifest.sourceFile,base))),manifest.sourceSha256)
 assert.deepEqual(JSON.parse(await readFile(new URL('assets/v2/lighting-baked/manifest.json',base))),manifest)
 assert.equal(compressed.length,manifest.compressedByteLength);assert.equal(hash(compressed),manifest.compressedSha256)
 const raw=gunzipSync(compressed);assert.equal(raw.length,manifest.rawByteLength);assert.equal(hash(raw),manifest.rawSha256)
 let end=0
 for(const [id,m] of Object.entries(manifest.maps)){
  assert.equal(m.offset,end);end+=m.byteLength;assert.equal(m.byteLength,m.width*m.height*4)
  const bytes=raw.subarray(m.offset,end);assert.equal(hash(bytes),m.sha256,id)
  if(m.recipe){const original=noise[m.recipe](...m.args);assert.equal(original.width,m.width);assert.equal(original.height,m.height);assert.deepEqual(bytes,Buffer.from(original.data),id)}
  else {const original=await readFile(new URL(m.sourceFile,base));assert.equal(hash(original),m.sourceSha256);assert.deepEqual(bytes,original,id)}
 }
 assert.equal(end,raw.length);assert.equal(Object.keys(manifest.maps).length,9)
})

test('decoded production cache is bounded, preserves shared arrays and retries failures',async()=>{
 let requests=0
 const load=createLightingNoiseLoader({fetchImpl:async()=>{requests++;return requests===1?new Response('',{status:503}):response()}})
 await assert.rejects(load(),/HTTP 503/)
 const maps=await load(),again=await load();assert.equal(maps,again);assert.equal(requests,2)
 assert.equal(new Set(Object.values(maps).map(p=>p.data.buffer)).size,1)
 for(const [id,m] of Object.entries(manifest.maps))assert.equal(hash(maps[id].data),m.sha256)
 const aborted=new AbortController();aborted.abort();await assert.rejects(load({signal:aborted.signal}),{name:'AbortError'})
 const truncated=createLightingNoiseLoader({fetchImpl:async()=>response(),decompress:async()=>new Uint8Array(4)})
 await assert.rejects(truncated(),/invalid RGBA size/)
 const corrupt=createLightingNoiseLoader({fetchImpl:async()=>new Response(new Uint8Array(10))})
 await assert.rejects(corrupt())
})

test('abort during decode does not cache a late result or block the next mount',async()=>{
 let finish,requests=0
 const bytes=new Uint8Array(gunzipSync(compressed))
 const load=createLightingNoiseLoader({fetchImpl:async()=>{requests++;return response()},decompress:async()=>requests===1?new Promise(resolve=>{finish=resolve}):bytes})
 const controller=new AbortController(),pending=load({signal:controller.signal})
 await new Promise(resolve=>setImmediate(resolve));controller.abort();finish(bytes)
 await assert.rejects(pending,{name:'AbortError'})
 assert.equal((await load()).sky.width,2048);assert.equal(requests,2)
})

test('atmosphere stays unrendered until all nine full textures are ready with unchanged sampling',async()=>{
 const maps=await createLightingNoiseLoader({fetchImpl:async()=>response()})()
 let finish
 const f=fixture(),h=mountV2Lighting({...f,loadNoisePixels:()=>new Promise(resolve=>{finish=resolve})})
 assert.equal(h.root.visible,false)
 const textures=new Set();h.root.traverse(o=>{if(o.material?.map)textures.add(o.material.map)})
 for(const texture of textures)assert.equal(texture.image.data,null)
 await new Promise(resolve=>setImmediate(resolve));finish(maps);await h.ready
 assert.equal(h.root.visible,true)
 const sky=h.root.getObjectByName('V2 fixed smoky sky dome').material.map
 assert.equal(sky.colorSpace,E.SRGBColorSpace);assert.equal(sky.wrapS,E.RepeatWrapping);assert.equal(sky.image.width,2048)
 for(const texture of textures){assert.equal(texture.minFilter,E.LinearFilter);assert.equal(texture.magFilter,E.LinearFilter);assert.equal(texture.generateMipmaps,false);assert.equal(texture.premultiplyAlpha,false);assert.ok(texture.image.data?.length>4);if(texture!==sky)assert.equal(texture.colorSpace,E.NoColorSpace)}
 for(let i=1;i<=8;i++)assert.equal(h.root.getObjectByName(`V2 distant smoke bank ${i}`).material.map.image.width,512)
 const listeners=new Map([...textures].map(t=>[t,0]));for(const t of textures)t.addEventListener('dispose',()=>listeners.set(t,listeners.get(t)+1))
 h.dispose();h.dispose();for(const count of listeners.values())assert.equal(count,1)
})

test('pending Stop never resurrects textures and load failure keeps readiness rejected',async()=>{
 const maps=await createLightingNoiseLoader({fetchImpl:async()=>response()})()
 let finish,signal
 const f=fixture(),h=mountV2Lighting({...f,loadNoisePixels:args=>{signal=args.signal;return new Promise(resolve=>{finish=resolve})}})
 const sky=h.root.getObjectByName('V2 fixed smoky sky dome').material.map,before=sky.image
 await new Promise(resolve=>setImmediate(resolve));h.dispose();assert.equal(signal.aborted,true);finish(maps);await h.ready
 assert.equal(sky.image,before);assert.equal(h.root.parent,null);assert.equal(h.root.visible,false)
 const failed=mountV2Lighting({...fixture(),loadNoisePixels:async()=>{throw Error('asset unavailable')}})
 await assert.rejects(failed.ready,/asset unavailable/);assert.equal(failed.root.visible,false);failed.dispose()
})
