// Structural and evaluated animation checks. Does not claim visual/contact approval.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {NodeIO} from '@gltf-transform/core'
globalThis.ImageData??=class{}
globalThis.window??={}
globalThis.ProgressEvent??=class{constructor(type,props){Object.assign(this,props)}}
const {Vector3}=await import('three')
const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js')
const {AuthoredWeaponClips}=await import('../../../lib/view/weapons-animation.js')
export const CLIPS=['Idle','Draw','Fire','Reload','AimIn','AimOut','AimIdle','Sprint','Inspect']
export async function verify(path){
 const raw=JSON.parse(await readFile(path,'utf8')),failures=[],warnings=[],assert=(v,s)=>{if(!v)failures.push(s)}
 const names=raw.nodes.map(n=>n.name),root=raw.nodes.find(n=>n.name==='RevolverRebuildRig')
 assert(new Set(names).size===names.length,'Node names must be unique for clone/skeleton binding')
 for(const name of ['Body','Frame','Barrel','Cylinder','Crane','Ejector','Hammer','Trigger','Latch','Muzzle','CylinderGapLeft','CylinderGapRight','Ejection','HandRight','HandLeft',...Array.from({length:6},(_,i)=>'Case'+i)])assert(names.includes(name),'Missing '+name)
 assert(!names.some(n=>/Reference|Practice|loafbrr/i.test(n)),'Reference or Practice leaked into export')
 assert(root?.extras?.viewModel?.embeddedHands,'Missing embeddedHands metadata')
 assert(root?.extras?.viewModel?.embeddedHandMeshes?.join('|')==='DJMaesenArms','Expected single accepted artist skin')
 assert(!names.some(n=>/HandMeshLeft|HandMeshRight|HandsRig|RightIndex[1-3]|LeftForearm/.test(n)),'Retired handcrafted hand node leaked into export')
 const handNode=raw.nodes.find(n=>n.name==='DJMaesenArms')
 assert(handNode?.skin!==undefined,'Accepted artist hand mesh is not skinned')
 const sourceJoints=raw.skins?.[handNode?.skin]?.joints?.map(i=>raw.nodes[i].name)||[]
 assert(sourceJoints.length===49,'Native 49-joint imported rig was not preserved')
 for(const joint of ['R_wrist_027','L_wrist_04','R_point3_034','L_point3_010'])assert(sourceJoints.includes(joint),'Missing native weighted joint '+joint)

 assert(root?.extras?.viewModel?.forwardAxis==='-Z','Incorrect forward axis')
 assert(!root?.rotation||root.rotation.every((v,i)=>Math.abs(v-(i===3?1:0))<1e-6),'Runtime metadata root must have identity rotation; put conversion under AuthoringFrame')
 assert(CLIPS.every(n=>raw.animations?.some(a=>a.name===n)),'Missing required action')
 for(const n of raw.nodes)for(const key of ['translation','rotation','scale'])assert(!n[key]||n[key].every(Number.isFinite),'Nonfinite transform '+n.name)
 const io=new NodeIO(),doc=await io.read(path),r=doc.getRoot()
 let triangles=0,weightedVertices=0
 for(const mesh of r.listMeshes())for(const p of mesh.listPrimitives()){
   triangles+=(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3
   const uv=p.getAttribute('TEXCOORD_0');assert(uv,'Missing UV: '+mesh.getName())
   if(uv){
    const a=uv.getArray();assert([...a].every(v=>Number.isFinite(v)&&v>=-.0001&&v<=1.0001),'UV outside atlas: '+mesh.getName())
    const indices=p.getIndices()?.getArray()||Array.from({length:p.getAttribute('POSITION').getCount()},(_,i)=>i)
    let collapsed=0
    for(let i=0;i<indices.length;i+=3){const [x,y,z]=[indices[i]*2,indices[i+1]*2,indices[i+2]*2];if(Math.abs((a[y]-a[x])*(a[z+1]-a[x+1])-(a[z]-a[x])*(a[y+1]-a[x+1]))<1e-12)collapsed++}
    assert(collapsed===0,'Collapsed UV triangles: '+mesh.getName()+' ('+collapsed+')')
   }
   const weights=p.getAttribute('WEIGHTS_0')?.getArray()
   if(weights)for(let i=0;i<weights.length;i+=4){weightedVertices++;assert(Math.abs(weights[i]+weights[i+1]+weights[i+2]+weights[i+3]-1)<.002,'Unnormalized skin weights: '+mesh.getName());if(failures.length>50)break}
 }
 assert(weightedVertices>0,'No skinned hand vertices')
 if(triangles>36000)warnings.push('Combined triangle budget exceeded: '+triangles)
 if(r.listMaterials().length>6)warnings.push('Material budget exceeded: '+r.listMaterials().length)
 // Test real exported curves at 121 fractional instants each, including seek after other clips.
 const g=structuredClone(raw)
 for(const b of g.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(resolve(dirname(path),b.uri))).toString('base64')
 delete g.images;delete g.textures;delete g.samplers;g.materials=[]
 for(const m of g.meshes)for(const p of m.primitives)delete p.material
 const asset=await new GLTFLoader().parseAsync(JSON.stringify(g),''),object=asset.scene.getObjectByName('RevolverRebuildRig')
 object.position.set(0,0,0);object.quaternion.identity();object.scale.set(1,1,1)
 const player=new AuthoredWeaponClips({root:object,clips:asset.animations}),samples={}
 function snapshot(){const out=[];object.traverse(n=>out.push(...n.matrixWorld.elements));return out}
 for(const name of CLIPS){
   const clip=asset.animations.find(c=>c.name===name);if(!clip)continue
   let maxStep=0,last=null
   for(let i=0;i<=120;i++){
    player.sample(name,clip.duration*i/120)
    const now=snapshot();assert(now.every(Number.isFinite),'Nonfinite evaluated pose '+name)
    if(last)maxStep=Math.max(maxStep,...now.map((v,j)=>Math.abs(v-last[j])));last=now
   }
   player.sample(name,clip.duration*.37);const before=snapshot()
   player.sample('Reload',.83);player.sample(name,clip.duration*.37);const after=snapshot()
   assert(before.every((v,i)=>Math.abs(v-after[i])<1e-6),'Seek is history dependent: '+name)
   samples[name]={duration:clip.duration,samples:121,maxMatrixElementStep:maxStep}
 }
 // Evaluate actual skin positions, not only node/bone existence.
 const skin=object.getObjectByName('DJMaesenArms'),skinSamples={}
 if(skin?.isSkinnedMesh){
  const a=skin.geometry.attributes.position,point=new Vector3()
  for(const name of CLIPS){
   const duration=player.actions.get(name).getClip().duration;let moved=0;const baseline=[]
   for(const fraction of [0,.17,.34,.67,1]){
    player.sample(name,duration*fraction);skin.skeleton.update()
    for(let i=0;i<a.count;i++){
     point.fromBufferAttribute(a,i);skin.applyBoneTransform(i,point);skin.localToWorld(point);object.getObjectByName('WeaponMotion').worldToLocal(point)
     assert(Number.isFinite(point.x+point.y+point.z),'Nonfinite evaluated skin '+name)
     if(fraction===0)baseline.push(point.clone());else moved=Math.max(moved,point.distanceTo(baseline[i]))
    }
   }
   skinSamples[name]={vertices:a.count,instants:5,maxLocalDeformationM:moved}
  }
  assert(skinSamples.Reload.maxLocalDeformationM>.05,'Reload does not deform the imported skin')
  assert(skinSamples.Fire.maxLocalDeformationM>.00001,'Firing index native control bake is missing')
 }else assert(false,'Expected actual SkinnedMesh for artist arms')
 player.sample('Idle',0)
 const handRest=new Map();object.traverse(n=>{if(n.isBone)handRest.set(n.name,[...n.matrixWorld.elements])})
 const endpointDrift={}
 for(const fraction of [0,1]){
   player.sample('Reload',player.actions.get('Reload').getClip().duration*fraction)
   let maximum=0
   for(const [name,values] of handRest){const node=object.getObjectByName(name);maximum=Math.max(maximum,...values.map((v,i)=>Math.abs(v-node.matrixWorld.elements[i])))}
   endpointDrift[fraction]=maximum;assert(maximum<1e-6,'Reload hand endpoint differs from Idle at '+fraction+': '+maximum)
 }
 player.sample('Idle',0)
 const muzzle=object.getObjectByName('Muzzle'),body=object.getObjectByName('Body')
 assert(muzzle.getWorldPosition(new Vector3()).z<body.getWorldPosition(new Vector3()).z,'Muzzle must point toward runtime -Z')
 const direction=muzzle.getWorldDirection(new Vector3());assert(direction.z<-.99,'Muzzle effect axis must point runtime -Z')
 const cylinder=object.getObjectByName('Cylinder')
 for(let i=0;i<6;i++){
   const node=object.getObjectByName('Case'+i),point=new Vector3();let maximumRadius=0
   node.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;for(let j=0;j<a.count;j++){point.fromBufferAttribute(a,j);n.localToWorld(point);cylinder.worldToLocal(point);maximumRadius=Math.max(maximumRadius,Math.hypot(point.x,point.y))}})
   assert(maximumRadius<.027,'Case'+i+' protrudes radially outside cylinder: '+maximumRadius)
 }
 player.dispose()
 // Serialized roundtrip supported glTF semantics, using the same exporter/importer pair.
 const json=await io.writeJSON(doc),round=await io.readJSON(json)
 assert(round.getRoot().listNodes().length===r.listNodes().length,'Roundtrip node count drift')
 for(let i=0;i<r.listNodes().length;i++){
   const a=r.listNodes()[i],b=round.getRoot().listNodes()[i]
   assert(a.getName()===b.getName()&&['getTranslation','getRotation','getScale'].every(k=>a[k]().every((v,j)=>Math.abs(v-b[k]()[j])<(k==='getTranslation'?1e-5:1e-6))),'Roundtrip local transform drift: '+a.getName())
   assert(a.getWorldMatrix().every((v,j)=>Math.abs(v-b.getWorldMatrix()[j])<1e-6),'Roundtrip world transform drift: '+a.getName())
 }
 function sameAccessor(a,b,label){
   if(!a&&!b)return
   const x=a?.getArray(),y=b?.getArray()
   assert(x&&y&&a.getType()===b.getType()&&a.getNormalized()===b.getNormalized()&&x.length===y.length&&x.every((v,j)=>v===y[j]),'Roundtrip accessor data drift: '+label)
 }
 for(const mesh of r.listMeshes()){
   const other=round.getRoot().listMeshes().find(m=>m.getName()===mesh.getName())
   assert(other?.listPrimitives().length===mesh.listPrimitives().length,'Roundtrip primitive count: '+mesh.getName())
   mesh.listPrimitives().forEach((p,i)=>{const q=other?.listPrimitives()[i];sameAccessor(p.getIndices(),q?.getIndices(),mesh.getName()+' indices');for(const semantic of p.listSemantics())sameAccessor(p.getAttribute(semantic),q?.getAttribute(semantic),mesh.getName()+' '+semantic)})
 }
 for(const animation of r.listAnimations()){
   const other=round.getRoot().listAnimations().find(a=>a.getName()===animation.getName())
   for(const channel of animation.listChannels()){
     const match=other?.listChannels().find(c=>c.getTargetNode().getName()===channel.getTargetNode().getName()&&c.getTargetPath()===channel.getTargetPath())
     assert(match,'Roundtrip channel missing: '+animation.getName())
     sameAccessor(channel.getSampler().getInput(),match?.getSampler().getInput(),animation.getName()+' times')
     sameAccessor(channel.getSampler().getOutput(),match?.getSampler().getOutput(),animation.getName()+' values')
   }
 }
 for(const skin of r.listSkins())sameAccessor(skin.getInverseBindMatrices(),round.getRoot().listSkins().find(s=>s.getName()===skin.getName())?.getInverseBindMatrices(),skin.getName()+' inverse bind matrices')
 assert(round.getRoot().listAnimations().map(a=>a.getName()).join('|')===r.listAnimations().map(a=>a.getName()).join('|'),'Roundtrip clip drift')
 const report={path,triangles,materials:r.listMaterials().length,weightedVertices,samples,skinSamples,endpointDrift,failures,warnings,limits:['No browser or game check run here.','Structural and finite-pose checks do not certify finger contact, self-intersection or visual quality.','glTF Transform checks geometry/skin/actions and world transforms to 1 micrometer. Its near-zero local translation canonicalization allows 10 micrometers in imported source units; measured armsmesh world drift is 20 nanometers. Optional specular extension roundtrip is not covered; shipping original glTF retains it.']}
 await writeFile(resolve(dirname(path),'validation.json'),JSON.stringify(report,null,2)+'\n')
 return report
}
if(process.argv[1]===new URL(import.meta.url).pathname){const report=await verify(resolve(process.argv[2]||'tools/blender/revolver-rebuild/generated/assembled/revolver-rebuild.gltf'));console.log(JSON.stringify(report,null,2));if(report.failures.length)process.exitCode=1}
