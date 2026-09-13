/** Reproduce real PlayerView POVs without editing the scene or the user's editor. */
import {mkdir,readFile,writeFile,access} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {chromium} from 'playwright'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const config=JSON.parse(await readFile(resolve(root,'docs/scene-targets/views.json'),'utf8'))
const out=resolve(root,process.argv[2] || 'docs/evidence/scene-candidate')
await mkdir(out,{recursive:true})
for(const view of config.views) {
  try {await access(resolve(out,view.id+'.png'));throw new Error(`Refusing to overwrite ${view.id}. Choose a new output folder.`)}
  catch(error){if(error.code!=='ENOENT')throw error}
}
const dev=JSON.parse(await readFile(resolve(root,'.kite3d/dev.json'),'utf8'))
const executablePath=process.env.CHROME_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined)
const browser=await chromium.launch({executablePath,headless:true,args:process.platform==='darwin'?['--use-angle=metal']:[]})
const manifest={schema:1,config,git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),browser:browser.version(),platform:process.platform,deviceScaleFactor:1,mode:'Actual PlayerView; first-wave start held still; default map state; fixed presentation tick; no enemies advanced',views:[]}
const clean=value=>String(value).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
try {
 for(const view of config.views){
  const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1})
  const errors=[]
  page.on('pageerror',e=>errors.push(clean(e.message)))
  page.on('console',e=>{if(e.type()==='error')errors.push(clean(e.text()))})
  await page.addInitScript(({seed,settings})=>{
   let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296}
   localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))
  },config)
  await page.request.get(dev.url)
  await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
  const state=await page.evaluate(async({view,config})=>{
   const m=window.terminator.manager
   m.update=()=>true // Stop simulation, not rendering; no scene/source mutation.
   await m.ui.startMatch();await m.mapView.ready
   m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
   const p=m.world.player
   p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
   const support=m.world.playerSupportAt(p.pos,p.pos.y,{radius:.3,maxAbove:.05,maxBelow:.05})
   if(!support||!m.world.playerHasHeadClearance(p.pos,1.8,support))throw Error('Invalid standing POV: '+view.id)
   const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-(p.pos.y+1.65),dz=view.lookAt[2]-p.pos.z
   p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
   for(let tick=0;tick<=config.tick;tick++){m.world.tick=tick;m.mapView.sync(m.world);m.playerView.sync(m.world)}
   m.syncUi(true);m.hud.sync()
   const camera=m.playerView.camera
   window.referenceFrame=()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);window.viewer.setDirty()}
   window.viewer.addEventListener('preFrame',window.referenceFrame)
   const gl=window.viewer.canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info')
   return {feet:{...p.pos},support:JSON.parse(JSON.stringify(support)),camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far},tick:m.world.tick,mapState:m.world.mapState,weapon:p.activeWeapon,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'}
  },{view,config})
  await page.evaluate(()=>document.fonts.ready)
  await page.waitForTimeout(1800)
  const file=resolve(out,view.id+'.png')
  const png=await page.screenshot({path:file,animations:'disabled'})
  manifest.views.push({id:view.id,...state,sha256:createHash('sha256').update(png).digest('hex'),errors})
  await page.evaluate(()=>{window.viewer.removeEventListener('preFrame',window.referenceFrame);window.terminator.manager.stop()})
  await page.close()
  if(errors.length)throw new Error(errors.join('\n'))
  console.log(`Captured ${view.id} at ${state.camera.fov}° from supported player feet`)
 }
 await writeFile(resolve(out,'capture.json'),JSON.stringify(manifest,null,2)+'\n')
}finally{await browser.close()}
