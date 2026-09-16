import {Group,Mesh2,BufferGeometry,BufferAttribute} from 'threepipe'
import {installV2LinearFog} from './fog.js'
import {replaceRuntimeWallShells} from './architecture-shells.js'
import {bakedMapKey} from './baked-recipe.js'
import {releaseSubtree} from '../mesh-release.js'
const slots=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap','bumpMap','displacementMap','lightMap','envMap']
// The bake's extras carry the fine-field and collapse records the offline
// builder wrote: 15,000 objects of boxed numbers that nothing reads at runtime.
// Their counts are republished below; the records themselves stay in the file.
const HEAVY=['aggregateFragments','collapseFragments']
const semantic=data=>Object.fromEntries(Object.entries(data||{}).filter(([k])=>!['gltfUUID','kite3dAuthoring','kiteAuthoring','EntityComponentPlugin','gltfExtensions','__autoBubbleToParentEvents',...HEAVY].includes(k)))
function findSource({viewer,refs,map,preview},kind) {
  if(preview||refs?.v2ArchitectureIO)return null
  const key=bakedMapKey(map),roots=refs?.v2BakedPreviewSource
  let found
  for(const root of [ ...(Array.isArray(roots)?roots:roots?[roots]:[]),viewer?.scene?.modelRoot])root?.traverse?.(o=>{
    if(o.userData?.v2BakedMapKey===key&&o.userData?.v2BakedKind===kind)found=o
  })
  if(!found)return null
  let meshes=0,valid=true
  found.traverse(o=>{if(!o.isMesh)return;meshes++;const g=o.geometry
    if(!g?.attributes?.position||!g.attributes.normal||!g.attributes.uv||!o.material||Array.isArray(o.material))valid=false
    if(o.position.lengthSq()>1e-12||o.scale.distanceToSquared({x:1,y:1,z:1})>1e-12||Math.abs(o.quaternion.w-1)>1e-12)valid=false
  })
  return valid&&meshes===found.userData.v2BakedMeshCount?found:null
}
function ownership(context,source,name) {
  const root=new Group();root.name=name;root.userData={...semantic(source.userData),preview:false,v2BakedReuse:true};context.root.add(root)
  const materials=new Map(),geometries=[],fog=[],borrowed=new Map();let disposed=false
  context.viewer?.scene?.modelRoot?.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){const match=m?.name?.match(/^Selected rubble (\d):/);if(match&&m.map)borrowed.set(Number(match[1]),m)}})
  function material(mesh){
    const original=mesh.material,key=original.name
    if(materials.has(key))return materials.get(key)
    const atlas=key.match(/atlas[ _](\d)/i),source=atlas&&borrowed.get(Number(atlas[1]))||original
    const m=new source.constructor().copy(source)
    m.name=original.name;m.userData={...semantic(original.userData)};m.fog=true
    m.vertexColors=Boolean(mesh.geometry.attributes.color)
    m.setDirty?.({needsUpdate:false,refreshUi:false})
    materials.set(key,m);fog.push(installV2LinearFog(m,{owned:true}));return m
  }
  function add(mesh,parent=root,geometry=mesh.geometry){
    const copy=new Mesh2(geometry,material(mesh));copy.name=mesh.userData.name||mesh.name.replaceAll('_',' ')
    copy.userData={...semantic(mesh.userData),preview:false,v2BakedReuse:true}
    copy.castShadow=mesh.castShadow;copy.receiveShadow=mesh.receiveShadow;copy.matrixAutoUpdate=false;parent.add(copy);return copy
  }
  return {root,geometries,material,add,dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const h of fog)h.dispose();for(const g of geometries)g.dispose();for(const m of materials.values()){for(const slot of slots)m[slot]=null;m.setDirty?.({needsUpdate:false,refreshUi:false});m.dispose()}releaseSubtree(root);root.clear();context.viewer?.setDirty?.()}}
}
function attributes(g){return Object.fromEntries(Object.entries(g.attributes).map(([k,a])=>[k==='_v2fracturemask'?'v2FractureMask':k,a]))}
// Concatenate complete vertices and adjust indices. No quantization, smoothing,
// simplification or material merging: original cell/surface draw boundaries stay.
export function mergeBakedGeometry(meshes) {
  const records=meshes.map(m=>({g:m.geometry,attrs:attributes(m.geometry)})),sizes=new Map()
  let vertices=0,elements=0
  for(const {g,attrs}of records){vertices+=attrs.position.count;elements+=g.index?.count||attrs.position.count;for(const [k,a]of Object.entries(attrs))sizes.set(k,a.itemSize)}
  const arrays=new Map([...sizes].map(([k,size])=>[k,new Float32Array(vertices*size)])),indices=new Uint32Array(elements)
  let vertex=0,element=0
  for(const {g,attrs}of records){
    for(const [k,a]of Object.entries(attrs))arrays.get(k).set(a.array,vertex*a.itemSize)
    const count=g.index?.count||attrs.position.count
    for(let i=0;i<count;i++)indices[element++]=vertex+(g.index?g.index.getX(i):i)
    vertex+=attrs.position.count
  }
  const geometry=new BufferGeometry()
  for(const [k,array]of arrays)geometry.setAttribute(k,new BufferAttribute(array,sizes.get(k)))
  geometry.setIndex(new BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry
}
export function mountBakedArchitecture(context) {
  const source=findSource(context,'architecture');if(!source)return null
  const handle=ownership(context,source,'V2 Ruined Architecture'),groups=new Map()
  const centers=new Map(context.map.colliders.map(c=>[c.id,c.center]))
  for(const s of source.userData.skylineLayout||[])centers.set(s.id,{x:s.x,z:s.z})
  let shells
  try {
    shells=replaceRuntimeWallShells(context.root,context.map.colliders.filter(c=>['wall','building_wall','tunnel_wall','column'].includes(c.kind)))
    for(const mesh of source.children){
      if(!mesh.isMesh){
        if(mesh.userData.v2PileCover){const cover=new Group();cover.name='V2 Declared Collapse Cover';cover.userData={...semantic(mesh.userData),preview:false};handle.root.add(cover);mesh.traverse(o=>{if(o.isMesh)handle.add(o,cover)})}
        continue
      }
      if(mesh.userData.architectureSurface==='photoscan'){handle.add(mesh);continue}
      const id=mesh.userData.sourceColliderIds?.[0],center=centers.get(id?.replace(/^collapse:/,''))
      if(!center)throw Error(`Baked source has no collider center: ${id}`)
      const key=`${Math.floor(center.x/24)},${Math.floor(center.z/24)}:${mesh.userData.architectureSurface}`
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mesh)
    }
    for(const [key,meshes]of groups){
      const geometry=mergeBakedGeometry(meshes);handle.geometries.push(geometry)
      const copy=handle.add(meshes[0],handle.root,geometry),split=key.lastIndexOf(':')
      copy.name=`V2 architecture ${key.slice(0,split)} · ${key.slice(split+1)}`
      copy.userData.sourceColliderIds=[...new Set(meshes.flatMap(m=>m.userData.sourceColliderIds||[]))]
      copy.userData.v2FractureMask=Boolean(geometry.attributes.v2FractureMask)
    }
    const stats={...source.userData.stats,replacedWallBatches:shells.count,bakedReuse:true}
    let count=0;handle.root.traverse(o=>{if(o.isMesh)count++});stats.meshes=count;handle.root.userData.stats={...stats}
    const dispose=handle.dispose;return {root:handle.root,stats,ready:Promise.resolve(),sync(){},dispose(){dispose();shells.dispose()}}
  } catch(error){handle.dispose();shells?.dispose();throw error}
}
export function mountBakedGround(context) {
  const source=findSource(context,'ground');if(!source)return null
  const handle=ownership(context,source,'V2 Ground Aggregate')
  try{source.traverse(o=>{if(o.isMesh)handle.add(o)})}catch(e){handle.dispose();throw e}
  const stats={...source.userData.v2BakedStats,ready:true,disposed:false,bakedReuse:true}
  // Same contract as the procedural mount: how many fine fragments this root has.
  handle.root.userData.aggregateFragments={count:source.userData.aggregateFragments?.length||stats.patches||0}
  return {root:handle.root,stats,ready:Promise.resolve(),sync(){},dispose(){stats.disposed=true;handle.dispose()}}
}
