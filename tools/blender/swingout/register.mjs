import {readFile,writeFile,copyFile} from 'node:fs/promises'
const dir='assets/models/weapons/swingout',path=`${dir}/swingout.gltf`
const staged='.kite3d/swingout-export'
const g=JSON.parse(await readFile(`${staged}/swingout.gltf`,'utf8'))
for(const entry of [...g.buffers,...g.images])await copyFile(`${staged}/${entry.uri}`,`${dir}/${entry.uri}`)
for(const n of g.nodes){
 n.extras={...n.extras,gltfUUID:n.extras?.gltfUUID||'weapon-swingout-'+n.name}
 if(['Muzzle','CylinderGapLeft','CylinderGapRight','Ejection'].includes(n.name))n.rotation=[0,0,0,1]
}
for(const a of g.animations)a.extras={...a.extras,rootRefs:['SwingoutRig']}
await writeFile(path,JSON.stringify(g,null,2)+'\n')
const registry=JSON.parse(await readFile('assets.json','utf8'))
registry.files['weapon-swingout']={path,files:Object.fromEntries(['swingout.gltf',...g.buffers.map(x=>x.uri),...g.images.map(x=>x.uri)].map(f=>[f,`${dir}/${f}`]))}
await writeFile('assets.json',JSON.stringify(registry,null,2)+'\n')
// Preserve human edits. Append one stable template; do not regenerate the scene.
const pkg=JSON.parse(await readFile('package.json','utf8')),scene=JSON.parse(await readFile(pkg.mainScene,'utf8'))
if(!scene.nodes.some(n=>n.extras?.gltfUUID==='lab-weapon-swingout')){
 const index=scene.nodes.length;scene.nodes.push({name:'Swingout Revolver Template',translation:[-17,1.55,-19],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2],extras:{gltfUUID:'lab-weapon-swingout',kite3dAuthoring:{role:'template',id:'lab-weapon-swingout'},rootPath:'/kite3d/@weapon-swingout/swingout.gltf',rootPathOptions:{createUniqueNames:false},sProperties:['visible','name','position','quaternion','scale']}})
 scene.scenes[scene.scene||0].nodes.push(index);await writeFile(pkg.mainScene,JSON.stringify(scene,null,2)+'\n')
}
const summary={source:'assets/models/weapons-candidates/revolver/loafbrr-cc0-hd/loafbrr-cc0-hd.gltf',builder:'tools/blender/swingout/build.py',triangles:g.meshes.reduce((s,m)=>s+m.primitives.reduce((s,p)=>s+g.accessors[p.indices].count/3,0),0),drawCalls:g.meshes.reduce((s,m)=>s+m.primitives.length,0),textures:g.images.map(i=>i.uri),textureSize:[2048,2048],clips:Object.fromEntries(g.animations.map(a=>[a.name,Math.max(...a.samplers.map(s=>g.accessors[s.input].max[0]))])),joints:g.skins[0].joints.length}
await writeFile(`${dir}/manifest.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary)
