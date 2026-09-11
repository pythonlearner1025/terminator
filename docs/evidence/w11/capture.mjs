#!/usr/bin/env node
// From the project root: node docs/evidence/w11/capture.mjs
// Uses real World.step inputs and freezes only between frames for exact captures.
import {chromium} from 'playwright'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
const out='docs/evidence/w11'
await mkdir(out,{recursive:true})
const log=await readFile('.kite3d/w11-dev.log','utf8')
const url=log.match(/http:\/\/127\.0\.0\.1:4950\/\?t=[A-Za-z0-9._~-]+/)?.[0]
if(!url)throw Error('Start kite3d dev on port 4950 with output in .kite3d/w11-dev.log')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
const sanitize=s=>String(s).replace(/\?t=[A-Za-z0-9._~-]+/g,'?t=[redacted]')
page.on('pageerror',e=>errors.push(sanitize(e.message)))
page.on('console',m=>{if(m.type()==='error')errors.push(sanitize(m.text()))})
try {
  await page.goto(url,{waitUntil:'domcontentloaded'})
  await page.getByTestId('play').waitFor({timeout:30000})
  await page.waitForTimeout(1500)
  if(!await page.evaluate(()=>Boolean(window.terminator?.world)))await page.getByTestId('play').click()
  await page.waitForFunction(()=>Boolean(window.terminator?.manager?.playerView?.weapons),null,{timeout:30000})
  await page.evaluate(()=>{
    const m=window.terminator.manager,w=m.world
    m.ui.screens.show(null);m.started=false
    w.phase='wave';w.player.pos={x:5,y:0,z:10};w.player.yaw=Math.PI;w.player.pitch=0
    w.player.hp=100;w.player.armor=100
    for(const id of ['pistol','m4','shotgun','plasma'])w.player.ammo[id]={owned:true,mag:w.weaponCatalog.weapons[id].mag,reserve:100}
    window.w11Advance=(count,input={})=>{
      for(let i=0;i<count;i++){w.step({yaw:Math.PI,pitch:0,...input});m.cameraFeel.consume(w);m.syncViews()}
      window.viewer.setDirty()
    }
    window.w11Advance(20)
    document.exitPointerLock()
  })
  async function capture(name) {
    await page.evaluate(()=>window.viewer.setDirty())
    await page.waitForTimeout(120)
    const clip=await page.evaluate(()=>{const r=window.viewer.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
    await page.screenshot({path:`${out}/${name}.png`,clip,timeout:30000})
    return page.evaluate(()=>({...window.terminator.manager.playerView.weapons.animation.state}))
  }
  const records=[]
  for(const id of ['pistol','m4','shotgun','plasma']) {
    await page.evaluate(id=>{window.w11Advance(1,{switchTo:id});window.w11Advance(24)},id)
    records.push({file:`${id}-idle.png`,state:await capture(`${id}-idle`)})
    await page.evaluate(()=>window.w11Advance(1,{fire:true}))
    await page.evaluate(()=>window.w11Advance(1))
    records.push({file:`${id}-firing.png`,state:await capture(`${id}-firing`)})
    await page.evaluate(id=>{window.w11Advance(60);window.w11Advance(1,{reload:true});window.w11Advance(Math.round(window.terminator.world.weaponCatalog.weapons[id].reloadSeconds*60*.55))},id)
    records.push({file:`${id}-reload.png`,state:await capture(`${id}-reload`)})
    await page.evaluate(()=>window.w11Advance(180))
    console.log('captured',id)
  }
  for(const id of ['knife','grenade']) {
    // Core exposes these as quick actions, not numbered inventory slots. Equip an
    // inspection-only empty inventory entry for the requested idle reference.
    await page.evaluate(id=>{const w=window.terminator.world;w.player.ammo[id]={owned:true,mag:0,reserve:0};w.player.grenades=4;window.w11Advance(1,{switchTo:id});window.w11Advance(24)},id)
    records.push({file:`${id}-idle.png`,inspectionOnly:true,state:await capture(`${id}-idle`)})
    await page.evaluate(id=>window.w11Advance(1,id==='knife'?{melee:true}:{grenade:true}),id)
    if(id==='grenade') {
      await page.evaluate(()=>window.w11Advance(10))
      records.push({file:'grenade-pull.png',state:await capture('grenade-pull')})
      await page.evaluate(()=>window.w11Advance(15))
      records.push({file:'grenade-throw.png',state:await capture('grenade-throw')})
    } else {
      await page.evaluate(()=>window.w11Advance(5))
      records.push({file:'knife-swing.png',state:await capture('knife-swing')})
      await page.evaluate(()=>window.w11Advance(15))
      records.push({file:'knife-recovery.png',state:await capture('knife-recovery')})
    }
    await page.evaluate(()=>window.w11Advance(80))
    console.log('captured',id)
  }
  const verification=await page.evaluate(async()=>{
    const m=window.terminator.manager,w=m.world,v=m.playerView.weapons
    const checks=[]
    const assert=(name,ok,detail)=>{checks.push({name,ok,detail});if(!ok)throw Error(name+': '+JSON.stringify(detail))}
    window.w11Advance(1,{switchTo:'pistol'});window.w11Advance(90)
    const startShots=v.animation.stats.shots
    w.player.ammo.pistol.mag=0;window.w11Advance(1,{fire:true})
    assert('Dry fire produces no muzzle flash',v.animation.stats.shots===startShots)
    w.player.ammo.pistol.reserve=100;window.w11Advance(1,{reload:true})
    window.w11Advance(1,{fire:true})
    assert('Reload blocks shot presentation',v.animation.stats.shots===startShots)
    const timings=[]
    for(const id of ['pistol','m4','shotgun','plasma']) {
      window.w11Advance(1,{switchTo:id});window.w11Advance(90)
      const spec=w.weaponCatalog.weapons[id]
      w.player.ammo[id].mag=0;w.player.ammo[id].reserve=100
      window.w11Advance(1,{reload:true});const start=w.tick
      let maxPump=0,shells=0
      while(w.player.reloadTimer>0){window.w11Advance(1);shells=Math.max(shells,v.animation.state.shellsInserted)}
      const reloadTicks=w.tick-start
      assert(id+' reload finishes with core ammo',w.player.ammo[id].mag===spec.mag && v.animation.state.mode!=='reload')
      const shotsBefore=w.eventLog.filter(e=>e.type==='shot'&&e.by==='player'&&e.weapon===id).length
      const shotTicks=[]
      for(let i=0;i<Math.ceil(60/spec.rate)*3+4;i++) {
        const n=w.eventLog.length;window.w11Advance(1,{fire:true})
        if(w.eventLog.slice(n).some(e=>e.type==='shot'&&e.by==='player'&&e.weapon===id))shotTicks.push(w.tick)
        maxPump=Math.max(maxPump,v.rigs[id].pump.position.z)
      }
      const gaps=shotTicks.slice(1).map((t,i)=>t-shotTicks[i])
      assert(id+' recoil follows confirmed fire cadence',gaps.every(g=>Math.abs(g/60-1/spec.rate)<=1/60+.000001),gaps)
      if(id==='shotgun')assert('Shotgun pump and eight insertion cycles',maxPump>.10 && shells===8,{maxPump,shells})
      timings.push({id,reloadSeconds:spec.reloadSeconds,reloadTicks,expectedReloadTicks:Math.round(spec.reloadSeconds*60),shotGapsTicks:gaps,shotsBefore})
    }
    window.w11Advance(90)
    const tick=w.tick,pose=v.rigs[v.animation.shown].root.position.clone(),age=v.animation.shotAge
    m.cameraFeel.freezeUntil=performance.now()+40
    m.started=true;m.update({deltaTime:16.667});m.started=false
    assert('CameraFeel hit-stop freezes world and weapon pose',w.tick===tick&&v.animation.shotAge===age&&pose.equals(v.rigs[v.animation.shown].root.position))
    m.cameraFeel.freezeUntil=0;m.cameraFeel.kick=.035;m.playerView.sync(w);m.cameraFeel.apply(m.playerView.camera);v.beforeRender(m.playerView.camera)
    assert('Weapon responds to final CameraFeel kick',Math.abs(v.feel.rotation.x)>.001,v.feel.rotation.x)
    const fixed=v.camera.fov,original=m.playerView.camera.fov
    m.playerView.camera.fov=110;m.playerView.camera.updateProjectionMatrix();v.beforeRender(m.playerView.camera)
    assert('Viewmodel FOV stays fixed when world FOV changes',v.camera.fov===fixed&&fixed===54)
    m.playerView.camera.fov=original;m.playerView.camera.updateProjectionMatrix()
    const samples=[]
    for(let i=0;i<1200;i++) {
      w.step({yaw:Math.PI,pitch:0})
      const start=performance.now();v.sync(w);v.beforeRender(m.playerView.camera)
      if(i>=200)samples.push(performance.now()-start)
    }
    samples.sort((a,b)=>a-b)
    const cpu={samples:samples.length,medianMs:samples[Math.floor(samples.length*.5)],p95Ms:samples[Math.floor(samples.length*.95)],meanMs:samples.reduce((a,b)=>a+b,0)/samples.length}
    return {checks,timings,cpu,stats:{...v.animation.stats}}
  })
  const renderCost=await page.evaluate(async()=>{
    const m=window.terminator.manager,v=m.playerView.weapons,viewer=window.viewer
    window.w11Advance(1,{switchTo:'m4'});window.w11Advance(90)
    const renderer=viewer.renderManager.webglRenderer,gl=renderer.getContext()
    const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
    const frame=visible=>new Promise(resolve=>{
      v.root.visible=visible
      let query,start
      const before=()=>{start=performance.now();if(ext){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}}
      const after=()=>{
        const cpuMs=performance.now()-start
        if(ext)gl.endQuery(ext.TIME_ELAPSED_EXT)
        viewer.removeEventListener('preRender',before);viewer.removeEventListener('postRender',after)
        if(!ext)return resolve({cpuMs,gpuMs:null})
        const poll=()=>{
          if(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))return requestAnimationFrame(poll)
          const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT)
          const gpuMs=disjoint?null:gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6
          gl.deleteQuery(query);resolve({cpuMs,gpuMs})
        }
        requestAnimationFrame(poll)
      }
      viewer.addEventListener('preRender',before);viewer.addEventListener('postRender',after);viewer.setDirty()
    })
    for(let i=0;i<8;i++)await frame(true)
    const pairs=[]
    for(let i=0;i<32;i++) {
      // Reverse order each pair to reduce bias from other agents' GPU work.
      let visible,hidden
      if(i%2){visible=await frame(true);hidden=await frame(false)}else{hidden=await frame(false);visible=await frame(true)}
      pairs.push({visible,hidden,cpuDeltaMs:visible.cpuMs-hidden.cpuMs,gpuDeltaMs:ext?visible.gpuMs-hidden.gpuMs:null})
    }
    v.root.visible=true;viewer.setDirty()
    const summary=key=>{const a=pairs.map(p=>p[key]).filter(v=>v!==null).sort((a,b)=>a-b);return a.length?{meanMs:a.reduce((s,v)=>s+v,0)/a.length,medianMs:a[Math.floor(a.length/2)],p95Ms:a[Math.floor(a.length*.95)]}:null}
    let draws=0,triangles=0
    v.root.traverseVisible(o=>{if(o.isMesh){draws++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3}})
    return {method:'Alternating complete renderer frames with M4 visible and hidden; GPU timer queries where available',gpuTimerAvailable:!!ext,pairs,cpuSubmissionDelta:summary('cpuDeltaMs'),gpuDelta:summary('gpuDeltaMs'),draws,triangles,viewport:{width:viewer.canvas.width,height:viewer.canvas.height}}
  })
  await writeFile(`${out}/capture-results.json`,JSON.stringify({records,verification,renderCost,errors},null,2)+'\n')
  console.log(JSON.stringify({screenshots:records.length,errors},null,2))
  if(process.env.W11_HOLD)await new Promise(()=>{})
} finally {await browser.close()}
