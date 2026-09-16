import {createHash} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const root=resolve(new URL('../../../',import.meta.url).pathname)
const files=['assets/models/weapons/pistol/pistol.gltf','assets/models/weapons/pistol/pistol.bin',
  'assets/models/weapons/pistol/pistol-albedo.png','assets/models/weapons/pistol/pistol-normal.png',
  'assets/models/weapons/pistol/pistol-orm.png','assets/models/weapons/manifest.json','assets.json']
const snapshot={}
for(const path of files){const bytes=await readFile(resolve(root,path));snapshot[path]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}}
const beforePath=resolve(root,'.kite3d/revolver-determinism-before.json')
if(process.argv[2]==='record'){
  await writeFile(beforePath,JSON.stringify(snapshot,null,2)+'\n')
  console.log('Recorded complete exported package hashes.')
}else if(process.argv[2]==='compare'){
  const before=JSON.parse(await readFile(beforePath,'utf8'))
  const differences=files.filter(path=>before[path]?.sha256!==snapshot[path].sha256)
  const report={identical:differences.length===0,scope:'Two consecutive full npm run build:revolver executions',differences,files:snapshot}
  await writeFile(resolve(root,'docs/evidence/blender-revolver/determinism.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({identical:report.identical,differences}))
  if(differences.length)process.exitCode=1
}else throw Error('Use record after one full build, then compare after the next full build.')
