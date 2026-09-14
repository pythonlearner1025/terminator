// Within-viewer zero-power light policy diagnostic, never combat FPS acceptance.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
assert.equal(process.env.FRAME_GPU_GRANTED,'1')
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8')),port=process.env.FRAME_DEV_PORT||'4754'
assert((process.platform==='darwin'?['4753','4756']:['4754']).includes(port));assert.equal(new URL(dev.origin).port,port);assert.equal(new URL(dev.origin).hostname,'127.0.0.1')
if(process.platform==='linux')assert.equal(JSON.parse(await readFile('../coordination/perf-budget-gpu.json','utf8')).owner,'perf-budget-frame')
const options=browserOptions();process.env.CHROME_ARGS=JSON.stringify([...options.args,'--disable-frame-rate-limit','--disable-gpu-vsync'])
const out=resolve(process.argv[2]);await mkdir(out)
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'Same viewer, same courtyard, six alternating zero-power light policies; 60 warm frames then 120 measured frames each. Static diagnostic, not combat acceptance.',rows:[],errors:[]}
const browser=await launchCaptureBrowser();report.launch=browserOptions();report.browser=browser.version()
const timeout=setTimeout(()=>browser.close(),240000)
try{
 const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.addInitScript(({seed,settings})=>{let s=seed>>>0;Math.random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url);await page.goto(dev.origin+'/files/tools/map-runtime.html')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 await page.evaluate(async({view,tick})=>{
  const m=window.terminator.manager;m.update=()=>true;await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop()
  const p=m.world.player;p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
  const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-p.pos.y-1.65,dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
  for(let i=0;i<=tick;i++){m.world.tick=i;m.mapView.sync(m.world);m.playerView.sync(m.world)}
  if(m.world.projectiles.length)throw Error('Expected the unchanged static benchmark setup with no live projectiles')
  window.lightPolicy=false
  m.update=()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);for(const l of m.playerView.weapons.projectiles.lights){if(l.intensity!==0)throw Error('Policy control may only compare zero-power slots');l.visible=window.lightPolicy}window.viewer.setDirty();return true}
 },{view:config.views[0],tick:config.tick})
 for(const visible of [false,true,true,false,false,true]){
  const row=await page.evaluate(async visible=>{
   window.lightPolicy=visible;for(let i=0;i<60;i++)await new Promise(requestAnimationFrame)
   const v=window.viewer,m=window.terminator.manager,r=v.renderManager.webglRenderer,rm=v.renderManager,cpu=[],submission=[],cadence=[];let t=0,pre=0,last=0,count=0
   const first=()=>{t=performance.now()},beforeRender=()=>{pre=performance.now()},afterRender=()=>{const now=performance.now();submission.push(now-pre);if(last)cadence.push(now-last);last=now;count++},end=()=>cpu.push(performance.now()-t)
   rm.addEventListener('animationLoop',first);const list=rm._listeners.animationLoop;list.splice(list.indexOf(first),1);list.unshift(first);rm.addEventListener('animationLoop',end)
   v.addEventListener('preRender',beforeRender);v.addEventListener('postRender',afterRender)
   try{while(count<120)await new Promise(requestAnimationFrame)}finally{rm.removeEventListener('animationLoop',first);rm.removeEventListener('animationLoop',end);v.removeEventListener('preRender',beforeRender);v.removeEventListener('postRender',afterRender)}
   const stats=a=>{const b=[...a].sort((a,b)=>a-b);return {p50:b[Math.floor(b.length*.5)],p95:b[Math.floor(b.length*.95)],samples:a}}
   const gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
   return {visible,cpu:stats(cpu),submission:stats(submission),cadence:stats(cadence),fps:1000/(cadence.reduce((a,b)=>a+b,0)/cadence.length),drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),programs:r.info.programs.length,lights:m.playerView.weapons.projectiles.lights.map(l=>({visible:l.visible,intensity:l.intensity})),camera:{position:m.playerView.camera.position.toArray(),quaternion:m.playerView.camera.quaternion.toArray(),fov:m.playerView.camera.fov}}
  },visible)
  report.rows.push(row);await page.screenshot({path:resolve(out,`policy-${report.rows.length}-${visible}.png`)});await writeFile(resolve(out,'control.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({visible,cpu:row.cpu.p50,p95:row.cpu.p95,submission:row.submission.p50,fps:row.fps}))
 }
 await page.evaluate(()=>window.terminator.manager.stop());assert.deepEqual(report.errors,[])
}finally{clearTimeout(timeout);await browser.close();await writeFile(resolve(out,'control.json'),JSON.stringify(report,null,2)+'\n')}
