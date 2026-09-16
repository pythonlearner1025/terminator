import {mountBakedGround} from './baked-environment.js'
import {installV2LinearFog} from './fog.js'
import {Group, Mesh2, PhysicalMaterial, BufferGeometry, Float32BufferAttribute, TextureLoader, SRGBColorSpace, DoubleSide} from 'threepipe'
import data from '../../../assets/v2/ground/fragments.json' with {type:'json'}
import {groundLayout} from './ground-layout.js'
import {releaseSubtree} from '../mesh-release.js'

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
  const buckets=Array.from({length:5},()=>({positions:null,normals:null,uv:null,colors:null,vertices:0,sources:new Set()}))
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
  // Two passes, no array growth. The field layout is deterministic, so the
  // first pass measures it and the second writes vertices straight into their
  // final buffers. The old build grew five plain Arrays with `push` and
  // `push(...spread)`, boxing millions of doubles through the young generation
  // in the one frame that starts Play, and kept 11,900 boxed records after.
  const layout=groundLayout(map,data.finePatches.length)
  // Float64, not Float32: pass two does the vertex maths from these, and the
  // baked environment is compared against this output triangle for triangle.
  const fragments={count:layout.length,
    x:new Float64Array(layout.length),y:new Float64Array(layout.length),z:new Float64Array(layout.length),
    width:new Float64Array(layout.length),depth:new Float64Array(layout.length),height:new Float64Array(layout.length),
    yaw:new Float64Array(layout.length),edgeLip:new Float64Array(layout.length),
    variant:new Uint8Array(layout.length),sourceIndex:new Uint8Array(layout.length),source:[]}
  const sourceIndices=new Map()
  // Upper bound: every boundary edge contributes six vertices unless its two
  // ends land on the same spot, which pass two detects and skips.
  const capacity=new Uint32Array(buckets.length)
  for(const [index,record] of layout.entries()){
    const patch=data.finePatches[record.variant],fit=fitGroundPatch(patch.sourceSpan,record)
    const lip=fit.width*fit.depth>.075?.007:0
    if(lip)stats.solidFragments++
    fragments.x[index]=record.x;fragments.y[index]=record.y;fragments.z[index]=record.z
    fragments.width[index]=fit.width;fragments.depth[index]=fit.depth;fragments.height[index]=fit.height
    fragments.yaw[index]=record.yaw;fragments.edgeLip[index]=lip;fragments.variant[index]=record.variant
    let source=sourceIndices.get(record.source)
    if(source===undefined){source=fragments.source.push(record.source)-1;sourceIndices.set(record.source,source)}
    fragments.sourceIndex[index]=source
    for(const [groupIndex,group] of patch.groups.entries()){
      buckets[group.atlas].sources.add(record.source)
      capacity[group.atlas]+=group.positions.length/3+(lip?boundaries[record.variant][groupIndex].length*6:0)
      for(let i=0;i<group.positions.length;i+=9){const p=group.positions;stats.coverageM2+=Math.abs((p[i+3]-p[i])*(p[i+8]-p[i+2])-(p[i+6]-p[i])*(p[i+5]-p[i+2]))*.5*fit.width*fit.depth}
      stats.topTriangles+=group.positions.length/9
    }
    stats.patches++;stats.bySupport[record.source]=(stats.bySupport[record.source]||0)+1
    stats.footprintM2+=fit.width*fit.depth;stats.maxHeight=Math.max(stats.maxHeight,fit.height+.002+lip)
  }
  for(const [atlas,b] of buckets.entries()){
    b.positions=new Float32Array(capacity[atlas]*3);b.normals=new Float32Array(capacity[atlas]*3)
    b.uv=new Float32Array(capacity[atlas]*2);b.colors=new Float32Array(capacity[atlas]*3)
    b.vertices=0
  }
  for(let index=0;index<layout.length;index++){
    const variant=fragments.variant[index],patch=data.finePatches[variant]
    const x0=fragments.x[index],y0=fragments.y[index],z0=fragments.z[index]
    const width=fragments.width[index],depth=fragments.depth[index],height=fragments.height[index]
    const lip=fragments.edgeLip[index],cs=Math.cos(fragments.yaw[index]),sn=Math.sin(fragments.yaw[index])
    for(const [groupIndex,group] of patch.groups.entries()){
      const b=buckets[group.atlas]
      for(let i=0;i<group.positions.length;i+=3){
        const x=group.positions[i]*width,y=group.positions[i+1]*height,z=group.positions[i+2]*depth
        let nx=group.normals[i]*patch.sourceSpan[0]/width,ny=group.normals[i+1]*patch.sourceSpan[1]/height,nz=group.normals[i+2]*patch.sourceSpan[2]/depth
        const length=Math.hypot(nx,ny,nz)||1;nx/=length;ny/=length;nz/=length
        const v=b.vertices++,p3=v*3,p2=v*2
        b.positions[p3]=x0+x*cs+z*sn;b.positions[p3+1]=y0+.002+lip+y;b.positions[p3+2]=z0-x*sn+z*cs
        b.normals[p3]=nx*cs+nz*sn;b.normals[p3+1]=ny;b.normals[p3+2]=-nx*sn+nz*cs
        b.uv[p2]=group.uv[i/3*2];b.uv[p2+1]=group.uv[i/3*2+1]
        b.colors[p3]=1;b.colors[p3+1]=1;b.colors[p3+2]=1
      }
      if(!lip)continue
      for(const [a,c] of boundaries[variant][groupIndex]){
        const top=index2=>{const x=group.positions[index2]*width,z=group.positions[index2+2]*depth;return [x0+x*cs+z*sn,y0+.002+lip+group.positions[index2+1]*height,z0-x*sn+z*cs]}
        const pa=top(a),pc=top(c),baseA=[pa[0],y0+.001,pa[2]],baseC=[pc[0],y0+.001,pc[2]],dx=pc[0]-pa[0],dz=pc[2]-pa[2],length=Math.hypot(dx,dz)
        if(length<1e-8)continue
        for(const [point,source] of [[pa,a],[baseA,a],[baseC,c],[pa,a],[baseC,c],[pc,c]]){
          const v=b.vertices++,p3=v*3,p2=v*2
          b.positions[p3]=point[0];b.positions[p3+1]=point[1];b.positions[p3+2]=point[2]
          b.normals[p3]=-dz/length;b.normals[p3+1]=0;b.normals[p3+2]=dx/length
          b.uv[p2]=group.uv[source/3*2];b.uv[p2+1]=group.uv[source/3*2+1]
          b.colors[p3]=.65;b.colors[p3+1]=.65;b.colors[p3+2]=.65
        }
        stats.edgeTriangles+=2
      }
    }
  }
  stats.triangles=stats.topTriangles+stats.edgeTriangles
  // The runtime only asks how many fragments this root carries. The layout
  // arrays stay for offline audits and tests; they are 11 typed arrays, not
  // 11,900 objects holding eight boxed numbers each.
  owned.userData.aggregateFragments=fragments
  for(const [atlas,b]of buckets.entries()){
    if(!b.vertices)continue
    const geometry=new BufferGeometry()
    // Degenerate boundary edges are skipped, so trim the reserve before upload.
    const exact=(array,size)=>array.length===b.vertices*size?array:array.slice(0,b.vertices*size)
    for(const [key,array,size]of [['position',b.positions,3],['normal',b.normals,3],['uv',b.uv,2],['color',b.colors,3]])geometry.setAttribute(key,new Float32BufferAttribute(exact(array,size),size))
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
    textures.clear();releaseSubtree(owned);owned.clear();viewer?.setDirty?.()
  }
  return {root:owned,ready,stats,sync(_world){},dispose}
}
