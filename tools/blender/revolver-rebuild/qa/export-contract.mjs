import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,dirname,basename} from 'node:path'
export const CLIPS=['Idle','Draw','Fire','Reload','AimIn','AimOut','AimIdle','Sprint','Inspect']
export const SOURCE={author:'DJMaesen',title:'First Person arms',url:'https://sketchfab.com/3d-models/first-person-arms-e3c42c05b22944e5839deb8e003f0987',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'}
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
export function inspectDocument(g) {
 const failures=[],nodes=g.nodes||[],named=name=>nodes.filter(n=>n.name===name)
 const vm=nodes.find(n=>n.extras?.viewModel?.embeddedHands)?.extras.viewModel
 const skins=nodes.filter(n=>n.skin!==undefined&&n.mesh!==undefined)
 const metadata=vm?.embeddedHandMeshes
 const actual=skins.map(n=>n.name).sort()
 if(!vm)failures.push('No embeddedHands viewModel metadata')
 if(!Array.isArray(metadata)||metadata.length!==1||JSON.stringify([...metadata].sort())!==JSON.stringify(actual))failures.push('embeddedHandMeshes must exactly name the single combined imported skinned mesh')
 if(skins.length!==1)failures.push(`Expected one combined skin, found ${skins.length}`)
 const skin=g.skins?.[skins[0]?.skin]
 if(skin?.joints?.length!==49)failures.push(`Expected 49 imported joints, found ${skin?.joints?.length||0}`)
 const joints=(skin?.joints||[]).map(i=>nodes[i]?.name)
 if(new Set(joints).size!==49||joints.some(n=>!n))failures.push('Imported joint names must be unique and nonempty')
 const ambiguous=joints.filter(name=>name&&named(name).length!==1)
 if(ambiguous.length)failures.push('Runtime clones bind bones by name; source controls collide with joints: '+ambiguous.join(', '))
 if(!joints.some(n=>n?.startsWith('L_'))||!joints.some(n=>n?.startsWith('R_')))failures.push('Imported bilateral source joint identities missing')
 const retired=nodes.filter(n=>n.mesh!==undefined&&/^(HandMesh(Right|Left)|Sleeve(Right|Left)|RightHand|LeftHand)$/.test(n.name||''))
 if(retired.length)failures.push('Retired handmade geometry present: '+retired.map(n=>n.name).join(', '))
 const markers=['Body','Hammer','Cylinder','Crane','Ejector','Muzzle','FrontSight','RearSight','HandRight','HandLeft',...Array.from({length:6},(_,i)=>`Case${i}`),...Array.from({length:6},(_,i)=>`Fresh${i}`),...Array.from({length:6},(_,i)=>`Bullet${i}`)]
 for(const name of markers)if(named(name).length!==1)failures.push(`Expected one runtime marker ${name}, found ${named(name).length}`)
 const clips=(g.animations||[]).map(a=>a.name)
 if(clips.length!==9||CLIPS.some(n=>!clips.includes(n)))failures.push('Expected exactly the nine runtime clips')
 const animated=new Set((g.animations||[]).flatMap(a=>a.channels||[]).map(c=>c.target?.node))
 const animatedJoints=(skin?.joints||[]).filter(i=>animated.has(i)).length
 if(!animatedJoints)failures.push('No imported native joints are animated')
 const primitives=skins.flatMap(n=>g.meshes?.[n.mesh]?.primitives||[])
 for(const p of primitives)for(const a of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])if(p.attributes?.[a]===undefined)failures.push(`Combined skin primitive missing ${a}`)
 return {failures,embeddedHandMeshes:metadata,actualHandMeshes:actual,jointNames:joints,jointCount:joints.length,animatedJoints,clips,markers,viewModel:vm,retiredGeometry:retired.map(n=>n.name)}
}
export function accessorValues(g,buffers,index) {
 const a=g.accessors?.[index],v=g.bufferViews?.[a?.bufferView]
 if(!a||!v||a.sparse)throw Error(`Accessor ${index} absent or sparse; unsupported QA input`)
 const sizes={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},types={5121:['getUint8',1,255],5123:['getUint16',2,65535],5125:['getUint32',4,4294967295],5126:['getFloat32',4,1]}
 const t=types[a.componentType],width=sizes[a.type]
 if(!t||!width)throw Error(`Unsupported accessor ${index} format`)
 const bytes=buffers[v.buffer],data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),values=[]
 for(let i=0;i<a.count;i++){const row=[];for(let c=0;c<width;c++){const offset=(v.byteOffset||0)+(a.byteOffset||0)+i*(v.byteStride||width*t[1])+c*t[1];let value=data[t[0]](offset,true);if(a.normalized)value/=t[2];row.push(value)}values.push(row)}
 return values
}
export async function inspectExport(path) {
 const file=resolve(path),raw=await readFile(file),g=JSON.parse(raw),report=inspectDocument(g),resources={}
 const uris=[basename(file),...(g.buffers||[]).map(b=>b.uri),...(g.images||[]).map(i=>i.uri)]
 for(const uri of uris){if(!uri||uri!==basename(uri)||uri.startsWith('data:'))throw Error('Export resources must use flat local files');resources[uri]=digest(await readFile(resolve(dirname(file),uri)))}
 const buffers=await Promise.all((g.buffers||[]).map(b=>readFile(resolve(dirname(file),b.uri))))
 const weightedJoints=new Set();let vertices=0,badWeights=0,badPositions=0,badJointIndices=0
 for(const n of g.nodes.filter(n=>n.skin!==undefined&&n.mesh!==undefined))for(const p of g.meshes[n.mesh].primitives){
  const positions=accessorValues(g,buffers,p.attributes.POSITION),weights=accessorValues(g,buffers,p.attributes.WEIGHTS_0),joints=accessorValues(g,buffers,p.attributes.JOINTS_0)
  vertices+=positions.length
  if(weights.length!==positions.length||joints.length!==positions.length)report.failures.push('Skin accessor vertex counts disagree')
  positions.forEach((v,i)=>{if(v.some(x=>!Number.isFinite(x)))badPositions++;const w=weights[i]||[],js=joints[i]||[];if(w.some(x=>!Number.isFinite(x)||x<0)||Math.abs(w.reduce((a,b)=>a+b,0)-1)>.002)badWeights++;w.forEach((value,k)=>{if(value>0){if(!Number.isInteger(js[k])||js[k]<0||js[k]>=49)badJointIndices++;weightedJoints.add(js[k])}})})
 }
 if(vertices===0||badPositions||badWeights||badJointIndices)report.failures.push(`Invalid skin: vertices=${vertices}, nonfinite=${badPositions}, weights=${badWeights}, joints=${badJointIndices}`)
 if(weightedJoints.size!==38)report.failures.push(`Expected 38 weighted source joints, found ${weightedJoints.size}`)
 return {...report,path:file,hashes:resources,vertices,weightedJointCount:weightedJoints.size,source:SOURCE}
}
export async function freezeGate(manifestPath,approvedSha,exportPath) {
 if(!/^[a-f0-9]{64}$/.test(approvedSha||''))throw Error('Parent-approved manifest SHA256 is required before browser work')
 const bytes=await readFile(manifestPath),sha=digest(bytes)
 if(sha!==approvedSha)throw Error('Freeze manifest changed after parent approval')
 const manifest=JSON.parse(bytes),contract=await inspectExport(exportPath)
 if(contract.failures.length)throw Error('Imported export rejected: '+contract.failures.join('; '))
 // Handoff schemas may differ; both immutable export hashes must appear explicitly.
 const serialized=JSON.stringify(manifest)
 for(const [name,hash] of Object.entries(contract.hashes).filter(([name])=>/\.(gltf|bin)$/.test(name)))if(!serialized.includes(hash))throw Error(`Freeze manifest does not identify ${name} hash ${hash}`)
 return {manifest,manifestSha256:sha,contract}
}
