import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../helpers/editor-driver.mjs'
// Run on 4676 with --no-open. All browsers remain headless.
// node test/view/tracers-browser.mjs before <revision>
// node test/view/tracers-browser.mjs after [--burst]
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
const out='.kite3d/tracers2'
const variant=process.argv[2]||'after'
if(!['before','after'].includes(variant))throw Error('Expected before or after')
const baseline=process.argv[3]
if(variant==='before'&&!baseline)throw Error('Baseline revision required')
await mkdir(out,{recursive:true})
const sources={}
if(variant==='before')for(const file of ['tracers.js','projectiles.js','fx.js'])sources[file]=(await promisify(execFile)('git',['show',`${baseline}:lib/view/${file}`])).stdout
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4676')throw Error('Expected local weapons server on 4676')
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
const sanitize=s=>String(s).replace(/\?t=[\w.~-]+/g,'?t=[redacted]')
page.on('pageerror',e=>errors.push(sanitize(e.message)))
page.on('console',m=>{if(m.type()==='error')errors.push(sanitize(m.text()))})
try {
  await page.addInitScript(()=>{let seed=1753;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296})
  await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
  if(variant==='before')for(const file of ['tracers.js','projectiles.js','fx.js'])await page.route('**/lib/view/'+file+'*',async route=>route.fulfill({contentType:'text/javascript',body:sources[file]}))
  await page.goto(dev.url,{waitUntil:'domcontentloaded'})
  await waitForProjectLoaded(page,{timeout:30000});await runEditor(page)
  await page.waitForFunction(()=>window.terminator?.manager?.world,null,{timeout:60000})
  await page.evaluate(async()=>{
    const m=window.terminator.manager,w=m.world,viewer=window.viewer
    m.ui.menuScene?.setActive(false);m.startViews();await m.visualWarmup;await m.mapView.ready
    m.started=false;m.input.stop();m.ui.screens.show(null)
    Object.assign(viewer.container.style,{position:'fixed',left:0,top:0,width:'1920px',height:'1080px',maxWidth:'none',maxHeight:'none',zIndex:'2147483000'})
    viewer.setSize({width:1920,height:1080});viewer.resize();viewer.renderManager.renderScale=1
    w.tick=0;w.phase='wave';w.wave=5;w.player.hp=w.player.maxHp=100;w.player.armor=100
    Object.assign(w.player.pos,{x:-5,y:0,z:16});w.player.yaw=Math.PI;w.player.pitch=0;w.player.aiming=false
    // C1 owns gameplay data. These specs exist only inside this isolated visual fixture.
    w.weaponCatalog={...w.weaponCatalog,weapons:{...w.weaponCatalog.weapons,
      sniper:{id:'sniper',name:'M14 Marksman',rate:1.2,mag:10,reloadSeconds:2.6,aimFov:30},
      launcher:{id:'launcher',name:'M79 Launcher',rate:1,mag:1,reloadSeconds:2.2}}}
    for(const id of ['pistol','m4','shotgun','plasma','sniper','launcher'])w.player.ammo[id]={owned:true,mag:w.weaponCatalog.weapons[id].mag,reserve:60}
    for(const u of w.units)u.brain?.destroy?.();w.units.length=0;w.unitById.clear()
    for(let i=0;i<24;i++){
      const u=w.spawnUnit(['endo','heavy','scout'][i%3],{x:-12+(i%8)*2,y:0,z:-3-Math.floor(i/8)*2.6},{yaw:0})
      u.brain?.destroy?.();u.brain={tick(){}};u.intent.fire=false;u.vel.x=u.vel.z=0
    }
    window.pose=(ticks=1)=>{w.tick+=ticks;m.syncViews();viewer.setDirty()}
    window.select=id=>{w.player.activeWeapon=id;w.player.reloadTimer=0;w.player.aiming=false;window.pose(1);window.pose(40)}
    window.pose(1)
  })
  await page.waitForTimeout(750)
  const measurements=[]
  for(const [id,distance] of [['m4',20],['m4',40],['sniper',40]]) {
    const record=await page.evaluate(({id,distance,variant})=>{
      const m=window.terminator.manager,w=m.world,v=m.playerView.weapons
      w.projectiles=[];v.tracers.pool.reset();window.select(id)
      w.player.pitch=.28;window.pose(1);window.pose(40)
      // One real muzzle and one shot. The head is within two metres of the endpoint.
      // No zoom, debug marker, crosshair, forced glow, or extra tracer is added.
      const from=v.rigs[id].muzzle.position.clone()
      v.rigs[id].muzzle.getWorldPosition(from)
      const camera=m.playerView.camera
      const end=from.clone().set(-5,1.65+Math.sin(.28)*distance,16-Math.cos(.28)*distance)
      w.eventLog.push({type:'shot',tick:w.tick,by:w.player.id,playerId:w.player.id,weapon:id,
        origin:{x:-5,y:1.65,z:16},hitPoint:{x:end.x,y:end.y,z:end.z},hit:false})
      window.pose(0)
      const pool=v.tracers.pool,p=pool.items.find(p=>p.active)
      if((variant==='before')!==(p.style.trail===(id==='m4'?8:14)))throw Error('Wrong tracer version')
      // Advance the whole visual fixture. Both versions use the same shot age.
      window.pose(distance===20?7:15)
      camera.updateMatrixWorld(true)
      const tip=from.clone().fromArray(pool.batch.end).project(camera)
      window.viewer.setDirty()
      return {id,distance,age:p.age,eye:camera.position.toArray(),quaternion:camera.quaternion.toArray(),
        fov:camera.fov,from:p.from.toArray(),tip:tip.toArray(),start:Array.from(pool.batch.start.slice(0,3)),
        end:Array.from(pool.batch.end.slice(0,3)),active:pool.active,style:p.style}
    },{id,distance,variant})
    await page.waitForTimeout(300)
    await page.screenshot({path:`${out}/${variant}-${id}-${distance}.png`})
    measurements.push(record)
    if(variant==='after'&&id==='m4'&&distance===40) {
      await page.evaluate(()=>{window.terminator.manager.mapView.post.bloom.enabled=false;window.viewer.setDirty()})
      await page.waitForTimeout(200)
      await page.screenshot({path:`${out}/after-high-no-bloom.png`})
      await page.evaluate(()=>{window.terminator.manager.playerView.weapons.tracers.pool.batch.mesh.visible=false;window.viewer.setDirty()})
      await page.waitForTimeout(200)
      await page.screenshot({path:`${out}/after-high-empty.png`})
      await page.evaluate(()=>{window.terminator.manager.playerView.weapons.tracers.pool.batch.mesh.visible=true;window.terminator.manager.mapView.post.bloom.enabled=true;window.viewer.setDirty()})
    }
  }
  const volley=await page.evaluate(()=>{
    const m=window.terminator.manager,w=m.world
    m.playerView.weapons.tracers.pool.reset();window.select('m4');w.player.pitch=0;window.pose(40)
    w.projectiles=Array.from({length:9},(_,i)=>({id:'tracer-volley-'+i,type:i%3===0?'round':'bolt',owner:'unit',
      pos:{x:-10+i*1.2-(5-i)*.3*.4,y:4.2+(i%3)*.04,z:-4-(i%3===0?30:18)*.4},vel:{x:(5-i)*.3,y:0,z:i%3===0?30:18}}))
    window.pose(1)
    // Advance observed positions to the original twenty metre volley fixture.
    for(let t=0;t<4;t++){for(const p of w.projectiles){p.pos.x+=p.vel.x*.1;p.pos.z+=p.vel.z*.1};window.pose(6)}
    const v=m.playerView.weapons.projectiles
    return {cores:v.orbs.count,lines:v.streaks.count,positions:w.projectiles.map(p=>p.pos),ends:Array.from(v.streaks.end.slice(0,27))}
  })
  measurements.push({volley})
  await page.waitForTimeout(300)
  await page.screenshot({path:`${out}/${variant}-volley-20.png`})
  // A brighter existing HDR sky tests contrast without changing project assets.
  await page.evaluate(()=>{
    const m=window.terminator.manager,w=m.world,v=m.playerView.weapons
    v.tracers.pool.reset();w.projectiles=[];window.select('m4');w.player.pitch=.28;window.pose(40)
    window.tracerSkyIntensity=window.viewer.scene.backgroundIntensity
    window.viewer.scene.backgroundIntensity=2
    window.viewer.setDirty()
  })
  await page.waitForTimeout(300)
  await page.screenshot({path:`${out}/${variant}-sky-empty.png`})
  await page.evaluate(()=>{
    const w=window.terminator.manager.world
    w.eventLog.push({type:'shot',tick:w.tick,by:w.player.id,playerId:w.player.id,weapon:'m4',
      origin:{x:-5,y:1.65,z:16},hitPoint:{x:-5,y:1.65+Math.sin(.28)*40,z:16-Math.cos(.28)*40},hit:false})
    window.pose(0);window.pose(15)
  })
  await page.waitForTimeout(300)
  await page.screenshot({path:`${out}/${variant}-sky-shot.png`})
  await page.evaluate(()=>{window.viewer.scene.backgroundIntensity=window.tracerSkyIntensity;window.viewer.setDirty()})
  if(variant==='after') {
    const bloomCheck=await page.evaluate(async()=>{
      const m=window.terminator.manager,post=m.mapView.post
      const {applyPerformanceQuality}=await import('/files/lib/view/performance-quality.js')
      const high=post.bloom.enabled
      applyPerformanceQuality(m,'low');post.bloom.enabled=false;window.viewer.setDirty()
      return {highBloomEnabled:high,lowBloomEnabled:post.bloom.enabled,lowScale:m.performanceQuality.renderScale}
    })
    await page.waitForTimeout(300)
    await page.screenshot({path:`${out}/after-low-no-bloom.png`})
    await page.evaluate(async()=>{
      const m=window.terminator.manager
      const {applyPerformanceQuality}=await import('/files/lib/view/performance-quality.js')
      applyPerformanceQuality(m,'high');m.mapView.post.bloom.enabled=true;window.viewer.setDirty()
    })
    measurements.push({bloomCheck})
  }
  if(variant==='after'&&process.argv.includes('--burst')) {
    await mkdir(`${out}/burst`,{recursive:true})
    await page.evaluate(()=>{
      const m=window.terminator.manager,w=m.world
      m.playerView.weapons.tracers.pool.reset();window.select('m4');window.pose(40)
      window.burstNext=w.tick;window.burstShot=0
    })
    for(let frame=0;frame<40;frame++) {
      await page.evaluate(()=>{
        const w=window.terminator.manager.world
        if(w.tick>=window.burstNext) {
          const angle=window.burstShot++*2.399963
          w.eventLog.push({type:'shot',tick:w.tick,by:w.player.id,playerId:w.player.id,weapon:'m4',
            origin:{x:-5,y:1.65,z:16},hitPoint:{x:-5+Math.cos(angle)*.65,y:1.65+Math.sin(.28)*40+Math.sin(angle)*.65,z:16-Math.cos(.28)*40},hit:false})
          window.burstNext+=60/w.weaponCatalog.weapons.m4.rate
        }
        window.pose(3)
      })
      await page.screenshot({path:`${out}/burst/${String(frame).padStart(3,'0')}.png`})
    }
  }
  await stopEditor(page)
  await page.waitForFunction(()=>!window.viewer.scene.getObjectByName('Player Runtime'),null,{timeout:15000})
  const cleanup=await page.evaluate(()=>!document.querySelector('[data-testid="sniper-scope"]')&&!document.querySelector('[data-testid="weapon-screen-fx"]'))
  await writeFile(`${out}/${variant}-capture.json`,JSON.stringify({measurements,cleanup,errors},null,2)+'\n')
  console.log(JSON.stringify({variant,measurements,cleanup,errors}))
  if(errors.length||!cleanup||measurements.some(m=>m.id&&m.active!==1))throw Error('Capture validation failed')
} finally {await browser.close()}
