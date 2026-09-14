// Lossless per-mesh indexing. Complete attribute tuples, including fracture masks,
// must match bit-for-bit. Triangle order and winding are unchanged.
import {readFile,writeFile,unlink} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const dir='assets/v2/performance/preview-019',path=`${dir}/preview.gltf`
const g=JSON.parse(await readFile(path,'utf8')),inputs=await Promise.all(g.buffers.map(b=>readFile(`${dir}/${b.uri}`)))
const old=g.buffers.map(b=>b.uri),accessors=[],views=[],parts=[[]],lengths=[0],limit=48*1024*1024
const before=createHash('sha256'),after=createHash('sha256');let beforeVertices=0,afterVertices=0,triangles=0
function store(bytes,item){let i=parts.length-1;if(lengths[i]+bytes.length>limit){parts.push([]);lengths.push(0);i++}if(bytes.length>limit)throw Error('Oversized attribute');const offset=lengths[i];parts[i].push(bytes);lengths[i]+=bytes.length;if(lengths[i]%4){const pad=Buffer.alloc(4-lengths[i]%4);parts[i].push(pad);lengths[i]+=pad.length}const bufferView=views.push({buffer:i,byteOffset:offset,byteLength:bytes.length})-1;return accessors.push({...item,bufferView,byteOffset:0})-1}
for(const mesh of g.meshes)for(const primitive of mesh.primitives){
 if(primitive.indices!==undefined)throw Error('Input already indexed; rebuild original preview first')
 const attrs=Object.entries(primitive.attributes).map(([key,id])=>{const a=g.accessors[id],v=g.bufferViews[a.bufferView],width=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type]*4;if(a.componentType!==5126||v.byteStride)throw Error('Expected contiguous Float32 recipe');return {key,a,width,bytes:inputs[v.buffer].subarray((v.byteOffset||0)+(a.byteOffset||0),(v.byteOffset||0)+(a.byteOffset||0)+a.count*width)}})
 const count=attrs[0].a.count,stride=attrs.reduce((n,a)=>n+a.width,0),row=Buffer.alloc(stride),seen=new Map(),representatives=[],indices=new Uint32Array(count)
 for(let i=0;i<count;i++){let offset=0;for(const a of attrs){a.bytes.copy(row,offset,i*a.width,(i+1)*a.width);offset+=a.width}const key=row.toString('base64');let index=seen.get(key);if(index===undefined){index=representatives.length;representatives.push(i);seen.set(key,index)}indices[i]=index}
 const next={}
 for(const {key,a,width,bytes}of attrs){const output=Buffer.alloc(representatives.length*width);for(let i=0;i<representatives.length;i++)bytes.copy(output,i*width,representatives[i]*width,(representatives[i]+1)*width)
  before.update(bytes);const expanded=Buffer.alloc(bytes.length);for(let i=0;i<count;i++)output.copy(expanded,i*width,indices[i]*width,(indices[i]+1)*width);after.update(expanded)
  if(!expanded.equals(bytes))throw Error('Attribute changed during indexing')
  next[key]=store(output,{...a,count:representatives.length})
 }
 primitive.attributes=next;primitive.indices=store(Buffer.from(indices.buffer),{componentType:5125,count,type:'SCALAR'})
 beforeVertices+=count;afterVertices+=representatives.length;triangles+=count/3
}
g.accessors=accessors;g.bufferViews=views;g.buffers=parts.map((_,i)=>({uri:`indexed-${i}.bin`,byteLength:lengths[i]}))
for(const [i,p]of parts.entries())await writeFile(`${dir}/${g.buffers[i].uri}`,Buffer.concat(p))
await writeFile(path,JSON.stringify(g,null,2)+'\n')
const a=JSON.parse(await readFile('assets.json','utf8')),files=a.files['v2-stopped-preview-019'].files
for(const p of old)delete files[p];for(const b of g.buffers)files[b.uri]=`${dir}/${b.uri}`
await writeFile('assets.json',JSON.stringify(a,null,2)+'\n');for(const p of old)await unlink(`${dir}/${p}`)
const report={beforeBytes:inputs.reduce((n,b)=>n+b.length,0),afterBytes:lengths.reduce((n,b)=>n+b,0),beforeVertices,afterVertices,triangles,beforeExpandedSha256:before.digest('hex'),afterExpandedSha256:after.digest('hex'),method:'Bit-exact complete Float32 attribute tuples; per-mesh indices; unchanged triangle sequence and winding'}
await writeFile(`${dir}/indexing.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
