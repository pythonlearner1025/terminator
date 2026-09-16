// Add only the two derivatives. Preserve all existing candidate registrations.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,relative,dirname,basename} from 'node:path'
const root=resolve(import.meta.dirname,'../../..')
const path=resolve(root,'assets.json')
const registry=JSON.parse(await readFile(path,'utf8'))
for(const [weapon,base] of [['shotgun','3dmodels-cc0'],['revolver','loafbrr-cc0']]) {
  const slug=base+'-hd',id=`candidate-${weapon}-${slug}`
  const file=resolve(root,`assets/models/weapons-candidates/${weapon}/${slug}/${slug}.gltf`)
  const doc=JSON.parse(await readFile(file,'utf8'))
  const report=JSON.parse(await readFile(resolve(dirname(file),'conversion.json'),'utf8'))
  const files={[basename(file)]:relative(root,file)}
  for(const entry of [...(doc.buffers||[]),...(doc.images||[])]) {
    if(!entry.uri||entry.uri.startsWith('data:'))throw Error('External files required')
    const resource=resolve(dirname(file),decodeURIComponent(entry.uri))
    await readFile(resource);files[entry.uri]=relative(root,resource)
  }
  registry.files[id]={path:relative(root,file),files,candidate:{
    name:`Candidate ${weapon} ${slug}`,weapon,slug,shippable:true,triangles:report.triangles,
    derivedFrom:`candidate-${weapon}-${base}`,
  }}
}
await writeFile(path,JSON.stringify(registry,null,2)+'\n')
console.log('Registered two HD derivatives. Existing candidates remain registered.')
