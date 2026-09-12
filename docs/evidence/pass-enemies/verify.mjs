import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const out=new URL('./',import.meta.url)
const dev=JSON.parse(await readFile(new URL('../../../.kite3d/dev.json',out),'utf8'))
assert.equal(new URL(dev.url).port,'4620')
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const report={mode:'Full Chrome, headless, full 1920x1080 game runtime, hardware renderer, no module substitutions',errors:[],checks:[],screenshots:[]}
const clean=s=>String(s).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
page.on('pageerror',e=>report.errors.push(clean(e.stack)))
page.on('console',m=>{if(m.type()==='error')report.errors.push(clean(m.text()))})
const check=(value,label)=>{report.checks.push({label,pass:Boolean(value)});console.log((value?'PASS ':'FAIL ')+label)}
async function shot(name){
 await page.evaluate(async()=>{
  viewer.renderEnabled=true;viewer.setDirty()
  await new Promise(resolve=>{const done=()=>{viewer.removeEventListener('postRender',done);viewer.renderEnabled=false;resolve()};viewer.addEventListener('postRender',done)})
 })
 try{await page.screenshot({path:new URL(name,out).pathname,timeout:20000});report.screenshots.push(name)}
 finally{await page.evaluate(()=>{viewer.renderEnabled=true;viewer.setDirty()})}
}
try{
 await page.request.get(dev.url)
 await page.goto(dev.origin+'/files/docs/evidence/pass-enemies/runtime.html',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.terminator?.manager?.unitView,null,{timeout:90000})
 await page.evaluate(()=>{
  const m=terminator.manager;m.startViews();m.ui.screens.show(null);m.ui.applySettings({...m.ui.screens.settings,quality:'high'})
  m.playerView.root.visible=false;m.unitView.toggleShowcase(true)
  Object.assign(m.unitView.showcase,{focus:'endo',angle:.5,cameraDistance:.83,targetY:1.78,state:'idle'})
 })
 await page.waitForTimeout(1200)
 await shot('01-endo-skull.png')
 await page.evaluate(()=>Object.assign(terminator.manager.unitView.showcase,{focus:null,angle:.12,cameraDistance:3.6,targetY:1.08,state:'idle'}))
 await page.waitForTimeout(600);await shot('02-roster.png')
 console.log('Captured anatomy')
 report.motion=await page.evaluate(async()=>{
  const {animateUnit,unitGround,hitUnitRig}=await import('/files/lib/view/units-animation.js')
  const {Vector3,Raycaster}=await import('threepipe')
  const m=terminator.manager,w=m.world,view=m.unitView
  m.update=()=>true
  const results={}
  const v=view.showcase.units.find(v=>v.state.type==='endo'),u=v.state
  u.intent.aimAt={x:u.pos.x+4,y:4,z:4}
  for(let i=0;i<30;i++)animateUnit(v.rig,u,1/60,i/60)
  results.tracking={headYaw:v.rig.joints.Head.rotation.y,headPitch:v.rig.joints.Head.rotation.x}
  const ray=new Raycaster();let rayError=0,matched=0
  v.rig.mesh.skeleton.update()
  for(const name of ['Head','Chest','Forearm Left','Shin Right']) {
    const point=v.rig.joints[name].getWorldPosition(new Vector3())
    ray.set(point.clone().add(new Vector3(0,0,3)),new Vector3(0,0,-1))
    const reference=ray.intersectObject(v.rig.mesh,false)[0],hit=hitUnitRig(v.rig,ray.ray)
    if(reference&&hit){matched++;rayError=Math.max(rayError,reference.point.distanceTo(hit.point))}
  }
  results.hitRay={matched,maxError:rayError}
  u.alive=false
  let minClearance=Infinity
  for(let i=0;i<180;i++){
    animateUnit(v.rig,u,1/60,i/60)
    for(const c of v.rig.contacts)for(const p of c.corners){const q=p.clone().applyMatrix4(c.bone.matrixWorld);minClearance=Math.min(minClearance,q.y-80)}
  }
  results.death={minClearance,pelvisY:v.rig.joints.Pelvis.position.y,eyesVisible:v.rig.eyes.visible,angle:v.rig.joints.Pelvis.rotation.x}
  const h=view.showcase.units.find(v=>v.state.type==='heavy')
  h.state.intent.fire=true;h.state.spinUp=1
  for(let i=0;i<90;i++)animateUnit(h.rig,h.state,1/60,i/60)
  results.heavy={barrels:h.rig.joints.Barrels.rotation.z,heat:h.rig.heat}
  // Exercise the actual map's six stair treads and ramp without changing core state.
  const testState={id:'terrain-fixture',type:'endo',pos:{x:10,y:.5,z:24.4},yaw:Math.PI,vel:{x:0,z:-1},alive:true,intent:{}}
  const terrain=view.cloneTemplateFigure(testState)
  w.snapshot();const before=JSON.stringify(w.snapshot())
  results.terrain={stairs:[],ramp:[],travel:[],minSoleClearance:Infinity,maxTargetError:0}
  for(let i=0;i<360;i++){
    testState.pos.z=24.4-i/75;testState.pos.y=unitGround(w.nav,10,testState.pos.z,testState.pos.y)
    terrain.object.position.set(10,testState.pos.y,testState.pos.z)
    animateUnit(terrain.rig,testState,1/60,i/60,w.nav)
    if(i%60===0)results.terrain.stairs.push(testState.pos.y)
    results.terrain.travel.push(terrain.rig.joints['Knee Left Rod'].scale.y)
    for(const side of ['Left','Right']){
      const foot=terrain.rig.joints['Foot '+side],f=terrain.rig.feet[side]
      const actual=foot.getWorldPosition(new Vector3())
      const error=actual.distanceTo(f.target)
      if(error>results.terrain.maxTargetError){results.terrain.maxTargetError=error;results.terrain.worst={i,side,actual:actual.toArray(),target:f.target.toArray(),pelvisY:terrain.rig.joints.Pelvis.position.y,state:{...testState.pos},thigh:terrain.rig.joints['Thigh '+side].rotation.toArray(),shin:terrain.rig.joints['Shin '+side].rotation.toArray()}}
      if(f.stance)results.terrain.minSoleClearance=Math.min(results.terrain.minSoleClearance,actual.y-.07-f.ground)
    }
  }
  for(let i=0;i<120;i++){
    testState.pos={x:17+i/100,y:unitGround(w.nav,17+i/100,-5,.5),z:-5};testState.yaw=Math.PI/2
    terrain.object.position.set(testState.pos.x,testState.pos.y,-5);terrain.object.rotation.y=testState.yaw
    animateUnit(terrain.rig,testState,1/60,i/60,w.nav)
    if(i%30===0)results.terrain.ramp.push(testState.pos.y)
  }
  results.coreUnchanged=before===JSON.stringify(w.snapshot())
  const t=results.terrain.travel;results.terrain.pistonRange=[Math.min(...t),Math.max(...t)];delete results.terrain.travel
  terrain.object.removeFromParent();const {disposeUnitRig}=await import('/files/lib/view/units-animation.js');disposeUnitRig(terrain.rig,terrain.object)
  return results
 })
 check(report.motion.hitRay.matched>=3&&report.motion.hitRay.maxError<.002,'Bone-local hit rays agree with the rendered skinned mesh')
 check(report.motion.tracking.headYaw>.2&&report.motion.tracking.headPitch<-.1,'Head follows target yaw and pitch')
 check(report.motion.death.minClearance>=-.002&&!report.motion.death.eyesVisible,'Limp death stays above ground and extinguishes eyes')
 check(report.motion.heavy.barrels>20&&report.motion.heavy.heat>.4,'Heavy barrels spin and retain heat')
 check(report.motion.terrain.stairs.at(-1)>2&&report.motion.terrain.ramp.at(-1)>.3,'Foot IK queries all stair heights and the sloped dock')
 check(report.motion.terrain.pistonRange[1]-report.motion.terrain.pistonRange[0]>.08,'Hydraulic rods visibly travel through the gait')
 check(report.motion.terrain.maxTargetError<.03&&report.motion.terrain.minSoleClearance>-.03,'Soles reach their planted targets without penetrating a stair')
 check(report.motion.coreUnchanged,'Animation and ground queries leave the complete core snapshot unchanged')
 delete report.motion.terrain.worst
 console.log(JSON.stringify(report.motion))
 if(process.env.ENEMIES_MOTION_ONLY==='1'){await browser.close();process.exit(0)}
 // Controlled damage fixture on the full runtime rig, no UI or gameplay code patches.
 report.damage=await page.evaluate(async()=>{
  const {animateUnit}=await import('/files/lib/view/units-animation.js'),{Vector3}=await import('threepipe')
  const view=terminator.manager.unitView,s=view.showcase,v=s.units.find(v=>v.state.type==='endo')
  v.state.alive=true;v.rig.death=0;v.state.intent={}
  for(let i=0;i<80;i++)animateUnit(v.rig,v.state,1/60,i/60)
  const bone=v.rig.joints.Chest,pos=bone.getWorldPosition(new Vector3()).add(new Vector3(.12,.04,.15))
  view.fx.damage(v,bone,pos,new Vector3(0,0,1),{amount:150,weapon:'plasma'},v.state)
  view.fx.wreck(v);v.state.alive=false
  let minLimbClearance=Infinity
  for(let i=0;i<120;i++){
    animateUnit(v.rig,v.state,1/60,i/60);view.fx.update(1/60)
    for(const b of view.fx.bodies){b.floor=80;b.mesh.updateMatrixWorld(true);for(const c of b.corners){const p=c.clone().applyMatrix4(b.mesh.matrixWorld);if(i>1)minLimbClearance=Math.min(minLimbClearance,p.y-80)}}
  }
  for(const item of s.units)item.object.visible=item===v
  Object.assign(s,{focus:'endo',angle:-.65,cameraDistance:2.1,targetY:.25,elevation:1.1,state:'dying'})
  // Render the settled fixture once. Simulation is paused in the harness.
  view.fx.hit(v.rig.joints.Chest.getWorldPosition(new Vector3()),7,new Vector3(0,1,0),80)
  view.fx.update(.04);view.optics.update([v]);view.renderShowcase();viewer.setDirty()
  return{...view.fx.stats,severed:[...v.rig.severed],minLimbClearance,scorchVisible:view.fx.decals.some(d=>d.mesh.visible),emberVisible:view.fx.embers.some(e=>e.mesh.visible)}
 })
 await page.waitForTimeout(100);await shot('03-damage-wreck.png')
 check(report.damage.severedLimbs>0&&report.damage.scorchVisible&&report.damage.emberVisible,'High damage detaches a limb, leaves a dent and lights wreck embers')
 check(report.damage.minLimbClearance>=-.002,'Detached limb lands above the ground')
 if(process.env.ENEMIES_ART_ONLY==='1'){await page.evaluate(()=>terminator.manager.stop());await browser.close();process.exit(0)}
 // Bench the full simulation, map, HUD and weapon with 8 units of each type.
 await page.evaluate(()=>{
  const m=terminator.manager,w=m.world;m.unitView.toggleShowcase(false);m.playerView.root.visible=true;delete m.update
  m.ui.startMatch();m.ui.screens.show(null)
  for(const u of w.units){u.alive=false;u.diedAtTick=w.tick-1000}
  w.player.pos={x:0,y:0,z:-15};w.player.hp=100000;w.player.alive=true
  m.input.yaw=0;m.input.pitch=0;m.input.cursorAnchorYaw=0
  for(let i=0;i<24;i++)w.spawnUnit(['scout','endo','heavy'][i%3],{x:(i%6-2.5)*1.8,y:0,z:Math.floor(i/6)*2.2-1},{yaw:Math.PI})
  m.syncViews()
 })
 await page.waitForTimeout(2500)
 report.performance=await page.evaluate(async()=>{
  const {manager:m,world:w}=terminator,v=viewer,r=v.renderManager.webglRenderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
  const before={...m.unitView.fx.stats},times=[],renderTimes=[],calls=[],triangles=[],unitCpu=[]
  const originalSync=m.unitView.sync
  m.unitView.sync=function(...args){const start=performance.now(),result=originalSync.apply(this,args);unitCpu.push(performance.now()-start);return result}
  let start=0,frameCalls=0,frameTriangles=0
  const originalRender=r.render
  r.render=function(...args){const result=originalRender.apply(this,args);frameCalls+=this.info.render.calls;frameTriangles+=this.info.render.triangles;return result}
  const pre=()=>{frameCalls=0;frameTriangles=0;start=performance.now()}
  const post=()=>{renderTimes.push(performance.now()-start);calls.push(frameCalls);triangles.push(frameTriangles)}
  v.addEventListener('preRender',pre);v.addEventListener('postRender',post)
  let previous=performance.now(),aliveMin=24,aliveMax=24
  for(let i=0;i<360;i++)await new Promise(resolve=>requestAnimationFrame(now=>{
    times.push(now-previous);previous=now;aliveMin=Math.min(aliveMin,w.aliveUnits.length);aliveMax=Math.max(aliveMax,w.aliveUnits.length)
    if(i%12===0){const u=w.aliveUnits.find(u=>u.type==='heavy');if(u)w.damageUnit(u.id,1,{weapon:'m4',source:'player'})}
    resolve()
  }))
  v.removeEventListener('preRender',pre);v.removeEventListener('postRender',post);r.render=originalRender;m.unitView.sync=originalSync
  const summary=a=>{const s=[...a].sort((a,b)=>a-b);return{mean:a.reduce((a,b)=>a+b,0)/a.length,p50:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:s.at(-1)}}
  // Diagnostic control: same live simulation and map, hide only unit rendering.
  // It is reported separately and is never used as the 24-enemy frame time.
  const effectsAfter={...m.unitView.fx.stats}
  m.unitView.root.visible=false
  const hidden=[];let last=performance.now()
  for(let i=0;i<120;i++)await new Promise(resolve=>requestAnimationFrame(now=>{hidden.push(now-last);last=now;resolve()}))
  m.unitView.root.visible=true
  return{samples:times.length,unitUpdateMs:summary(unitCpu),unitsHiddenControlMs:summary(hidden),renderedFrames:renderTimes.length,aliveMin,aliveMax,frameMs:summary(times),cpuRenderMs:summary(renderTimes),drawCalls:summary(calls),triangles:summary(triangles),framesOver20ms:times.filter(t=>t>20).length,
    renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable',canvas:[v.canvas.width,v.canvas.height],renderScale:v.renderManager.renderScale,
    types:Object.fromEntries(['scout','endo','heavy'].map(t=>[t,w.aliveUnits.filter(u=>u.type===t).length])),effectsBefore:before,effectsAfter}
 })
 await shot('04-live-24.png')
 check(report.performance.renderedFrames>=350,'Renderer remains active throughout the measurement')
 check(report.performance.aliveMin===24&&report.performance.aliveMax===24,'Exactly 24 enemies stay alive during 360 measured frames')
 check(report.performance.canvas[0]===1920&&report.performance.canvas[1]===1080&&report.performance.renderScale===1,'Performance uses the full 1920x1080 render target')
 check(report.performance.effectsAfter.plasmaShots>report.performance.effectsBefore.plasmaShots&&report.performance.effectsAfter.minigunShots>report.performance.effectsBefore.minigunShots,'Live plasma, minigun, hit sparks and oil run during measurement')
 console.log(JSON.stringify(report.performance))
 report.cleanup=await page.evaluate(()=>{terminator.manager.stop();return{unitsRoot:Boolean(viewer.scene.getObjectByName('Units Runtime')),effectsRoot:Boolean(viewer.scene.getObjectByName('Enemy sparks oil and wreckage'))}})
 check(!report.cleanup.unitsRoot&&!report.cleanup.effectsRoot,'Stop removes unit roots and all effect pools')
 check(report.errors.length===0,'No JavaScript or renderer errors')
 await writeFile(new URL('results.json',out),JSON.stringify(report,null,2)+'\n')
 assert.ok(report.checks.every(c=>c.pass),'See results.json for failed visual assertions')
}finally{await writeFile(new URL('results.json',out),JSON.stringify(report,null,2)+'\n');await browser.close()}
