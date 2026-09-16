/** Explicit diagnostic of existing contact-occlusion quality; no project settings are written. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
if(!process.argv[2])throw Error('Choose a new diagnostic evidence directory')
const output=resolve(process.argv[2])
await mkdir(output)
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const overrides=loadPilotOverrides()
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),config,launch:browserOptions(),sourceFiles:{},diagnosticOverrides:overrides?.manifest,mode:'Explicit existing SSAO/GBuffer quality diagnostic: current high, SSAO disabled, .5 scale/8 samples. Intensity/radius and all other settings held.',views:[],errors:[]}
for(const path of execFileSync('git',['ls-files','lib','assets/v2','generators','main.js','package.json','tools/v2/capture-contact-diagnostics.mjs','tools/v2/capture-browser.mjs','tools/v2/capture-pilot-overrides.mjs'],{encoding:'utf8'}).trim().split('\n')) report.sourceFiles[path]=createHash('sha256').update(await readFile(path)).digest('hex')
const clean=value=>String(value).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
const browser=await launchCaptureBrowser();report.browser=browser.version()
try{
 for(const view of config.views.filter(view=>['04-service','05-rooftop'].includes(view.id))){
  const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1})
  await overrides?.install(page)
  page.on('pageerror',e=>report.errors.push(clean(e.message)))
  page.on('console',e=>{if(e.type()==='error')report.errors.push(clean(e.text()))})
  await page.addInitScript(({seed,settings})=>{let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
  await page.request.get(dev.url);await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
  const initial=await page.evaluate(async({view,config})=>{
   const m=window.terminator.manager,viewer=window.viewer;m.update=()=>true
   await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
   const p=m.world.player;p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
   const support=m.world.playerSupportAt(p.pos,p.pos.y,{radius:.3,maxAbove:.05,maxBelow:.05});if(!support||!m.world.playerHasHeadClearance(p.pos,1.8,support))throw Error('Unsupported original POV')
   const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-p.pos.y-1.65,dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
   for(let i=0;i<=config.tick;i++){m.world.tick=i;m.mapView.sync(m.world);m.playerView.sync(m.world)}m.syncUi(true);m.hud.sync()
   const post=m.mapView.post,ssao=viewer.getPlugin('SSAOPlugin');if(!post.ssao||post.ssao!==ssao)throw Error('Expected existing MapPost-owned SSAO')
   window.contactFrame=()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);viewer.setDirty()};viewer.addEventListener('preFrame',window.contactFrame)
   window.contactOriginal={quality:{...post.quality},enabled:ssao.enabled}
   window.contactSnapshot=()=>{
    const camera=m.playerView.camera,renderer=viewer.renderManager.webglRenderer,gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info')
    const target=t=>t?{width:t.width,height:t.height,sizeMultiplier:t.sizeMultiplier}:null
    return {fixed:{camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far},feet:{...p.pos},tick:m.world.tick,mapState:JSON.parse(JSON.stringify(m.world.mapState)),weapon:p.activeWeapon,quality:{...m.mapView.quality},weather:{...m.mapView.refs.weather?.settings},drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderScale:viewer.renderManager.renderScale,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unknown',exposure:viewer.getPlugin('Tonemap')?.exposure,grain:viewer.getPlugin('FilmicGrain')?.intensity,fog:viewer.scene.fog?{color:viewer.scene.fog.color.toArray(),density:viewer.scene.fog.density}:null},ssao:{enabled:ssao.enabled,intensity:ssao.pass.intensity,occlusionWorldRadius:ssao.pass.occlusionWorldRadius,numSamples:ssao.pass.numSamples,bias:ssao.pass.bias,target:target(ssao.target),gbuffer:target(viewer.renderManager.gbufferTarget)},postQuality:{...post.quality}}
   }
   return window.contactSnapshot()
  },{view,config})
  assert.match(initial.fixed.renderer,/NVIDIA/)
  const record={id:view.id,initial,variants:[]};report.views.push(record)
  for(const variant of ['current','off','half-eight']){
   await page.evaluate(variant=>{
    const post=window.terminator.manager.mapView.post,ssao=window.viewer.getPlugin('SSAOPlugin'),original=window.contactOriginal
    post.setQuality(variant==='half-eight'?{...original.quality,gbufferScale:.5,ssaoScale:.5,ssaoSamples:8}:original.quality)
    ssao.enabled=variant==='off'?false:original.enabled;window.viewer.setDirty()
   },variant)
   await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(1600)
   const timing=await page.evaluate(async()=>{
    const viewer=window.viewer,r=viewer.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
    if(!ext)throw Error('GPU disjoint timer unavailable')
    const cpu=[],gpu=[],pending=[],draws=[];let active=null,start=0,count=0,disjoint=false,current={calls:0,triangles:0,points:0,lines:0}
    const original=r.render;r.render=function(...args){const result=original.apply(this,args);for(const key of Object.keys(current))current[key]+=this.info.render[key];return result}
    const pre=()=>{current={calls:0,triangles:0,points:0,lines:0};start=performance.now();if(count<90){active=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,active)}}
    const post=()=>{if(count<90){cpu.push(performance.now()-start);draws.push(current)}if(active){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(active);active=null}count++}
    viewer.addEventListener('preRender',pre);viewer.addEventListener('postRender',post)
    try{
     const deadline=performance.now()+15000
     while((count<90||pending.length)&&performance.now()<deadline){await new Promise(resolve=>requestAnimationFrame(resolve));disjoint ||= gl.getParameter(ext.GPU_DISJOINT_EXT);while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){const q=pending.shift();gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}}
    }finally{viewer.removeEventListener('preRender',pre);viewer.removeEventListener('postRender',post);r.render=original;for(const q of pending)gl.deleteQuery(q)}
    const stats=a=>{const sorted=[...a].sort((a,b)=>a-b);return {count:a.length,medianMs:sorted[Math.floor(a.length*.5)],p95Ms:sorted[Math.floor(a.length*.95)],samplesMs:a}}
    return {cpu:stats(cpu),gpu:stats(gpu),disjoint,draws}
   })
   const snapshot=await page.evaluate(()=>window.contactSnapshot())
   assert.deepEqual(snapshot.fixed,initial.fixed,'Non-AO state changed')
   for(const key of ['intensity','occlusionWorldRadius','bias'])assert.equal(snapshot.ssao[key],initial.ssao[key])
   assert.equal(timing.disjoint,false);assert.equal(timing.cpu.count,90);assert.equal(timing.gpu.count,90)
   const filename=`${view.id}-${variant}.png`,png=await page.screenshot({path:resolve(output,filename),animations:'disabled'})
   record.variants.push({variant,filename,sha256:createHash('sha256').update(png).digest('hex'),...snapshot,timing})
   console.log(JSON.stringify({view:view.id,variant,ssao:snapshot.ssao,cpu:timing.cpu.medianMs,gpu:timing.gpu.medianMs}))
   await writeFile(resolve(output,'contact.json'),JSON.stringify(report,null,2)+'\n')
   assert.deepEqual(report.errors,[])
  }
  record.restored=await page.evaluate(()=>{const original=window.contactOriginal;window.terminator.manager.mapView.post.setQuality(original.quality);window.viewer.getPlugin('SSAOPlugin').enabled=original.enabled;return window.contactSnapshot()})
  assert.deepEqual(record.restored,initial,'AO state did not restore exactly')
  await page.evaluate(()=>{window.viewer.removeEventListener('preFrame',window.contactFrame);window.terminator.manager.stop()});await page.close()
 }
 report.pass=true
}catch(error){throw new Error(clean(error.message))}finally{await writeFile(resolve(output,'contact.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
