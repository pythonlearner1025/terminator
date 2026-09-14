import test from 'node:test'
import assert from 'node:assert/strict'
import {gzipSync,gunzipSync,constants} from 'node:zlib'
import {readFile,mkdtemp,mkdir,copyFile,writeFile,stat,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {spawnSync} from 'node:child_process'
import {hash,manifestModule,compressedMetadata,compressLightingNoise,verifyLightingNoiseBake} from '../tools/v2/lighting-noise-bake-format.mjs'

const raw=Buffer.from('Identical RGBA pixels across compressors.\0'.repeat(1000))
const expectedManifest={version:1,rawByteLength:raw.length,rawSha256:hash(raw),maps:{sample:{offset:0,byteLength:raw.length,sha256:hash(raw)}}}
const fixture=compressed=>{
 const manifest={...expectedManifest,...compressedMetadata(compressed)}
 return {compressed,manifest,moduleSource:manifestModule(manifest),expectedRaw:raw,expectedManifest}
}

test('different gzip encodings of identical pixels are valid and preserved on rebake',()=>{
 const original=gzipSync(raw,{level:9}),alternate=gzipSync(raw,{level:1,strategy:constants.Z_HUFFMAN_ONLY})
 assert.notDeepEqual(original,alternate)
 for(const compressed of [original,alternate]){
  verifyLightingNoiseBake(fixture(compressed))
  assert.equal(compressLightingNoise(raw,compressed),compressed)
 }
 assert.deepEqual(gunzipSync(compressLightingNoise(raw,Buffer.from('corrupt'))),raw)
})

test('compressed integrity, exact decoded pixels and full manifest consistency are independent checks',()=>{
 const a=fixture(gzipSync(raw,{level:9})),b=fixture(gzipSync(raw,{level:1}))
 assert.throws(()=>verifyLightingNoiseBake({...a,compressed:b.compressed}),/compressed digest/)
 const changed=Buffer.from(raw);changed[100]^=1
 const wrongPixels=fixture(gzipSync(changed)) // Correct gzip digest but stale raw recipe.
 assert.throws(()=>verifyLightingNoiseBake(wrongPixels),/decompressed pixels/)
 const stale={...a.manifest,maps:{sample:{...a.manifest.maps.sample,offset:4}}}
 assert.throws(()=>verifyLightingNoiseBake({...a,manifest:stale,moduleSource:manifestModule(stale)}),/manifest metadata/)
 assert.throws(()=>verifyLightingNoiseBake({...a,moduleSource:manifestModule({...a.manifest,compressedSha256:'stale'})}),/JS\/JSON/)
 assert.throws(()=>verifyLightingNoiseBake({...a,manifest:{...a.manifest,unexpected:true}}),/manifest metadata/)
})

test('real CLI accepts an alternate production compressor and neither check nor unchanged rebake writes artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lighting-bake-check-'))
 const base=new URL('../',import.meta.url)
 const bundle='assets/v2/lighting-baked/production.rgba.gz',json='assets/v2/lighting-baked/manifest.json',module='lib/view/v2/lighting-noise-baked-manifest.js'
 try{
  for(const file of ['tools/v2/bake-lighting-noise.mjs','tools/v2/lighting-noise-bake-format.mjs','lib/view/v2/lighting-noise.js',...Array.from({length:4},(_,i)=>`assets/v2/lighting/plume-${i}.rgba`)]){
   await mkdir(dirname(join(root,file)),{recursive:true});await copyFile(new URL(file,base),join(root,file))
  }
  await writeFile(join(root,'package.json'),'{"type":"module"}\n')
  const original=await readFile(new URL(bundle,base)),pixels=gunzipSync(original)
  const alternate=gzipSync(pixels,{level:1,strategy:constants.Z_HUFFMAN_ONLY})
  assert.notDeepEqual(alternate,original)
  const manifest={...JSON.parse(await readFile(new URL(json,base))),...compressedMetadata(alternate)}
  await mkdir(dirname(join(root,bundle)),{recursive:true})
  await writeFile(join(root,bundle),alternate)
  await writeFile(join(root,json),JSON.stringify(manifest,null,2)+'\n')
  await writeFile(join(root,module),manifestModule(manifest))
  const paths=[bundle,json,module].map(file=>join(root,file))
  const before=await Promise.all(paths.map(async path=>({bytes:await readFile(path),mtime:(await stat(path,{bigint:true})).mtimeNs})))
  for(const args of [['--check'],[]]){
   const result=spawnSync(process.execPath,['--max-old-space-size=768','tools/v2/bake-lighting-noise.mjs',...args],{cwd:root,encoding:'utf8',timeout:60000})
   assert.equal(result.status,0,result.error?.message||result.stderr)
   assert.equal(JSON.parse(result.stdout).maps,9)
   for(let i=0;i<paths.length;i++){
    assert.deepEqual(await readFile(paths[i]),before[i].bytes)
    assert.equal((await stat(paths[i],{bigint:true})).mtimeNs,before[i].mtime)
   }
  }
 }finally{await rm(root,{recursive:true,force:true})}
})
