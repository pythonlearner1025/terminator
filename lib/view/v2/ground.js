import {mountBakedGround} from './baked-environment.js'
import {installV2LinearFog} from './fog.js'
import {Group, Mesh2, PhysicalMaterial, BufferGeometry, Float32BufferAttribute, TextureLoader, SRGBColorSpace, DoubleSide} from 'threepipe'
import data from '../../../assets/v2/ground/fragments.json' with {type:'json'}
import {groundLayout} from './ground-layout.js'

const mapSlots=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap','bumpMap','displacementMap','lightMap','envMap','clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','transmissionMap','thicknessMap','specularColorMap','specularIntensityMap','sheenColorMap','sheenRoughnessMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap']
// Cut-edge closure is only for larger visible chips. Original scan top attributes
// are unchanged; the shallow sides meet the existing support plane.
const boundaries=data.finePatches.map(p=>p.groups.map(g=>{
  const edges=new Map(),v=g.positions
  for(let i=0;i<v.length;i+=9)for(let j=0;j<3;j++){
    const a=i+j*3,b=i+(j+1)%3*3,key=[v.slice(a,a+3).join(','),v.slice(b,b+3).join(',')].sort().join('|')
    if(edges.has(key))edges.delete(key);else edges.set(key,[a,b])
  }
  return [...edges.values()]
}))
/** Uniform scale: preserve the source proportions in all three axes. */
export function fitGroundPatch(span,{width,depth,height}) {
  const horizontal=Math.min(width/span[0],depth/span[2],height/span[1])
  return {width:span[0]*horizontal,depth:span[2]*horizontal,height:span[1]*horizontal}
}

/** Static map-local, finite opaque batches. Does not change authored content or viewer settings.
 * loadTexture is an optional CPU test seam. In Node, existing maps are cloned; no DOM loads.
 */
export function mountV2Ground({viewer,root,map,refs,preview=false,loadTexture}={}) {
  const baked=mountBakedGround({viewer,root,map,refs,preview})
  if(baked)return baked
  if(!root?.add||!Array.isArray(map?.colliders))throw new TypeError('V2 ground requires root and map.colliders')
  const owned=new Group();owned.name='V2 Ground Aggregate'
  owned.userData={v2Ground:true,preview,seed:1984,selectable:true}
  root.add(owned)
  const materials=[],geometries=[],textures=new Set(),sourceTextures=new Map(),sourceMaterials=new Map()
  const buckets=Array.from({length:5},()=>({positions:[],normals:[],uv:[],colors:[],sources:new Set()}))
  const stats={patches:0,triangles:0,topTriangles:0,edgeTriangles:0,solidFragments:0,draws:0,materials:5,textures:0,sharedImages:0,coverageM2:0,footprintM2:0,maxHeight:0,bySupport:{},ready:false,disposed:false}
  let disposed=false
  for(const source of [root,viewer?.scene?.modelRoot])source?.traverse?.(object=>{
    for(const mat of Array.isArray(object.material)?object.material:[object.material]){
      const match=mat?.name?.match(/^Selected rubble (\d):/)
      if(match&&mat.map)sourceMaterials.set(Number(match[1])-1,mat)
    }
  })
  function cloneTexture(source) {
    if(!sourceTextures.has(source)){
      // Separate disposable Texture object, shared immutable image/Source. Three's
      // GPU texture cache ref-counts the shared Source; original texture stays live.
      const texture=source.clone();texture.name=`${source.name || 'rubble atlas'} · V2 ground owned handle`
      texture.userData={...texture.userData,v2Ground:true};textures.add(texture);sourceTextures.set(source,texture)
      stats.sharedImages++;stats.textures=textures.size
    }
    return sourceTextures.get(source)
  }
  const loads=[],fogHandles=[]
  for(let atlas=0;atlas<5;atlas++){
    const source=sourceMaterials.get(atlas)
    const material=source?new source.constructor().copy(source):new PhysicalMaterial({color:0xffffff,roughness:1,metalness:0,side:DoubleSide})
    if(source)for(const slot of mapSlots)if(source[slot]?.isTexture)material[slot]=cloneTexture(source[slot])
    material.name=`V2 ground scanned aggregate atlas ${atlas+1}`
    material.userData={...material.userData,v2Ground:true,v2Surface:'preserve',sourceAsset:data.source}
    material.vertexColors=true
    // Threepipe PhysicalMaterial defaults fog=false. Ground is world geometry.
    material.fog=true
    // copy() subscribed this owned material to source atlas updates. Refresh after
    // slot replacement so Threepipe detaches only this material's old callbacks.
    material.setDirty?.({needsUpdate:false,refreshUi:false})
    materials.push(material)
    fogHandles.push(installV2LinearFog(material,{owned:true}))
    if(!source&&(loadTexture||typeof document!=='undefined')){
      const url=new URL(`../../../assets/models/selected/${data.source}/TextureAtlas_100${atlas+1}_baseColor.png`,import.meta.url).href
      loads.push(Promise.resolve().then(()=>loadTexture?loadTexture(url):new TextureLoader().loadAsync(url)).then(texture=>{
        if(disposed){texture.dispose();return}
        texture.colorSpace=SRGBColorSpace;texture.flipY=false;texture.name=`V2 ground owned fallback atlas ${atlas+1}`
        textures.add(texture);stats.textures=textures.size;material.map=texture;material.setDirty?.();viewer?.setDirty?.()
      }))
    }
  }
  const records=groundLayout(map,data.finePatches.length)
  for(const record of records){
    const patch=data.finePatches[record.variant],fit=fitGroundPatch(patch.sourceSpan,record),cs=Math.cos(record.yaw),sn=Math.sin(record.yaw)
    Object.assign(record,fit)
    const lip=fit.width*fit.depth>.075?.007:0
    record.edgeLip=lip;if(lip)stats.solidFragments++
    for(const [groupIndex,group] of patch.groups.entries()){const b=buckets[group.atlas];b.sources.add(record.source)
      for(let i=0;i<group.positions.length;i+=3){
        const x=group.positions[i]*fit.width,y=group.positions[i+1]*fit.height,z=group.positions[i+2]*fit.depth
        b.positions.push(record.x+x*cs+z*sn,record.y+.002+lip+y,record.z-x*sn+z*cs)
        let nx=group.normals[i]*patch.sourceSpan[0]/fit.width,ny=group.normals[i+1]*patch.sourceSpan[1]/fit.height,nz=group.normals[i+2]*patch.sourceSpan[2]/fit.depth
        const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length;b.normals.push(nx*cs+nz*sn,ny,-nx*sn+nz*cs);b.colors.push(1,1,1)
      }
      b.uv.push(...group.uv)
      for(let i=0;i<group.positions.length;i+=9){const p=group.positions;stats.coverageM2+=Math.abs((p[i+3]-p[i])*(p[i+8]-p[i+2])-(p[i+6]-p[i])*(p[i+5]-p[i+2]))*.5*fit.width*fit.depth}
      stats.topTriangles+=group.positions.length/9
      if(lip)for(const [a,c]of boundaries[record.variant][groupIndex]){
        const top=index=>{const x=group.positions[index]*fit.width,z=group.positions[index+2]*fit.depth;return [record.x+x*cs+z*sn,record.y+.002+lip+group.positions[index+1]*fit.height,record.z-x*sn+z*cs]}
        const pa=top(a),pc=top(c),baseA=[pa[0],record.y+.001,pa[2]],baseC=[pc[0],record.y+.001,pc[2]],dx=pc[0]-pa[0],dz=pc[2]-pa[2],length=Math.hypot(dx,dz)
        if(length<1e-8)continue
        for(const [point,index]of [[pa,a],[baseA,a],[baseC,c],[pa,a],[baseC,c],[pc,c]]){
          b.positions.push(...point);b.normals.push(-dz/length,0,dx/length);b.uv.push(group.uv[index/3*2],group.uv[index/3*2+1]);b.colors.push(.65,.65,.65)
        }
        stats.edgeTriangles+=2
      }
    }
    stats.patches++;stats.bySupport[record.source]=(stats.bySupport[record.source]||0)+1
    stats.footprintM2+=fit.width*fit.depth;stats.maxHeight=Math.max(stats.maxHeight,fit.height+.002+lip)
  }
  stats.triangles=stats.topTriangles+stats.edgeTriangles
  owned.userData.aggregateFragments=records
  for(const [atlas,b]of buckets.entries()){
    if(!b.positions.length)continue
    const geometry=new BufferGeometry()
    for(const [key,array,size]of [['position',b.positions,3],['normal',b.normals,3],['uv',b.uv,2],['color',b.colors,3]])geometry.setAttribute(key,new Float32BufferAttribute(array,size))
    geometry.computeBoundingBox();geometry.computeBoundingSphere();geometries.push(geometry)
    const mesh=new Mesh2(geometry,materials[atlas]);mesh.name=`V2 ground aggregate atlas ${atlas+1}`
    mesh.userData={v2Ground:true,v2Surface:'preserve',selectable:true,preview,sourceAsset:data.source,sourceColliderIds:[...b.sources]}
    mesh.castShadow=false;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;owned.add(mesh);stats.draws++
  }
  const ready=Promise.all(loads).then(()=>{stats.ready=!disposed})
  // Mark rejection handled even when a caller stops before awaiting ready. It still
  // rejects for callers awaiting it, and disposes partial owned resources on error.
  ready.catch(()=>dispose())
  function dispose(){
    if(disposed)return;disposed=true;stats.disposed=true;owned.removeFromParent()
    for(const handle of fogHandles)handle.dispose()
    for(const geometry of geometries)geometry.dispose()
    for(const material of materials){for(const slot of mapSlots)if(material[slot]?.isTexture)material[slot]=null;material.setDirty?.({needsUpdate:false,refreshUi:false});material.dispose()}
    for(const texture of textures)texture.dispose()
    textures.clear();owned.clear();viewer?.setDirty?.()
  }
  return {root:owned,ready,stats,sync(_world){},dispose}
}
