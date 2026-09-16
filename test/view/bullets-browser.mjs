// Headless proof against an isolated lab server. Does not start or stop any server.
// node test/view/bullets-browser.mjs .kite3d/bullets-proof/.kite3d/dev.json
import {chromium} from 'playwright'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const dev=JSON.parse(await readFile(process.argv[2]||'.kite3d/bullets-proof/.kite3d/dev.json','utf8'))
assert.notEqual(new URL(dev.url).port,'4310','Never use the owner editor for capture')
const out='/Users/minjunes/games/terminator-evidence/docs/evidence/bullets/raw';await mkdir(out,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1}),errors=[]
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
try {
 await page.goto(dev.url+'&range=1');await page.getByTestId('play').click({timeout:60000})
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:60000})
 await page.evaluate(async()=>{
  const m=window.terminator.manager,v=window.viewer;await m.ready;m.capturePaused=true;m.input.stop();m.range.setReloads(false)
  Object.assign(v.container.style,{position:'fixed',left:0,top:0,width:'1920px',height:'1080px',maxWidth:'none',maxHeight:'none',zIndex:999})
  v.setSize({width:1920,height:1080});v.resize()
  m.rangeView.options.trajectories=false;m.rangeView.options.impacts=false;m.rangeView.options.ruler=false
  window.bulletProof={
   setup(weapon,distance,scale=.1){
    m.range.clock.setScale(scale);m.rangeView.clearShots();m.range.equip(weapon);m.rangeView.equip(weapon)
    m.range.layout=[{id:'proof-target',type:'heavy',distance,row:distance,pos:{x:-18+distance,y:0,z:-13},yaw:-Math.PI/2}];m.range.respawn()
    m.world.player.yaw=Math.PI/2;m.world.player.pitch=0;m.world.player.pos.x=-18;m.world.player.pos.z=-13
    m.world.tick+=120;m.syncViews();m.world.tick+=120;m.syncViews()
    m.playerView.weapons.bullets.reset();m.unitView.fx.reset()
    this.start=m.world.tick/60;this.events=m.world.eventLog.length;this.impacts=[]
    const b=m.playerView.weapons.bullets
    b.deliver=p=>{this.impacts.push({kind:p.kind,due:p.due,at:b.lastTime});b.arrive(p)}
   },
   advance(frames,scale=.1,fire=true){
    for(let i=0;i<frames;i++){
     const ticks=m.range.clock.takeTicks(1000/30)
     for(let t=0;t<ticks;t++){m.director.pauseWaves();m.director.step({fire,yaw:Math.PI/2,pitch:0});m.range.afterStep();m.cameraFeel.consume(m.world)}
     m.syncViews()
    }
   },
   state(){
    const b=m.playerView.weapons.bullets,c=m.playerView.camera;c.updateMatrixWorld(true)
    return {tick:m.world.tick,scale:m.range.clock.scale,time:b.lastTime-this.start,
     shots:m.world.eventLog.slice(this.events).filter(e=>e.type==='shot'&&!e.unitType).map(e=>({tick:e.tick,hit:e.hit,paths:e.paths?.length})),
     bullets:b.pool.items.filter(p=>p.active).map(p=>({position:p.position.toArray(),from:p.from.toArray(),to:p.to.toArray(),age:p.age,distance:p.distance,
      pixel:p.position.clone().project(c).toArray().slice(0,2).map((v,i)=>(i?1-v:1+v)*(i?540:960))})),
     impacts:this.impacts,sparks:m.unitView.fx.stats.sparkBursts,decals:m.unitView.fx.stats.decals,pending:b.impacts.pending}
   }
  }
 })
 const f2=await page.evaluate(()=>{
  const m=window.terminator.manager,before=document.body.innerHTML.includes('ARTICULATION')
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'F2',key:'F2',bubbles:true}))
  const absent=!document.querySelector('[data-lab-panel]')&&!before&&!m.lab.panel&&!m.lab.debug
  const hidden=m.ui.rangePanel.root.hidden
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'F1',key:'F1',bubbles:true}))
  const toggled=m.ui.rangePanel.root.hidden!==hidden
  window.dispatchEvent(new KeyboardEvent('keydown',{code:'F1',key:'F1',bubbles:true}))
  return {absent,toggled,reference:!!m.lab.reference.strip}
 });assert.deepEqual(f2,{absent:true,toggled:true,reference:true})
 await page.getByTestId('range-time-0').click()
 const stopped=await page.evaluate(()=>{const m=terminator.manager;m.capturePaused=false;return m.world.tick})
 await page.getByTestId('range-step-once').click()
 await page.waitForFunction(t=>terminator.manager.world.tick===t+1,stopped)
 await page.evaluate(()=>{terminator.manager.capturePaused=true})
 await page.getByTestId('range-weapon-m4').click()
 await page.waitForFunction(()=>[...document.querySelectorAll('.lab-frames img')].every(i=>i.complete&&i.naturalWidth>0))
 await page.getByTestId('lab-frame-0').click()
 assert.equal(await page.getByTestId('lab-comparison').isVisible(),true)
 await page.getByTestId('lab-unpin').click()
 assert.equal(await page.getByTestId('lab-comparison').isVisible(),false)
 const results={ui:{...f2,pauseAndStep:true,referencePin:true}}
 for(const [weapon,distance,frames] of [['m4',20,84],['shotgun',20,36],['sniper',40,72]]){
  await page.evaluate(({weapon,distance,frames})=>{bulletProof.setup(weapon,distance);bulletProof.advance(frames);const m=terminator.manager;m.ui.rangePanel.root.hidden=true;m.lab.reference.strip.hidden=true}, {weapon,distance,frames})
  await page.waitForTimeout(400)
  results[weapon]=await page.evaluate(()=>bulletProof.state())
  assert.ok(results[weapon].bullets.length>0)
  if(weapon==='m4'){assert.ok(results.m4.bullets.length>=3);assert.equal(results.m4.impacts.length,0);assert.equal(results.m4.sparks,0)}
  if(weapon==='shotgun')assert.equal(results.shotgun.bullets.length,8)
  await page.screenshot({path:`${out}/${weapon}.png`})
  if(weapon==='sniper'){
   await page.evaluate(()=>{
    const m=terminator.manager,c=m.playerView.camera,b=m.playerView.weapons.bullets.pool.items.find(p=>p.active)
    const target=b.position.clone().addScaledVector(b.direction,-b.style.length/2)
    window.profileRestore={sync:m.syncViews,position:c.position.clone(),quaternion:c.quaternion.clone(),fov:c.fov}
    m.syncViews=()=>{};m.playerView.weapons.root.visible=false;m.lab.root.hidden=true;m.hud.root.hidden=true
    c.position.copy(target);c.position.y+=.08;c.position.z+=.85;c.fov=35;c.lookAt(target);c.updateProjectionMatrix();c.updateMatrixWorld(true);viewer.setDirty()
   })
   await page.waitForTimeout(250);await page.screenshot({path:`${out}/sniper-profile.png`})
   await page.evaluate(()=>{
    const m=terminator.manager,c=m.playerView.camera,r=profileRestore
    c.position.copy(r.position);c.quaternion.copy(r.quaternion);c.fov=r.fov;c.updateProjectionMatrix()
    m.syncViews=r.sync;m.playerView.weapons.root.visible=true;m.lab.root.hidden=false;m.hud.root.hidden=false;m.syncViews()
   })
  }
 }
 await page.evaluate(()=>{bulletProof.setup('m4',20);bulletProof.advance(6)})
 const immediate=await page.evaluate(()=>bulletProof.state());assert.equal(immediate.sparks,0)
 await page.evaluate(()=>bulletProof.advance(110,.1,false))
 const arrived=await page.evaluate(()=>bulletProof.state())
 assert.ok(arrived.sparks>0);assert.ok(arrived.impacts.length>0)
 for(const p of arrived.impacts)assert.ok(p.at>=p.due)
 results.impact={immediate,arrived}
 await page.evaluate(()=>{bulletProof.setup('m4',20,.25);bulletProof.advance(4,.25)})
 for(let frame=0;frame<30;frame++){
  await page.evaluate(()=>bulletProof.advance(2,.25))
  await page.screenshot({path:`${out}/gif-${String(frame).padStart(3,'0')}.png`})
 }
 results.errors=errors.map(s=>s.replace(/([?&]t=)[^&\s]+/g,'$1[private]'))
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2)+'\n')
 assert.deepEqual(results.errors,[])
 console.log(JSON.stringify({ui:f2,bullets:Object.fromEntries(['m4','shotgun','sniper'].map(k=>[k,results[k].bullets.length])),delayed:arrived.impacts.length,errors:results.errors}))
}finally{await browser.close()}
