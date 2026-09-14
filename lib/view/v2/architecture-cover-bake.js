// Offline, serial extraction of conservative cover columns from the existing
// licensed full scan. Native geometry, normals, UVs and textures are not changed.
// Run: node --max-old-space-size=1024 lib/view/v2/architecture-cover-bake.js
import {readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'

const source = '5986d1487d9443b883d67b121c2c903c'
const directory = new URL(`../../../assets/models/selected/${source}/`, import.meta.url)
const document = JSON.parse(await readFile(new URL('scene.gltf', directory), 'utf8'))
const bytes = await readFile(new URL('scene.bin', directory))
const descriptor = index => {
  const a = document.accessors[index], b = document.bufferViews[a.bufferView]
  if ((b.byteStride && b.byteStride !== {SCALAR:1,VEC2:2,VEC3:3}[a.type]*{5126:4,5125:4,5123:2}[a.componentType]) || a.sparse) throw new Error('Source layout changed; review extraction')
  return {offset: (a.byteOffset || 0) + (b.byteOffset || 0), count: a.count, components: {SCALAR:1,VEC2:2,VEC3:3}[a.type], type: a.componentType}
}
const read = a => new ({5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.type])(bytes.buffer, bytes.byteOffset + a.offset, a.count * a.components)
const groups = document.meshes.map((mesh, atlas) => {
  if (mesh.primitives.length !== 1) throw new Error('Source primitive layout changed')
  const p = mesh.primitives[0]
  return {atlas, position:descriptor(p.attributes.POSITION), normal:descriptor(p.attributes.NORMAL), uv:descriptor(p.attributes.TEXCOORD_0), index:descriptor(p.indices)}
})
const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity]
for (const group of groups) {
  const p = read(group.position)
  for (let i=0;i<p.length;i++) {min[i%3]=Math.min(min[i%3],p[i]);max[i%3]=Math.max(max[i%3],p[i])}
}
const divisions = 12, dx = (max[0]-min[0])/divisions, dz = (max[2]-min[2])/divisions
const heights = new Float64Array(divisions*divisions).fill(-Infinity)
function clip(poly, axis, limit, sign) {
  const result=[]
  for (let i=0;i<poly.length;i++) {
    const a=poly[i], b=poly[(i+1)%poly.length], da=sign*(a[axis]-limit), db=sign*(b[axis]-limit)
    if (da>=0) result.push(a)
    if ((da>=0)!==(db>=0)) {const t=da/(da-db);result.push(a.map((v,j)=>v+(b[j]-v)*t))}
  }
  return result
}
let triangles=0
for (const group of groups) {
  const p=read(group.position), index=read(group.index)
  for (let i=0;i<index.length;i+=3) {
    const tri=[...index.subarray(i,i+3)].map(j=>[p[j*3],p[j*3+1],p[j*3+2]])
    const x0=Math.max(0,Math.floor((Math.min(...tri.map(v=>v[0]))-min[0])/dx)), x1=Math.min(divisions-1,Math.floor((Math.max(...tri.map(v=>v[0]))-min[0])/dx))
    const z0=Math.max(0,Math.floor((Math.min(...tri.map(v=>v[2]))-min[2])/dz)), z1=Math.min(divisions-1,Math.floor((Math.max(...tri.map(v=>v[2]))-min[2])/dz))
    for (let x=x0;x<=x1;x++) for (let z=z0;z<=z1;z++) {
      let poly=clip(tri,0,min[0]+x*dx,1)
      poly=clip(poly,0,min[0]+(x+1)*dx,-1)
      poly=clip(poly,2,min[2]+z*dz,1)
      poly=clip(poly,2,min[2]+(z+1)*dz,-1)
      for (const v of poly) heights[z*divisions+x]=Math.max(heights[z*divisions+x],v[1]-min[1])
    }
    triangles++
  }
}
const cells=[]
for (let z=0;z<divisions;z++) for (let x=0;x<divisions;x++) {
  const height=heights[z*divisions+x]
  if (!Number.isFinite(height)) continue
  // Two millimetres of numerical reserve, no metre-wide invisible bounding box.
  cells.push({x:(x+.5)*dx-(max[0]-min[0])/2,z:(z+.5)*dz-(max[2]-min[2])/2,width:dx,depth:dz,height:Math.max(.004,height+.002)})
}
const data={version:1,source,author:'GameDev Nick',license:'CC-BY-4.0',sourceUrl:`https://sketchfab.com/3d-models/rubble-pile-photoscan-optimized-${source}`,sourceBinSha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,triangles,min,max,groups,cells,divisions,changes:'Unmodified native full scan. Data-only 12x12 clipped-triangle height envelope for additive cover. Uniform runtime scale and yaw; original front topology, normals and atlas UVs retained. Open rear faces wall; not a closed shadow caster.'}
await writeFile(new URL('../../../assets/v2/architecture/rubble-cover.json',import.meta.url),JSON.stringify(data)+'\n')
console.log(JSON.stringify({triangles,cells:cells.length,sourceBytes:bytes.length,span:max.map((v,i)=>v-min[i])}))
