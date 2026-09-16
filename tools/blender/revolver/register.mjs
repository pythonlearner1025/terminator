import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
const root=new URL('../../../',import.meta.url),dir=new URL('assets/models/weapons/pistol/',root)
const path=new URL('pistol.gltf',dir),g=JSON.parse(await readFile(path,'utf8'))
// The bone exporter adds an empty-axis correction. The game marker explicitly faces +Z.
const muzzle=g.nodes.find(n=>n.name==='Muzzle');muzzle.rotation=[0,0,0,1]
// Hide reload props in the stopped rest pose, after exporting unscaled bind matrices.
for(const name of ['SpeedLoader','SpentRounds'])g.nodes.find(n=>n.name===name).scale=[.00001,.00001,.00001]
for(const n of g.nodes)n.extras={...n.extras,gltfUUID:n.extras?.gltfUUID||'weapon-pistol-'+n.name}
// Direct clips to the authored package root, including when loaded as a scene reference.
for(const a of g.animations)a.extras={...a.extras,rootRefs:['RevolverRig']}
await writeFile(path,JSON.stringify(g,null,2)+'\n')
const registryPath=new URL('assets.json',root),registry=JSON.parse(await readFile(registryPath,'utf8'))
const uris=['pistol.gltf',...g.buffers.map(b=>b.uri),...g.images.map(i=>i.uri)]
registry.files['weapon-pistol']={path:'assets/models/weapons/pistol/pistol.gltf',files:Object.fromEntries(uris.map(uri=>[uri,'assets/models/weapons/pistol/'+uri]))}
await writeFile(registryPath,JSON.stringify(registry,null,2)+'\n')
await unlink(new URL('pistol-albedo.jpg',dir)).catch(e=>{if(e.code!=='ENOENT')throw e})
const doc=await new NodeIO().read(fileURLToPath(path));let weapon=0,hands=0
for(const n of doc.getRoot().listNodes())if(n.getMesh()){
 const tris=n.getMesh().listPrimitives().reduce((sum,p)=>sum+(p.getIndices()||p.getAttribute('POSITION')).getCount()/3,0)
 if(n.getName().includes('Hand_and_Sleeve'))hands+=tris;else weapon+=tris
}
const summary={triangles:weapon+hands,weaponTriangles:weapon,handTriangles:hands,atlas:[2048,2048],maps:['albedo','normal','orm'],nodes:g.nodes.map(n=>n.name),clips:Object.fromEntries(g.animations.map(a=>[a.name,Math.max(...a.samplers.map(s=>g.accessors[s.input].max[0]))])),builder:'tools/blender/revolver/build.py',armatures:1}
if(weapon>12000||hands>8000)throw Error('Triangle budget exceeded: '+JSON.stringify({weapon,hands}))
const manifestPath=new URL('assets/models/weapons/manifest.json',root),manifest=JSON.parse(await readFile(manifestPath,'utf8'));manifest.pistol=summary
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n')
const reportPath=new URL('docs/evidence/blender-revolver/asset-report.json',root)
await mkdir(new URL('.',reportPath),{recursive:true})
await writeFile(reportPath,JSON.stringify(summary,null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
