// Keep a private headless editor connected for the unmodified Kite3D check.
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {spawn} from 'node:child_process'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4357')throw Error('Expected private port 4357')
const browser=await chromium.launch({headless:true,args:[
  '--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist',
]})
const errors=[]
const missing=[]
const safe=s=>String(s).replace(/([?&]t=)[^&\s"']+/g,'$1[private]')
try {
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
  page.on('pageerror',e=>errors.push(safe(e.message)))
  page.on('console',e=>{if(e.type()==='error')errors.push(safe(e.text()))})
  page.on('response',r=>{if(r.status()>=400)missing.push(new URL(r.url()).pathname)})
  await page.goto(dev.url,{waitUntil:'domcontentloaded'})
  await page.getByTestId('play').waitFor({timeout:90000})
  await page.waitForFunction(()=>{
    const rack=window.viewer?.scene?.modelRoot?.getObjectByName('Candidates')
    return rack?.children.length===17&&rack.children.every(n=>n.children.length>0)
  },null,{timeout:90000})
  const assets=await page.evaluate(()=>{
    const root=window.viewer.scene.modelRoot,rack=root.getObjectByName('Candidates')
    return rack.children.filter(n=>n.name.endsWith('-hd')).map(n=>{
      let triangles=0,draws=0;const maps=new Set()
      n.traverse(o=>{if(!o.isMesh)return;draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3
        for(const key of ['map','normalMap','roughnessMap','metalnessMap','aoMap'])if(o.material[key])maps.add(o.material[key])})
      return {name:n.name,triangles,drawCalls:draws,textureCount:maps.size,
        textures:[...maps].map(t=>({width:t.image?.width,height:t.image?.height}))}
    })
  })
  const child=spawn('npx',['--no-install','kite3d','check'],{stdio:['ignore','pipe','pipe']})
  let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b)
  const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)})
  await writeFile('.kite3d/hd-check.log',safe(log))
  const report=JSON.parse(await readFile('.kite3d/check.json','utf8'))
  await writeFile('tools/blender/hd/rounds/validation.json',safe(JSON.stringify({assets,errors,missing,check:report},null,2))+'\n')
  console.log(safe(log));console.log(JSON.stringify({assets,consoleErrors:errors.length}))
  process.exitCode=code||0
}finally{await browser.close()}
