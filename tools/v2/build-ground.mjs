// Offline adaptation of the existing licensed photoscan. Never downloads or changes source assets.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
// Optional CPU-only coverage audit; no asset rebuild, browser, or renderer.
if(process.argv.includes('--measure')) {
 globalThis.ImageData ??= class {};globalThis.window ??= {}
 const {Group}=await import('threepipe'),{defaultMap}=await import('../../lib/core/map.js'),{mountV2Ground}=await import('../../lib/view/v2/ground.js')
 const data=JSON.parse(await readFile(new URL('../../assets/v2/ground/fragments.json',import.meta.url),'utf8'))
 const handle=mountV2Ground({root:new Group(),map:defaultMap});await handle.ready
 const grid=.025,counts={},nx=Math.ceil((defaultMap.bounds.maxX-defaultMap.bounds.minX)/grid)
 for(const record of handle.root.userData.aggregateFragments){
  const result=counts[record.source]??={patches:0,projectedAreaM2:0,cells:new Set()},cs=Math.cos(record.yaw),sn=Math.sin(record.yaw);result.patches++
  for(const g of data.finePatches[record.variant].groups)for(let i=0;i<g.positions.length;i+=9){
   const p=[];for(let j=0;j<3;j++){const x=g.positions[i+j*3]*record.width,z=g.positions[i+j*3+2]*record.depth;p.push([record.x+x*cs+z*sn,record.z-x*sn+z*cs])}
   const [a,b,c]=p,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);result.projectedAreaM2+=Math.abs(den)*.5;if(Math.abs(den)<1e-12)continue
   const ix0=Math.floor((Math.min(...p.map(v=>v[0]))-defaultMap.bounds.minX)/grid),ix1=Math.floor((Math.max(...p.map(v=>v[0]))-defaultMap.bounds.minX)/grid),iz0=Math.floor((Math.min(...p.map(v=>v[1]))-defaultMap.bounds.minZ)/grid),iz1=Math.floor((Math.max(...p.map(v=>v[1]))-defaultMap.bounds.minZ)/grid)
   for(let iz=iz0;iz<=iz1;iz++)for(let ix=ix0;ix<=ix1;ix++){
    const x=defaultMap.bounds.minX+(ix+.5)*grid,z=defaultMap.bounds.minZ+(iz+.5)*grid,u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(z-c[1]))/den,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(z-c[1]))/den
    if(u>=0&&v>=0&&u+v<=1)result.cells.add(iz*nx+ix)
   }
  }
 }
 const regions=Object.fromEntries(Object.entries(counts).map(([id,result])=>{
  const floor=defaultMap.colliders.find(c=>c.id===id),slabArea=(floor.shapes||[{size:floor.size}]).reduce((a,p)=>a+p.size.x*p.size.z,0),union=result.cells.size*grid*grid
  return[id,{patches:result.patches,projectedAreaM2:result.projectedAreaM2,approximateUnionM2:union,staticSlabAreaM2:slabArea,approximateSlabCoverage:union/slabArea}]
 }))
 const report={method:'Center-sampled triangle projection union at 2.5 cm per cell per support. Denominator is gross static slab area (includes occupied cover footprints). No image-space or GPU inference.',cellMeters:grid,stats:structuredClone(handle.stats),regions}
 handle.dispose();await writeFile(new URL('../../assets/v2/ground/coverage.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(regions,null,2));process.exit(0)
}
const dir=new URL('../../assets/models/selected/5986d1487d9443b883d67b121c2c903c/',import.meta.url)
const gltf=JSON.parse(await readFile(new URL('scene.gltf',dir),'utf8'))
const bytes=await readFile(new URL('scene.bin',dir))
function accessor(index){const a=gltf.accessors[index],v=gltf.bufferViews[a.bufferView],size={SCALAR:1,VEC2:2,VEC3:3}[a.type],Type={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType];return new Type(bytes.buffer,bytes.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*size)}
// Find genuinely low nearby faces in THREE dimensions. The prototype's XZ-only
// nearest selection mixed different vertical shelves into tall sparse subsets.
const finePatches=[]
for(let atlas=0;atlas<5;atlas++){
 const prim=gltf.meshes[atlas].primitives[0],pos=accessor(prim.attributes.POSITION),uv=accessor(prim.attributes.TEXCOORD_0),nor=accessor(prim.attributes.NORMAL),ix=accessor(prim.indices)
 const faces=[]
 for(let i=0;i<ix.length;i+=3){const ids=[ix[i],ix[i+1],ix[i+2]],center=[0,1,2].map(k=>ids.reduce((s,j)=>s+pos[j*3+k],0)/3)
  if(center[1]<-.13&&ids.reduce((s,j)=>s+nor[j*3+1],0)/3>.75)faces.push({i,center})
 }
 const selected=[]
 for(let attempt=0;attempt<400&&selected.length<5;attempt++){
  const seed=faces[Math.floor(faces.length*((attempt*.61803398875+.17)%1))]
  if(selected.some(p=>Math.hypot(...p.center.map((v,k)=>v-seed.center[k]))<.075))continue
  const near=[...faces].sort((a,b)=>a.center.reduce((s,v,k)=>s+(v-seed.center[k])**2,0)-b.center.reduce((s,v,k)=>s+(v-seed.center[k])**2,0)).slice(0,12)
  const group={atlas,positions:[],normals:[],uv:[]}
  for(const face of near)for(const j of ix.slice(face.i,face.i+3)){group.positions.push(...pos.slice(j*3,j*3+3));group.normals.push(...nor.slice(j*3,j*3+3));group.uv.push(...uv.slice(j*2,j*2+2))}
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<group.positions.length;i++){const k=i%3;min[k]=Math.min(min[k],group.positions[i]);max[k]=Math.max(max[k],group.positions[i])}
  const sourceSpan=max.map((v,k)=>v-min[k]),[w,h,d]=sourceSpan
  if(Math.min(w,d)<.045||h<.001||h/Math.min(w,d)>.22||Math.max(w/d,d/w)>2.6)continue
  let area=0;const p=group.positions;for(let i=0;i<p.length;i+=9)area+=Math.abs((p[i+3]-p[i])*(p[i+8]-p[i+2])-(p[i+6]-p[i])*(p[i+5]-p[i+2]))*.5
  if(area/(w*d)<.35)continue
  group.positions=group.positions.map((v,i)=>{const k=i%3;return +((v-(k===1?min[k]:(min[k]+max[k])/2))/sourceSpan[k]).toFixed(6)})
  selected.push({center:seed.center});finePatches.push({id:finePatches.length,sourceSpan,groups:[group],triangles:group.positions.length/9})
 }
 if(selected.length<4)throw Error('Not enough native low subsets in atlas '+atlas)
}
const data={sourceBinSha256:createHash('sha256').update(bytes).digest('hex'),source:'5986d1487d9443b883d67b121c2c903c',author:'GameDev Nick',license:'CC-BY-4.0',changes:'Pilot03 refinement of transferred architecture fine field: 25 twelve-face subsets selected using 3D proximity, upward normals, native relief ratio at most .22, and meaningful projected area. Original source attributes retained; uniform scale only.',finePatches}
await writeFile(new URL('../../assets/v2/ground/fragments.json',import.meta.url),JSON.stringify(data)+'\n')
console.log({variants:finePatches.length,triangles:finePatches.reduce((s,p)=>s+p.triangles,0)})
