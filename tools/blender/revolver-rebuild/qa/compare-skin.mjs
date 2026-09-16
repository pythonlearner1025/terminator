// CPU-only Three.js GLTFLoader; no browser, renderer, textures, or scene edits.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {execFileSync} from 'node:child_process'
import {digest} from './export-contract.mjs'
import {blenderWorldPoint,buildCorrespondence,compareWorldPositions} from './skin-correspondence.mjs'
const args=process.argv.slice(2),opt=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1]}
const path=resolve(opt('--gltf','tools/blender/revolver-rebuild/generated/qa-skin-smoke/smoke.gltf'))
const referencePath=resolve(opt('--reference',resolve(dirname(path),'blender-skin.json')))
const output=resolve(opt('--out',resolve(dirname(path),'skin-roundtrip.json'))),tolerance=Number(opt('--tolerance','0.00001'))
const raw=await readFile(path),g=JSON.parse(raw),sourceRaw=await readFile(referencePath),source=JSON.parse(sourceRaw)
const hashEntries=await Promise.all([['gltf',path],['blend',source.sourceBlend],['reference',referencePath],...(g.buffers||[]).map(b=>[b.uri,resolve(dirname(path),b.uri)])].map(async([name,file])=>[name,digest(await readFile(file))]))
const hashMap=Object.fromEntries(hashEntries)
if(hashMap.blend!==source.sourceBlendSha256)throw Error('Source Blend changed after sampling')
const nameCounts=new Map();for(const n of g.nodes)nameCounts.set(n.name,(nameCounts.get(n.name)||0)+1)
const duplicateNames=[...nameCounts].filter(([name,count])=>name&&count>1)
const document=structuredClone(g)
for(const b of document.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(resolve(dirname(path),b.uri))).toString('base64')
delete document.images;delete document.textures;delete document.samplers;document.materials=[]
for(const mesh of document.meshes)for(const p of mesh.primitives)delete p.material
// Required before importing Three.js in Node; no DOM or image decode is used.
globalThis.ImageData??=class{};globalThis.ProgressEvent??=class{constructor(type,props){Object.assign(this,{type},props)}}
const T=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js')
const asset=await new GLTFLoader().parseAsync(JSON.stringify(document),''),mesh=asset.scene.getObjectByName(source.mesh)
if(!mesh?.isSkinnedMesh)throw Error('Expected one named native skinned mesh '+source.mesh)
asset.scene.updateMatrixWorld(true);mesh.skeleton.update()
const a=mesh.geometry.attributes,exported=[]
for(let i=0;i<a.position.count;i++){
 const weights={};for(let k=0;k<4;k++){const w=a.skinWeight.getComponent(i,k),j=a.skinIndex.getComponent(i,k);if(w)weights[mesh.skeleton.bones[j].name]=(weights[mesh.skeleton.bones[j].name]||0)+w}
 const uvs=[];for(const name of ['uv','uv1','uv2','uv3'])if(a[name])uvs.push([a[name].getX(i),a[name].getY(i)])
 exported.push({position:[a.position.getX(i),a.position.getY(i),a.position.getZ(i)],uvs,weights})
}
const sourceWorldBind=source.vertices.map(v=>blenderWorldPoint(v.localBlender,source.sourceMeshMatrixWorldBlender))
const inverseMesh=mesh.matrixWorld.clone().invert()
const modes={localAxes:source.vertices.map(v=>v.localGltfAxes),worldBakedBind:sourceWorldBind,meshRelativeWorldBind:sourceWorldBind.map(p=>new T.Vector3(...p).applyMatrix4(inverseMesh).toArray())}
let correspondence,mode;const attempts={}
for(const [name,points]of Object.entries(modes)){
 const candidate=buildCorrespondence(source,exported,points)
 attempts[name]={ok:candidate.ok,unmatched:candidate.unmatched.length,uncovered:candidate.uncovered.length,ambiguous:candidate.ambiguous.length,maxBindErrorM:candidate.maxBindErrorM}
 if(candidate.ok&&!correspondence){correspondence=candidate;mode=name}
}
const root=g.nodes.find(n=>n.extras?.viewModel)?.extras.viewModel
const report={checkedAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),kind:'sampled skin pose fidelity; not gameplay or final asset approval',files:{gltf:path,sourceBlend:source.sourceBlend,reference:referencePath},hashes:hashMap,toleranceM:tolerance,
 sourceVertexCount:source.vertexCount,exportedVertexCount:a.position.count,boneCount:mesh.skeleton.bones.length,nodeCount:g.nodes.length,duplicateNames,
 metadata:{viewModel:root,embeddedMeshesMatch:JSON.stringify(root?.embeddedHandMeshes)===JSON.stringify([mesh.name]),nativeBoneNamesUnique:mesh.skeleton.bones.every(b=>nameCounts.get(b.name)===1),nativeBoneInventoryMatches:JSON.stringify(mesh.skeleton.bones.map(b=>b.name).sort())===JSON.stringify([...source.boneNames].sort())},
 actualClipDurations:Object.fromEntries(asset.animations.map(c=>[c.name,c.duration])),sourceNla:source.nla[source.armature],constraintsAtLoad:source.constraintsAtLoad,
 correspondence:{mode,attempts,...correspondence},samples:[],limitations:['Only requested sample times are compared; this is not continuous animation or gameplay proof.','Positions include complete evaluated Blender parent transforms and Three.js matrixWorld.','Mapping is fixed using undeformed bind positions, all exported UV layers and normalized named weights; it is not recomputed by nearest posed vertex.','Per-source max/RMS uses each source vertex once; seam duplicates use their worst error.']}
if(!correspondence){report.status='fail';report.reason='Unable to establish unambiguous stable correspondence';await writeFile(output,JSON.stringify(report,null,2)+'\n');throw Error(report.reason)}
const mixer=new T.AnimationMixer(asset.scene)
for(const [clipName,entry]of Object.entries(source.samples)){
 const clip=asset.animations.find(c=>c.name===clipName);if(!clip)throw Error('Missing glTF clip '+clipName)
 for(const reference of entry.frames){
  if(reference.seconds>clip.duration+1e-7)throw Error('Requested time exceeds actual clip duration')
  mixer.stopAllAction();const action=mixer.clipAction(clip);action.reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();mixer.setTime(reference.seconds)
  asset.scene.updateMatrixWorld(true);mesh.skeleton.update()
  const points=[],p=new T.Vector3();for(let i=0;i<a.position.count;i++){mesh.getVertexPosition(i,p);mesh.localToWorld(p);points.push(p.toArray())}
  const comparison=compareWorldPositions(reference.worldGltfAxes,points,correspondence)
  const native=source.nativeBakeMutedConstraints[clipName].frames.find(f=>Math.abs(f.seconds-reference.seconds)<1e-9)
  const identity={mapping:source.vertices.map((_,i)=>i),candidates:source.vertices.map((_,i)=>[i])}
  const sourceBake=compareWorldPositions(reference.worldGltfAxes,native.worldGltfAxes,identity)
  report.samples.push({clip:clipName,seconds:reference.seconds,blenderFrame:reference.frame,gltfActionTime:action.time,
   status:comparison.sourceVertexErrors.maxM<=tolerance&&comparison.missingSourceVertices.length===0?'pass':'fail',...comparison,
   sourceMotionFromFirstSample:compareWorldPositions(entry.frames[0].worldGltfAxes,reference.worldGltfAxes,identity).sourceVertexErrors,
   nativeBakeVersusLiveSource:sourceBake.sourceVertexErrors,meshMatrixWorld:mesh.matrixWorld.toArray()})
 }
}
report.status=report.samples.every(s=>s.status==='pass')&&!duplicateNames.length&&report.metadata.embeddedMeshesMatch&&report.metadata.nativeBoneNamesUnique&&report.metadata.nativeBoneInventoryMatches?'pass':'fail'
report.maxM=Math.max(...report.samples.map(s=>s.sourceVertexErrors.maxM));report.rmsM=Math.sqrt(report.samples.reduce((sum,s)=>sum+s.sourceVertexErrors.rmsM**2*s.sourceVertexErrors.count,0)/report.samples.reduce((sum,s)=>sum+s.sourceVertexErrors.count,0))
await writeFile(output,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({output,status:report.status,sourceVertices:source.vertexCount,exportedVertices:a.position.count,mappingMode:mode,ambiguous:correspondence.ambiguous.length,covered:correspondence.coveredSourceVertices,maxM:report.maxM,rmsM:report.rmsM,samples:report.samples.map(s=>({clip:s.clip,time:s.seconds,status:s.status,max:s.sourceVertexErrors.maxM,rms:s.sourceVertexErrors.rmsM,nativeVsLive:s.nativeBakeVersusLiveSource.maxM}))},null,2))
if(report.status!=='pass')process.exitCode=1
