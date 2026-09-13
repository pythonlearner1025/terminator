// Headless motion/contact proof. Requires kite3d dev --port 4680 --no-open.
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url),out=new URL('file:///Users/minjunes/games/terminator-evidence/docs/evidence/scout-gait/')
const dev=JSON.parse(await readFile(new URL('.kite3d/dev.json',root),'utf8'))
assert.equal(new URL(dev.origin).port,'4680')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
page.on('pageerror',e=>errors.push(String(e.message).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')))
try {
  await page.request.get(dev.url)
  await page.goto(dev.origin+'/files/tools/map-runtime.html')
  await page.waitForFunction(()=>window.terminator?.manager?.unitView,null,{timeout:90000})
  await page.evaluate(async()=>{
    const m=terminator.manager
    m.startViews();m.ui.screens.show(null);m.ui.applySettings({...m.ui.screens.settings,quality:'high'})
    await m.mapView.ready
    m.update=()=>true;m.input.stop();m.playerView.root.visible=false
    m.unitView.toggleShowcase(true)
    Object.assign(m.unitView.showcase,{focus:'scout',angle:1.05,cameraDistance:4.6,targetY:.68,elevation:.12})
    for(const v of m.unitView.showcase.units)v.object.visible=v.state.type==='scout'
    await m.unitView.materials.ready
  })
  await page.waitForTimeout(800)
  const report=await page.evaluate(async()=>{
    const {animateUnit,unitGround,disposeUnitRig}=await import('/files/lib/view/units-animation.js')
    const {Vector3}=await import('threepipe')
    const m=terminator.manager,w=m.world,view=m.unitView
    w.snapshot()
    const before=JSON.stringify(w.snapshot()),p=new Vector3()
    const state={id:'scout-ground-proof',type:'scout',pos:{x:0,y:0,z:0},yaw:0,vel:{x:0,z:7},alive:true,intent:{}}
    const v=view.cloneTemplateFigure(state)
    const frame=(time)=>{v.object.position.set(state.pos.x,state.pos.y,state.pos.z);v.object.rotation.y=state.yaw;animateUnit(v.rig,state,1/30,time,w.nav)}
    const measures={flat:{maxError:0,minClearance:Infinity,contacts:[0,0,0,0]},stairs:{maxError:0,minClearance:Infinity,contacts:[0,0,0,0]},ramp:{maxError:0,minClearance:Infinity,contacts:[0,0,0,0]}}
    function record(result,i){
      v.rig.scoutContacts.forEach((f,k)=>{
        if(!f.stance)return
        f.tip.getWorldPosition(p)
        const error=p.distanceTo(f.target)
        if(error>result.maxError){result.maxError=error;result.worst={i,limb:f.tip.name,pos:{...state.pos},target:f.target.toArray(),actual:p.toArray()}}
        p.copy(f.pad);f.tip.localToWorld(p)
        result.minClearance=Math.min(result.minClearance,p.y-f.ground)
        result.contacts[k]++
      })
    }
    for(let i=0;i<120;i++){state.pos.z=i*7/30;frame(i/30);if(i>10)record(measures.flat,i)}
    state.pos.x=10;state.pos.y=0;state.yaw=Math.PI;state.vel.z=-1.5
    for(const f of v.rig.scoutContacts)f.initialized=false
    for(let i=0;i<140;i++){
      state.pos.z=25.4-i*1.5/30;state.pos.y=unitGround(w.nav,10,state.pos.z,state.pos.y)
      frame(i/30);if(i>10)record(measures.stairs,i)
    }
    measures.stairs.lastHeight=state.pos.y
    state.pos.x=16.9;state.pos.y=0;state.pos.z=-5;state.yaw=Math.PI/2;state.vel.z=0;state.vel.x=1
    for(const f of v.rig.scoutContacts)f.initialized=false
    for(let i=0;i<90;i++){
      state.pos.x=16.9+i/30;state.pos.y=unitGround(w.nav,state.pos.x,-5,state.pos.y)
      frame(i/30);if(i>10)record(measures.ramp,i)
    }
    measures.ramp.lastHeight=state.pos.y
    // Only a stationary melee intent may lift the Scout. Idle remains on all fours.
    Object.assign(state.pos,{x:0,y:0,z:0});state.yaw=0;state.vel.x=state.vel.z=0
    for(const f of v.rig.scoutContacts)f.initialized=false
    for(let i=0;i<30;i++)frame(i/30)
    const idlePitch=v.rig.joints.Pelvis.rotation.x
    state.intent.melee=true
    for(let i=0;i<30;i++)frame(i/30)
    const meleePitch=v.rig.joints.Pelvis.rotation.x,meleeHandHeight=v.rig.joints['Hand Right'].getWorldPosition(p).y
    state.vel.z=7
    for(let i=0;i<30;i++){state.pos.z+=7/30;frame(i/30)}
    const chasePitch=v.rig.joints.Pelvis.rotation.x
    // Keep the core frozen while testing the real UnitView animation gate.
    const coreUnchanged=before===JSON.stringify(w.snapshot())
    const biped={}
    for(const type of ['endo','heavy']) {
      const s={id:'biped-'+type,type,pos:{x:0,y:0,z:0},yaw:0,vel:{x:0,z:1.5},alive:true,intent:{}}
      const b=view.cloneTemplateFigure(s)
      let maxError=0
      for(let i=0;i<60;i++){
        s.pos.z=i*.05;b.object.position.z=s.pos.z;animateUnit(b.rig,s,1/30,i/30,w.nav)
        for(const side of ['Left','Right']){b.rig.joints['Foot '+side].getWorldPosition(p);maxError=Math.max(maxError,p.distanceTo(b.rig.feet[side].target))}
      }
      biped[type]={maxError,pitch:b.rig.joints.Pelvis.rotation.x}
      b.object.removeFromParent();disposeUnitRig(b.rig,b.object)
    }
    const scout=w.spawnUnit('scout',{x:3,y:0,z:3},{id:'scout-clock-proof'})
    scout.vel.z=7
    const tick=w.tick,samples=[]
    for(let i=0;i<8;i++){w.tick=tick+i;scout.pos.z+=7/60;view.sync(w);samples.push(view.visuals.get(scout.id).lastAnimationTick)}
    const clockRig=view.visuals.get(scout.id).rig
    const clock={samples,pitch:clockRig.joints.Pelvis.rotation.x}
    w.units.splice(w.units.indexOf(scout),1);w.unitById.delete(scout.id);w.tick=tick
    view.sync(w)
    // 24 active Scout rigs, including four-limb IK and actuator updates, at 30 Hz.
    const fixtures=[]
    for(let i=0;i<24;i++){
      const s={id:'cost-'+i,type:'scout',pos:{x:0,y:0,z:0},yaw:0,vel:{x:0,z:7},alive:true,intent:{}}
      fixtures.push({s,v:view.cloneTemplateFigure(s)})
    }
    const costs=[]
    for(let frame=0;frame<180;frame++){
      const start=performance.now()
      for(const {s,v}of fixtures){s.pos.z=(frame%60)*7/30;v.object.position.set(s.pos.x,0,s.pos.z);animateUnit(v.rig,s,1/30,frame/30,w.nav)}
      if(frame>=30)costs.push(performance.now()-start)
    }
    costs.sort((a,b)=>a-b)
    const cost={scouts:24,animationHz:30,samples:costs.length,meanMs:costs.reduce((a,b)=>a+b,0)/costs.length,p95Ms:costs[Math.floor(costs.length*.95)]}
    for(const {v}of fixtures){v.object.removeFromParent();disposeUnitRig(v.rig,v.object)}
    v.object.removeFromParent();disposeUnitRig(v.rig,v.object)
    // The support/animation loops preceding the explicit clock fixture must be pure.
    // spawnUnit is confined to the disposable headless test World.
    return {measures,idlePitch,meleePitch,meleeHandHeight,chasePitch,clock,cost,coreUnchanged,biped}
  })
  for(const [name,mode]of [['gallop-mid-stride.png','gallop'],['melee-rise.png','melee']]) {
    await page.evaluate(async mode=>{
      const {animateUnit}=await import('/files/lib/view/units-animation.js')
      const view=terminator.manager.unitView,show=view.showcase,v=show.units.find(v=>v.state.type==='scout'),s=v.state
      for(const other of show.units)other.object.visible=other===v
      s.vel.z=mode==='gallop'?7:0;s.intent.melee=mode==='melee'
      for(let i=0;i<40;i++)animateUnit(v.rig,s,1/30,i/30)
      Object.assign(show,{angle:mode==='gallop'?1.05:.65,targetY:mode==='gallop'?.52:.8,cameraDistance:mode==='gallop'?2.8:3.5})
      viewer.scene.mainCamera.fov=35;viewer.scene.mainCamera.updateProjectionMatrix()
      show.backdrop.receiveShadow=true
      for(const light of show.stage.children)if(light.isDirectionalLight){
        light.intensity=light.position.y>3?1.5:1
        if(light.position.y>3){light.castShadow=true;light.shadow.mapSize.set(1024,1024);light.shadow.camera.left=-3;light.shadow.camera.right=3;light.shadow.camera.top=3;light.shadow.camera.bottom=-3;light.shadow.camera.updateProjectionMatrix()}
      }
      view.optics.update(show.units)
      viewer.setDirty()
    },mode)
    await page.waitForTimeout(100)
    await page.screenshot({path:new URL(name,out).pathname})
  }
  report.errors=errors
  await writeFile(new URL('.kite3d/scout-proof.json',root),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
  for(const [name,result]of Object.entries(report.measures)){
    assert.ok(result.maxError<.035,`${name} contact error ${result.maxError}`)
    assert.ok(result.minClearance>-.012,`${name} pad clearance ${result.minClearance}`)
    assert.ok(result.contacts.every(n=>n>0),`${name} uses every limb`)
  }
  assert.ok(report.idlePitch>1.1&&report.chasePitch>1.1,'only melee raises the torso')
  assert.ok(report.meleePitch<.45&&report.meleeHandHeight>.3,'melee raises torso and striking hand')
  assert.ok(report.clock.pitch>.7,'new Scout passes the animation gate')
  for(const result of Object.values(report.biped)){assert.ok(result.maxError<.025);assert.ok(Math.abs(result.pitch)<.05)}
  assert.equal(report.coreUnchanged,true,'animation and grounding leave core state untouched')
  assert.equal(errors.length,0)
} finally {await browser.close()}
