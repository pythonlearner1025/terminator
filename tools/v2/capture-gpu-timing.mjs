/** Supplemental GPU/CPU timings; does not replace rAF cadence in five-view captures. */
import {readFile,writeFile,mkdir,access} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const selectedIds=process.env.CAPTURE_VIEW?.split(',')
if(selectedIds?.some(id=>!config.views.some(view=>view.id===id)))throw Error('Unknown CAPTURE_VIEW')
const selectedViews=selectedIds?config.views.filter(view=>selectedIds.includes(view.id)):config.views
const output=resolve(process.argv[2]||'docs/evidence/v2-integration-checks/gpu.json')
await access(output).then(()=>{throw Error('Refusing to overwrite GPU evidence; choose a new output path')},error=>{if(error.code!=='ENOENT')throw error})
const provenance={captureViews:selectedViews.map(view=>view.id),git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),sourceFiles:{}}
const files=execFileSync('git',['ls-files','lib/core','scripts/GameManager.script.js','lib/view/map.js','lib/view/map-batching.js','main.js','package.json','assets/main.scene.gltf','assets/models/map/rubble-1x1p5x12-zh655b/rubble-1x1p5x12-zh655b.gltf','generators','lib/view/v2','assets/v2','tools/v2/capture-gpu-timing.mjs','tools/v2/capture-browser.mjs'],{encoding:'utf8'}).trim().split('\n')
for(const file of files)provenance.sourceFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex')
const pilotOverrides=loadPilotOverrides()
if(pilotOverrides)provenance.diagnosticOverrides=pilotOverrides.manifest
const browser=await launchCaptureBrowser()
try{
 const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1})
 await pilotOverrides?.install(page)
 await page.addInitScript(({seed,settings})=>{let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url)
 await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 const results=[]
 for(const view of selectedViews){
 const result=await page.evaluate(async(config)=>{
  const m=window.terminator.manager;if(!m.world)m.start();m.update=()=>true
  await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
  const view=config.views[0],p=m.world.player;p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
  const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-p.pos.y-1.65,dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
  for(let tick=0;tick<=config.tick;tick++){m.world.tick=tick;m.mapView.sync(m.world);m.playerView.sync(m.world)}
  const viewer=window.viewer,r=viewer.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info')
  const frame=()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);viewer.setDirty()};viewer.addEventListener('preFrame',frame)
  await new Promise(resolve=>setTimeout(resolve,2000))
  const cpu=[],gpu=[],pending=[],draws=[];let start=0,active=null,count=0,disjoint=false,currentDraws={calls:0,triangles:0,points:0,lines:0}
  const originalRender=r.render
  r.render=function(...args){const result=originalRender.apply(this,args);for(const key of ['calls','triangles','points','lines'])currentDraws[key]+=this.info.render[key];return result}
  const pre=()=>{currentDraws={calls:0,triangles:0,points:0,lines:0};start=performance.now();if(ext&&count<90){active=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,active)}}
  const post=()=>{if(count<90){cpu.push(performance.now()-start);draws.push(currentDraws)};if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null}count++}
  viewer.addEventListener('preRender',pre);viewer.addEventListener('postRender',post)
  const deadline=performance.now()+15000
  while((count<90||pending.length)&&performance.now()<deadline){
   await new Promise(resolve=>requestAnimationFrame(resolve))
   if(ext){disjoint ||= gl.getParameter(ext.GPU_DISJOINT_EXT);while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift();gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}}
  }
  viewer.removeEventListener('preRender',pre);viewer.removeEventListener('postRender',post);viewer.removeEventListener('preFrame',frame)
  r.render=originalRender
  for(const q of pending)gl.deleteQuery(q)
  const stats=a=>{const sorted=[...a].sort((a,b)=>a-b);return {count:a.length,medianMs:sorted[Math.floor(a.length*.5)]??null,p95Ms:sorted[Math.floor(a.length*.95)]??null,samplesMs:a}}
  const pluginSettings={}
  for(const type of ['SSAOPlugin','GBuffer']){
   const plugin=viewer.getPlugin(type)
   pluginSettings[type]=plugin?{present:true,enabled:plugin.enabled,sizeMultiplier:plugin.sizeMultiplier,bufferType:plugin.bufferType,packing:plugin.packing,pass:plugin.pass?{enabled:plugin.pass.enabled,occlusionWorldRadius:plugin.pass.occlusionWorldRadius,numSamples:plugin.pass.numSamples,intensity:plugin.pass.intensity,bias:plugin.pass.bias}:null}: {present:false}
  }
  const result={camera:{position:m.playerView.camera.position.toArray(),quaternion:m.playerView.camera.quaternion.toArray(),fov:m.playerView.camera.fov},feet:{...p.pos},tick:m.world.tick,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),draws,cpuSubmission:stats(cpu),gpuElapsed:ext&&!disjoint?stats(gpu):null,disjoint,timerExtension:!!ext,visibility:document.visibilityState,maxFramePerLoop:viewer.maxFramePerLoop,rendersPerFrame:viewer.rendersPerFrame,render:{...r.info.render},drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderScale:viewer.renderManager.renderScale}
  result.plugins={types:Object.keys(viewer.plugins),settings:pluginSettings}
  m.stop();return result
 },{...config,views:[view]})
 if(process.platform==='linux'&&!/NVIDIA/.test(result.renderer))throw Error('Expected NVIDIA GPU renderer')
 results.push({id:view.id,...result})
 console.log(JSON.stringify({id:view.id,cpu:result.cpuSubmission.medianMs,gpu:result.gpuElapsed?.medianMs,draws:result.draws[0],renderer:result.renderer}))
 }
 await mkdir(resolve(output,'..'),{recursive:true})
 await writeFile(output,JSON.stringify({...provenance,browser:browser.version(),launch:browserOptions(),views:results},null,2)+'\n')

}catch(error){throw new Error(String(error.message).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]'))}finally{await browser.close()}
