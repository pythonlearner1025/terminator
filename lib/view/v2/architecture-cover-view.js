import {Group, Mesh2, PhysicalMaterial, BufferGeometry, BufferAttribute, TextureLoader, SRGBColorSpace, DoubleSide} from 'threepipe'
import {installV2LinearFog} from './fog.js'
import {declaredV2ArchitectureCover} from './architecture-cover.js'
import scan from '../../../assets/v2/architecture/rubble-cover.json' with {type:'json'}

/** Full native piles, five atlas batches per interior (shared materials). No map, authored mesh or texture edits.
 * Optional I/O injection supports headless tests; production uses project URLs.
 */
export function mountV2CoverGeometry({viewer, root, map, preview=false, loadBinary, loadTexture}) {
  const specs=declaredV2ArchitectureCover(map)
  const stats={piles:specs.length,triangles:0,meshes:0,materials:0,geometryBytes:0}
  if (!specs.length) return {stats,ready:Promise.resolve(),dispose(){}}
  const owned=new Group()
  owned.name='V2 Declared Collapse Cover'
  owned.userData={v2Architecture:true,v2PileCover:true,preview,selectable:true,sourceColliderIds:specs.map(c=>c.id)}
  root.add(owned)
  const materials=[],textures=new Set(),geometries=[],fogHandles=[],borrowed=new Map()
  let disposed=false
  const abort=new AbortController()
  for (const source of [root,viewer?.scene?.modelRoot]) source?.traverse?.(object=>{
    for (const m of Array.isArray(object.material)?object.material:[object.material]) {
      const match=m?.name?.match(/^Selected rubble (\d):/)
      if (match && m.map) borrowed.set(Number(match[1])-1,m)
    }
  })
  const textureLoads=[]
  for (let i=0;i<5;i++) {
    const source=borrowed.get(i)
    const material=source?new source.constructor().copy(source):new PhysicalMaterial({color:0xffffff,roughness:1,metalness:0,side:DoubleSide})
    material.name=`V2 full collapse atlas ${i+1}`
    material.fog=true
    material.userData={...material.userData,v2Architecture:true,v2Surface:'preserve',architectureSurface:'photoscan',v2PileCover:true,sourceAsset:scan.source}
    materials.push(material)
    fogHandles.push(installV2LinearFog(material,{owned:true}))
    if (!source && (loadTexture || typeof document!=='undefined')) {
      const url=new URL(`../../../assets/models/selected/${scan.source}/TextureAtlas_100${i+1}_baseColor.png`,import.meta.url).href
      textureLoads.push(Promise.resolve().then(()=>loadTexture?loadTexture(url):new TextureLoader().loadAsync(url)).then(texture=>{
        if (disposed) {texture.dispose();return}
        texture.colorSpace=SRGBColorSpace;texture.flipY=false
        texture.name=`V2 owned full collapse atlas ${i+1}`
        textures.add(texture);material.map=texture;material.setDirty?.()
      }))
    }
  }
  const url=new URL(`../../../assets/models/selected/${scan.source}/scene.bin`,import.meta.url).href
  const binary=Promise.resolve().then(()=>loadBinary?loadBinary(url,{signal:abort.signal}):fetch(url,{signal:abort.signal}).then(response=>{
    if (!response.ok) throw new Error(`V2 collapse source load failed: ${response.status}`)
    return response.arrayBuffer()
  }))
  const ready=Promise.all([binary,...textureLoads]).then(([bytes])=>{
    if (disposed) return
    const buffer=ArrayBuffer.isView(bytes)?bytes.buffer:bytes, offset=ArrayBuffer.isView(bytes)?bytes.byteOffset:0
    if (bytes.byteLength!==scan.byteLength) throw new Error('V2 full collapse source byte length changed')
    const read=a=>new ({5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.type])(buffer,offset+a.offset,a.count*a.components)
    const cx=(scan.min[0]+scan.max[0])/2,cz=(scan.min[2]+scan.max[2])/2
    const regions=[specs.filter(c=>c.id.includes('barracks')),specs.filter(c=>c.id.includes('service'))].filter(region=>region.length)
    for (const group of scan.groups) for (const region of regions) {
      const input=read(group.position),normal=read(group.normal),tex=read(group.uv),indices=read(group.index)
      // Preallocated typed buffers bound peak memory; no giant JS number arrays.
      const position=new Float32Array(indices.length*3*region.length),normals=new Float32Array(position.length),uv=new Float32Array(indices.length*2*region.length)
      let vertex=0
      for (const spec of region) {
        const p=spec.v2Pile,cs=Math.cos(p.yaw),sn=Math.sin(p.yaw)
        for (const j of indices) {
          const x=(input[j*3]-cx)*p.scale,y=(input[j*3+1]-scan.min[1])*p.scale,z=(input[j*3+2]-cz)*p.scale
          position[vertex*3]=p.x+x*cs+z*sn;position[vertex*3+1]=p.y+y;position[vertex*3+2]=p.z-x*sn+z*cs
          normals[vertex*3]=normal[j*3]*cs+normal[j*3+2]*sn;normals[vertex*3+1]=normal[j*3+1];normals[vertex*3+2]=-normal[j*3]*sn+normal[j*3+2]*cs
          uv[vertex*2]=tex[j*2];uv[vertex*2+1]=tex[j*2+1];vertex++
        }
      }
      const geometry=new BufferGeometry()
      geometry.setAttribute('position',new BufferAttribute(position,3));geometry.setAttribute('normal',new BufferAttribute(normals,3));geometry.setAttribute('uv',new BufferAttribute(uv,2))
      geometry.computeBoundingBox();geometry.computeBoundingSphere();geometries.push(geometry)
      const mesh=new Mesh2(geometry,materials[group.atlas])
      mesh.name=`V2 ${region[0].id.includes('barracks')?'barracks':'service'} collapse cover atlas ${group.atlas+1}`
      mesh.userData={v2Architecture:true,v2PileCover:true,v2Surface:'preserve',architectureSurface:'photoscan',sourceAsset:scan.source,sourceColliderIds:region.map(c=>c.id),preview,selectable:true,sourceTopology:'native-open-scan',atlas:group.atlas,verticesPerPile:indices.length}
      // The scan is an open measured surface. Do not enable a closed-solid-only
      // caster experiment on its boundary skirts or pretend it is watertight.
      mesh.castShadow=false;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false
      owned.add(mesh)
      stats.triangles+=indices.length/3*region.length;stats.meshes++
      stats.geometryBytes+=position.byteLength+normals.byteLength+uv.byteLength
    }
    stats.materials=materials.length;owned.userData.stats={...stats};viewer?.setDirty?.()
  }).catch(error=>{
    // A failed request still reports errors while mounted. After an explicit
    // stop, late network rejection is just cancellation, like late success.
    const cancelled=disposed
    dispose()
    if (!cancelled) throw error
  })
  function dispose() {
    if (disposed) return
    disposed=true;abort.abort();owned.removeFromParent()
    for (const h of fogHandles) h.dispose()
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) {
      // Borrowed atlas textures survive both normal stop and failed loads.
      for (const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap']) material[key]=null
      material.setDirty?.();material.dispose()
    }
    for (const texture of textures) texture.dispose()
    owned.clear();viewer?.setDirty?.()
  }
  return {root:owned,stats,ready,dispose}
}
