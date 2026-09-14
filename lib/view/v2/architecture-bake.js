// Offline adaptation of the existing licensed photoscan. Never downloads or changes source assets.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {MeshoptSimplifier} from 'meshoptimizer'
const dir=new URL('../../../assets/models/selected/5986d1487d9443b883d67b121c2c903c/',import.meta.url)
const gltf=JSON.parse(await readFile(new URL('scene.gltf',dir),'utf8'))
const bytes=await readFile(new URL('scene.bin',dir))
function accessor(index){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3}[a.type],Type={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];return new Type(bytes.buffer,bytes.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*size)}
await MeshoptSimplifier.ready
const regions=[[-.9,1.35,.76],[.45,2.55,.76],[.75,2.25,.76],[.9,2.1,.76],[1.2,1.95,.76],[-.75,1.2,.76],[-1.05,1.35,.76],[.3,2.55,.76]]
const patches=[]
for(const [patchId,[cx,cz,width]]of regions.entries()){
 const groups=[];let all=[]
 for(const [atlas,m]of gltf.meshes.entries()){
  const prim=m.primitives[0],pos=accessor(prim.attributes.POSITION),uv=accessor(prim.attributes.TEXCOORD_0),nor=accessor(prim.attributes.NORMAL),ix=accessor(prim.indices)
  const vertices=[],normals=[],tex=[],indices=[],weld=new Map()
  for(let i=0;i<ix.length;i+=3){const ids=[ix[i],ix[i+1],ix[i+2]]
   if(!ids.every(j=>Math.abs(pos[j*3]-cx)<width/2&&Math.abs(pos[j*3+2]-cz)<width/2))continue
   for(const j of ids){const key=[pos[j*3],pos[j*3+1],pos[j*3+2],uv[j*2],uv[j*2+1]].join(',');let k=weld.get(key)
    if(k===undefined){k=vertices.length/3;weld.set(key,k);vertices.push(...pos.slice(j*3,j*3+3));normals.push(...nor.slice(j*3,j*3+3));tex.push(...uv.slice(j*2,j*2+2))}indices.push(k)
   }
  }
  if(!indices.length)continue
  const [result]=MeshoptSimplifier.simplify(new Uint32Array(indices),new Float32Array(vertices),3,Math.min(indices.length,360),.045,['LockBorder'])
  const out={atlas,positions:[],normals:[],uv:[]}
  for(const j of result){out.positions.push(...vertices.slice(j*3,j*3+3));out.normals.push(...normals.slice(j*3,j*3+3));out.uv.push(...tex.slice(j*2,j*2+2))}
  groups.push(out);all.push(...out.positions)
 }
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
 for(let i=0;i<all.length;i++) {const k=i%3;min[k]=Math.min(min[k],all[i]);max[k]=Math.max(max[k],all[i])}
 const span=max.map((v,i)=>v-min[i])
 for(const group of groups){for(let i=0;i<group.positions.length;i++){const k=i%3;group.positions[i]=+(k===1?(group.positions[i]-min[k])/span[k]:(group.positions[i]-(min[k]+max[k])/2)/span[k]).toFixed(6)}group.normals=group.normals.map(v=>+v.toFixed(5));group.uv=group.uv.map(v=>+v.toFixed(6))}
 patches.push({id:patchId,sourceCenter:[cx,cz],sourceSpan:span,groups,triangles:all.length/9})
}
const data={sourceBinSha256:createHash('sha256').update(bytes).digest('hex'),source:'5986d1487d9443b883d67b121c2c903c',author:'GameDev Nick',license:'CC-BY-4.0',changes:'Eight broad low-relief perimeter topology patches, position-only edge-collapse decimation with atlas seam/border preservation. Original atlas UVs retained. Normalized footprint and height for support-bounded dressing.',patches}
await writeFile(new URL('../../../assets/v2/architecture/rubble-patches.json',import.meta.url),JSON.stringify(data)+'\n')
console.log(patches.map(p=>({id:p.id,triangles:p.triangles,span:p.sourceSpan})))
