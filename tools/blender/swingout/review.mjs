import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../../../test/helpers/editor-driver.mjs'
// Record the real GameManager and WeaponView. No lab UI or authored-clip override.
import {chromium} from 'playwright'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
const round=process.env.SWINGOUT_ROUND||'baseline'
const folder=`tools/blender/swingout/rounds/${round}-game`
await mkdir(folder,{recursive:true})
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const browser=await chromium.launch({headless:true,args:['--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--no-sandbox','--autoplay-policy=no-user-gesture-required']})
const errors=[],rows=[]
try{
 const page=await browser.newPage({viewport:{width:1920,height:900}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await runEditor(page,{timeout:120000})
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:120000})
 await page.evaluate(async()=>{
  const m=window.terminator.manager;await m.ready;if(m.ui?.startMatch){await m.ui.startMatch();m.ui.screens.show(null)}
  m.lobby?.stop();m.director.pauseWaves();window.reviewUpdate=m.update.bind(m);m.update=()=>true
  m.playerView.weapons.selectVariant('swingout');m.mapView.bindWeapon(m.playerView.weapons.materials)
  m.world.player.yaw=0;m.world.player.pitch=0;m.syncViews()
  window.reviewStep=(input={})=>{m.world.step({yaw:0,pitch:0,...input});m.syncViews()}
  for(let i=0;i<70;i++)window.reviewStep()
 })
 const canvas=getCanvas(page),box=await canvas.boundingBox(),cdp=await page.context().newCDPSession(page)
 for(const speed of [1,.25]){
  for(const clip of ['fire','reload']){
   const frames=`${folder}/${clip}-${speed}x`;console.log('Capture',clip,speed);await mkdir(frames,{recursive:true})
   await page.evaluate(clip=>{
    const m=window.terminator.manager,w=m.world,v=m.playerView.weapons
    v.rigs.pistol.clipPlayer.shots=0;w.player.reloadTimer=0;w.player.fireCooldown=0;w.player.ammo.pistol.mag=6;w.player.ammo.pistol.reserve=120
    for(let i=0;i<70;i++)window.reviewStep()
    if(clip==='reload')for(let j=0;j<6;j++){window.reviewStep({fire:true});for(let i=0;i<30;i++)window.reviewStep()}
    window.reviewStep(clip==='fire'?{fire:true}:{reload:true})
   },clip)
   const live=process.env.SWINGOUT_LIVE==='1'
   const started=Date.now(),duration=clip==='reload'?3:.6,n=live?10000:Math.ceil(duration*60)
   // Every image represents one actual simulation tick. Encoding sets the review playback speed.
   for(let i=0;i<n;i++){
    if(live&&(Date.now()-started)/1000>duration/speed)break
    if(live&&i===1)await page.evaluate(speed=>{const m=window.terminator.manager;m.range.clock.setScale(speed);m.ui.sample=()=>({yaw:0,pitch:0});m.update=window.reviewUpdate},speed)
    if(i&&!live)await page.evaluate(()=>window.reviewStep())
    if(!live)await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)))
    if(process.env.SWINGOUT_STILLS==='1'&&i%12&&![3,5,50,108].includes(i))continue
    const capture=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:88,clip:{...box,scale:1},captureBeyondViewport:false})
    await writeFile(`${frames}/${String(i).padStart(4,'0')}.jpg`,Buffer.from(capture.data,'base64'))
    rows.push(await page.evaluate(({clip,speed,i})=>{
     const m=window.terminator.manager,v=m.playerView.weapons,c=v.rigs.pistol.clipPlayer
     return {clip,speed,frame:i,seconds:i/60,wallMs:Date.now(),action:c.name,clipTime:c.actions.get(c.name)?.time,reload:m.world.player.reloadTimer,shots:c.shots,fx:{...v.fx.revolver.stats},ammo:m.world.player.ammo.pistol.mag,hammer:v.rigs.pistol.root.getObjectByName('Hammer').quaternion.toArray(),bullets:v.bullets.pool.items.filter(x=>x.active).map(x=>({age:x.age,z:x.position.z})),bulletDraws:v.bullets.pool.batch.count}
    },{clip,speed,i}))
   }
   if(live)await page.evaluate(()=>{window.terminator.manager.update=()=>true;window.terminator.manager.range.clock.setScale(0)})
  }
 }
 await writeFile(`${folder}/telemetry.json`,JSON.stringify({live:process.env.SWINGOUT_LIVE==='1',rows,errors},null,2)+'\n')
 await page.evaluate(()=>window.viewer.getPlugin('EntityComponentPlugin').stop())
 console.log(JSON.stringify({folder,frames:rows.length,errors}))
}finally{await browser.close()}
