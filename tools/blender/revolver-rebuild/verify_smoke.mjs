import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
globalThis.ImageData??=class{};globalThis.window??={};globalThis.ProgressEvent??=class{constructor(t,p){Object.assign(this,p)}}
const {Vector3}=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js'),{AuthoredWeaponClips}=await import('../../../lib/view/weapons-animation.js')
const path=resolve(process.argv[2]),g=JSON.parse(await readFile(path,'utf8')),ref=JSON.parse(await readFile(resolve(dirname(path),'reference.json'),'utf8'))
for(const b of g.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(resolve(dirname(path),decodeURIComponent(b.uri)))).toString('base64')
delete g.images;delete g.textures;delete g.samplers;g.materials=[];for(const m of g.meshes)for(const p of m.primitives)delete p.material
const asset=await new GLTFLoader().parseAsync(JSON.stringify(g),''),root=asset.scene.getObjectByName('RevolverRebuildRig'),skin=root.getObjectByName('DJMaesenArms'),player=new AuthoredWeaponClips({root,clips:asset.animations}),report={bones:skin.skeleton.bones.length,clips:asset.animations.map(c=>c.name),samples:{},duplicates:g.nodes.filter((n,i,a)=>a.findIndex(x=>x.name===n.name)!==i).map(n=>n.name)}
const motion=root.getObjectByName('WeaponMotion');let baseline=[]
for(const [name,reference] of Object.entries(ref)){
 player.sample(reference.clip||name,reference.seconds);skin.skeleton.update();let max=0,sum=0,maxLocalDeformation=0;const point=new Vector3(),a=skin.geometry.attributes.position
 for(let i=0;i<a.count;i++){
  point.fromBufferAttribute(a,i);skin.applyBoneTransform(i,point);skin.localToWorld(point);const authored=motion.worldToLocal(point.clone());if(name==='Idle')baseline[i]=authored;else maxLocalDeformation=Math.max(maxLocalDeformation,authored.distanceTo(baseline[i]))
  let nearest=Infinity;for(const v of reference.vertices)nearest=Math.min(nearest,(point.x-v[0])**2+(point.y-v[1])**2+(point.z-v[2])**2)
  max=Math.max(max,Math.sqrt(nearest));sum+=nearest
 }
 report.samples[name]={clip:reference.clip||name,seconds:reference.seconds,vertices:a.count,maxLocalDeformationM:maxLocalDeformation,maxNearestSourceErrorM:max,rmsErrorM:Math.sqrt(sum/a.count)}
}
player.dispose();await writeFile(resolve(dirname(path),'smoke-validation.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.samples.Fire.maxLocalDeformationM<.00001||report.bones!==49||report.duplicates.length||Object.values(report.samples).some(s=>s.maxNearestSourceErrorM>.00002))process.exitCode=1
