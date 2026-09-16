import {readFile} from 'node:fs/promises'
globalThis.ImageData ??= class {}
globalThis.ProgressEvent ??= class {constructor(type,props){this.type=type;Object.assign(this,props)}}
const T=await import('three')
const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js')
export async function loadWeaponFixture() {
  const root=new T.Group(),loader=new GLTFLoader()
  for(const id of ['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher','hands']){
    const dir=new URL(`../../assets/models/weapons/${id}/`,import.meta.url),gltf=JSON.parse(await readFile(new URL(id+'.gltf',dir),'utf8'))
    for(const b of gltf.buffers)b.uri='data:application/octet-stream;base64,'+(await readFile(new URL(b.uri,dir))).toString('base64')
    // Node has no image decoder. Geometry, skins, hierarchy and extras still use the real GLTFLoader.
    for(const m of gltf.materials||[])for(const k of ['normalTexture','occlusionTexture','emissiveTexture'])delete m[k]
    for(const m of gltf.materials||[]){delete m.pbrMetallicRoughness?.baseColorTexture;delete m.pbrMetallicRoughness?.metallicRoughnessTexture}
    const asset=await loader.parseAsync(JSON.stringify(gltf),'');asset.scene.animations=asset.animations;root.add(asset.scene)
  }
  return root
}
export const weaponFixture=await loadWeaponFixture()
