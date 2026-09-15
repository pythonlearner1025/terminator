// Run from project root: DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-sustained.mjs
// Requires the project's kite3d dev server. One disposable Playwright profile.
import {readFile, writeFile, appendFile, mkdir} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {launchCaptureBrowser} from './capture-browser.mjs'
const output=process.env.SUSTAIN_OUTPUT||'docs/evidence/sustained-validation.json'
const findings=process.env.SUSTAIN_FINDINGS||'../coordination/sustained-validation.findings.md'
const seconds=Number(process.env.SUSTAIN_SECONDS||240)
if(!Number.isFinite(seconds)||seconds<180||seconds>300)throw Error('SUSTAIN_SECONDS must be 180–300')
const cg='/sys/fs/cgroup'+(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::')).slice(3)
const report={startedAt:new Date().toISOString(),durationSeconds:seconds,viewport:[480,270],samples:[],errors:[],consoleErrors:[],resourceFailures:[]}
let browser,monitor,child,deadline
await mkdir('docs/evidence',{recursive:true})
const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n')
async function progress(message){console.log(message);await appendFile(findings,`\n${new Date().toISOString()} ${message}\n`);await save()}
try{
 report.cgroup={memoryMax:Number(await readFile(cg+'/memory.max','utf8')),tasksMax:Number(await readFile(cg+'/pids.max','utf8')),abortAboveBytes:3.5*1024**3}
 // Monitor starts before launch, covers browser startup as well as scene load.
 monitor=setInterval(async()=>{try{const bytes=Number(await readFile(cg+'/memory.current','utf8'));report.peakCgroupBytes=Math.max(report.peakCgroupBytes||0,bytes);if(bytes>report.cgroup.abortAboveBytes&&!report.aborted){report.aborted='cgroup above 3.5 GiB';console.error(report.aborted);await browser?.close()}}catch{}},500)
 deadline=setTimeout(()=>{report.aborted='12 minute overall deadline';child?.kill('SIGTERM');browser?.close()},720000)
 browser=await launchCaptureBrowser()
 if(report.aborted)throw Error(report.aborted)
 const context=await browser.newContext({viewport:{width:480,height:270},deviceScaleFactor:1,ignoreHTTPSErrors:true})
 await context.addInitScript(()=>{
  localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',fov:72,controlsSeen:true}))
  document.addEventListener('click',event=>{if(event.target.closest?.('[data-testid="start-match"]')){
   const s=window.__startProbe={clickedAt:performance.now()}
   const watch=()=>{const m=window.terminator?.manager;if(m?.input?.active&&!m.ui?.screens?.route&&m.director?.phase==='wave'){
    s.inputReadyMs=performance.now()-s.clickedAt
    requestAnimationFrame(()=>s.nextFrameMs=performance.now()-s.clickedAt)
   }else if(performance.now()-s.clickedAt<90000)requestAnimationFrame(watch)};requestAnimationFrame(watch)
  }},true)
 })
 const page=await context.newPage();page.setDefaultTimeout(90000)
 page.on('pageerror',e=>{if(report.errors.length<30)report.errors.push(e.message)})
 page.on('console',e=>{if(e.type()==='error'&&report.consoleErrors.length<30)report.consoleErrors.push(e.text())})
 page.on('requestfailed',r=>{if(report.resourceFailures.length<30){const url=new URL(r.url());report.resourceFailures.push({path:url.pathname,error:r.failure()?.errorText})}})
 const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
 await page.request.get(dev.url)
 await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main')
 await progress('Owned 480x270 Vulkan browser loaded main menu; starting through actual DOM buttons.')
 async function domStart(){
  await page.getByTestId('menu-play').click()
  await page.getByTestId('start-match').click()
  await page.waitForFunction(()=>window.__startProbe?.nextFrameMs&&window.terminator.manager.visualWarmupReport)
  await page.keyboard.down('w')
  await page.waitForFunction(()=>window.terminator.manager.world.lastInputsBundle?.player?.move?.z===1)
  const result=await page.evaluate(()=>{const m=window.terminator.manager,r=m.ctx.viewer.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {...window.__startProbe,keyAcceptedMs:performance.now()-window.__startProbe.clickedAt,lastInputs:m.world.lastInputsBundle.player,renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),warmup:m.visualWarmupReport,startup:m.startup,memory:{...r.info.memory},programs:r.info.programs.length}})
  await page.keyboard.up('w');return result
 }
 report.start=await domStart()
 await progress(`DOM START input ready ${report.start.inputReadyMs.toFixed(1)}ms, next frame ${report.start.nextFrameMs.toFixed(1)}ms; keyboard W accepted. Renderer: ${report.start.renderer}.`)
 report.fixture=await page.evaluate(async()=>{
  const {createCombatRoute}=await import('/files/tools/v2/combat-route.mjs')
  const m=window.terminator.manager,w=m.world,v=m.ctx.viewer,r=v.renderManager.webglRenderer,u=m.unitView
  m.director.setSandbox(true);m.director.pauseWaves();w.setSandbox({invulnerable:true,infiniteScrap:true})
  w.clearUnits();m.syncViews();w.giveAllWeapons();w.switchWeapon('m4')
  const types=['scout','endo','heavy','t1000','hkaerial','hktank'],slots=new Map()
  const base={...w.player.pos};let spawns=0,forcedDeaths=0,cycle=0
  const replenish=()=>{for(let i=0;i<types.length;i++){
   const type=types[i],old=slots.get(type);if(old?.alive)continue
   const a=(i-2)*.24,pos={x:base.x+Math.sin(a)*11,y:type==='hkaerial'?4:0,z:base.z+Math.cos(a)*11}
   slots.set(type,w.spawnUnit(type,pos));spawns++
  }}
  replenish();m.syncViews();const route=createCombatRoute(w),originalSample=m.ui.sample
  m.ui.sample=()=>route.sample()
  const now=()=>performance.now(),start=now(),originalStep=m.director.step
  m.director.step=function(inputs){
   replenish()
   const next=Math.floor((now()-start)/8000)
   if(next>cycle){cycle=next;const victim=slots.get(types[(cycle-1)%types.length]);if(victim?.alive){w.damageUnit(victim.id,100000,{source:'player',weapon:victim.type==='scout'?'grenade':'m4',headshot:victim.type==='endo',direction:{x:0,y:0,z:1},point:{...victim.pos,y:victim.pos.y+1.4}});forcedDeaths++}replenish()}
   const ammo=w.player.ammo?.[w.player.activeWeapon];if(ammo&&ammo.reserve<90)ammo.reserve=300
   originalStep.call(this,inputs);replenish()
  }
  let previous=now(),draws=0,corpseDraws=0,skinCalls=0,corpseSkinCalls=0,skinMs=0,corpseSkinMs=0
  const frames=[],calls=[],corpseCalls=[],skins=[],corpseSkins=[],skinTimes=[],corpseSkinTimes=[],corpseMeshes=new Set(),corpseSkeletons=new Set()
  const refreshCorpses=()=>{corpseMeshes.clear();corpseSkeletons.clear();for(const visual of u.visuals.values())if(visual.ragdoll||visual.rosterDeath)visual.object.traverse(o=>{if(o.isMesh)corpseMeshes.add(o);if(o.skeleton)corpseSkeletons.add(o.skeleton)});for(const record of u.ragdolls.records)corpseMeshes.add(record.object)}
  const originalDraw=r.renderBufferDirect
  r.renderBufferDirect=function(camera,scene,geometry,material,object,group){const before=r.info.render.calls;const result=originalDraw.call(this,camera,scene,geometry,material,object,group);const count=r.info.render.calls-before;draws+=count;if(corpseMeshes.has(object))corpseDraws+=count;return result}
  const skeleton=Array.from(u.visuals.values()).find(x=>x.rig.mesh.skeleton)?.rig.mesh.skeleton
  const proto=Object.getPrototypeOf(skeleton),originalSkin=proto.update
  proto.update=function(...args){const start=now(),result=originalSkin.apply(this,args),ms=now()-start;skinCalls++;skinMs+=ms;if(corpseSkeletons.has(this)){corpseSkinCalls++;corpseSkinMs+=ms}return result}
  const post=()=>{const time=now();frames.push(time-previous);previous=time;calls.push(draws);corpseCalls.push(corpseDraws);skins.push(skinCalls);corpseSkins.push(corpseSkinCalls);skinTimes.push(skinMs);corpseSkinTimes.push(corpseSkinMs);draws=corpseDraws=skinCalls=corpseSkinCalls=skinMs=corpseSkinMs=0;refreshCorpses()}
  v.addEventListener('postFrame',post)
  window.__sustain={start,frames,calls,corpseCalls,skins,corpseSkins,skinTimes,corpseSkinTimes,route,summary:()=>({spawns,forcedDeaths,cycle}),stop(){v.removeEventListener('postFrame',post);r.renderBufferDirect=originalDraw;proto.update=originalSkin;m.director.step=originalStep;m.ui.sample=originalSample;frames.length=calls.length=corpseCalls.length=skins.length=corpseSkins.length=skinTimes.length=corpseSkinTimes.length=0}}
  return {types,base,description:'240 wall-clock seconds; normal GameManager accumulator, World.step, AI, route collision/movement, M4 fire/reload. Sandbox invulnerability and wave scheduling pause only. Replenish one live unit per six types; force one rotating death every 8 real seconds in addition to weapon kills. Corpse lifetime and quality unchanged.',sampleArrays:'Drained every ten seconds; no retained per-frame history',routePoints:route.path.length}
 })
 for(let elapsed=10;elapsed<=seconds;elapsed+=10){
  await page.waitForTimeout(10000)
  const sample=await page.evaluate(()=>{
   const m=window.terminator.manager,w=m.world,u=m.unitView,r=m.ctx.viewer.renderManager.webglRenderer,s=window.__sustain
   const q=values=>{const a=values.splice(0).sort((a,b)=>a-b);return {n:a.length,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null}}
   return {elapsedSeconds:(performance.now()-s.start)/1000,simulationSeconds:w.tick/60,activeEnemies:w.aliveUnits.length,units:w.units.length,eventLog:w.eventLog.length,replay:w.replay.length,projectiles:w.projectiles.length,framesMs:q(s.frames),drawCalls:q(s.calls),corpseDrawCalls:q(s.corpseCalls),skinUpdates:q(s.skins),corpseSkinUpdates:q(s.corpseSkins),skinCpuMs:q(s.skinTimes),corpseSkinCpuMs:q(s.corpseSkinTimes),memory:{...r.info.memory},programs:r.info.programs.length,heapBytes:performance.memory?.usedJSHeapSize,visuals:u.visuals.size,pools:Object.fromEntries(Object.entries(u.visualPool).map(([k,p])=>[k,p.length])),ragdolls:{records:u.ragdolls.records.size,active:u.ragdolls.active.length,settled:[...u.ragdolls.records].filter(x=>x.settledAt!==null).length,unitCorpses:[...u.ragdolls.records].filter(x=>x.kind==='unit').length,freeUnit:u.ragdolls.freeUnitRecords.length,freeLimb:u.ragdolls.freeLimbRecords.length,clock:u.ragdolls.clock,stats:{...u.ragdolls.stats}},rosterDeaths:u.rosterFx.deaths.size,route:s.route.summary(),workload:s.summary(),kills:w.telemetry.counters.kills}
  })
  report.samples.push(sample);await save();console.log(JSON.stringify(sample))
  if(elapsed%30===0)await progress(`Sustained ${sample.elapsedSeconds.toFixed(0)}s: live=${sample.activeEnemies}, units=${sample.units}, corpses=${sample.ragdolls.unitCorpses}, settled=${sample.ragdolls.settled}, frame p50/p95/p99=${sample.framesMs.p50?.toFixed(1)}/${sample.framesMs.p95?.toFixed(1)}/${sample.framesMs.p99?.toFixed(1)}ms, geometries=${sample.memory.geometries}, programs=${sample.programs}.`)
  if(report.aborted)throw Error(report.aborted)
 }
 report.stop=await page.evaluate(async()=>{window.__sustain.stop();delete window.__sustain;const m=window.terminator.manager,v=m.ctx.viewer;const prior={world:m.world,unit:m.unitView};m.stop();await new Promise(requestAnimationFrame);return {renderEnabled:v.renderEnabled,runtimeRoots:v.scene.children.filter(o=>/Runtime|Endo menu stage/.test(o.name)).map(o=>o.name),memory:{...v.renderManager.webglRenderer.info.memory},programs:v.renderManager.webglRenderer.info.programs.length,managerWorld:m.world,started:m.started,ragdollRecords:prior.unit.ragdolls?.records?.size??null}})
 if(report.stop.runtimeRoots.length||report.stop.started||report.stop.managerWorld)throw Error('Stop left runtime resources')
 await progress('Sustained run complete; Stop removed runtime roots. Testing same-page restart and actual START again.')
 await page.evaluate(()=>window.terminator.manager.start())
 await page.waitForFunction(()=>window.terminator.manager.ui?.screens?.route==='main')
 report.restart=await domStart()
 report.restartStop=await page.evaluate(()=>{const m=window.terminator.manager,v=m.ctx.viewer;m.stop();return {runtimeRoots:v.scene.children.filter(o=>/Runtime|Endo menu stage/.test(o.name)).map(o=>o.name),memory:{...v.renderManager.webglRenderer.info.memory},programs:v.renderManager.webglRenderer.info.programs.length}})
 if(report.restartStop.runtimeRoots.length)throw Error('Restart Stop left runtime roots')
 await progress(`Restart DOM START next frame ${report.restart.nextFrameMs.toFixed(1)}ms; second Stop clean. Closing runtime page before editor check.`)
 await page.close()
 const editor=await context.newPage();await editor.goto(dev.url,{waitUntil:'domcontentloaded'})
 await editor.waitForFunction(async()=>{const state=await fetch('/api/state').then(r=>r.json());return state.projectLoaded&&!state.lastLoadError},null,{timeout:120000})
 await progress('Stopped editor loaded in same owned browser; running all three Kite3D check outcomes.')
 child=spawn('npx',['kite3d','check'],{stdio:['ignore','pipe','pipe']});let checkLog=''
 child.stdout.on('data',s=>{checkLog+=s;process.stdout.write(s)});child.stderr.on('data',s=>{checkLog+=s;process.stderr.write(s)})
 report.checkExit=await new Promise(resolve=>child.once('exit',resolve));child=null
 await writeFile('docs/evidence/sustained-check.log',checkLog)
 report.check=JSON.parse(await readFile('.kite3d/check.json','utf8'))
 if(report.checkExit!==0)throw Error('Kite3D check failed')
 await progress('Integrated Kite3D check completed successfully. Browser evidence recorded; closing owned browser.')
}catch(error){report.error=error.stack;console.error(error.stack);process.exitCode=1}
finally{clearInterval(monitor);clearTimeout(deadline);child?.kill('SIGTERM');await browser?.close();report.finishedAt=new Date().toISOString();await save()}
