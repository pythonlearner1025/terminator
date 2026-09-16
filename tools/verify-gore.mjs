// Headless only. Event fixtures carry the agreed core fields pending C1 merge.
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url),out=new URL('file:///Users/minjunes/games/terminator-evidence/docs/evidence/gore/')
const dev=JSON.parse(await readFile(new URL('.kite3d/dev.json',root),'utf8'))
assert.equal(new URL(new URL(dev.url).origin).port,'4720')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
page.on('pageerror',e=>errors.push(e.message))
page.on('console',m=>{if(m.type()==='error')errors.push(m.text().replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]'))})
try {
  await page.request.get(dev.url)
  await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:90000})
  const warmup=await page.evaluate(async()=>{
    const m=terminator.manager
    m.ui.menuScene.setActive(false);m.startViews();await m.visualWarmup;m.ui.screens.show(null)
    m.hud.root.style.visibility='hidden';m.ui.applySettings({...m.ui.screens.settings,quality:'high'})
    await m.mapView.ready;await m.unitView.fx.gore.ready
    m.update=()=>true;m.input.stop();m.playerView.root.visible=false
    const E=await import('threepipe');window.E=E
    window.goreCamera=(pos,target)=>{
      const camera=viewer.scene.mainCamera;camera.controlsMode='';camera.autoLookAtTarget=false
      camera.position.set(...pos);camera.lookAt(...target);camera.updateMatrixWorld(true);viewer.setDirty()
    }
    window.spawnGore=(id,pos,type='endo')=>{
      const u=m.world.spawnUnit(type,pos,{id,yaw:0});u.brain?.destroy?.();u.brain={tick(){}}
      m.unitView.sync(m.world);return u
    }
    window.advanceGore=ticks=>{for(let i=0;i<ticks;i++){m.world.tick++;m.unitView.sync(m.world)}viewer.setDirty()}
    window.clearGore=()=>{
      m.unitView.ragdolls.reset()
      for(const [id,v]of m.unitView.visuals)m.unitView.recycleVisual(id,v,v.unitType)
      m.unitView.fx.reset();m.world.units.length=0;m.world.unitById.clear()
    }
    window.goreEvent=(unit,{weapon='sniper',part='Head',amount=unit.hp,kill=true,headshot=false,direction={x:.2,y:.06,z:-1}}={})=>{
      const v=m.unitView.visuals.get(unit.id),b=v.rig.joints[part]||v.rig.joints.Chest
      const pos=b.getWorldPosition(new E.Vector3());pos.z+=part==='Head'?.125:.06;if(part==='Head')pos.y+=.055
      if(part.startsWith('Thigh'))pos.y-=.16
      const first=m.world.eventLog.length
      m.world.damageUnit(unit.id,kill?unit.hp:amount,{source:'player',playerId:m.world.player.id,weapon,headshot})
      for(let i=first;i<m.world.eventLog.length;i++){
        const event=m.world.eventLog[i]
        if(event.type==='unit_damage'||event.type==='kill')Object.assign(event,{part,pos:pos.toArray().reduce((o,x,i)=>(o[['x','y','z'][i]]=x,o),{}),direction,normal:{x:-direction.x,y:-direction.y,z:-direction.z}})
      }
      m.unitView.sync(m.world);return v
    }
    const report=m.visualWarmupReport?.deathPath
    if(!report?.skullCrunch||!report?.limb||!report?.torsoSplit||!report?.dent)throw new Error('Warmup missed gore coverage: '+JSON.stringify(report))
    if(m.unitView.ragdolls.records.size)throw new Error('Warmup left physics records')
    Object.assign(m.world.player.pos,{x:4,y:0,z:12})
    return report
  })
  const head=await page.evaluate(()=>{
    const u=spawnGore('gore-head',{x:4,y:0,z:8}),v=goreEvent(u,{headshot:true,direction:{x:-.45,y:.05,z:-1}})
    advanceGore(2)
    const crunch=v.gore.crunch
    if(!crunch||crunch.progress<=0||crunch.progress>=1)throw new Error('Missing intermediate skull crunch')
    const midProgress=crunch.progress
    if(v.rig.eyes.visible)throw new Error('Skull optics stayed on')
    advanceGore(6)
    const pieces=terminator.manager.unitView.fx.gore.pieces.items
    const piece=pieces.find(p=>p.record&&p.mesh.name==='Detached Head')
    if(!piece||!v.rig.severed.has('Head'))throw new Error('Head did not detach after crunch')
    if(v.ragdoll.parts.some(p=>p.bone.name==='Head'))throw new Error('Detached head still has a ragdoll constraint')
    goreCamera([4.65,2.1,9.1],[3.95,1.57,7.8])
    return {midProgress,vertices:crunch.count,spin:piece.record.parts[0].body.angularVelocity.length(),headPosition:piece.mesh.position.toArray()}
  })
  await page.waitForTimeout(500)
  await page.screenshot({path:new URL('skull-crunch.png',out).pathname})
  const limb=await page.evaluate(()=>{
    clearGore()
    const u=spawnGore('gore-limb',{x:7,y:0,z:8})
    const before=JSON.stringify(u.pos),v=goreEvent(u,{part:'Thigh Left',amount:u.maxHp*.6,kill:false,direction:{x:-.9,y:.18,z:-.2}})
    advanceGore(12)
    if(!u.alive||!v.rig.states.has('crawl'))throw new Error('Leg loss did not enter living crawl: '+JSON.stringify({alive:u.alive,hp:u.hp,maxHp:u.maxHp,severed:[...v.rig.severed],states:[...v.rig.states],events:terminator.manager.world.eventLog.slice(-3)}))
    if(JSON.stringify(u.pos)!==before)throw new Error('Crawl changed core movement')
    goreCamera([5.4,1.1,9.75],[6.45,.8,7.9])
    return {alive:u.alive,crawl:v.rig.crawl,severed:[...v.rig.severed],pelvisY:v.rig.joints.Pelvis.getWorldPosition(new E.Vector3()).y}
  })
  await page.waitForTimeout(500)
  await page.screenshot({path:new URL('limb-fluid.png',out).pathname})
  const split=await page.evaluate(()=>{
    clearGore()
    const u=spawnGore('gore-blast',{x:10,y:0,z:8},'heavy'),v=goreEvent(u,{part:'Chest',weapon:'grenade',direction:{x:.45,y:.16,z:-.8}})
    advanceGore(15)
    const chest=v.rig.joints.Chest.getWorldPosition(new E.Vector3()),pelvis=v.rig.joints.Pelvis.getWorldPosition(new E.Vector3())
    if(!v.rig.goreSplit||!v.gore.split)throw new Error('Blast did not split torso')
    if(v.ragdoll.constraints.some(c=>{
      const a=v.ragdoll.parts.find(p=>p.body===c.bodyA)?.bone.name,b=v.ragdoll.parts.find(p=>p.body===c.bodyB)?.bone.name
      return a==='Pelvis'&&b==='Chest'
    }))throw new Error('Waist constraint survived blast')
    goreCamera([12.1,1.75,11.1],[10.3,1.55,7.1])
    return {severed:[...v.rig.severed],torsoGap:chest.distanceTo(pelvis),constraints:v.ragdoll.constraints.length}
  })
  await page.waitForTimeout(500)
  await page.screenshot({path:new URL('explosion-split.png',out).pathname})
  const proof=await page.evaluate(()=>{
    const m=terminator.manager,g=m.unitView.fx.gore,r=m.unitView.ragdolls
    // Core state remains byte-identical during isolated visual updates.
    m.world.snapshot();const before=JSON.stringify(m.world.snapshot())
    for(let i=0;i<120;i++){r.update(1/60);g.update(1/60,m.world.nav)}
    if(before!==JSON.stringify(m.world.snapshot()))throw new Error('Gore changed deterministic state')
    const records=[...r.records]
    for(const record of records)r.freeze(record)
    const wreck=m.unitView.visuals.get('gore-blast'),surface=wreck.rig.pickParts.find(p=>p.bone.name==='Chest')
    const a=new E.Vector3(),b=new E.Vector3(),c=new E.Vector3(),normal=new E.Vector3(),edge=new E.Vector3(),center=new E.Vector3(),origin=new E.Vector3(),direction=new E.Vector3()
    const active=r.active.length,hits=g.stats.wreckHits
    for(let i=0;i<surface.triangles.length&&g.stats.wreckHits===hits;i+=9){
      a.fromArray(surface.triangles,i);b.fromArray(surface.triangles,i+3);c.fromArray(surface.triangles,i+6)
      normal.copy(b).sub(a).cross(edge.copy(c).sub(a)).normalize().transformDirection(surface.bone.matrixWorld)
      if(normal.y<.6)continue
      center.copy(a).add(b).add(c).multiplyScalar(1/3).applyMatrix4(surface.bone.matrixWorld)
      origin.copy(center).addScaledVector(normal,.6);direction.copy(normal).negate()
      g.hitWrecks({origin},m.unitView.visuals,{yaw:Math.atan2(direction.x,direction.z),pitch:Math.asin(direction.y)})
    }
    if(g.stats.wreckHits!==hits+1||r.active.length!==active)throw new Error('Frozen wreck reaction failed or restarted physics')
    const piece=g.pieces.items.find(p=>p.record),record=piece.record
    record.settledAt=r.clock-179;r.update(0)
    if(!piece.mesh.visible||piece.mesh.material.opacity!==1)throw new Error('Early piece fade')
    record.settledAt=r.clock-181;r.update(0)
    if(Math.abs(piece.mesh.material.opacity-.5)>.001)throw new Error('Piece fade failed')
    record.settledAt=r.clock-182.1;r.update(0)
    if(piece.record||piece.mesh.visible)throw new Error('Piece expiry failed')
    const result={coreUnchanged:true,lifetime:true,frozenWreckShot:true,stains:g.stats.stains,pieceCapacity:g.pieces.items.length,
      deformationCap:g.stats.maxVertices,activePieces:r.activeCount('limb'),stats:{...g.stats}}
    clearGore()
    for(let i=0;i<8;i++){
      const u=spawnGore('cost-'+i,{x:3+(i%4)*1.4,y:3,z:7-Math.floor(i/4)*2})
      goreEvent(u,{weapon:'m4',part:'Chest'})
    }
    const source=m.unitView.cloneTemplateFigure({id:'cost-pieces',type:'endo',pos:{x:4,y:4,z:8},yaw:0})
    const velocity=new E.Vector3(.3,.1,-.7)
    for(let i=0;i<24;i++){
      source.rig.joints['Forearm Left'].scale.setScalar(1);source.rig.severed.clear()
      source.object.position.set(3+(i%6)*.4,3+Math.floor(i/6)*.3,7);source.object.updateMatrixWorld(true)
      g.detach(source,'Forearm Left',velocity,0)
    }
    source.object.visible=false;m.unitView.visualPool.endo.push(source)
    const identities=g.pieces.items.map(item=>item.mesh.geometry),samples=[],physics=[],effects=[]
    m.world.snapshot();const unchanged=JSON.stringify(m.world.snapshot())
    for(let i=0;i<90;i++){
      const all=r.activeCount('unit')===8&&r.activeCount('limb')===24
      const start=performance.now();r.update(1/60);const middle=performance.now();g.update(1/60,m.world.nav);const end=performance.now()
      if(all){samples.push(end-start);physics.push(middle-start);effects.push(end-middle)}
    }
    if(samples.length<30)throw new Error('Insufficient samples with all pieces awake')
    if(JSON.stringify(m.world.snapshot())!==unchanged)throw new Error('Microbenchmark changed core state')
    if(g.pieces.items.some((item,i)=>item.mesh.geometry!==identities[i]))throw new Error('Piece geometry changed after warmup')
    const mean=xs=>xs.reduce((sum,v)=>sum+v,0)/xs.length,sorted=samples.sort((a,b)=>a-b)
    result.activeBudget={samples:samples.length,ragdolls:8,pieces:24,meanMs:mean(samples),p95Ms:sorted[Math.floor(sorted.length*.95)],maxMs:sorted.at(-1),physicsMeanMs:mean(physics),goreMeanMs:mean(effects),stableGeometries:true}
    m.stop();result.cleanup={bodies:r.world.bodies.length,records:r.records.size,root:Boolean(viewer.scene.getObjectByName('Pooled machine gore'))}
    return result
  })
  assert.equal(proof.cleanup.bodies,0);assert.equal(proof.cleanup.records,0);assert.equal(proof.cleanup.root,false)
  const result={warmup,head,limb,split,proof,errors:[...new Set(errors)]}
  await writeFile('/tmp/terminator-gore-proof.json',JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2));assert.deepEqual(result.errors,[])
}finally{await browser.close()}
