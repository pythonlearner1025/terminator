// Capture the actual placed pairs headlessly. Do not save this temporary camera setup.
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4357')throw Error('Expected private port 4357')
const browser=await chromium.launch({headless:true,args:[
  '--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist',
]})
const output='docs/evidence/weapons-hd'
await mkdir(output,{recursive:true})
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').click({timeout:90000})
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:90000})
 await page.evaluate(()=>window.terminator.manager.ready)
 const setup=await page.evaluate(async()=>{
  const E=await import('threepipe'),v=window.viewer,m=window.terminator.manager
  m.capturePaused=true;m.syncViews=()=>{}
  m.lab.root.style.visibility='hidden';m.ui.rangePanel.root.hidden=true
  m.hud.root.style.visibility='hidden'
  m.playerView.root.visible=false
  Object.assign(v.container.style,{position:'fixed',left:'0',top:'0',width:'1920px',height:'1080px',zIndex:999})
  v.setSize({width:1920,height:1080});v.resize()
  const camera=new E.OrthographicCamera2('',v.canvas,false)
  camera.frustumSize=0
  camera.name='Temporary evidence camera';camera.controlsMode='';camera.autoLookAtTarget=false
  camera.autoNearFar=false;camera.near=.01;camera.far=200;camera.updateProjectionMatrix()
  v.scene.addObject(camera);camera.activateMain()
  const report=[]
  for(const [weapon,slug] of [['shotgun','3dmodels-cc0'],['revolver','loafbrr-cc0']]){
   const names=[`Candidate ${weapon} ${slug}`,`Candidate ${weapon} ${slug}-hd`]
   const objects=names.map(name=>{let result;v.scene.modelRoot.traverse(o=>{if(o.name===name||o.name===name.replaceAll(' ','_'))result=o});return result})
   if(objects.some(o=>!o))throw Error('Missing placed pair')
   const box=new E.Box3();for(const o of objects)box.union(new E.Box3().setFromObject(o))
   const center=box.getCenter(new E.Vector3()),size=box.getSize(new E.Vector3())
   report.push({weapon,names,center:center.toArray(),size:size.toArray(),positions:objects.map(o=>o.getWorldPosition(new E.Vector3()).toArray())})
  }
  window.hdEvidence={E,camera,report};return report
 })
 for(const pair of setup){
  await page.evaluate(pair=>{
   const {E,camera}=window.hdEvidence,v=window.viewer
   const c=new E.Vector3(...pair.center)
   const halfWidth=pair.weapon==='shotgun'?1.14:.86
   camera.left=-halfWidth;camera.right=halfWidth
   camera.top=halfWidth*1080/1920;camera.bottom=-camera.top;camera.updateProjectionMatrix()
   const names=new Set(pair.names.flatMap(n=>[n,n.replaceAll(' ','_')]))
   for(const n of v.scene.modelRoot.getObjectByName('Candidates').children)n.visible=names.has(n.name)
   camera.position.copy(c).add(new E.Vector3(0,.20,pair.weapon==='shotgun'?2.15:1.7))
   camera.target.copy(c);camera.lookAt(c);camera.updateMatrixWorld(true);camera.setDirty();v.setDirty()
  },pair)
  await page.waitForTimeout(1200)
  await page.screenshot({path:`${output}/${pair.weapon}-rack.png`})
 }
 await writeFile('tools/blender/hd/rounds/rack-layout.json',JSON.stringify(setup,null,2)+'\n')
}finally{await browser.close()}
