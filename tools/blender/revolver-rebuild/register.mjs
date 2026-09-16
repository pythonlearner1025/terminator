// Explicit packaging step. Never regenerates a scene; preserves existing node IDs/extras.
import {readFile,writeFile,mkdir,copyFile,unlink} from 'node:fs/promises'
import {resolve,basename} from 'node:path'
import {verify} from './verify.mjs'
const staged=resolve(process.argv[2]||'tools/blender/revolver-rebuild/generated/assembled')
const report=await verify(`${staged}/revolver-rebuild.gltf`)
if(report.failures.length)throw Error('Export validation failed: '+report.failures.join('; '))
const dir='assets/models/weapons/revolver-rebuild',path=`${dir}/revolver-rebuild.gltf`
await mkdir(dir,{recursive:true})
const g=JSON.parse(await readFile(`${staged}/revolver-rebuild.gltf`,'utf8'))
for(const n of g.nodes)n.extras={...n.extras,gltfUUID:n.extras?.gltfUUID||'weapon-revolver-rebuild-'+n.name}
for(const a of g.animations)a.extras={...a.extras,rootRefs:['RevolverRebuildRig']}
const files=['revolver-rebuild.gltf','LICENSES.md','hand-attribution.json']
for(const entry of [...g.buffers,...(g.images||[])]){
 if(!entry.uri||entry.uri.startsWith('data:'))continue
 const filename=decodeURIComponent(entry.uri)
 if(filename!==basename(filename)||filename.includes('\\')||filename==='.'||filename==='..')throw Error('Only local flat export resources accepted: '+entry.uri)
 await copyFile(`${staged}/${filename}`,`${dir}/${filename}`);files.push(filename)
}
await writeFile(path,JSON.stringify(g,null,2)+'\n')
const registry=JSON.parse(await readFile('assets.json','utf8'))
// Prune only superseded resources explicitly owned by this variant registry.
for(const [name,path] of Object.entries(registry.files['weapon-revolver-rebuild']?.files||{})){
 if(!files.includes(name)&&path.startsWith(dir+'/')&&basename(path)===name)await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e})
}
registry.files['weapon-revolver-rebuild']={path,files:Object.fromEntries(files.map(f=>[f,`${dir}/${f}`]))}
await writeFile('assets.json',JSON.stringify(registry,null,2)+'\n')
const pkg=JSON.parse(await readFile('package.json','utf8')),scene=JSON.parse(await readFile(pkg.mainScene,'utf8'))
if(!scene.nodes.some(n=>n.extras?.gltfUUID==='lab-weapon-revolver-rebuild')){
 const index=scene.nodes.length;scene.nodes.push({name:'Rebuilt Revolver Template',translation:[-18,1.55,-19],extras:{gltfUUID:'lab-weapon-revolver-rebuild',kite3dAuthoring:{role:'template',id:'lab-weapon-revolver-rebuild'},rootPath:'/kite3d/@weapon-revolver-rebuild/revolver-rebuild.gltf',rootPathOptions:{createUniqueNames:false},sProperties:['visible','name','position','quaternion','scale']}})
 scene.scenes[scene.scene||0].nodes.push(index);await writeFile(pkg.mainScene,JSON.stringify(scene,null,2)+'\n')
}
await writeFile(`${dir}/manifest.json`,JSON.stringify({...report,builder:'tools/blender/revolver-rebuild/assemble.py',reference:'loafbrr-cc0 visual reference only'},null,2)+'\n')
await copyFile('tools/blender/revolver-rebuild/source/imported-hands/attribution.json',`${dir}/hand-attribution.json`)
await writeFile(`${dir}/LICENSES.md`, '# Revolver rebuild attribution\n\nFirst Person arms by DJMaesen, CC BY 4.0.\nSource: https://sketchfab.com/3d-models/first-person-arms-e3c42c05b22944e5839deb8e003f0987\nLicense: https://creativecommons.org/licenses/by/4.0/\nChanges: recovered native controls, uniform scaling, grasp pose and nine new animations. Original artist geometry, weights, UVs and source map pixels retained.\n\nGun: independently rebuilt source geometry; loafbrr-cc0 was a visual shape reference only. Source and bake provenance are in tools/blender/revolver-rebuild/source-assets/gun.\n')
console.log('Registered',path)
