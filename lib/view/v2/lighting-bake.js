// Offline-only deterministic asset build. No renderer, DOM, asset service or GPU.
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {bakePlume} from './lighting-noise.js'
const directory=new URL('../../../assets/v2/lighting/',import.meta.url)
const sha=data=>createHash('sha256').update(data).digest('hex')
await mkdir(directory,{recursive:true})
const sourceSha256=sha(await readFile(new URL('./lighting-noise.js',import.meta.url)))
const manifest={generator:'lib/view/v2/lighting-bake.js',sourceSha256,width:512,height:512,
  sampling:{resolution:192,depth:128},encoding:'RGBA8 straight-alpha linear RGB, no header',files:[]}
for(let seed=0;seed<4;seed++) {
  const {data}=bakePlume(512,seed,manifest.sampling),file=`plume-${seed}.rgba`
  await writeFile(new URL(file,directory),data)
  manifest.files.push({file,seed,bytes:data.byteLength,sha256:sha(data)})
  console.log(`Baked ${file}: ${data.byteLength} bytes`)
}
await writeFile(new URL('manifest.json',directory),JSON.stringify(manifest,null,2)+'\n')
await writeFile(new URL('PROVENANCE.txt',directory),
  'Original procedural smoke generated from this project lighting-noise.js.\nNo external photographs, reference pixels, purchased assets or credentials used.\nRebuild: node lib/view/v2/lighting-bake.js\nSee manifest.json for exact source hash, recipe and output hashes.\n')
