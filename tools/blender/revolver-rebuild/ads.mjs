// Geometry-based runtime ADS check; no browser, textures or self-assigned visual score.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
globalThis.ImageData??=class{};globalThis.window??={};globalThis.ProgressEvent??=class{constructor(type,props){Object.assign(this,props)}}
const T=await import('three'),{GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js')
const path=resolve(process.argv[2]||'tools/blender/revolver-rebuild/generated/assembled-final/revolver-rebuild.gltf')
const raw=JSON.parse(await readFile(path,'utf8')),g=structuredClone(raw)
for(const b of g.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(resolve(dirname(path),b.uri))).toString('base64')
delete g.images;delete g.textures;delete g.samplers;g.materials=[];for(const m of g.meshes)for(const p of m.primitives)delete p.material
const asset=await new GLTFLoader().parseAsync(JSON.stringify(g),''),root=asset.scene.getObjectByName('RevolverRebuildRig'),vm=root.userData.viewModel
root.position.set(0,-vm.sight.height,-vm.sight.distance);root.rotation.set(vm.sight.pitch||0,0,0);root.updateMatrixWorld(true)
const camera=new T.PerspectiveCamera(vm.fov,640/480,.02,8);camera.updateMatrixWorld(true)
const points={}
for(const name of ['FrontSight','RearSight']){
 const object=root.getObjectByName(name),vertices=[]
 object.traverse(n=>{if(!n.isMesh)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++)vertices.push(n.localToWorld(new T.Vector3().fromBufferAttribute(a,i)))})
 const top=Math.max(...vertices.map(p=>p.y)),selected=vertices.filter(p=>p.y>top-.00001),center=selected.reduce((sum,p)=>sum.add(p),new T.Vector3()).multiplyScalar(1/selected.length)
 const projected=center.clone().project(camera);points[name]={world:center.toArray(),pixel:[(projected.x+1)*320,(1-projected.y)*240],selectedTopVertices:selected.length}
}
const report={metadata:vm.sight,verticalFov:vm.fov,viewport:[640,480],reticle:[320,240],points,limitations:'Top-edge geometry projection; rear notch aperture and perceived sight picture also need visual review.'}
await writeFile(resolve(dirname(path),'ads-validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
