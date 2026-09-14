import {readFile,writeFile,unlink} from 'node:fs/promises'
const dir='assets/v2/performance/preview-019',path=`${dir}/preview.gltf`
const g=JSON.parse(await readFile(path,'utf8'))
const inputs=await Promise.all(g.buffers.map(b=>readFile(`${dir}/${b.uri}`)))
const limit=48*1024*1024,parts=[[]],lengths=[0]
for(const v of g.bufferViews){
 const bytes=inputs[v.buffer].subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength)
 if(bytes.length>limit)throw Error('A single attribute exceeds the file budget')
 let i=parts.length-1
 if(lengths[i]+bytes.length>limit){parts.push([]);lengths.push(0);i++}
 v.buffer=i;v.byteOffset=lengths[i];parts[i].push(bytes);lengths[i]+=bytes.length
 if(lengths[i]%4){const pad=Buffer.alloc(4-lengths[i]%4);parts[i].push(pad);lengths[i]+=pad.length}
}
const previous=g.buffers.map(b=>b.uri)
g.buffers=parts.map((_,i)=>({uri:`preview-${i}.bin`,byteLength:lengths[i]}))
for(const [i,chunks]of parts.entries())await writeFile(`${dir}/${g.buffers[i].uri}`,Buffer.concat(chunks))
await writeFile(path,JSON.stringify(g,null,2)+'\n')
const a=JSON.parse(await readFile('assets.json','utf8')),files=a.files['v2-stopped-preview-019'].files
for(const file of previous)delete files[file]
for(const b of g.buffers)files[b.uri]=`${dir}/${b.uri}`
await writeFile('assets.json',JSON.stringify(a,null,2)+'\n')
for(const file of previous)if(!g.buffers.some(b=>b.uri===file))await unlink(`${dir}/${file}`)
console.log(JSON.stringify({buffers:g.buffers,total:lengths.reduce((a,b)=>a+b,0)}))
