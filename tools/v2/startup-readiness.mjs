import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../../test/helpers/editor-driver.mjs'
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname} from 'node:path'
import {launchCaptureBrowser} from './capture-browser.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const ownPort=process.env.STARTUP_DEV_PORT||'4752'
assert(['4752','4753'].includes(ownPort));assert.equal(new URL(new URL(dev.url).origin).hostname,'127.0.0.1');assert.equal(new URL(new URL(dev.url).origin).port,ownPort)
const output=process.argv[2]||'docs/evidence/perf-startup/readiness.json'
await readFile(output).then(()=>{throw Error('Refusing evidence overwrite')},e=>{if(e.code!=='ENOENT')throw e})
const browser=await launchCaptureBrowser(),report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),errors:[],cycles:[]}
let releaseGate
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',fov:72,controlsSeen:true})))
 let failing=true,requests=0
 await page.route('**/assets/textures/weapons/weapon-albedo.png',async route=>{requests++;if(failing)await route.fulfill({status:503,body:'Intentional optional preload failure'});else await route.continue()})
 await page.request.get(dev.url)
 await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
 const menu=()=>page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 await menu()
 await page.waitForFunction(()=>window.terminator.manager.ui.preparationError,null,{timeout:30000})
 report.optionalFailure=await page.evaluate(()=>({phase:window.terminator.manager.director.phase,viewsStarted:window.terminator.manager.viewsStarted}))
 assert.equal(report.optionalFailure.phase,'lobby');assert.equal(report.optionalFailure.viewsStarted,false)
 failing=false
 await page.evaluate(async()=>{const m=window.terminator.manager;await m.ui.startMatch();m.ui.screens.show(null)})
 report.recovered=await page.evaluate(()=>{const m=window.terminator.manager;return {phase:m.director.phase,textureWidth:m.playerView.weapons.material.map.image.width,modules:m.mapView.v2Handles.length,warmup:m.visualWarmupReport,cover:!!m.mapView.root.getObjectByName('V2 Declared Collapse Cover'),renderEnabled:m.ctx.viewer.renderEnabled}})
 assert.equal(requests,2);assert.equal(report.recovered.phase,'wave');assert(report.recovered.textureWidth>0);assert.equal(report.recovered.modules,5);assert(report.recovered.cover);assert.equal(report.recovered.renderEnabled,true)
 await page.unroute('**/assets/textures/weapons/weapon-albedo.png')
 const stop=()=>page.evaluate(async()=>{
  const m=window.terminator.manager,v=m.ctx.viewer;m.stop()
  for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)
  return {renderEnabled:v.renderEnabled,runtimeRoots:v.scene.children.filter(o=>/^(Map Runtime|Units Runtime|Player Runtime|Endo menu stage)$/.test(o.name)).length,
    previewVisible:(v.scene.modelRoot.getObjectByName('V2 Environment Preview')||v.scene.modelRoot.getObjectByName('V2_Environment_Preview'))?.visible,
    memory:{...v.renderManager.webglRenderer.info.memory,programs:v.renderManager.webglRenderer.info.programs.length}}
 })
 report.cycles.push(await stop())
 for(let i=0;i<2;i++){
  await page.evaluate(()=>window.terminator.manager.start());await menu()
  await page.evaluate(async()=>{const m=window.terminator.manager;await m.ui.startMatch();m.ui.screens.show(null)})
  report.cycles.push(await stop())
 }
 for(const cycle of report.cycles){assert(cycle.renderEnabled);assert.equal(cycle.runtimeRoots,0);assert(cycle.previewVisible)}
 const scan=JSON.parse(await readFile('assets/v2/architecture/rubble-cover.json','utf8'))
 const binary=`**/assets/models/selected/${scan.source}/scene.bin`
 await page.evaluate(()=>window.terminator.manager.start());await menu()
 await page.route(binary,route=>route.fulfill({status:503,body:'Intentional required collision-matched cover failure'}))
 report.requiredFailure=await page.evaluate(async()=>{
  const m=window.terminator.manager;let error
  try{await m.ui.startMatch()}catch(e){error=String(e.message||e)}
  return {error,phase:m.director.phase,renderEnabled:m.ctx.viewer.renderEnabled,viewsStarted:m.viewsStarted}
 })
 assert.match(report.requiredFailure.error,/503/);assert.equal(report.requiredFailure.phase,'lobby');assert.equal(report.requiredFailure.viewsStarted,false);assert(report.requiredFailure.renderEnabled)
 await page.unroute(binary);await stop()
 await page.evaluate(()=>window.terminator.manager.start());await menu()
 const observed=Promise.withResolvers(),gate=Promise.withResolvers();releaseGate=gate.resolve
 await page.route(binary,async route=>{observed.resolve();await gate.promise;await route.abort().catch(()=>{})})
 await page.evaluate(()=>{const m=window.terminator.manager;m.ui.menuScene.setActive(false);m.startViews();window.__pendingStartup=m.visualWarmup})
 let timer
 try {await Promise.race([observed.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Required request not observed')),30000)})])}finally{clearTimeout(timer)}
 report.cancelled=await stop()
 assert(report.cancelled.renderEnabled);assert.equal(report.cancelled.runtimeRoots,0);assert(report.cancelled.previewVisible)
 releaseGate();report.cancelled.warmup=await page.evaluate(()=>window.__pendingStartup)
 assert.equal(report.cancelled.warmup.cancelled,true)
 await page.close()
 // Actual editor Play, held before menu readiness: Stop must release the
 // initial render hold and return the still-authored editor to a usable state.
 const editor=await browser.newPage({viewport:{width:1920,height:1080}})
 editor.on('pageerror',e=>report.errors.push(e.message))
 await editor.goto(dev.url,{waitUntil:'domcontentloaded'})
 await waitForProjectLoaded(editor,{timeout:120000})
 await editor.waitForFunction(()=>window.viewer?.scene.modelRoot.getObjectByName('Map'),null,{timeout:120000})
 await editor.evaluate(()=>{window.__startupEditor=window.viewer})
 const menuHeld=Promise.withResolvers(),menuGate=Promise.withResolvers();releaseGate=menuGate.resolve
 await editor.route('**/assets/store/materials/steel-albedo.png',async route=>{menuHeld.resolve();await menuGate.promise;await route.abort().catch(()=>{})})
 await runEditor(editor)
 let menuTimer
 try{await Promise.race([menuHeld.promise,new Promise((_,reject)=>{menuTimer=setTimeout(()=>reject(Error('Menu request not observed')),60000)})])}finally{clearTimeout(menuTimer)}
 await editor.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='loading',null,{timeout:30000})
 report.editorLoading=await editor.evaluate(()=>({renderEnabled:window.terminator.manager.ctx.viewer.renderEnabled,phase:window.terminator.manager.director.phase}))
 assert.equal(report.editorLoading.renderEnabled,false)
 await stopEditor(editor)
 releaseGate()
 await editor.waitForFunction(()=>window.__startupEditor.renderEnabled&&!window.__startupEditor.getPlugin('EntityComponentPlugin').running,null,{timeout:30000})
 report.editorStopped=await editor.evaluate(()=>({renderEnabled:window.__startupEditor.renderEnabled,previewVisible:(window.__startupEditor.scene.modelRoot.getObjectByName('V2 Environment Preview')||window.__startupEditor.scene.modelRoot.getObjectByName('V2_Environment_Preview')).visible}))
 assert(report.editorStopped.renderEnabled);assert(report.editorStopped.previewVisible)
 assert.deepEqual(report.errors,[])
 report.requestCount=requests;report.pass=true;report.cgroup=browser.captureCgroup
} catch(error){report.error=error.stack;throw error}
finally {releaseGate?.();await browser.close();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n')}
console.log('PASS: real optional preload recovery, required asset failure, held-request cancellation and three lifecycle cycles')
