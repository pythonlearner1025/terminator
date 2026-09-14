import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname} from 'node:path'
import {launchCaptureBrowser} from './capture-browser.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(process.env.STARTUP_GPU_GRANTED!=='1')throw Error('Explicit startup GPU grant required')
if(process.platform==='linux')assert.equal(JSON.parse(await readFile('../coordination/perf-budget-gpu.json','utf8')).owner,'perf-budget-startup')
const ownPort=process.env.STARTUP_DEV_PORT||'4755'
assert((process.platform==='darwin'?['4753','4755','4756']:['4755']).includes(ownPort));assert.equal(new URL(dev.origin).hostname,'127.0.0.1');assert.equal(new URL(dev.origin).port,ownPort)
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
 await page.goto(dev.origin+'/files/tools/map-runtime.html')
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
 // Isolated first-use diagnostic: grant inventory/actors solely to exercise all
 // variants. Native timing acceptance is collected separately without this setup.
 report.firstUse=await page.evaluate(async()=>{
  const m=window.terminator.manager,w=m.world,r=m.ctx.viewer.renderManager.webglRenderer
  const result={method:'Diagnostic inventory grants and direct gameplay actions; not FPS acceptance',weapons:[],deaths:[]}
  const observe=async(action)=>{
   const textures=r.info.memory.textures,programs=r.info.programs.length,tick=w.tick
   const gaps=[],start=performance.now();let last=start
   action()
   while(performance.now()-start<700){await new Promise(requestAnimationFrame);const now=performance.now();gaps.push(now-last);last=now}
   const sorted=[...gaps].sort((a,b)=>a-b)
   return {tickDelta:w.tick-tick,frames:gaps.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...gaps),newTextures:r.info.memory.textures-textures,newPrograms:r.info.programs.length-programs}
  }
  w.player.hp=10000;w.player.armor=10000
  for(const id of w.weaponCatalog.slots){
   w.player.ammo[id].owned=true;w.player.ammo[id].mag=w.weaponCatalog.weapons[id].mag
   let fired=false
   const timing=await observe(()=>{w.switchWeapon(id);w.player.fireCooldown=0;w.player.reloadTimer=0;fired=w.playerFire()})
   result.weapons.push({id,fired,...timing})
  }
  for(const type of Object.keys(w.unitCatalog.types)){
   const p=w.player.pos,u=w.spawnUnit(type,{x:p.x+4,y:type==='hkaerial'?5:0,z:p.z-5},{yaw:0})
   await new Promise(requestAnimationFrame)
   const timing=await observe(()=>w.damageUnit(u.id,100000,{source:'player',playerId:w.player.id,weapon:'sniper',part:'Head',point:{...u.pos},normal:{x:0,y:1,z:0},direction:{x:0,y:0,z:-1}}))
   result.deaths.push({type,dead:!u.alive,...timing})
  }
  return result
 })

 report.duplicateImages=await page.evaluate(async()=>{
  const sources=new Map(),groups=new Map()
  window.terminator.manager.ctx.viewer.scene.traverse(o=>{
   for(const material of (Array.isArray(o.material)?o.material:[o.material]))if(material)for(const t of Object.values(material))if(t?.isTexture&&t.source&&!sources.has(t.source)){
    const image=t.image;if(!image?.src?.startsWith('blob:'))continue
    sources.set(t.source,true);const key=JSON.stringify([t.name,image.width,image.height])
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({source:t.source.uuid,url:image.src})
   }
  })
  const result=[]
  for(const [key,items] of groups)if(items.length>1){
   const hashes=[]
   for(const item of items){const bytes=await fetch(item.url).then(r=>r.arrayBuffer());const digest=await crypto.subtle.digest('SHA-256',bytes);hashes.push({source:item.source,bytes:bytes.byteLength,sha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')})}
   result.push({nameDimensions:JSON.parse(key),sources:hashes,distinctPayloads:new Set(hashes.map(h=>h.sha256)).size})
  }
  return result
 })
 assert.equal(report.firstUse.weapons.length,6);assert.equal(report.firstUse.deaths.length,6)
 for(const item of report.firstUse.weapons)assert(item.fired,`${item.id} did not fire`)
 for(const item of report.firstUse.deaths)assert(item.dead,`${item.type} did not die`)

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
 // The exact cover is already imported by the baked path. Exercise a required
 // runtime material instead, without forcing procedural fallback.
 const binary='**/assets/v2/materials/wall-aggregate-normal.png'
 await page.evaluate(()=>window.terminator.manager.start());await menu()
 await page.route(binary,route=>route.fulfill({status:503,body:'Intentional required collision-matched cover failure'}))
 report.requiredFailure=await page.evaluate(async()=>{
  const m=window.terminator.manager;let error
  try{await m.ui.startMatch()}catch(e){error=String(e.message||e)}
  return {error,phase:m.director.phase,renderEnabled:m.ctx.viewer.renderEnabled,viewsStarted:m.viewsStarted}
 })
 assert(report.requiredFailure.error,'Required material failure must reject readiness');assert.equal(report.requiredFailure.phase,'lobby');assert.equal(report.requiredFailure.viewsStarted,false);assert(report.requiredFailure.renderEnabled)
 await page.unroute(binary);await stop()
 await page.evaluate(()=>window.terminator.manager.start());await menu()
 await page.evaluate(async()=>{const m=window.terminator.manager;await m.ui.startMatch();m.ui.screens.show(null)})
 report.requiredRetry=await page.evaluate(()=>({phase:window.terminator.manager.director.phase,ready:!!window.terminator.manager.visualWarmupReport,baked:window.terminator.manager.mapView.v2Handles.slice(0,2).map(h=>h.stats.bakedReuse)}))
 assert.equal(report.requiredRetry.phase,'wave');assert(report.requiredRetry.ready);assert.deepEqual(report.requiredRetry.baked,[true,true]);await stop()
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
 await editor.waitForFunction(async()=>{const s=await fetch('/api/state').then(r=>r.json());return s.projectLoaded&&!s.lastLoadError&&window.viewer?.scene.modelRoot.getObjectByName('Map')},null,{timeout:120000})
 await editor.evaluate(()=>{window.__startupEditor=window.viewer})
 const menuHeld=Promise.withResolvers(),menuGate=Promise.withResolvers();releaseGate=menuGate.resolve
 await editor.route('**/assets/store/materials/steel-albedo.png',async route=>{menuHeld.resolve();await menuGate.promise;await route.abort().catch(()=>{})})
 await editor.getByTestId('play').click()
 let menuTimer
 try{await Promise.race([menuHeld.promise,new Promise((_,reject)=>{menuTimer=setTimeout(()=>reject(Error('Menu request not observed')),60000)})])}finally{clearTimeout(menuTimer)}
 await editor.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='loading',null,{timeout:30000})
 report.editorLoading=await editor.evaluate(()=>({renderEnabled:window.terminator.manager.ctx.viewer.renderEnabled,phase:window.terminator.manager.director.phase}))
 assert.equal(report.editorLoading.renderEnabled,false)
 await editor.getByTestId('play').click()
 releaseGate()
 await editor.waitForFunction(()=>window.__startupEditor.renderEnabled&&!window.__startupEditor.getPlugin('EntityComponentPlugin').running,null,{timeout:30000})
 report.editorStopped=await editor.evaluate(()=>({renderEnabled:window.__startupEditor.renderEnabled,previewVisible:(window.__startupEditor.scene.modelRoot.getObjectByName('V2 Environment Preview')||window.__startupEditor.scene.modelRoot.getObjectByName('V2_Environment_Preview')).visible}))
 assert(report.editorStopped.renderEnabled);assert(report.editorStopped.previewVisible)
 assert.deepEqual(report.errors,[])
 for(const cycle of report.cycles.slice(1))for(const key of ['geometries','textures','programs'])assert(cycle.memory[key]<=report.cycles[0].memory[key]+1,`${key} grew across completed cycles`)
 report.imageSourceSharing=await editor.evaluate(()=>({...window.__startupEditor.getPlugin('V2ExactImageSourceSharing')?.stats}))
 report.requestCount=requests;report.pass=true;report.cgroup=browser.captureCgroup
} catch(error){report.error=error.stack;throw error}
finally {releaseGate?.();await browser.close();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n')}
console.log('PASS: real optional preload recovery, required asset failure, held-request cancellation and three lifecycle cycles')
