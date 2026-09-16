// Sequential old/fixed probe, one browser at a time. No production renderer hooks.
// FADE_STAGE=old|fixed runs one stage; FADE_OUTPUT selects its report.
// Default both-stage mode waits for .kite3d/fade-fixed-ready after old Stop.
// DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-fade-retention.mjs
import {readFile,writeFile,appendFile,mkdir,access} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser} from './capture-browser.mjs'
if(process.env.DISPLAY!==':1')throw Error('Probe requires DISPLAY=:1')
let prior;try{prior=execFileSync('systemctl',['--user','is-active','terminator-v2-performance-final'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch(e){prior=e.stdout?.trim()}
if(prior!=='inactive')throw Error('Previous service must be inactive')
const cg='/sys/fs/cgroup'+(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::')).slice(3)
const output=process.env.FADE_OUTPUT||'docs/evidence/fade-program-retention.json',findings='../coordination/fade-program-retention.findings.md'
const report={startedAt:new Date().toISOString(),base:execFileSync('git',['rev-parse','HEAD']).toString().trim(),description:'Only corpse settled age is accelerated. Normal GameManager update and rendering, real combat damage/death and pool reuse. Two separated fade rounds per stage.',stages:[],errors:[],peakCgroupBytes:0}
let browser,monitor,reclaiming=false
await mkdir('docs/evidence',{recursive:true})
const save=()=>writeFile(output,JSON.stringify(report,null,2)+'\n')
const progress=async message=>{console.log(message);await appendFile(findings,`\n${new Date().toISOString()} ${message}\n`);await save()}
try{
 const reclaim=async()=>{const stats=await readFile(cg+'/memory.stat','utf8'),inactive=Number(stats.match(/^inactive_file (\d+)/m)?.[1]||0);if(inactive>128*1024**2){await writeFile(cg+'/memory.reclaim',String(Math.min(inactive,1024**3)));report.fileReclaims=(report.fileReclaims||0)+1}}
 await reclaim().catch(()=>{})
 report.limits={memoryMax:await readFile(cg+'/memory.max','utf8'),memoryHigh:await readFile(cg+'/memory.high','utf8'),tasks:await readFile(cg+'/pids.max','utf8'),abort:3.5*1024**3}
 monitor=setInterval(async()=>{try{const n=Number(await readFile(cg+'/memory.current','utf8'));report.peakCgroupBytes=Math.max(n,report.peakCgroupBytes);if(n>3.5*1024**3){report.aborted='memory >3.5GiB';await browser?.close()}else if(n>3*1024**3&&!reclaiming){reclaiming=true;try{await reclaim()}finally{reclaiming=false}}}catch{}},200)
 browser=await launchCaptureBrowser()
 const context=await browser.newContext({viewport:{width:480,height:270},deviceScaleFactor:1})
 await context.addInitScript(()=>{
  localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',fov:72,controlsSeen:true}))
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-testid="start-match"]')){
   const s=window.__startProbe={clickedAt:performance.now()};const poll=()=>{const m=window.terminator?.manager;if(m?.input?.active&&!m.ui.screens.route&&m.director.phase==='wave')s.inputReadyMs=performance.now()-s.clickedAt;else requestAnimationFrame(poll)};requestAnimationFrame(poll)
  }},true)
 })
 const page=await context.newPage();page.setDefaultTimeout(60000)
 page.on('pageerror',e=>report.errors.push(e.message.replace(/([?&]t=)[^&\s"')]+/g,'$1[REDACTED]')))
 const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'));await page.request.get(dev.url)
 for(const label of (process.env.FADE_STAGE?[process.env.FADE_STAGE]:['old','fixed'])){
  await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main')
  await page.evaluate(()=>{
   const m=window.terminator.manager,u=m.unitView,v=m.ctx.viewer,r=v.renderManager.webglRenderer
   const inventory=()=>r.info.programs.map(p=>({id:p.id,name:p.name,cacheKey:p.cacheKey}))
   const program=p=>p&&({id:p.id,name:p.name,cacheKey:p.cacheKey})
   const events=[],watched=new Set(),stacks=new Set()
   const watch=mat=>{if(!mat||watched.has(mat))return;watched.add(mat);mat.addEventListener('dispose',()=>{
    const stack=new Error().stack.split('\n').slice(1,10).join('\n');const detail=!stacks.has(stack);stacks.add(stack)
    events.push({at:performance.now(),name:mat.name,uuid:mat.uuid,event:'dispose',programs:[...(r.properties.get(mat).programs?.values()||[])].map(program),...(detail?{stack}:{} )})
   })}
   const warmup=u.primeWarmup
   u.primeWarmup=function(){const release=warmup.call(this);for(const rec of this.ragdolls.records){watch(rec.fadeOriginal);watch(rec.fadeMaterial)}
    return()=>{window.__fade.warmupBeforeReset=inventory();window.__fade.warmupMaterials=[...this.ragdolls.records].filter(x=>x.fadeMaterial).map(x=>({name:x.fadeMaterial.name,uuid:x.fadeMaterial.uuid,programs:[...(r.properties.get(x.fadeMaterial).programs?.values()||[])].map(program)}));release();window.__fade.warmupAfterReset=inventory()}
   }
   const draw=r.renderBufferDirect,draws=[],programEvents=[];let prior=null
   const post=()=>{if(!window.__fade.warmupAfterReset)return;const next=inventory();if(prior){const ids=new Set(prior.map(p=>p.id)),nextIds=new Set(next.map(p=>p.id)),added=next.filter(p=>!ids.has(p.id)),removed=prior.filter(p=>!nextIds.has(p.id));if(added.length||removed.length)programEvents.push({round:window.__fade.round,added,removed})}prior=next}
   v.addEventListener('postFrame',post)
   r.renderBufferDirect=function(camera,scene,geometry,material,object,group){const result=draw.call(this,camera,scene,geometry,material,object,group);if(window.__fade.capture&&material.transparent&&/Gore piece fade|Pooled fading wreck metal|Pooled HK debris/.test(material.name)){
    const p=r.properties.get(material).currentProgram;if(p&&!draws.some(d=>d.round===window.__fade.round&&d.uuid===material.uuid&&d.program.id===p.id))draws.push({round:window.__fade.round,object:object.name,name:material.name,uuid:material.uuid,opacity:material.opacity,program:program(p)})
   }return result}
   window.__fade={inventory,program,events,watch,draws,programEvents,capture:false,round:0,cleanup(){v.removeEventListener('postFrame',post);r.renderBufferDirect=draw;u.primeWarmup=warmup}}
  })
  await page.getByTestId('menu-play').click();await page.getByTestId('start-match').click()
  await page.waitForFunction(()=>window.__startProbe?.inputReadyMs&&window.terminator.manager.visualWarmupReport)
  const stage=await page.evaluate(()=>{const m=window.terminator.manager,r=m.ctx.viewer.renderManager.webglRenderer,gl=r.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {start:window.__startProbe,renderer:gl.getParameter(e.UNMASKED_RENDERER_WEBGL),warmup:m.visualWarmupReport,beforeReset:window.__fade.warmupBeforeReset,afterReset:window.__fade.warmupAfterReset,warmupMaterials:window.__fade.warmupMaterials,startInventory:window.__fade.inventory(),rounds:[]}})
  stage.label=label;report.stages.push(stage);await progress(`${label}: DOM START ${stage.start.inputReadyMs.toFixed(1)}ms; warmup pre/post reset ${stage.beforeReset.length}/${stage.afterReset.length} programs.`)
  for(let round=1;round<=2;round++){
   await page.evaluate(round=>{
    const m=window.terminator.manager,w=m.world,u=m.unitView,s=window.__fade
    m.director.setSandbox(true);m.director.pauseWaves();w.setSandbox({invulnerable:true});w.clearUnits();m.syncViews()
    if(round>1){u.rosterFx.reset();u.fx.reset();u.ragdolls.reset()}
    s.round=round;s.capture=true;s.roundBefore=s.inventory();s.eventStart=s.events.length
    const base=w.player.pos;s.victims=['endo','heavy','hkaerial','hktank'].map((type,i)=>w.spawnUnit(type,{x:base.x+(i-1.5)*1.6,y:type==='hkaerial'?3:0,z:base.z+7}))
    m.syncViews()
    for(const visual of u.visuals.values()){s.watch(visual.rig.wreckMaterial);for(const p of visual.rig.roster?.pieces||[]){s.watch(p.mesh.userData.wreckMaterial);s.watch(p.mesh.material)}}
    for(const p of u.fx.gore.pieces.items)s.watch(p.fade)
   },round)
   await page.waitForTimeout(300)
   await page.evaluate(()=>{const w=window.terminator.manager.world;for(const unit of window.__fade.victims)w.damageUnit(unit.id,100000,{source:'player',weapon:'m4',headshot:unit.type==='endo',direction:{x:0,y:0,z:1},point:{...unit.pos,y:unit.pos.y+1.4}})})
   await page.waitForFunction(()=>{const u=window.terminator.manager.unitView,recs=[...u.ragdolls.records];return recs.some(x=>x.visual)&&recs.some(x=>x.object.name.startsWith('Detached hk'))&&u.fx.gore.pieces.items.some(x=>x.record)&&recs.every(x=>x.settledAt!==null)},null,{timeout:25000})
   const crossing=await page.evaluate(async()=>{
    const m=window.terminator.manager,u=m.unitView,v=m.ctx.viewer,s=window.__fade,recs=[...u.ragdolls.records]
    s.beforeCross=s.inventory();s.fades=[]
    // Capture before touching age, then cross through the next normal update.
    await new Promise(resolve=>{const post=()=>{v.removeEventListener('postFrame',post);resolve()};v.addEventListener('postFrame',post);v.setDirty(m)})
    for(const rec of recs)rec.settledAt=u.ragdolls.clock-180
    await new Promise(resolve=>{const post=()=>{if(!recs.some(rec=>rec.fadeMaterial))return;v.removeEventListener('postFrame',post);resolve()};v.addEventListener('postFrame',post)})
    return recs.map(rec=>({name:rec.object.name,kind:rec.kind,age:u.ragdolls.clock-rec.settledAt,material:rec.fadeMaterial?.name,prepared:rec.fadeMaterial===(rec.visual?.rig.wreckMaterial||rec.object.userData.wreckMaterial)}))
   })
   await page.waitForTimeout(2600)
   const result=await page.evaluate(()=>{const s=window.__fade,u=window.terminator.manager.unitView;return {before:s.roundBefore,beforeCross:s.beforeCross,after:s.inventory(),draws:s.draws.filter(x=>x.round===s.round),disposals:s.events.slice(s.eventStart),remainingRecords:u.ragdolls.records.size}})
   result.crossing=crossing;result.round=round;stage.rounds.push(result);await progress(`${label} round${round}: ${result.draws.length} actual fade material/program draws, ${result.disposals.length} disposal events, ${result.remainingRecords} records after expiry.`)
  }
  stage.disposals=await page.evaluate(()=>window.__fade.events)
  stage.programEvents=await page.evaluate(()=>window.__fade.programEvents)
  stage.stop=await page.evaluate(async()=>{const m=window.terminator.manager,v=m.ctx.viewer,u=m.unitView,s=window.__fade;s.capture=false;s.cleanup();m.stop();await new Promise(requestAnimationFrame);return {runtimeRoots:v.scene.children.filter(o=>/Runtime|Endo menu stage/.test(o.name)).map(o=>o.name),programs:s.inventory(),world:m.world,owner:u.owner,dormantRoot:u.dormantRoot,ragdolls:u.ragdolls}})
  await save()
  if(label==='old'&&!process.env.FADE_STAGE){
   await progress('Old-code probe complete and stopped. Awaiting local fixed-stage gate; same owned browser remains idle.')
   await writeFile('.kite3d/fade-old-complete','ready')
   for(let i=0;;i++){try{await access('.kite3d/fade-fixed-ready');break}catch{}if(i>600)throw Error('Fixed gate timeout');await new Promise(r=>setTimeout(r,1000))}
  }
 }
}catch(error){report.error=String(error).replace(/([?&]t=)[^&\s"')]+/g,'$1[REDACTED]');console.error(report.error);process.exitCode=1}
finally{await browser?.close();clearInterval(monitor);report.finishedAt=new Date().toISOString();report.memoryEvents=await readFile(cg+'/memory.events','utf8');report.swapBytes=await readFile(cg+'/memory.swap.current','utf8');await save()}
