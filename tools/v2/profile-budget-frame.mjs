/** Same-device frame benchmark. Keeps all scene content and high quality intact.
 * Run from any clean comparison checkout; this script and guarded launcher stay
 * in the frame worktree. Output is immutable. PROFILE=1 adds a separate CDP pass.
 */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
const pkg=JSON.parse(await readFile('package.json','utf8'))
const installed=JSON.parse(await readFile('node_modules/@kite3d/engine/package.json','utf8'))
if(pkg.devDependencies.kite3d!=='0.19.0-alpha.2'||installed.version!=='0.19.0-alpha.2')throw Error('Requires exact 0.19.0-alpha.2 baseline and installed engine')
if(process.env.FRAME_GPU_GRANTED!=='1')throw Error('Requires FRAME_GPU_GRANTED=1 after coordination release/process verification')
if(process.env.FRAME_BEFORE)throw Error('Source routing is forbidden; serve the actual comparison commit')
const scheduler=process.env.FRAME_SCHEDULER||'native'
if(!['native','message'].includes(scheduler))throw Error('Invalid FRAME_SCHEDULER')
const pacing=process.env.FRAME_PACING||'uncapped'
if(!['uncapped','default'].includes(pacing))throw Error('FRAME_PACING must be uncapped or default')
const baseOptions=browserOptions()
if(pacing==='uncapped')process.env.CHROME_ARGS=JSON.stringify([...baseOptions.args,'--disable-frame-rate-limit','--disable-gpu-vsync'])
if(!process.argv[2])throw Error('Pass a fresh output directory')
const out=resolve(process.argv[2]);await access(out).then(()=>{throw Error('Output exists')},e=>{if(e.code!=='ENOENT')throw e});await mkdir(out,{recursive:true})
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const ownPort=process.env.FRAME_DEV_PORT||'4754'
if(!(process.platform==='darwin'?['4753','4756']:['4754']).includes(ownPort)||new URL(new URL(dev.url).origin).hostname!=='127.0.0.1'||new URL(new URL(dev.url).origin).port!==ownPort)throw Error('Frame server must match explicit owned port')
const config=JSON.parse(await readFile(new URL('../../docs/scene-targets/views.json',import.meta.url),'utf8'))
if(process.env.FRAME_VIEWPORT){const [width,height]=JSON.parse(process.env.FRAME_VIEWPORT);if(!Number.isInteger(width)||!Number.isInteger(height)||width<640||height<480)throw Error('Invalid viewport');config.viewport={width,height}}
const dpr=Number(process.env.FRAME_DPR||1)
const movingRoute=process.env.FRAME_ROUTE==='1'
if(!Number.isFinite(dpr)||dpr<1||dpr>3)throw Error('Invalid FRAME_DPR')
const report={workload:movingRoute?'moving combat route':'historical crowd stress',gpuQueriesRequested:process.env.GPU_QUERIES==='1',scheduler,diagnosticOverrides:scheduler==='message'?{scheduler:'MessageChannel drives unchanged RenderManager.animationLoop with performance.now wall deltas; not native presentation FPS acceptance'}:null,runtime:installed.version,pacing,dpr,platform:process.platform,git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}),config,sourceFiles:{},errors:[],views:[],method:'Pacing flags recorded in launch; 60s native combat. GPU_QUERIES diagnostic only; PROFILE runs after timings. 150 fixed-view frames at tick 120; 120 deterministic active warmup frames then 360 active frames, 1/60s gameplay update per render; cadence measured independently; seventh view resumes native deltaTime/catch-up for 60 wall-clock seconds from the same tick-600 state; CPU frame starts before component preFrame; GPU spans all viewer render passes'}
for(const file of execFileSync('git',['ls-files','lib','scripts','main.js','package.json','assets/main.scene.gltf'],{encoding:'utf8'}).trim().split('\n'))report.sourceFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex')
for(const file of ['tools/v2/combat-route.mjs','tools/v2/capture-browser.mjs'])report.sourceFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex')
report.profilerHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')
const browser=await launchCaptureBrowser();report.browser=browser.version();report.launch=browserOptions();report.cgroup=browser.captureCgroup
report.gpuClockSamples=[]
const sampleClock=()=>{if(process.platform!=='linux')return;try{report.gpuClockSamples.push({at:new Date().toISOString(),csv:execFileSync('nvidia-smi',['--query-gpu=pstate,clocks.gr,clocks.mem,utilization.gpu,power.draw,temperature.gpu','--format=csv,noheader'],{encoding:'utf8',timeout:2000}).trim()})}catch(error){report.gpuClockError=error.message}}
sampleClock();const clockTimer=setInterval(sampleClock,5000)
const timeout=setTimeout(()=>browser.close(),360000)
try {
 const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:dpr});page.setDefaultTimeout(120000)
 report.emptyPageRaf=await page.evaluate(async()=>{const samples=[];let last=performance.now();for(let i=0;i<30;i++){await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-last);last=now}return samples})

 const redact=s=>s.replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
 page.on('console',e=>{if(e.type()==='error')report.errors.push(redact(e.text()))})
 report.assetErrors=[]
 page.on('response',r=>{if(r.status()>=400)report.assetErrors.push({url:redact(r.url()),status:r.status()})})
 page.on('requestfailed',r=>report.assetErrors.push({url:redact(r.url()),failure:r.failure()?.errorText}))
 page.on('pageerror',e=>{report.errors.push(e.message);console.log('pageerror',e.message.slice(0,250))})
 await page.addInitScript(({seed,settings})=>{let s=seed>>>0;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url);console.log('authenticated')
 await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'});console.log('document loaded')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000});console.log('main ready')
 report.warmupResidency=await page.evaluate(async()=>{
  const m=window.terminator.manager,r=window.viewer.renderManager.webglRenderer,prime=m.unitView.primeWarmup,rows=[]
  const resources=()=>({...r.info.memory,programs:r.info.programs.length})
  m.unitView.primeWarmup=function(...args){const release=prime.apply(this,args);return()=>{const before=resources();release();rows.push({before,after:resources()})}}
  window.perfOriginalUpdate=m.update;m.update=()=>true
  try{await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup}finally{m.unitView.primeWarmup=prime}
  m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false);return rows
 })
 console.log('match ready')
 report.combatOnly=process.env.FRAME_COMBAT_ONLY==='1'
 for(const [index,view] of [...config.views,{...config.views[0],id:'06-active-wave'},{...config.views[0],id:'07-active-realtime'}].entries()) {
  if(report.combatOnly&&index<5)continue
  const active=index>=5,realtime=index===6
  await page.evaluate(async({view,active,realtime,tick,scheduler,movingRoute})=>{
   const m=window.terminator.manager,p=m.world.player
   if(realtime){
    if(movingRoute){const {createCombatRoute}=await import('/files/tools/v2/combat-route.mjs');window.perfRoute=createCombatRoute(m.world);m.ui.sample=()=>window.perfRoute.sample()}
    if(scheduler==='message'){
     const rm=window.viewer.renderManager,r=rm.webglRenderer,channel=new MessageChannel();let running=true;
     r.setAnimationLoop(null);rm._lastTime=performance.now();
     channel.port1.onmessage=()=>{if(!running)return;rm.animationLoop(performance.now());channel.port2.postMessage(0)};
     window.perfRestoreScheduler=()=>{running=false;channel.port1.close();channel.port2.close();rm._lastTime=performance.now();r.setAnimationLoop(rm.animationLoop)};
     channel.port2.postMessage(0);
    }
    window.perfSampling=false;m.accumulator=0;m.update=e=>{if(window.perfSampling)window.perfOriginalUpdate.call(m,e);return true};return}
   p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
   const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-p.pos.y-1.65,dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
   for(let t=0;t<=tick;t++){m.world.tick=t;m.mapView.sync(m.world);m.playerView.sync(m.world)}
   if(active){
    m.world.sandbox.invulnerable=true;m.world.scaling.maxAlive=24
    const types=['scout','endo','heavy','t1000','hkaerial','hktank']
    for(let i=0;i<24;i++){const a=i/24*Math.PI*2,type=types[i%types.length];m.world.spawnUnit(type,{x:Math.sin(a)*20,y:type==='hkaerial'?5:0,z:Math.cos(a)*20},{yaw:a+Math.PI})}
    m.ui.sample=()=>({move:{x:Math.sin(m.world.tick/80)*.3,z:0},yaw:p.yaw,pitch:p.pitch,fire:true})
    m.accumulator=0
   }
   window.perfActive=active;window.perfSampling=false
   if(active){m.update=()=>true;for(let i=0;i<120;i++){window.perfOriginalUpdate.call(m,{deltaTime:1000/60});await new Promise(resolve=>requestAnimationFrame(resolve))}}
   m.update=()=>{if(active){if(window.perfSampling)window.perfOriginalUpdate.call(m,{deltaTime:1000/60})}else {m.mapView.sync(m.world);m.playerView.sync(m.world);window.viewer.setDirty()}return true}
   await new Promise(resolve=>setTimeout(resolve,2000))
  },{view,active,realtime,tick:config.tick,scheduler,movingRoute})
  const result=await page.evaluate(async({active,realtime,processQuery})=>{
   const v=window.viewer,m=window.terminator.manager,r=v.renderManager.webglRenderer,gl=r.getContext(),ext=processQuery?gl.getExtension('EXT_disjoint_timer_query_webgl2'):null,debug=gl.getExtension('WEBGL_debug_renderer_info')
   const statsBefore={...m.mapView.post?.frameRendering?.stats};const timed=performance.now(), initialTick=m.world.tick, duration=realtime?60000:0; const N=realtime?100000:active?360:150,samples={cpuLoop:[],cpuFrame:[],cpuSubmission:[],simulation:[],cadence:[],gpu:[]},draws=[],actors=[],pending=[]
   let complete=false, frameStart=0,renderStart=0,last=0,q=null,count=0,disjoint=false,simTime=0,current={calls:0,triangles:0,points:0,lines:0,passes:0}
   const frame=()=>{frameStart=performance.now();simTime=0}
   let loopStart=0, loopMeasured=false, animationLoopCount=0
   const loopBefore=()=>{animationLoopCount++;loopStart=performance.now();loopMeasured=false}
   const loopAfter=()=>{if(loopMeasured)samples.cpuLoop.push(performance.now()-loopStart)}
   const manager=v.renderManager
   manager.addEventListener('animationLoop',loopBefore)
   const loops=manager._listeners.animationLoop;loops.splice(loops.indexOf(loopBefore),1);loops.unshift(loopBefore)
   manager.addEventListener('animationLoop',loopAfter)
   // Listener list prepend includes component preFrame and the ECP update.
   v.addEventListener('preFrame',frame);const list=v._listeners.preFrame;list.splice(list.indexOf(frame),1);list.unshift(frame)
   const render=r.render,step=m.world.step
   m.world.step=function(...args){const t=performance.now();try{return step.apply(this,args)}finally{simTime+=performance.now()-t}}
   r.render=function(...args){const result=render.apply(this,args);current.passes++;for(const key of ['calls','triangles','points','lines'])current[key]+=this.info.render[key];return result}
   const pre=()=>{renderStart=performance.now();current={calls:0,triangles:0,points:0,lines:0,passes:0};if(ext&&!complete){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q)}}
   const post=()=>{const now=performance.now();if(!complete){loopMeasured=true;samples.cpuFrame.push(now-frameStart);samples.cpuSubmission.push(now-renderStart);samples.simulation.push(simTime);if(last)samples.cadence.push(now-last);draws.push(current);actors.push({tick:m.world.tick,alive:m.world.aliveUnits.length,projectiles:m.world.projectiles.length});last=now}if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(q);q=null}if(!complete)count++;if(count>=N||(duration&&now-timed>=duration)){complete=true;window.perfSampling=false}}
   v.addEventListener('preRender',pre);v.addEventListener('postRender',post);window.perfSampling=true
   const deadline=performance.now()+90000
   try{while((!complete||pending.length)&&performance.now()<deadline){await new Promise(resolve=>requestAnimationFrame(resolve));if(ext){disjoint ||= gl.getParameter(ext.GPU_DISJOINT_EXT);while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const p=pending.shift();samples.gpu.push(gl.getQueryParameter(p,gl.QUERY_RESULT)/1e6);gl.deleteQuery(p)}}}}
   finally{manager.removeEventListener('animationLoop',loopBefore);manager.removeEventListener('animationLoop',loopAfter);v.removeEventListener('preFrame',frame);v.removeEventListener('preRender',pre);v.removeEventListener('postRender',post);r.render=render;m.world.step=step;window.perfSampling=false;for(const p of pending)gl.deleteQuery(p)}
   const stats=a=>{const sorted=[...a].sort((a,b)=>a-b);return {count:a.length,median:sorted[Math.floor(a.length*.5)]??null,p95:sorted[Math.floor(a.length*.95)]??null,samples:a}}
   const lights=[];v.scene.traverse(o=>{if(o.isLight&&o.castShadow)lights.push({name:o.name,size:o.shadow.mapSize.toArray()})})
   const dormant={roots:m.unitView.dormantRoot?.children.length||0,nodes:0};m.unitView.dormantRoot?.traverse(()=>dormant.nodes++)
   return {combatRoute:realtime?window.perfRoute?.summary():null,dormantUnits:dormant,frameRenderingStats:m.mapView.post?.frameRendering?.stats?Object.fromEntries(Object.entries(m.mapView.post.frameRendering.stats).map(([key,value])=>[key,value-(statsBefore[key]||0)])):null,animationLoopCount,postRenderCount:count,maxFramePerLoop:v.maxFramePerLoop,rendersPerFrame:v.rendersPerFrame,elapsedMs:last-timed,initialTick,tickDelta:m.world.tick-initialTick,complete,enemyOverlays:document.querySelectorAll('.tm-nameplate:not(.teammate),.tm-boss,.tm-range-ruler').length,unitVisuals:m.unitView.visuals.size,quality:m.ui.screens.settings.quality,pixelRatio:r.getPixelRatio(),timings:Object.fromEntries(Object.entries(samples).map(([k,a])=>[k,stats(a)])),fps:1000/(samples.cadence.reduce((a,b)=>a+b,0)/samples.cadence.length),draws,actors,disjoint,timerExtension:!!ext,visibility:document.visibilityState,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderScale:v.renderManager.renderScale,lights,camera:{position:m.playerView.camera.position.toArray(),quaternion:m.playerView.camera.quaternion.toArray(),fov:m.playerView.camera.fov},feet:{...m.world.player.pos},simulationState:active?{tick:m.world.tick,player:m.world.player,units:m.world.units.map(({brain,...unit})=>unit),projectiles:m.world.projectiles,eventLog:m.world.eventLog}:null,plugins:Object.keys(v.plugins),resources:{...r.info.memory,programs:r.info.programs.length}}
  },{active,realtime,processQuery:process.env.GPU_QUERIES==='1'})
  if((process.platform==='linux'&&!/NVIDIA/.test(result.renderer))||/SwiftShader|llvmpipe/i.test(result.renderer)||!result.complete||result.visibility!=='visible'||result.disjoint||result.timings.cpuFrame.count<(realtime?100:active?360:150))throw Error('Invalid GPU, visibility, disjoint, or incomplete sample')
  if(process.env.GPU_QUERIES==='1'&&(!result.timerExtension||result.timings.gpu.count!==result.timings.cpuFrame.count))throw Error('GPU diagnostic requires complete non-disjoint asynchronous query samples');
  if(realtime&&movingRoute&&!(result.combatRoute?.distance>100))throw Error('Moving combat route must travel over 100 metres through normal collision in 60 seconds');
  if(realtime&&(result.elapsedMs<60000||Math.min(...result.actors.map(a=>a.alive))<6))throw Error('Native combat must run 60s with at least six live actors');
  report.views.push({id:view.id,...result});console.log(JSON.stringify({id:view.id,cpu:result.timings.cpuFrame.median,submission:result.timings.cpuSubmission.median,sim:result.timings.simulation.median,gpu:result.timings.gpu.median,fps:result.fps,draws:result.draws[0],actors:result.actors.at(-1)}))
  await page.screenshot({path:resolve(out,view.id+'.png')})
  await writeFile(resolve(out,'frames.json'),JSON.stringify(report,null,2)+'\n')
 }
 if(process.env.PROFILE==='1'){
  await page.evaluate(()=>{window.perfSampling=true})
  report.passDiagnostic=await page.evaluate(async()=>{
   const v=window.viewer,r=v.renderManager.webglRenderer,render=r.render, rows=[];let n=0,frame=0;
   const rootCounts=[];for(const root of v.scene.children){let nodes=0,meshes=0,auto=0;root.traverse(o=>{nodes++;meshes+=o.isMesh?1:0;auto+=o.matrixAutoUpdate?1:0});rootCounts.push({name:root.name,visible:root.visible,nodes,meshes,auto})}
   const materials=new Set();v.scene.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m)materials.add(m)});
   const materialSummary={total:materials.size,transmissive:[...materials].filter(m=>m.transmission>0).map(m=>m.name)};
   const before=()=>{frame++;n=0};v.addEventListener('preRender',before);
   r.render=function(scene,camera){const t=performance.now(),target=r.getRenderTarget(), mat=scene.material||scene.children?.[0]?.material;const result=render.call(this,scene,camera);rows.push({frame,pass:n++,scene:scene.name,type:scene.type,material:mat?.name,shader:mat?.fragmentShader?.slice(0,150),mode:Object.fromEntries(Object.entries(r.userData||{}).filter(([,value])=>typeof value==='boolean')),target:target?.texture?.name,size:target?[target.width,target.height]:null,cpu:performance.now()-t,...r.info.render});return result};
   await new Promise(resolve=>setTimeout(resolve,1500));r.render=render;v.removeEventListener('preRender',before);
   let objects=0,auto=0;v.scene.traverse(o=>{objects++;auto+=o.matrixAutoUpdate?1:0});
   return {rows,objects,auto,rootCounts,materialSummary,passes:v.renderManager._composer?.passes?.map(p=>({id:p.passId,enabled:p.enabled})),maxFramePerLoop:v.maxFramePerLoop,rendersPerFrame:v.rendersPerFrame};
  });await writeFile(resolve(out,'frames.json'),JSON.stringify(report,null,2)+'\n');

  await page.evaluate(()=>{window.perfSampling=true})
  const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await page.waitForTimeout(8000);const {profile}=await cdp.send('Profiler.stop');await writeFile(resolve(out,'active.cpuprofile'),JSON.stringify(profile));await cdp.detach()
 }
 await page.evaluate(()=>{window.perfRestoreScheduler?.();window.terminator.manager.stop()})
}finally{clearTimeout(timeout);clearInterval(clockTimer);await browser.close()}
