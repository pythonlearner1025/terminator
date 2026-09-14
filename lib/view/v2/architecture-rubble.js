import {installV2LinearFog} from './fog.js'
import {Mesh2, PhysicalMaterial, BufferGeometry, Float32BufferAttribute, TextureLoader, SRGBColorSpace, DoubleSide} from 'threepipe'
import data from '../../../assets/v2/architecture/rubble-patches.json' with {type:'json'}

/** Keep horizontal texture/topology aspect and bound vertical compression. */
export function fitScannedPatch(span,{width,depth,height}) {
  const horizontal=Math.min(width/span[0],depth/span[2],height/span[1]*1.8)
  return {width:span[0]*horizontal,depth:span[2]*horizontal,height:Math.min(height,span[1]*horizontal)}
}

/** Own copies of geometry/materials; existing selected atlas textures are borrowed read-only. */
export function createScannedRubble({viewer,root,preview=false,loadTexture}) {
  const buckets=Array.from({length:5},()=>({positions:[],normals:[],uv:[]})),materials=[],geometries=[],textures=[]
  const borrowed=new Map()
  for(const source of [root,viewer?.scene?.modelRoot])source?.traverse?.(m=>{
    for(const mat of Array.isArray(m.material)?m.material:[m.material]){
      const match=mat?.name?.match(/^Selected rubble (\d):/)
      if(match&&mat.map)borrowed.set(Number(match[1])-1,mat)
    }
  })
  let disposed=false,count=0,triangles=0
  const loads=[],fogHandles=[]
  for(let i=0;i<5;i++){
    const source=borrowed.get(i),m=source?new source.constructor().copy(source):new PhysicalMaterial({color:0xffffff,roughness:1,metalness:0,side:DoubleSide})
    m.fog=true // Owned copy only; Threepipe defaults PhysicalMaterial fog to false.
    m.name=`V2 scanned rubble atlas ${i+1}`
    m.userData={...m.userData,v2Surface:'preserve',v2Architecture:true,architectureSurface:'photoscan',sourceAsset:data.source}
    materials.push(m)
    fogHandles.push(installV2LinearFog(m,{owned:true}))
    if(!source&&(loadTexture||typeof document!=='undefined')){
      const url=new URL(`../../../assets/models/selected/${data.source}/TextureAtlas_100${i+1}_baseColor.png`,import.meta.url).href
      loads.push((loadTexture?loadTexture(url):new TextureLoader().loadAsync(url)).then(t=>{
        if(disposed){t.dispose();return}
        t.colorSpace=SRGBColorSpace;t.flipY=false;t.name=`V2 owned fallback rubble atlas ${i+1}`;textures.push(t);m.map=t;m.setDirty?.();viewer?.setDirty?.()
      }))
    }
  }
  return {
    ready:Promise.all(loads),
    add({x,y,z,width,depth,height,yaw,variant=0}){
      if(disposed||count>=190)return false
      const patch=data.patches[variant%data.patches.length],cs=Math.cos(yaw),sn=Math.sin(yaw)
      // Fit the source's natural horizontal aspect. Never stretch small upright
      // scan regions into broad wafer faces; vertical compression is bounded.
      const fit=fitScannedPatch(patch.sourceSpan,{width,depth,height})
      width=fit.width;depth=fit.depth;height=fit.height
      for(const g of patch.groups){const b=buckets[g.atlas]
        for(let i=0;i<g.positions.length;i+=3){
          const px=g.positions[i]*width,py=g.positions[i+1]*height,pz=g.positions[i+2]*depth
          b.positions.push(x+px*cs+pz*sn,y+py,z-px*sn+pz*cs)
          let nx=g.normals[i]*patch.sourceSpan[0]/width,ny=g.normals[i+1]*patch.sourceSpan[1]/height,nz=g.normals[i+2]*patch.sourceSpan[2]/depth
          const len=Math.hypot(nx,ny,nz)||1;nx/=len;ny/=len;nz/=len
          b.normals.push(nx*cs+nz*sn,ny,-nx*sn+nz*cs)
        }
        b.uv.push(...g.uv);triangles+=g.positions.length/9
      }
      count++;return true
    },
    finish(){
      for(const [i,b]of buckets.entries()){
        if(!b.positions.length)continue
        const g=new BufferGeometry()
        g.setAttribute('position',new Float32BufferAttribute(b.positions,3));g.setAttribute('normal',new Float32BufferAttribute(b.normals,3));g.setAttribute('uv',new Float32BufferAttribute(b.uv,2));g.computeBoundingBox();g.computeBoundingSphere()
        const m=new Mesh2(g,materials[i]);m.name=`V2 scanned collapse atlas ${i+1}`;m.userData={v2Architecture:true,v2Surface:'preserve',architectureSurface:'photoscan',selectable:true,sourceAsset:data.source,preview};m.castShadow=true;m.receiveShadow=true;m.matrixAutoUpdate=false;root.add(m);geometries.push(g)
      }
      return {patches:count,triangles,meshes:geometries.length,borrowedAtlases:borrowed.size}
    },
    dispose(){if(disposed)return;disposed=true;for(const h of fogHandles)h.dispose();for(const g of geometries)g.dispose();for(const m of materials){for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'])m[key]=null;m.setDirty?.();m.dispose()}for(const t of textures)t.dispose()},
  }
}
