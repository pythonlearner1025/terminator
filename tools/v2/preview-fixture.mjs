import {decodedPreviewViews} from './decode-preview-buffers.mjs'
// Node-only loader for exact CPU verification of the committed preview buffers.
import {readFile} from 'node:fs/promises'
globalThis.ImageData??=class {};globalThis.window??={}
const E=await import('threepipe')
const read=async p=>JSON.parse(await readFile(p,'utf8'))
export async function previewFixture(){
 const s=await read('assets/main.scene.gltf'),objects=s.nodes.map(n=>{const o=new E.Group();o.name=n.name||'';o.userData=structuredClone(n.extras||{});if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale)}else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale)}return o})
 s.nodes.forEach((n,i)=>{for(const child of n.children||[])objects[i].add(objects[child])})
 const modelRoot=new E.Group(),mapRoot=objects.find(o=>o.name==='Map');modelRoot.add(mapRoot)
 const {buildV2PlayableMap}=await import('../../lib/core/v2-map.js'),{scenePlacements}=await import('../../lib/core/map.js')
 const map=buildV2PlayableMap(await read('lib/core/data/map.json'),await read('lib/core/data/map-piece-registry.json'),scenePlacements(mapRoot))
 const dir='assets/v2/performance/preview-019',g=await read(`${dir}/preview.gltf`),views=await decodedPreviewViews(g,dir)
 const accessor=id=>{const a=g.accessors[id],v=g.bufferViews[a.bufferView],size=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4})[a.type],T=({5126:Float32Array,5125:Uint32Array,5123:Uint16Array})[a.componentType],b=views[a.bufferView];return new E.BufferAttribute(new T(b.buffer,b.byteOffset+(a.byteOffset||0),a.count*size),size)}
 const textures=Array.from({length:5},()=>new E.Texture()),materials=g.materials.map(m=>{const p=m.pbrMetallicRoughness;const mat=new E.PhysicalMaterial({name:m.name,color:new E.Color().fromArray(p.baseColorFactor),roughness:p.roughnessFactor,metalness:p.metallicFactor,side:m.doubleSided?E.DoubleSide:E.FrontSide,map:p.baseColorTexture?textures[p.baseColorTexture.index]:null});mat.userData=structuredClone(m.extras||{});return mat})
 const nodes=g.nodes.map(n=>{let o;if(n.mesh!==undefined){const p=g.meshes[n.mesh].primitives[0],geometry=new E.BufferGeometry();for(const [key,a]of Object.entries(p.attributes))geometry.setAttribute(({POSITION:'position',NORMAL:'normal',TEXCOORD_0:'uv',COLOR_0:'color'})[key]||key.toLowerCase(),accessor(a));if(p.indices!==undefined)geometry.setIndex(accessor(p.indices));geometry.computeBoundingBox();geometry.computeBoundingSphere();o=new E.Mesh2(geometry,materials[p.material]);o.material.vertexColors=!!geometry.attributes.color}else o=new E.Group();o.name=n.name;o.userData=structuredClone(n.extras||{});Object.assign(o,n.extensions?.WEBGI_object3d_extras);return o})
 g.nodes.forEach((n,i)=>{for(const child of n.children||[])nodes[i].add(nodes[child])});modelRoot.add(nodes[0])
 for(let i=0;i<5;i++){const m=new E.PhysicalMaterial({name:`Selected rubble ${i+1}: source`,map:textures[i],roughness:1,metalness:0,side:E.DoubleSide});modelRoot.add(new E.Mesh2(new E.BufferGeometry(),m))}
 return {E,map,modelRoot,source:nodes[0],textures,viewer:{scene:{modelRoot},setDirty(){}}}
}
