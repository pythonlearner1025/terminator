/** Same-device frame benchmark. Keeps all scene content and high quality intact.
 * Run from any clean comparison checkout; this script and guarded launcher stay
 * in the frame worktree. Output is immutable. PROFILE=1 adds a separate CDP pass.
 */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
const out=resolve(process.argv[2]);await access(out).then(()=>{throw Error('Output exists')},e=>{if(e.code!=='ENOENT')throw e});await mkdir(out,{recursive:true})
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const ownPort=process.env.FRAME_DEV_PORT||'4751'
if(!['4751','4753'].includes(ownPort)||new URL(dev.origin).hostname!=='127.0.0.1'||new URL(dev.origin).port!==ownPort)throw Error('Frame server must match explicit owned port')
const config=JSON.parse(await readFile(new URL('../../docs/scene-targets/views.json',import.meta.url),'utf8'))
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}),config,sourceFiles:{},errors:[],views:[],method:'150 fixed-view frames at tick 120; 120 deterministic active warmup frames then 360 active frames, 1/60s gameplay update per render; cadence measured independently; seventh view resumes native deltaTime/catch-up for 180 frames from the same tick-600 state; CPU frame starts before component preFrame; GPU spans all viewer render passes'}
for(const file of execFileSync('git',['ls-files','lib','scripts','main.js','package.json','assets/main.scene.gltf'],{encoding:'utf8'}).trim().split('\n'))report.sourceFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex')
report.profilerHash=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')
const browser=await launchCaptureBrowser();report.browser=browser.version();report.launch=browserOptions();report.cgroup=browser.captureCgroup
const timeout=setTimeout(()=>browser.close(),240000)
try {
 const originals = new Map()
 if (process.env.FRAME_BEFORE === '1') {
  report.beforeOverride = {commit:'babafed',files:{}}
  for (const file of ['lib/core/collision.js','lib/view/map-batching.js']) {
   const body=execFileSync('git',['show',`babafed:${file}`]);originals.set(file,body)
   report.beforeOverride.files[file]=createHash('sha256').update(body).digest('hex')
   report.sourceFiles[file]=report.beforeOverride.files[file]
  }
 }
 const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1});page.setDefaultTimeout(120000)
 if (originals.size) await page.route('**/files/**',async route=>{const file=new URL(route.request().url()).pathname.replace(/^\/files\//,'');if(originals.has(file))await route.fulfill({contentType:'text/javascript',body:originals.get(file)});else await route.continue()})
 page.on('console',e=>{if(e.type()==='error')report.errors.push(e.text())})
 page.on('pageerror',e=>{report.errors.push(e.message);console.log('pageerror',e.message.slice(0,250))})
 await page.addInitScript(({seed,settings})=>{let s=seed>>>0;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url);console.log('authenticated')
 await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'});console.log('document loaded')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000});console.log('main ready')
 await page.evaluate(async()=>{const m=window.terminator.manager;window.perfOriginalUpdate=m.update;m.update=()=>true;await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)})
 console.log('match ready')
 report.combatOnly=process.env.FRAME_COMBAT_ONLY==='1'
 for(const [index,view] of [...config.views,{...config.views[0],id:'06-active-wave'},{...config.views[0],id:'07-active-realtime'}].entries()) {
  if(report.combatOnly&&index<5)continue
  const active=index>=5,realtime=index===6
  await page.evaluate(async({view,active,realtime,tick})=>{
   const m=window.terminator.manager,p=m.world.player
   if(realtime){window.perfSampling=false;m.accumulator=0;m.update=e=>{if(window.perfSampling)window.perfOriginalUpdate.call(m,e);return true};return}
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
  },{view,active,realtime,tick:config.tick})
  const result=await page.evaluate(async({active,realtime})=>{
   const v=window.viewer,m=window.terminator.manager,r=v.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info')
   const N=realtime?180:active?360:150,samples={cpuFrame:[],cpuSubmission:[],simulation:[],cadence:[],gpu:[]},draws=[],actors=[],pending=[]
   let frameStart=0,renderStart=0,last=0,q=null,count=0,disjoint=false,simTime=0,current={calls:0,triangles:0,points:0,lines:0,passes:0}
   const frame=()=>{frameStart=performance.now();simTime=0}
   // Listener list prepend includes component preFrame and the ECP update.
   v.addEventListener('preFrame',frame);const list=v._listeners.preFrame;list.splice(list.indexOf(frame),1);list.unshift(frame)
   const render=r.render,step=m.world.step
   m.world.step=function(...args){const t=performance.now();try{return step.apply(this,args)}finally{simTime+=performance.now()-t}}
   r.render=function(...args){const result=render.apply(this,args);current.passes++;for(const key of ['calls','triangles','points','lines'])current[key]+=this.info.render[key];return result}
   const pre=()=>{renderStart=performance.now();current={calls:0,triangles:0,points:0,lines:0,passes:0};if(ext&&count<N){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q)}}
   const post=()=>{const now=performance.now();if(count<N){samples.cpuFrame.push(now-frameStart);samples.cpuSubmission.push(now-renderStart);samples.simulation.push(simTime);if(last)samples.cadence.push(now-last);draws.push(current);actors.push({tick:m.world.tick,alive:m.world.aliveUnits.length,projectiles:m.world.projectiles.length});last=now}if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(q);q=null}count++;if(count>=N)window.perfSampling=false}
   v.addEventListener('preRender',pre);v.addEventListener('postRender',post);window.perfSampling=true
   const deadline=performance.now()+45000
   try{while((count<N||pending.length)&&performance.now()<deadline){await new Promise(resolve=>requestAnimationFrame(resolve));if(ext){disjoint ||= gl.getParameter(ext.GPU_DISJOINT_EXT);while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const p=pending.shift();samples.gpu.push(gl.getQueryParameter(p,gl.QUERY_RESULT)/1e6);gl.deleteQuery(p)}}}}
   finally{v.removeEventListener('preFrame',frame);v.removeEventListener('preRender',pre);v.removeEventListener('postRender',post);r.render=render;m.world.step=step;window.perfSampling=false;for(const p of pending)gl.deleteQuery(p)}
   const stats=a=>{const sorted=[...a].sort((a,b)=>a-b);return {count:a.length,median:sorted[Math.floor(a.length*.5)]??null,p95:sorted[Math.floor(a.length*.95)]??null,samples:a}}
   const lights=[];v.scene.traverse(o=>{if(o.isLight&&o.castShadow)lights.push({name:o.name,size:o.shadow.mapSize.toArray()})})
   return {enemyOverlays:document.querySelectorAll('.tm-nameplate:not(.teammate),.tm-boss,.tm-range-ruler').length,unitVisuals:m.unitView.visuals.size,quality:m.ui.screens.settings.quality,pixelRatio:r.getPixelRatio(),timings:Object.fromEntries(Object.entries(samples).map(([k,a])=>[k,stats(a)])),fps:1000/(samples.cadence.reduce((a,b)=>a+b,0)/samples.cadence.length),draws,actors,disjoint,timerExtension:!!ext,visibility:document.visibilityState,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderScale:v.renderManager.renderScale,lights,camera:{position:m.playerView.camera.position.toArray(),quaternion:m.playerView.camera.quaternion.toArray(),fov:m.playerView.camera.fov},feet:{...m.world.player.pos},simulationState:active?{tick:m.world.tick,player:m.world.player,units:m.world.units.map(({brain,...unit})=>unit),projectiles:m.world.projectiles,eventLog:m.world.eventLog}:null,plugins:Object.keys(v.plugins),resources:{...r.info.memory,programs:r.info.programs.length}}
  },{active,realtime})
  if(!/NVIDIA/.test(result.renderer)||result.visibility!=='visible'||result.disjoint||result.timings.cpuFrame.count!==(realtime?180:active?360:150))throw Error('Invalid GPU, visibility, disjoint, or incomplete sample')
  report.views.push({id:view.id,...result});console.log(JSON.stringify({id:view.id,cpu:result.timings.cpuFrame.median,submission:result.timings.cpuSubmission.median,sim:result.timings.simulation.median,gpu:result.timings.gpu.median,fps:result.fps,draws:result.draws[0],actors:result.actors.at(-1)}))
  await page.screenshot({path:resolve(out,view.id+'.png')})
  await writeFile(resolve(out,'frames.json'),JSON.stringify(report,null,2)+'\n')
 }
 if(process.env.PROFILE==='1'){
  await page.evaluate(()=>{window.perfSampling=true})
  const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start');await page.waitForTimeout(5000);const {profile}=await cdp.send('Profiler.stop');await writeFile(resolve(out,'active.cpuprofile'),JSON.stringify(profile));await cdp.detach()
 }
 await page.evaluate(()=>window.terminator.manager.stop())
}finally{clearTimeout(timeout);await browser.close()}
