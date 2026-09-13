import {unitMaterials} from './unit-materials.js'
import {combineOrmMaterial} from './orm-material.js'
let shared
export function rosterMaterials(E) {
  if (shared) return shared
  const pending=[], base=unitMaterials(E)
  const load=(file,srgb=false)=>{
    const promise=Promise.withResolvers();pending.push(promise.promise)
    const t=new E.TextureLoader().load(new URL(`../../assets/textures/roster/${file}`,import.meta.url).href,promise.resolve,undefined,promise.reject)
    t.name=file;t.colorSpace=srgb?E.SRGBColorSpace:E.NoColorSpace;t.anisotropy=4
    t.wrapS=t.wrapT=E.RepeatWrapping
    return t
  }
  const surface=(prefix,name)=>{
    const orm=load(`${prefix}-orm.png`)
    const material=new E.PhysicalMaterial({name,map:load(`${prefix}-albedo.jpg`,true),normalMap:load(`${prefix}-normal.png`),
      roughnessMap:orm,metalnessMap:orm,aoMap:orm,metalness:1,roughness:1,envMapIntensity:prefix==='liquid'?.65:.32})
    material.userData.renderToGBuffer=false
    combineOrmMaterial(material)
    return material
  }
  const chrome=surface('liquid','Mimetic polyalloy 1K'),armor=surface('hk','Hunter Killer worn armor 1K')
  chrome.normalScale.set(.34,.34)
  const light=base.eye.clone();light.name='Hunter Killer optical glass';light.emissive.setHex(0xff2815)
  const ready=Promise.all([...pending,base.ready]).then(()=>{
    for(const material of [chrome,armor,light]) {material.envMap=base.metal.envMap;material.needsUpdate=true}
  })
  shared={chrome,armor,light,ready,glowMap:base.glowMap};return shared
}

// One compiled program per material family. Each pooled rig owns its uniform values.
export function animatedRosterMaterial(E,type) {
  const source=rosterMaterials(E)[type==='t1000'?'chrome':'armor'],m=source.clone()
  const state={time:{value:0},ripple:{value:0},regen:{value:0},scroll:{value:0},hitY:{value:1.2}}
  const baseCompile=m.onBeforeCompile.bind(m),key=m.customProgramCacheKey.bind(m)
  m.onBeforeCompile=(shader,renderer)=>{
    baseCompile(shader,renderer)
    Object.assign(shader.uniforms,{rosterTime:state.time,rosterRipple:state.ripple,rosterRegen:state.regen,rosterScroll:state.scroll,rosterHitY:state.hitY})
    shader.vertexShader='varying vec3 rosterPosition;\nuniform float rosterScroll;\n'+shader.vertexShader
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrosterPosition = position;')
    if(type==='hktank')shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      if(uv.x>.5 && uv.y<.5) {
        float t=.008+mod(uv.y-.008+rosterScroll,.484);
        vMapUv.y=t; vNormalMapUv.y=t; vRoughnessMapUv.y=t; vMetalnessMapUv.y=t; vAoMapUv.y=t;
      }`)
    shader.fragmentShader='varying vec3 rosterPosition;\nuniform float rosterTime,rosterRipple,rosterRegen,rosterHitY;\n'+shader.fragmentShader
    if(type==='t1000')shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      float ring=sin((rosterPosition.y-rosterHitY)*30.0-rosterTime*22.0)*rosterRipple;
      float flow=sin(rosterPosition.y*13.0+rosterPosition.x*9.0-rosterTime*1.3);
      normal=normalize(normal+vec3(flow*.009+ring*.17,ring*.065,flow*.012));`)
    if(type==='t1000')shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float sweep=pow(max(0.0,sin(rosterPosition.y*15.0-rosterTime*9.0)),12.0);
      totalEmissiveRadiance+=vec3(.18,.33,.4)*sweep*rosterRegen;`)
  }
  m.customProgramCacheKey=()=>key()+':roster-'+type+'-v1'
  rosterMaterials(E).ready.then(()=>{m.envMap=source.envMap;m.needsUpdate=true})
  return {material:m,uniforms:state}
}
