/** Lossless production atmosphere payload. No image codec, quantization or art edits. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {hash,manifestModule,compressedMetadata,compressLightingNoise,verifyLightingNoiseBake} from './lighting-noise-bake-format.mjs'
import {bakeSky,bakeSmoke,bakeMist,bakeHorizonHaze} from '../../lib/view/v2/lighting-noise.js'
const base=new URL('../../',import.meta.url),out=new URL('assets/v2/lighting-baked/',base)
const maps=[['sky',bakeSky(),{recipe:'bakeSky',args:[]}],...Array.from({length:2},(_,i)=>[`smoke-${i+4}`,bakeSmoke(384,i+4),{recipe:'bakeSmoke',args:[384,i+4]}]),['mist',bakeMist(),{recipe:'bakeMist',args:[]}],['horizon',bakeHorizonHaze(),{recipe:'bakeHorizonHaze',args:[]}]]
for(let i=0;i<4;i++){
 const path=`assets/v2/lighting/plume-${i}.rgba`,data=await readFile(new URL(path,base))
 if(data.length!==512*512*4)throw Error('Existing production plume size changed')
 maps.push([`plume-${i}`,{data,width:512,height:512},{sourceFile:path,sourceSha256:hash(data)}])
}
const buffers=[],entries={};let offset=0
for(const [id,{data,width,height},source] of maps){
 const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength)
 entries[id]={width,height,offset,byteLength:bytes.length,sha256:hash(bytes),...source};offset+=bytes.length;buffers.push(bytes)
}
const bytes=Buffer.concat(buffers),check=process.argv.includes('--check')
const expectedManifest={version:1,format:'gzip of concatenated unchanged Uint8 RGBA; straight alpha, original color-space assignment retained by lighting.js',sourceFile:'lib/view/v2/lighting-noise.js',sourceSha256:hash(await readFile(new URL('lib/view/v2/lighting-noise.js',base))),rawByteLength:bytes.length,rawSha256:hash(bytes),url:'../../../assets/v2/lighting-baked/production.rgba.gz',maps:entries}
const bundlePath=new URL('production.rgba.gz',out),jsonPath=new URL('manifest.json',out),modulePath=new URL('lib/view/v2/lighting-noise-baked-manifest.js',base)
let compressed
if(check){
 compressed=await readFile(bundlePath)
 verifyLightingNoiseBake({compressed,manifest:JSON.parse(await readFile(jsonPath,'utf8')),moduleSource:await readFile(modulePath,'utf8'),expectedRaw:bytes,expectedManifest})
}else{
 const existing=await readFile(bundlePath).catch(error=>{if(error.code!=='ENOENT')throw error})
 compressed=compressLightingNoise(bytes,existing)
 // Keep the established generated property order as well as the bundle bytes.
 const {url,maps,...metadata}=expectedManifest
 const manifest={...metadata,...compressedMetadata(compressed),url,maps}
 await mkdir(out,{recursive:true})
 for(const [path,data] of [[bundlePath,compressed],[jsonPath,JSON.stringify(manifest,null,2)+'\n'],[modulePath,manifestModule(manifest)]]){
  const previous=await readFile(path).catch(error=>{if(error.code!=='ENOENT')throw error})
  if(!previous?.equals(Buffer.from(data)))await writeFile(path,data)
 }
}
console.log(JSON.stringify({maps:maps.length,rawBytes:bytes.length,gzipBytes:compressed.length,sourceSha256:expectedManifest.sourceSha256,check}))
