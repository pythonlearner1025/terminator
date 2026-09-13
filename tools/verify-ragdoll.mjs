// Headless-only visual and lifetime proof on the assigned worktree server.
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url),out=new URL('file:///Users/minjunes/games/terminator-evidence/docs/evidence/ragdoll/')
const dev=JSON.parse(await readFile(new URL('.kite3d/dev.json',root),'utf8'))
assert.equal(new URL(dev.origin).port,'4670')
const captureScreenshots=process.argv.includes('--screenshots')
if(captureScreenshots)await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[],knownMenuWarnings=[]
const redact=s=>String(s).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
const report=(message,url='')=>{
  // This existing menu-only path is outside the pass. Keep its diagnostics in
  // the result while continuing to fail on every other resource or JS error.
  const target=url.endsWith('/files/lib/assets/textures/units/studio_small_09_1k.hdr')?knownMenuWarnings:errors
  target.push(redact(message))
}
page.on('response',r=>{if(r.status()>=400)report('HTTP '+r.status()+' '+r.url(),r.url())})
page.on('pageerror',e=>errors.push(redact(e.message)))
page.on('console',e=>{if(['warning','error'].includes(e.type()))report(e.text(),e.location().url)})
try {
  await page.request.get(dev.url)
  await page.goto(dev.origin+'/files/tools/map-runtime.html')
  await page.waitForFunction(()=>window.terminator?.manager?.unitView,null,{timeout:90000})
  await page.waitForFunction(()=>terminator.manager.ui.screens.route==='main',null,{timeout:90000})
  await page.evaluate(async()=>{
    const m=terminator.manager
    m.ui.menuScene.setActive(false);m.startViews();await m.visualWarmup;m.ui.screens.show(null);m.hud.root.style.visibility='hidden';m.ui.applySettings({...m.ui.screens.settings,quality:'high'})
    await m.mapView.ready
    const warmup=m.visualWarmupReport?.deathPath
    if(warmup?.ragdolls!==1||warmup?.detachedLimbs!==1||warmup?.fixedLimbMeshes!==12)throw new Error(`Death warmup proof failed: ${JSON.stringify(warmup)}`)
    if(m.unitView.ragdolls.records.size||m.unitView.ragdolls.world.constraints.length)throw new Error('Death warmup did not reset ragdoll records')
    m.update=()=>true;m.input.stop();m.playerView.root.visible=false
    await m.unitView.materials?.ready
    window.ragdollCamera=(pos,target)=>{
      const camera=viewer.scene.mainCamera
      camera.controlsMode='';camera.autoLookAtTarget=false;camera.position.set(...pos);camera.lookAt(...target);camera.updateMatrixWorld(true);viewer.setDirty()
    }
    window.spawnEvidence=(id,pos,type='endo')=>{
      const u=m.world.spawnUnit(type,pos,{id,yaw:Math.PI})
      u.brain?.destroy?.();u.brain={tick(){}};return u
    }
    window.advanceWreck=(ticks)=>{
      for(let i=0;i<ticks;i++){m.world.tick++;m.unitView.sync(m.world)}
      viewer.setDirty()
    }
    const w=m.world
    Object.assign(w.player.pos,{x:4,y:0,z:12});w.player.yaw=Math.PI;w.player.pitch=-.1
    w.player.activeWeapon='shotgun'
    w.player.ammo.shotgun={mag:8,reserve:48,owned:true};w.phase='wave'
    const u=spawnEvidence('shotgun-proof',{x:4,y:0,z:8.5});u.hp=24
    advanceWreck(8)
    window.shotgunProofId=u.id
    w.step({yaw:Math.PI,pitch:-.1,fire:true});m.unitView.sync(w)
    if(u.alive)throw new Error('The actual shotgun pellets did not kill the fixture')
    advanceWreck(16)
    ragdollCamera([6,1.4,4.5],[4,1.05,7.1])
  })
  await page.waitForTimeout(800)
  if(captureScreenshots)await page.screenshot({path:new URL('shotgun-midair.png',out).pathname})
  const shot=await page.evaluate(()=>{
    const v=terminator.manager.unitView.visuals.get(shotgunProofId)
    return {active:v.ragdoll.settledAt===null,weapon:v.impact.weapon,bodies:v.ragdoll.parts.length,head:v.rig.joints.Head.getWorldPosition(v.object.position.clone()).toArray()}
  })
  assert.equal(shot.weapon,'shotgun');assert.equal(shot.active,true)
  const stairs=await page.evaluate(()=>{
    const m=terminator.manager,w=m.world
    const units=[]
    for(const [i,pos] of [{x:9.35,y:1,z:23.5},{x:10.65,y:2,z:21.5},{x:9.4,y:3,z:19.5}].entries()) {
      const u=spawnEvidence('stair-proof-'+i,pos,i===1?'heavy':'endo');units.push(u)
    }
    advanceWreck(8)
    for(const u of units){w.damageUnit(u.id,2000,{weapon:'rifle'});m.unitView.sync(w)}
    advanceWreck(840)
    ragdollCamera([10,7.4,23.5],[10,1.6,22.1])
    return units.map(u=>{
      const v=m.unitView.visuals.get(u.id)
      return {id:u.id,settled:v.ragdoll.settledAt!==null,pelvis:v.rig.joints.Pelvis.getWorldPosition(v.object.position.clone()).toArray()}
    })
  })
  await page.waitForTimeout(400)
  if(captureScreenshots)await page.screenshot({path:new URL('stairs-settled.png',out).pathname})
  assert.ok(stairs.every(s=>s.settled))
  const proof=await page.evaluate(async()=>{
    const m=terminator.manager,w=m.world,view=m.unitView
    const {Vector3}=await import('threepipe')
    const {animateUnit}=await import('/files/lib/view/units-animation.js')
    // Timed physics and bone synchronization on the full shipping rigs. Each
    // batch starts with eight awake wrecks, then runs 120 fixed view frames.
    const costs=[],births=[],activeCounts=[]
    for(let batch=0;batch<4;batch++) {
      for(const record of [...view.ragdolls.records])view.ragdolls.release(record)
      const records=[]
      for(let i=0;i<8;i++) {
        const state={id:`cost-${batch}-${i}`,type:['scout','endo','heavy'][i%3],pos:{x:3+(i%4)*1.8,y:1,z:6-Math.floor(i/4)*2},yaw:0,vel:{x:0,y:0,z:1},alive:true,intent:{}}
        const v=view.cloneTemplateFigure(state)
        for(let j=0;j<10;j++)animateUnit(v.rig,state,1/30,j/30,w.nav)
        const start=performance.now()
        const record=view.ragdolls.add(v,state,{weapon:'shotgun',direction:new Vector3(.1,0,-1),point:new Vector3(state.pos.x,2,state.pos.z)},()=>{view.fx.release(v);v.object.removeFromParent();view.visualPool[state.type].push(v)})
        births.push(performance.now()-start);records.push(record)
      }
      w.snapshot();const before=JSON.stringify(w.snapshot())
      for(let frame=0;frame<120;frame++) {
        const active=view.ragdolls.active.filter(r=>r.kind==='unit').length
        const start=performance.now();view.ragdolls.update(1/60);const cost=performance.now()-start
        if(active===8){costs.push(cost);activeCounts.push(active)}
      }
      if(before!==JSON.stringify(w.snapshot()))throw new Error('Visual physics changed the core snapshot')
    }
    const sorted=costs.sort((a,b)=>a-b),mean=a=>a.reduce((s,v)=>s+v,0)/a.length
    // Cross the real settled lifetime boundaries with a corpse still retained
    // by the core. Its fatal damage also exercises detached limb expiry.
    for(const record of [...view.ragdolls.records])view.ragdolls.release(record)
    const lifetime=spawnEvidence('lifetime-proof',{x:5,y:0,z:8});advanceWreck(3)
    w.damageUnit(lifetime.id,2000,{weapon:'rifle'});view.sync(w);advanceWreck(900)
    const wreck=view.visuals.get(lifetime.id),record=wreck.ragdoll
    if(record.settledAt===null)throw new Error('Lifetime fixture did not settle')
    advanceWreck(Math.max(0,Math.floor((record.settledAt+179-view.ragdolls.clock)*60)))
    if(!view.visuals.has(lifetime.id)||wreck.rig.mesh.material.opacity!==1)throw new Error('Wreck faded before three minutes')
    advanceWreck(120)
    if(wreck.rig.mesh.material.opacity<.45||wreck.rig.mesh.material.opacity>.55)throw new Error('Wreck did not fade over two seconds')
    advanceWreck(65)
    if(view.visuals.has(lifetime.id)||view.visuals.has(shotgunProofId)||view.fx.bodies.some(body=>body.record))throw new Error('Expired corpse or detached limb remained')
    // Pooled rigs restore severed scales and start clean on a later spawn.
    const u=spawnEvidence('recycled-proof',{x:5,y:0,z:8});advanceWreck(3)
    const v=view.visuals.get(u.id)
    if(v.ragdoll||v.rig.severed.size||v.rig.joints['Forearm Left'].scale.x<.9)throw new Error('Recycled rig retained dead state')
    return {samples:costs.length,activeRagdolls:Math.min(...activeCounts),meanMs:mean(costs),p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),meanSpawnMs:mean(births),coreUnchanged:true,lifetimeAndReuse:true}
  })
  assert.equal(proof.activeRagdolls,8);assert.ok(proof.samples>=100)
  const cleanup=await page.evaluate(()=>{
    const m=terminator.manager,physics=m.unitView.ragdolls
    m.stop()
    return {bodies:physics.world.bodies.length,constraints:physics.world.constraints.length,records:physics.records.size,runtimeRoot:Boolean(viewer.scene.getObjectByName('Units Runtime'))}
  })
  assert.deepEqual(cleanup,{bodies:0,constraints:0,records:0,runtimeRoot:false})
  const result={shot,stairs,physics:proof,cleanup,knownMenuWarnings,errors:[...new Set(errors)]}
  await writeFile('/tmp/terminator-ragdoll-proof.json',JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
  assert.deepEqual(result.errors,[])
} finally {await browser.close()}
