// Required 0.19 migration: freeze the existing stopped Generator output as an asset.
// Runtime generation is deliberately untouched in this upgrade baseline.
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {relative, resolve} from 'node:path'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E=await import('threepipe')
const {scenePlacements}=await import('../../lib/core/map.js')
const {buildV2PlayableMap}=await import('../../lib/core/v2-map.js')
const {mountV2Architecture}=await import('../../lib/view/v2/architecture.js')
const {mountV2Ground}=await import('../../lib/view/v2/ground.js')
const read=async path=>JSON.parse(await readFile(path,'utf8'))
const scenePath='assets/main.scene.gltf',scene=await read(scenePath)
// Reading before mutation is mandatory even when the journal only has the upgrade.
const journal=await readFile('.kite3d/journal.jsonl','utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return ''})
const preview=scene.nodes.find(n=>n.extras?.gltfUUID==='terminator-v2-environment-preview')
if(!preview)throw Error('Stable preview source missing')
const previous=await read('assets/v2/performance/preview-019/migration.json').catch(()=>null)
const original=previous?.originalNode||structuredClone(preview)
const objects=scene.nodes.map(n=>{const o=new E.Group();o.name=n.name||'';o.userData=structuredClone(n.extras||{});if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale)}else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale)}return o})
scene.nodes.forEach((n,i)=>{for(const child of n.children||[])objects[i].add(objects[child])})
const mapRoot=objects.find(o=>o.name==='Map'),modelRoot=new E.Group();modelRoot.add(mapRoot)
const map=buildV2PlayableMap(await read('lib/core/data/map.json'),await read('lib/core/data/map-piece-registry.json'),scenePlacements(mapRoot))
const asset='5986d1487d9443b883d67b121c2c903c'
// Exact imported selected rubble defaults; original maps are immutable borrowed sources.
for(let i=1;i<=5;i++){
 const t=new E.Texture(),m=new E.PhysicalMaterial({name:`Selected rubble ${i}: TextureAtlas_100${i}`,color:0xffffff,roughness:1,metalness:0,side:E.DoubleSide,map:t})
 const o=new E.Mesh2(new E.BufferGeometry(),m);modelRoot.add(o)
}
const root=new E.Group();root.name='V2 stopped ruined architecture'
const viewer={scene:{modelRoot},setDirty(){}}
const context={viewer,root,map,preview:true,refs:{v2ArchitectureIO:{loadBinary:url=>readFile(new URL(url))}}}
const started=performance.now(),architecture=mountV2Architecture(context);await architecture.ready
const ground=mountV2Ground(context);await ground.ready
const {bakedMapKey}=await import('../../lib/view/v2/baked-recipe.js')
for(const [kind,handle]of [['architecture',architecture],['ground',ground]]){let count=0;handle.root.traverse(o=>{if(o.isMesh)count++});Object.assign(handle.root.userData,{v2BakedMapKey:bakedMapKey(map),v2BakedKind:kind,v2BakedMeshCount:count,v2BakedStats:{...handle.stats}})}
const dir='assets/v2/performance/preview-019';await mkdir(dir,{recursive:true})
const document={asset:{version:'2.0',generator:'tools/v2/migrate-preview-019.mjs'},scene:0,scenes:[{nodes:[0]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[],images:[],textures:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],extensionsUsed:['WEBGI_object3d_extras','WEBGI_material_extras']}
const chunks=[],materialIds=new Map();let byteLength=0,triangles=0
const digest=createHash('sha256')
function accessor(a){
 const bytes=Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength),offset=byteLength
 chunks.push(bytes);byteLength+=bytes.length
 if(byteLength%4){const pad=Buffer.alloc(4-byteLength%4);chunks.push(pad);byteLength+=pad.length}
 digest.update(bytes)
 const view=document.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length})-1
 const item={bufferView:view,componentType:a.array instanceof Float32Array?5126:a.array instanceof Uint32Array?5125:5123,count:a.count,type:({1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'})[a.itemSize]}
 if(a.itemSize===3){item.min=[Infinity,Infinity,Infinity];item.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<a.count;i++)for(let j=0;j<3;j++){const v=a.array[i*3+j];item.min[j]=Math.min(item.min[j],v);item.max[j]=Math.max(item.max[j],v)}}
 return document.accessors.push(item)-1
}
function material(m){
 if(materialIds.has(m))return materialIds.get(m)
 const result={name:m.name,pbrMetallicRoughness:{baseColorFactor:[...m.color.toArray(),m.opacity],roughnessFactor:m.roughness,metallicFactor:m.metalness},doubleSided:m.side===E.DoubleSide,extras:structuredClone(m.userData),extensions:{WEBGI_material_extras:{fog:m.fog}}}
 const atlas=m.name.match(/atlas (\d)/)
 if(atlas){const index=Number(atlas[1])-1;while(document.images.length<5){const i=document.images.length;document.images.push({uri:`TextureAtlas_100${i+1}_baseColor.png`});document.textures.push({sampler:0,source:i})}result.pbrMetallicRoughness.baseColorTexture={index}}
 const id=document.materials.push(result)-1;materialIds.set(m,id);return id
}
function node(o){
 const id=document.nodes.length,extras=structuredClone(o.userData)
 extras.gltfUUID=`terminator-v2-baked-preview-${id}`
 extras.kite3dAuthoring={role:'direct',id:extras.gltfUUID}
 const n={name:o.name,extras,extensions:{WEBGI_object3d_extras:{castShadow:o.castShadow,receiveShadow:o.receiveShadow}}};document.nodes.push(n)
 if(o.geometry){const g=o.geometry,p={attributes:{},material:material(o.material)};for(const [key,a]of Object.entries(g.attributes))p.attributes[({position:'POSITION',normal:'NORMAL',uv:'TEXCOORD_0',color:'COLOR_0'})[key]||'_'+key.toUpperCase()]=accessor(a);if(g.index)p.indices=accessor(g.index);triangles+=(g.index?.count||g.attributes.position.count)/3;n.mesh=document.meshes.push({name:o.name,primitives:[p]})-1}
 if(o.children.length)n.children=o.children.map(node)
 return id
}
node(root);document.buffers=[{uri:'preview.bin',byteLength}]
await writeFile(`${dir}/preview.bin`,Buffer.concat(chunks));await writeFile(`${dir}/preview.gltf`,JSON.stringify(document,null,2)+'\n')
const component=preview.extras.EntityComponentPlugin?.['terminator-v2-preview-generator']
preview.extras={...preview.extras,kite3dAuthoring:{...preview.extras.kite3dAuthoring,role:'direct'},kite3dBakedFrom:preview.extras.kite3dBakedFrom||{componentId:'terminator-v2-preview-generator',...component},rootPath:'/kite3d/@v2-stopped-preview-019/f.gltf',sProperties:['visible','name','position','quaternion','scale']}
if(component){delete preview.extras.EntityComponentPlugin['terminator-v2-preview-generator'];if(!Object.keys(preview.extras.EntityComponentPlugin).length)delete preview.extras.EntityComponentPlugin}
const assets=await read('assets.json');assets.files['v2-stopped-preview-019']={path:`${dir}/preview.gltf`,files:{'f.gltf':`${dir}/preview.gltf`,'preview.bin':`${dir}/preview.bin`}}
for(let i=1;i<=5;i++)assets.files['v2-stopped-preview-019'].files[`TextureAtlas_100${i}_baseColor.png`]=`assets/models/selected/${asset}/TextureAtlas_100${i}_baseColor.png`
await writeFile('assets.json',JSON.stringify(assets,null,2)+'\n');await writeFile(scenePath,JSON.stringify(scene,null,2)+'\n')
const report={schema:1,reason:'Kite3D 0.19 removed Generator; required stopped preview migration only',sourceHead:process.env.SOURCE_HEAD||'d33e0e4',journalEntriesRead:journal.trim().split('\n').filter(Boolean).length,originalNode:original,triangles,meshes:document.meshes.length,bytes:byteLength,attributesSha256:digest.digest('hex'),architecture:architecture.stats,ground:ground.stats,cpuBuildMs:performance.now()-started}
await writeFile(`${dir}/migration.json`,JSON.stringify(report,null,2)+'\n')
architecture.dispose();ground.dispose();console.log(JSON.stringify({triangles,meshes:document.meshes.length,bytes:byteLength,cpuBuildMs:report.cpuBuildMs}))

await import("./split-preview-buffers.mjs")
