// Run from project root: DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-performance-final.mjs
// Natural soak + fixed-scene cache microprobe + Stop only; official check runs separately.
// Requires the project's kite3d dev server. One disposable Playwright profile.
import {readFile, writeFile, appendFile, mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser} from './capture-browser.mjs'
const output=process.env.SUSTAIN_OUTPUT||'docs/evidence/performance-final-soak.json'
const findings=process.env.SUSTAIN_FINDINGS||'../coordination/performance-final.findings.md'
const seconds=Number(process.env.SUSTAIN_SECONDS||240)
if(!Number.isFinite(seconds)||seconds<180||seconds>300)throw Error('SUSTAIN_SECONDS must be 180–300')
const cg='/sys/fs/cgroup'+(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::')).slice(3)
const report={sourceCommit:execFileSync('git',['rev-parse','23ccd98']).toString().trim(),testedHead:execFileSync('git',['rev-parse','HEAD']).toString().trim(),startedAt:new Date().toISOString(),durationSeconds:seconds,viewport:[480,270],samples:[],errors:[],consoleErrors:[],resourceFailures:[]}
let browser,monitor,deadline
const scrub=s=>String(s).replace(/([?&]t=)[^&\s"')]+/g,'$1[REDACTED]')
await mkdir('docs/evidence',{recursive:true})
const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n')
async function progress(message){console.log(message);await appendFile(findings,`\n${new Date().toISOString()} ${message}\n`);await save()}
try{
 await writeFile(cg+'/memory.reclaim',String(1024**3)).catch(()=>{})
 report.memoryEventsBefore=await readFile(cg+'/memory.events','utf8')
 report.cgroup={memoryHigh:Number(await readFile(cg+'/memory.high','utf8')),memoryMax:Number(await readFile(cg+'/memory.max','utf8')),tasksMax:Number(await readFile(cg+'/pids.max','utf8')),abortAboveBytes:3.5*1024**3}
 // Monitor starts before launch, covers browser startup as well as scene load.
 monitor=setInterval(async()=>{try{const bytes=Number(await readFile(cg+'/memory.current','utf8'));report.peakCgroupBytes=Math.max(report.peakCgroupBytes||0,bytes);if(bytes>report.cgroup.abortAboveBytes&&!report.aborted){report.aborted='cgroup above 3.5 GiB';console.error(report.aborted);await browser?.close()}}catch{}},500)
 deadline=setTimeout(()=>{report.aborted='12 minute overall deadline';browser?.close()},720000)
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
 page.on('pageerror',e=>{if(report.errors.length<30)report.errors.push(scrub(e.message))})
 page.on('console',e=>{if(e.type()==='error'&&report.consoleErrors.length<30)report.consoleErrors.push(scrub(e.text()))})
 page.on('requestfailed',r=>{if(report.resourceFailures.length<30){const url=new URL(r.url());report.resourceFailures.push({path:url.pathname,error:r.failure()?.errorText})}})
 const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
 await page.request.get(dev.url)
 await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main')
 await progress('Owned 480x270 Vulkan browser loaded main menu; starting through actual DOM buttons.')
 async function domStart(){
  await page.getByTestId('menu-play').click()
  await page.getByTestId('start-match').click()
  await page.waitForFunction(()=>window.__startProbe?.nextFrameMs&&window.terminator.manager.visualWarmupReport)
  await page.keyboard.down('w')
  await page.waitForFunction(()=>window.terminator.manager.world.lastInputsBundle?.player?.move?.z===1)
  const result=await page.evaluate(()=>{const m=window.terminator.manager,r=m.ctx.viewer.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {...window.__startProbe,keyAcceptedMs:performance.now()-window.__startProbe.clickedAt,lastInputs:m.world.lastInputsBundle.player,renderer:gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),warmup:m.visualWarmupReport,startup:m.startup,memory:{...r.info.memory},programs:r.info.programs.length,programInventory:r.info.programs.map(p=>({id:p.id,name:p.name,cacheKey:p.cacheKey}))}})
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
  const inventory=()=>r.info.programs.map(p=>({id:p.id,name:p.name,cacheKey:p.cacheKey}))
  let priorPrograms=inventory();const programDeltas=[],fades=[],seenFades=new WeakSet(),versions=new Map()
  const poseSnapshot=()=>{let skinUpdates=0,skinSkips=0;const textures=[];for(const record of u.ragdolls.records){if(record.poseCache){skinUpdates+=record.poseCache.stats.skinUpdates;skinSkips+=record.poseCache.stats.skinSkips;record.object.traverse(o=>{if(o.skeleton?.boneTexture){const t=o.skeleton.boneTexture,last=versions.get(t.id);textures.push({id:t.id,version:t.version,delta:last===undefined?null:t.version-last});versions.set(t.id,t.version)}})}}return {skinUpdates,skinSkips,textures}}
  const post=()=>{
   if(r.info.programs.length!==priorPrograms.length){const next=inventory(),ids=new Set(priorPrograms.map(p=>p.id)),nextIds=new Set(next.map(p=>p.id));programDeltas.push({elapsedSeconds:(now()-start)/1000,before:priorPrograms.length,after:next.length,added:next.filter(p=>!ids.has(p.id)),removed:priorPrograms.filter(p=>!nextIds.has(p.id))});priorPrograms=next}
   for(const record of u.ragdolls.records)if(record.fadeMaterial&&!seenFades.has(record)){const mesh=record.visual?.rig.mesh||record.object,p=r.properties.get(mesh.material).currentProgram;if(p){seenFades.add(record);fades.push({elapsedSeconds:(now()-start)/1000,clock:u.ragdolls.clock,settledAt:record.settledAt,age:u.ragdolls.clock-record.settledAt,kind:record.kind,name:mesh.name,material:mesh.material.name,opacity:mesh.material.opacity,prepared:mesh.material===(record.visual?.rig.wreckMaterial||mesh.userData.wreckMaterial),program:{id:p.id,name:p.name,cacheKey:p.cacheKey}})}}
const time=now();frames.push(time-previous);previous=time;calls.push(draws);corpseCalls.push(corpseDraws);skins.push(skinCalls);corpseSkins.push(corpseSkinCalls);skinTimes.push(skinMs);corpseSkinTimes.push(corpseSkinMs);draws=corpseDraws=skinCalls=corpseSkinCalls=skinMs=corpseSkinMs=0;refreshCorpses()}
  v.addEventListener('postFrame',post)
  window.__sustain={programDeltas,fades,poseSnapshot,originalSkin,proto,start,frames,calls,corpseCalls,skins,corpseSkins,skinTimes,corpseSkinTimes,route,summary:()=>({spawns,forcedDeaths,cycle}),stop(){v.removeEventListener('postFrame',post);r.renderBufferDirect=originalDraw;proto.update=originalSkin;m.director.step=originalStep;m.ui.sample=originalSample;frames.length=calls.length=corpseCalls.length=skins.length=corpseSkins.length=skinTimes.length=corpseSkinTimes.length=0}}
  return {types,base,description:'240 wall-clock seconds; normal GameManager accumulator, World.step, AI, route collision/movement, M4 fire/reload. Sandbox invulnerability and wave scheduling pause only. Replenish one live unit per six types; force one rotating death every 8 real seconds in addition to weapon kills. Corpse lifetime and quality unchanged.',sampleArrays:'Drained every ten seconds; no retained per-frame history',routePoints:route.path.length}
 })
 for(let elapsed=10;elapsed<=seconds;elapsed+=10){
  await page.waitForTimeout(10000)
  const sample=await page.evaluate(()=>{
   const m=window.terminator.manager,w=m.world,u=m.unitView,r=m.ctx.viewer.renderManager.webglRenderer,s=window.__sustain
   const q=values=>{const a=values.splice(0).sort((a,b)=>a-b);return {n:a.length,p50:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null}}
   return {poseCache:s.poseSnapshot(),programDeltas:s.programDeltas.splice(0),naturalFades:s.fades.splice(0),elapsedSeconds:(performance.now()-s.start)/1000,simulationSeconds:w.tick/60,activeEnemies:w.aliveUnits.length,units:w.units.length,eventLog:w.eventLog.length,replay:w.replay.length,projectiles:w.projectiles.length,framesMs:q(s.frames),drawCalls:q(s.calls),corpseDrawCalls:q(s.corpseCalls),skinUpdates:q(s.skins),corpseSkinUpdates:q(s.corpseSkins),skinCpuMs:q(s.skinTimes),corpseSkinCpuMs:q(s.corpseSkinTimes),memory:{...r.info.memory},programs:r.info.programs.length,heapBytes:performance.memory?.usedJSHeapSize,visuals:u.visuals.size,pools:Object.fromEntries(Object.entries(u.visualPool).map(([k,p])=>[k,p.length])),ragdolls:{records:u.ragdolls.records.size,active:u.ragdolls.active.length,settled:[...u.ragdolls.records].filter(x=>x.settledAt!==null).length,unitCorpses:[...u.ragdolls.records].filter(x=>x.kind==='unit').length,freeUnit:u.ragdolls.freeUnitRecords.length,freeLimb:u.ragdolls.freeLimbRecords.length,clock:u.ragdolls.clock,stats:{...u.ragdolls.stats}},rosterDeaths:u.rosterFx.deaths.size,route:s.route.summary(),workload:s.summary(),kills:w.telemetry.counters.kills}
  })
  sample.cgroupBytes=Number(await readFile(cg+'/memory.current','utf8'));report.samples.push(sample);await save();console.log(JSON.stringify(sample))
  if(elapsed%30===0)await progress(`Sustained ${sample.elapsedSeconds.toFixed(0)}s: live=${sample.activeEnemies}, units=${sample.units}, corpses=${sample.ragdolls.unitCorpses}, settled=${sample.ragdolls.settled}, frame p50/p95/p99=${sample.framesMs.p50?.toFixed(1)}/${sample.framesMs.p95?.toFixed(1)}/${sample.framesMs.p99?.toFixed(1)}ms, geometries=${sample.memory.geometries}, programs=${sample.programs}.`)
  if(report.aborted)throw Error(report.aborted)
 }
 report.soakCompleted=true
 await progress('Natural soak saved successfully. Beginning separate fixed-scene cache on/off/on microprobe; simulation paused, rendering retained.')
 report.cacheProbe=await page.evaluate(async()=>{
  const m=window.terminator.manager,v=m.ctx.viewer,r=v.renderManager.webglRenderer,u=m.unitView,s=window.__sustain
  const update=m.update;m.update=()=>{v.setDirty(m);return true}
  const skeletons=new Set();for(const rec of u.ragdolls.records)if(rec.poseCache)rec.object.traverse(o=>{if(o.skeleton)skeletons.add(o.skeleton)})
  const saved=[...skeletons].map(sk=>({sk,update:sk.update,version:sk.boneTexture?.version,matrices:Array.from(sk.boneMatrices)}))
  const camera=v.scene.mainCamera,initialCamera=camera.matrixWorld.elements.slice(),tick=m.world.tick
  const hash=()=>saved.map(({sk})=>({matrices:Array.from(sk.boneMatrices),world:sk.bones.map(b=>b.matrixWorld.elements.slice()),inverse:sk.boneInverses.map(b=>b.elements.slice())}))
  const baseline=JSON.stringify(hash()),phases=[]
  const rm=v.renderManager,render=rm.render;let cpu=[],native=0
  const instrumented=s.proto.update
  s.proto.update=function(...args){native++;return instrumented.apply(this,args)}
  // Cache closures retain the earlier prototype instrumenter: native counts use existing s.skins.
  rm.render=function(...args){const t=performance.now();try{return render.apply(this,args)}finally{cpu.push(performance.now()-t)}}
  const q=a=>{a.sort((a,b)=>a-b);return {n:a.length,mean:a.reduce((x,y)=>x+y,0)/a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]}}
  try{for(const mode of ['on','off','on']){
   for(const x of saved)x.sk.update=mode==='on'?x.update:instrumented
   await new Promise(resolve=>setTimeout(resolve,300));cpu=[];s.skins.length=s.corpseSkins.length=s.frames.length=0
   const before=s.poseSnapshot(),versions=saved.map(x=>x.sk.boneTexture?.version)
   await new Promise(resolve=>setTimeout(resolve,2500))
   const after=s.poseSnapshot()
   phases.push({mode,renderCpuMs:q(cpu),frameMs:q(s.frames.splice(0)),nativeSkinCalls:s.skins.splice(0).reduce((a,b)=>a+b,0),nativeCorpseSkinCalls:s.corpseSkins.splice(0).reduce((a,b)=>a+b,0),skinUpdates:after.skinUpdates-before.skinUpdates,skinSkips:after.skinSkips-before.skinSkips,textureVersionDeltas:saved.map((x,i)=>(x.sk.boneTexture?.version??0)-(versions[i]??0)),exactPoseEqual:JSON.stringify(hash())===baseline,tick:m.world.tick,cameraEqual:camera.matrixWorld.elements.every((x,i)=>x===initialCamera[i])})
  }}finally{for(const x of saved)x.sk.update=x.update;rm.render=render;s.proto.update=instrumented;m.update=update}
  return {description:'Fixed camera/population, normal rendering with GameManager.update paused; 300ms settling + 2500ms measured per on/off/on phase. RenderManager.render synchronous CPU wall time includes driver submission; not GPU elapsed time or uncapped FPS.',skeletons:saved.length,corpses:u.ragdolls.records.size,tick,phases}
 })
 await save()
 report.stop=await page.evaluate(async()=>{window.__sustain.stop();delete window.__sustain;const m=window.terminator.manager,v=m.ctx.viewer;const prior={world:m.world,unit:m.unitView};m.stop();await new Promise(requestAnimationFrame);return {renderEnabled:v.renderEnabled,runtimeRoots:v.scene.children.filter(o=>/Runtime|Endo menu stage/.test(o.name)).map(o=>o.name),memory:{...v.renderManager.webglRenderer.info.memory},programs:v.renderManager.webglRenderer.info.programs.length,managerWorld:m.world,started:m.started,ragdollRecords:prior.unit.ragdolls?.records?.size??null}})
 if(report.stop.runtimeRoots.length||report.stop.started||report.stop.managerWorld)throw Error('Stop left runtime resources')
 await progress('Natural soak, separate cache probe, and Stop complete. Closing sole runtime browser. Restart omitted; official headless check is a separate command.')
}catch(error){report.error=scrub(error.stack);console.error(report.error);process.exitCode=1}
finally{clearInterval(monitor);clearTimeout(deadline);await browser?.close();report.memoryEventsAfter=await readFile(cg+'/memory.events','utf8');report.finishedAt=new Date().toISOString();await save()}
