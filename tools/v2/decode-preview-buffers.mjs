import {readFile} from 'node:fs/promises'
export async function decodedPreviewViews(g,dir){
 const inputs=await Promise.all(g.buffers.map(b=>b.uri?readFile(`${dir}/${b.uri}`):null))
 let decoder
 if(g.extensionsRequired?.includes('EXT_meshopt_compression')){decoder=(await import('meshoptimizer')).MeshoptDecoder;await decoder.ready}
 return g.bufferViews.map(v=>{
  const ext=v.extensions?.EXT_meshopt_compression
  if(!ext)return inputs[v.buffer].subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)
  const out=Buffer.alloc(ext.count*ext.byteStride)
  decoder.decodeGltfBuffer(out,ext.count,ext.byteStride,inputs[ext.buffer].subarray(ext.byteOffset||0,(ext.byteOffset||0)+ext.byteLength),ext.mode,ext.filter)
  return out
 })
}
