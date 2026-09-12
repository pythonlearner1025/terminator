// Run from the project root with port 4630 running. Headless only.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
const out='docs/evidence/pass-weapons'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4630')throw Error('Expected weapons server on port 4630')
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const errors=[]
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const sanitize=s=>s.replace(/\?t=[\w.~-]+/g,'?t=[redacted]')
page.on('pageerror',e=>{errors.push(sanitize(e.message));console.log('Browser error:',sanitize(e.message))})
page.on('console',m=>{if(m.type()==='error')errors.push(sanitize(m.text()))})
try {
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').waitFor({timeout:30000});await page.waitForTimeout(700)
 if(!await page.evaluate(()=>window.terminator?.world))await page.getByTestId('play').click()
 await page.waitForFunction(()=>window.terminator?.world,null,{timeout:30000})
 await page.evaluate(()=>{
  const m=window.terminator.manager,w=m.world;m.startViews();m.started=false;m.ui.screens.show(null)
  const c=window.viewer.canvas;c.style.cssText+=';position:fixed;left:0;top:0;width:1920px;height:1080px;z-index:500;'
  document.querySelector('[data-testid="terminator-hud"]')?.style.setProperty('z-index','600')
  m.playerView.weapons.screenFx.root.style.zIndex=550
  w.phase='wave';w.player.pos={x:5,y:0,z:10};w.player.yaw=Math.PI;w.player.pitch=0;w.player.armor=100
  for(const id of ['pistol','m4','shotgun','plasma'])w.player.ammo[id]={owned:true,mag:w.weaponCatalog.weapons[id].mag,reserve:200}
  window.advance=(count,input={})=>{for(let i=0;i<count;i++){w.step({yaw:Math.PI,pitch:0,...input});m.cameraFeel.consume(w);m.syncViews()}window.viewer.setDirty()}
  window.advance(30)
 })
 await page.waitForFunction(()=>{const m=window.terminator.manager.playerView.weapons.material;return ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].every(k=>m[k]?.image?.width===2048)},null,{timeout:45000})
 await page.evaluate(()=>window.viewer.setDirty())
 await page.waitForTimeout(300)
 const checks=await page.evaluate(async()=>{
  const m=window.terminator.manager,w=m.world,v=m.playerView.weapons,checks=[]
  const assert=(name,ok)=>{checks.push({name,ok});if(!ok)throw Error(name)}
  const authority=()=>JSON.stringify({tick:w.tick,player:w.player,units:w.units,events:w.eventLog,rng:w.rng,telemetry:w.telemetry,replay:w.replay})
  const saved=authority();v.sync(w);v.beforeRender(m.playerView.camera)
  assert('Presentation does not change authoritative state',authority()===saved)
  for(const id of ['pistol','m4','shotgun','plasma']){
   window.advance(1,{switchTo:id});window.advance(90)
   const old=v.animation.stats.shots;w.player.ammo[id].mag=0;window.advance(1,{fire:true})
   assert(`${id}: empty trigger does not flash`,v.animation.stats.shots===old)
   window.advance(1,{reload:true});window.advance(1,{fire:true})
   assert(`${id}: reload blocks flash`,v.animation.stats.shots===old)
   let maxSlide=0,maxPump=0
   while(w.player.reloadTimer>0){window.advance(1);maxSlide=Math.max(maxSlide,v.rigs[id].slide.position.z)}
   assert(`${id}: reload completes with core ammo`,w.player.ammo[id].mag===w.weaponCatalog.weapons[id].mag)
   window.advance(1,{aim:true});window.advance(16,{aim:true})
   assert(`${id}: sights align to center ray`,Math.abs(v.rigs[id].root.position.x)<.005&&Math.abs(v.rigs[id].root.position.y+v.rigs[id].sight.height)<.005)
   window.advance(1,{fire:true});v.beforeRender(m.playerView.camera)
   assert(`${id}: flash lights the hands and scene`,v.material.userData.weaponFlash.power.value>0&&v.worldFx.light.intensity>0)
   if(id==='plasma')assert('Plasma drives screen refraction',v.screenFx.uniforms.weaponHeatCount.value>0)
   const events=w.eventLog.length
   const flashes=v.animation.stats.shots;v.sync(w);v.sync(w)
   assert(`${id}: event consumed once`,v.animation.stats.shots===flashes&&w.eventLog.length===events)
   for(let i=0;i<65;i++){window.advance(1);maxPump=Math.max(maxPump,v.rigs[id].pump.position.z)}
   if(id==='shotgun')assert('Shotgun pump cycles',maxPump>.1)
  }
  window.advance(1,{switchTo:'pistol'});window.advance(90)
  const pool=v.worldFx.pools.brass
  let bounces=0;const onSound=v.worldFx.onSound;v.worldFx.onSound=(kind,...args)=>{if(kind==='shell-bounce')bounces++;onSound?.(kind,...args)}
  window.advance(1,{fire:true});window.advance(240)
  assert('World brass bounces and emits sound hook',bounces>0)
  const explosions=v.worldFx.stats.explosions;w.player.grenades=1;window.advance(1,{grenade:true})
  assert('Explosion rendered on the authoritative event tick',v.worldFx.stats.explosions===explosions+1)
  assert('Blast flashes and shockwave emitted',v.worldFx.pools.blast.active>0&&v.worldFx.pools.rings.active>0)
  window.advance(61)
  const oldHoles=v.worldFx.stats.wallImpacts
  window.advance(1,{fire:true,pitch:-.25});window.advance(30,{pitch:-.25})
  assert('Wall shot creates persistent decal',v.worldFx.stats.wallImpacts>oldHoles&&v.worldFx.pools.holes.items.some(p=>p.life>85))
  w.damagePlayer(75,{pos:{x:w.player.pos.x+2,y:0,z:w.player.pos.z},type:'scout'});w.player.hp=25;window.advance(1)
  assert('Low health desaturates the canvas',window.viewer.canvas.style.filter.includes('saturate'))
  assert('Damage direction shows',Number(v.screenFx.direction.style.opacity)>.1)
  w.player.hp=100;window.advance(90)
  assert('Healing restores canvas color',window.viewer.canvas.style.filter===v.screenFx.savedFilter)
  assert('PBR maps loaded at 2048', ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].every(k=>v.material[k]?.image?.width===2048))
  const target=w.spawnUnit('scout',{x:20,y:0,z:20})
  w.damageUnit(target.id,target.hp,{source:'player',playerId:w.player.id,weapon:'pistol',headshot:true})
  m.cameraFeel.consume(w);const tick=w.tick;m.started=true;m.update({deltaTime:16.67});m.started=false
  assert('Headshot hit-stop remains 40ms and freezes updates',m.cameraFeel.hitStopped&&w.tick===tick)
  m.cameraFeel.freezeUntil=0
  return checks
 })
 console.log(JSON.stringify({checks:checks.length,passed:checks.every(c=>c.ok)}))
 if(!process.env.NO_CAPTURE){
  await page.evaluate(()=>{window.addTarget=()=>{const w=window.terminator.world;w.player.hp=100;w.player.alive=true;w.player.armor=100;const u=w.units.find(u=>u.alive&&u.type==='endo')||w.spawnUnit('endo',{x:5,y:0,z:3});u.pos={x:5,y:0,z:3};u.hp=10000;window.terminator.manager.unitView.sync(w)}})
  const capture=async name=>{await page.evaluate(()=>window.viewer.setDirty());await page.waitForTimeout(180);await page.screenshot({path:`${out}/${name}.png`})}
  await page.evaluate(()=>{window.advance(1,{switchTo:'pistol'});window.advance(120);window.advance(1,{fire:true});window.advance(30);window.advance(1,{reload:true});window.advance(40)})
  await capture('01-pistol-reload')
  await page.evaluate(()=>{window.advance(180);window.advance(1,{switchTo:'m4'});window.advance(90);window.addTarget();window.advance(1,{fire:true})})
  await capture('02-m4-fire')
  await page.evaluate(()=>{window.advance(90);window.advance(1,{switchTo:'shotgun'});window.advance(90);window.addTarget();window.advance(1,{fire:true});window.advance(18)})
  await capture('03-shotgun-pump')
  await page.evaluate(()=>{window.advance(90);window.advance(1,{switchTo:'plasma'});window.advance(90);window.addTarget();window.advance(1,{fire:true})})
  await capture('04-plasma-fire')
  await page.evaluate(()=>{window.advance(90);const w=window.terminator.world;w.player.grenades=1;w.player.hp=100;w.player.alive=true;window.advance(1,{grenade:true});window.advance(5)})
  await capture('05-grenade-explosion')
 }
 await page.getByTestId('play').evaluate(button=>button.click())
 await page.waitForFunction(()=>!window.viewer.scene.getObjectByName('Player Runtime'),null,{timeout:10000})
 const cleanup=await page.evaluate(()=>({weaponRootRemoved:!window.viewer.scene.getObjectByName('Player Runtime'),screenRemoved:!document.querySelector('[data-testid="weapon-screen-fx"]'),filterRestored:window.viewer.canvas.style.filter===''}))
 if(Object.values(cleanup).some(v=>!v))throw Error('Cleanup failed: '+JSON.stringify(cleanup))
 await writeFile(`${out}/verification.json`,JSON.stringify({checks,cleanup,errors},null,2)+'\n')
 if(errors.length)throw Error(`${errors.length} browser errors: ${errors.slice(0,3).join('; ')}`)
 console.log(JSON.stringify({cleanup,errors}))
}catch(error){console.log(JSON.stringify({errors,state:await page.evaluate(()=>({world:!!window.terminator?.world,body:document.body.innerText.slice(-1600)})).catch(()=>null)}));throw error}finally{await browser.close()}
