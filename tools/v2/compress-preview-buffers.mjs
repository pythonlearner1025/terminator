// Bit-exact meshopt coding; no quantization, vertex reordering or filtering.
import {readFile,writeFile,unlink} from 'node:fs/promises'
import {MeshoptEncoder,MeshoptDecoder} from 'meshoptimizer'
import {createHash} from 'node:crypto'
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready])
const dir='assets/v2/performance/preview-019',path=`${dir}/preview.gltf`
const g=JSON.parse(await readFile(path,'utf8')),old=g.buffers,inputs=await Promise.all(old.map(b=>readFile(`${dir}/${b.uri}`)))
const parts=[[]],lengths=[0],limit=48*1024*1024,hash=createHash('sha256');let decodedBytes=0
const byView=new Map(g.accessors.map(a=>[a.bufferView,a]))
for(const [id,v]of g.bufferViews.entries()){
 const a=byView.get(id);if(!a||v.extensions?.EXT_meshopt_compression)throw Error('Expected raw indexed preview views')
 const stride=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type]*4,mode=a.componentType===5125?'INDICES':'ATTRIBUTES'
 const bytes=inputs[v.buffer].subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)
 const packed=MeshoptEncoder.encodeGltfBuffer(bytes,a.count,stride,mode),decoded=new Uint8Array(bytes.length)
 MeshoptDecoder.decodeGltfBuffer(decoded,a.count,stride,packed,mode,'NONE')
 if(!Buffer.from(decoded).equals(bytes))throw Error(`Lossy roundtrip in view ${id}`)
 hash.update(decoded)
 let part=parts.length-1;if(lengths[part]+packed.length>limit){parts.push([]);lengths.push(0);part++}
 const offset=lengths[part];parts[part].push(packed);lengths[part]+=packed.length
 v.extensions={EXT_meshopt_compression:{buffer:part,byteOffset:offset,byteLength:packed.length,byteStride:stride,count:a.count,mode,filter:'NONE'}}
 v.byteOffset=decodedBytes;decodedBytes+=bytes.length
}
g.buffers=parts.map((_,i)=>({uri:`meshopt-${i}.bin`,byteLength:lengths[i]}))
const fallback=g.buffers.length;g.buffers.push({byteLength:decodedBytes,extensions:{EXT_meshopt_compression:{fallback:true}}})
for(const v of g.bufferViews)v.buffer=fallback
g.extensionsUsed=[...new Set([...(g.extensionsUsed||[]),'EXT_meshopt_compression'])];g.extensionsRequired=[...new Set([...(g.extensionsRequired||[]),'EXT_meshopt_compression'])]
for(const [i,p]of parts.entries())await writeFile(`${dir}/${g.buffers[i].uri}`,Buffer.concat(p))
await writeFile(path,JSON.stringify(g,null,2)+'\n')
const a=JSON.parse(await readFile('assets.json','utf8')),files=a.files['v2-stopped-preview-019'].files
for(const b of old)delete files[b.uri];for(const b of g.buffers)if(b.uri)files[b.uri]=`${dir}/${b.uri}`
await writeFile('assets.json',JSON.stringify(a,null,2)+'\n');for(const b of old)await unlink(`${dir}/${b.uri}`)
const report={encoding:'EXT_meshopt_compression, ATTRIBUTES/INDICES, filter NONE',decodedBytes,encodedBytes:lengths.reduce((a,b)=>a+b,0),decodedViewsSha256:hash.digest('hex'),bitExactRoundtrip:true}
await writeFile(`${dir}/compression.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
