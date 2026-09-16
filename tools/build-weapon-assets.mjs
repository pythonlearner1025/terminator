#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {Document,NodeIO} from '@gltf-transform/core'
import {buildWeapon,IDS} from './weapons/models.mjs'
import {buildHands} from './weapons/hands.mjs'
import {bakeGripPoses} from './weapons/fit-grips.mjs'
const root=new URL('../',import.meta.url),io=new NodeIO(),manifest=JSON.parse(await readFile(new URL('assets.json',root),'utf8'))
manifest.files ||= {}
const report={},handsSource=buildHands()
for(const id of [...IDS,'hands']){
  const source=id==='hands'?buildHands():buildWeapon(id),doc=new Document(),buffer=doc.createBuffer(id),scene=doc.createScene(id+' Asset')
  const nodes=new Map(),meshes=new Map(),skins=[],dir=new URL(`assets/models/weapons/${id}/`,root)
  if(id!=='hands')bakeGripPoses(source,handsSource)
  await mkdir(dir,{recursive:true})
  const textures={}
  for(const kind of ['albedo','normal','orm','emissive']){
    if(kind==='emissive'&&id!=='plasma')continue
    const ext=kind==='albedo'?'jpg':'png',uri=`${id}-${kind}.${ext}`,file=`assets/models/weapons/${id}/${uri}`
    const image=await readFile(new URL(file,root))
    textures[kind]=doc.createTexture(id+' '+kind).setImage(image).setMimeType(ext==='jpg'?'image/jpeg':'image/png').setURI(uri)
  }
  const mat=doc.createMaterial(id+' 2K PBR').setBaseColorTexture(textures.albedo).setNormalTexture(textures.normal).setNormalScale(.75)
    .setMetallicRoughnessTexture(textures.orm).setOcclusionTexture(textures.orm).setMetallicFactor(1).setRoughnessFactor(1)
  if(textures.emissive)mat.setEmissiveTexture(textures.emissive).setEmissiveFactor([.3,.75,1])
  const accessor=(name,arr,size)=>doc.createAccessor(name).setType(({2:'VEC2',3:'VEC3',4:'VEC4',16:'MAT4'})[size]||'SCALAR').setArray(arr).setBuffer(buffer)
  let triangles=0
  function convert(o){
    const n=doc.createNode(o.name).setTranslation(o.position.toArray()).setRotation(o.quaternion.toArray()).setScale(o.scale.toArray()).setExtras({...o.userData})
    nodes.set(o,n)
    if(o.geometry){
      let mesh=meshes.get(o.geometry)
      if(!mesh){
        const g=o.geometry,p=doc.createPrimitive().setMaterial(mat)
        for(const [name,semantic] of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0'],['skinIndex','JOINTS_0'],['skinWeight','WEIGHTS_0']])if(g.attributes[name]){
          const a=g.attributes[name];p.setAttribute(semantic,accessor(o.name+' '+name,name==='uv'?Float32Array.from(a.array,(v,i)=>i%2?1-v:v):a.array,a.itemSize))
        }
        if(g.index)p.setIndices(accessor(o.name+' indices',g.index.array,1))
        mesh=doc.createMesh(o.name).addPrimitive(p);meshes.set(o.geometry,mesh)
      }
      triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;n.setMesh(mesh)
      if(o.isSkinnedMesh)skins.push([o,n])
    }
    for(const c of o.children)n.addChild(convert(c))
    return n
  }
  scene.addChild(convert(source))
  for(const [o,n] of skins){
    const skin=doc.createSkin(o.name+' Skeleton'),s=o.skeleton
    s.bones.forEach(b=>skin.addJoint(nodes.get(b)))
    skin.setSkeleton(nodes.get(s.bones[0])).setInverseBindMatrices(accessor(o.name+' inverse binds',new Float32Array(s.boneInverses.flatMap(m=>m.toArray())),16));n.setSkin(skin)
  }
  if(triangles>(id==='hands'?6000:20000))throw Error(`${id}: ${triangles} triangles exceeds budget`)
  await io.write(new URL(id+'.gltf',dir).pathname,doc)
  const file=new URL(id+'.gltf',dir),json=JSON.parse(await readFile(file,'utf8'))
  json.asset.generator='Terminator original weapon authoring, glTF Transform 4.3'
  const files={[id+'.gltf']:`assets/models/weapons/${id}/${id}.gltf`}
  for(const entry of [...(json.buffers||[]),...(json.images||[])])files[entry.uri]=`assets/models/weapons/${id}/${entry.uri}`
  await writeFile(file,JSON.stringify(json,null,2)+'\n')
  manifest.files['weapon-'+id]={path:files[id+'.gltf'],files}
  report[id]={triangles,atlas:[2048,2048],maps:Object.keys(textures),nodes:json.nodes.map(n=>n.name)}
}
await writeFile(new URL('assets.json',root),JSON.stringify(manifest,null,2)+'\n')
await writeFile(new URL('assets/models/weapons/manifest.json',root),JSON.stringify(report,null,2)+'\n')
console.log(Object.fromEntries(Object.entries(report).map(([id,s])=>[id,s.triangles])))
