import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CLIPS,digest,inspectDocument,inspectExport,freezeGate} from './export-contract.mjs'
function fixture(){
 const joints=Array.from({length:49},(_,i)=>({name:(i<25?'L_':'R_')+'source_'+i}))
 const markers=['Body','Hammer','Cylinder','Crane','Ejector','Muzzle','FrontSight','RearSight','HandRight','HandLeft',...Array.from({length:6},(_,i)=>`Case${i}`),...Array.from({length:6},(_,i)=>`Fresh${i}`),...Array.from({length:6},(_,i)=>`Bullet${i}`)]
 return {asset:{version:'2.0'},nodes:[...joints,...markers.map(name=>({name})),{name:'ImportedArms',mesh:0,skin:0,extras:{viewModel:{embeddedHands:true,embeddedHandMeshes:['ImportedArms']}}}],skins:[{joints:joints.map((_,i)=>i)}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:0,TEXCOORD_0:0,JOINTS_0:1,WEIGHTS_0:2}}]}],animations:CLIPS.map(name=>({name,channels:[{target:{node:0,path:'rotation'}}]}))}
}
test('combined imported skin accepts attachments without splitting geometry',()=>assert.deepEqual(inspectDocument(fixture()).failures,[]))
test('metadata cannot silently leave a combined hand mesh visible for hands=false',()=>{const g=fixture();g.nodes.at(-1).extras.viewModel.embeddedHandMeshes=['HandRight','HandLeft'];assert.match(inspectDocument(g).failures.join(';'),/exactly name/)})
test('retired handmade mesh is rejected even if correctly named imported mesh also exists',()=>{const g=fixture();g.nodes.push({name:'HandMeshLeft',mesh:0});assert.match(inspectDocument(g).failures.join(';'),/Retired handmade/)})
test('49 unique source joints and baked native animation are required',()=>{const g=fixture();g.nodes[1].name=g.nodes[0].name;g.animations.forEach(a=>a.channels=[]);const f=inspectDocument(g).failures.join(';');assert.match(f,/unique/);assert.match(f,/No imported native joints/)})
test('retained source controls cannot shadow native bones in runtime clone lookup',()=>{const g=fixture();g.nodes.push({name:g.nodes[0].name});assert.match(inspectDocument(g).failures.join(';'),/source controls collide/)})
test('immutable hash gate validates actual normalized weights and rejects later mutation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'revolver-qa-contract-'))
 try{
  const g=fixture(),buf=Buffer.alloc(38*(12+8+16));let cursor=0
  g.bufferViews=[];g.accessors=[]
  for(const [type,componentType,width,bytes]of[['VEC3',5126,3,4],['VEC4',5123,4,2],['VEC4',5126,4,4]]){
   const start=cursor
   for(let i=0;i<38;i++)for(let j=0;j<width;j++){const val=componentType===5123?(j===0?i:0):width===4?(j===0?1:0):i*.001;if(bytes===2)buf.writeUInt16LE(val,cursor);else buf.writeFloatLE(val,cursor);cursor+=bytes}
   g.bufferViews.push({buffer:0,byteOffset:start,byteLength:cursor-start});g.accessors.push({bufferView:g.bufferViews.length-1,componentType,type,count:38})
  }
  g.buffers=[{uri:'rig.bin',byteLength:buf.length}]
  const path=join(dir,'rig.gltf');await writeFile(path,JSON.stringify(g));await writeFile(join(dir,'rig.bin'),buf)
  const report=await inspectExport(path);assert.deepEqual(report.failures,[]);assert.equal(report.weightedJointCount,38)
  const manifest=Buffer.from(JSON.stringify({hashes:report.hashes})),mp=join(dir,'ready.json');await writeFile(mp,manifest)
  assert.equal((await freezeGate(mp,digest(manifest),path)).contract.vertices,38)
  await assert.rejects(freezeGate(mp,'0'.repeat(64),path),/changed after parent approval/)
  buf.writeFloatLE(0,g.bufferViews[2].byteOffset);await writeFile(join(dir,'rig.bin'),buf)
  assert.match((await inspectExport(path)).failures.join(';'),/weights=1/)
  await assert.rejects(freezeGate(mp,digest(manifest),path),/Imported export rejected/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
