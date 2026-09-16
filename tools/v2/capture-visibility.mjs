/** Explicit single-object visibility diagnostic; never a progress-gallery capture. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
const [directory,baselineDirectory,viewId,objectName]=process.argv.slice(2)
if(!directory||!baselineDirectory||!viewId||!objectName)throw Error('Usage: capture-visibility output baseline view-id exact-object-name')
const output=resolve(directory);await mkdir(output)
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const baselineBytes=await readFile(resolve(baselineDirectory,'capture.json'))
const baseline=JSON.parse(baselineBytes),view=config.views.find(v=>v.id===viewId),before=baseline.views.find(v=>v.id===viewId)
assert(view&&before);assert.deepEqual(config,baseline.config)
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8')),overrides=loadPilotOverrides()
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),config,launch:browserOptions(),sourceFiles:{},diagnosticOverrides:overrides?.manifest,baseline:{directory:baselineDirectory,manifestSha256:createHash('sha256').update(baselineBytes).digest('hex'),view:before},mode:'Single named runtime object hidden; diagnostic only; original POV and all other scene state preserved',objectName,errors:[]}
for(const file of Object.keys(baseline.sourceFiles))report.sourceFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex')
assert.deepEqual(report.sourceFiles,baseline.sourceFiles,'Runtime source differs from reused baseline')
assert.deepEqual(report.diagnosticOverrides,baseline.diagnosticOverrides,'Owner pins differ from reused baseline')
report.harnessSha256=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')
const clean=v=>String(v).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
const browser=await launchCaptureBrowser();report.browser=browser.version()
try{
 const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1});await overrides?.install(page)
 page.on('pageerror',e=>report.errors.push(clean(e.message)));page.on('console',e=>{if(e.type()==='error')report.errors.push(clean(e.text()))})
 await page.addInitScript(({seed,settings})=>{let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url);await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 report.initial=await page.evaluate(async({view,config,objectName})=>{
  const m=window.terminator.manager,viewer=window.viewer;m.update=()=>true
  await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
  const p=m.world.player;p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
  const support=m.world.playerSupportAt(p.pos,p.pos.y,{radius:.3,maxAbove:.05,maxBelow:.05});if(!support||!m.world.playerHasHeadClearance(p.pos,1.8,support))throw Error('Unsupported original POV')
  const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-(p.pos.y+1.65),dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
  for(let tick=0;tick<=config.tick;tick++){m.world.tick=tick;m.mapView.sync(m.world);m.playerView.sync(m.world)}m.syncUi(true);m.hud.sync()
  const matches=[];m.mapView.root.traverse(o=>{if(o.name===objectName)matches.push(o)})
  if(matches.length!==1)throw Error('Expected exactly one named runtime object')
  const object=matches[0];window.visibilityDiagnostic={object,visible:object.visible,frame:()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);viewer.setDirty()}}
  viewer.addEventListener('preFrame',window.visibilityDiagnostic.frame)
  window.visibilitySnapshot=()=>{
   const camera=m.playerView.camera,rm=viewer.renderManager,r=rm.webglRenderer,gl=r.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),visibility=[]
   m.mapView.root.traverse(o=>{visibility.push({name:o.name,uuid:o.uuid,visible:o.visible})})
   return {camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far},feet:{...p.pos},support:JSON.parse(JSON.stringify(support)),tick:m.world.tick,mapState:JSON.parse(JSON.stringify(m.world.mapState)),weapon:p.activeWeapon,
    renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unknown',renderSettings:{drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],pixelRatio:r.getPixelRatio(),renderScale:rm.renderScale,maxRenderScale:viewer.maxRenderScale??null,antialias:gl.getContextAttributes().antialias,msaa:rm.msaa??null,outputColorSpace:r.outputColorSpace,quality:m.mapView.quality},visibility,
    fog:viewer.scene.fog?{color:viewer.scene.fog.color.toArray(),density:viewer.scene.fog.density}:null,exposure:viewer.getPlugin('Tonemap')?.exposure,
    object:{name:object.name,uuid:object.uuid,visible:object.visible,position:object.position.toArray(),opacity:object.material?.opacity,color:object.material?.color?.toArray()}}
  }
  return window.visibilitySnapshot()
 },{view,config,objectName})
 assert.match(report.initial.renderer,/NVIDIA/)
 // Baseline is JSON: canonicalize signed zero using the same serialization.
 for(const key of ['camera','feet','support','tick','mapState','weapon','renderer','renderSettings'])assert.deepEqual(JSON.parse(JSON.stringify(report.initial[key])),before[key],key+' differs from baseline')
 try{
  await page.evaluate(()=>{window.visibilityDiagnostic.object.visible=false;window.viewer.setDirty()})
  await page.evaluate(()=>document.fonts.ready)
  await page.evaluate(async()=>{for(let i=0;i<120;i++)await new Promise(resolve=>requestAnimationFrame(resolve))})
  report.hidden=await page.evaluate(()=>window.visibilitySnapshot())
  const expected=structuredClone(report.initial);expected.object.visible=false;expected.visibility.find(o=>o.uuid===expected.object.uuid).visible=false
  assert.deepEqual(report.hidden,expected,'More than the named visibility changed')
  const png=await page.screenshot({path:resolve(output,viewId+'-hidden.png'),animations:'disabled'});report.sha256=createHash('sha256').update(png).digest('hex')
 }finally{
  report.restored=await page.evaluate(()=>{const state=window.visibilityDiagnostic;state.object.visible=state.visible;window.viewer.setDirty();return window.visibilitySnapshot()})
  assert.deepEqual(report.restored,report.initial,'Visibility/state did not restore exactly')
  await page.evaluate(()=>{window.viewer.removeEventListener('preFrame',window.visibilityDiagnostic.frame);window.terminator.manager.stop()})
 }
 assert.deepEqual(report.errors,[]);report.pass=true
}catch(error){throw new Error(clean(error.message))}finally{await writeFile(resolve(output,'visibility.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
