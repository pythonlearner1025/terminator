import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const browser=await chromium.launch({headless:true,args:['--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--no-sandbox']})
try{
 const page=await browser.newPage({viewport:{width:1920,height:900}})
 await page.goto(dev.url,{waitUntil:'domcontentloaded'});await page.getByTestId('play').click({timeout:120000})
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:120000})
 const result=await page.evaluate(async()=>{
  const m=window.terminator.manager;await m.ready;m.capturePaused=true;m.update=()=>true
  const w=m.world,v=m.playerView.weapons;v.selectVariant('swingout');m.mapView.bindWeapon(v.materials)
  const cp=v.rigs.pistol.clipPlayer,results=[]
  window.fireOrderStart=()=>{w.player.reloadTimer=0;w.player.fireCooldown=0;w.player.ammo.pistol.mag=6;cp.shots=0;v.bullets.pool.reset();for(let i=0;i<70;i++)step();step({fire:true})}
  window.fireOrderStep=()=>step()
  window.fireOrderRead=()=>({clipMs:cp.actions.get('Fire').time*1000,hammerAngle:2*Math.acos(Math.min(1,Math.abs(v.rigs.pistol.root.getObjectByName('Hammer').quaternion.w))),bulletDraws:v.bullets.pool.batch.count,fxShots:v.fx.revolver.stats.shots})
  const step=(input={})=>{w.step({yaw:0,pitch:0,...input});m.syncViews()}
  for(const count of [1,3,5,6]){
   w.player.reloadTimer=0;w.player.fireCooldown=0;w.player.ammo.pistol.mag=6;w.player.ammo.pistol.reserve=120;cp.shots=0
   for(let i=0;i<70;i++)step()
   const before=v.fx.revolver.stats.emittedCases
   for(let shot=0;shot<count;shot++){step({fire:true});for(let i=0;i<30;i++)step()}
   const afterFire=v.fx.revolver.stats.emittedCases
   step({reload:true});for(let i=0;i<65;i++)step()
   const spent=cp.spent.slice(),live=cp.cartridges.filter((c,i)=>!spent.includes(i)).map(c=>({caseScale:c.node.scale.x,bulletScale:c.bullet.scale.x,freshScale:c.fresh.scale.x}))
   for(let i=0;i<110;i++)step()
   results.push({fired:count,casesDuringFire:afterFire-before,ejected:v.fx.revolver.stats.emittedCases-before,spent,live,mag:w.player.ammo.pistol.mag,restoredCases:cp.cartridges.map(c=>c.node.scale.x)})
  }
  return results
 })
 for(const row of result){assert.equal(row.casesDuringFire,0);assert.equal(row.ejected,row.fired);assert.equal(row.mag,6);for(const scale of row.restoredCases)assert.equal(scale,1);for(const c of row.live){assert.equal(c.caseScale,1);assert.equal(c.bulletScale,1);assert.equal(c.freshScale,.001)}}
 const order=[];await page.evaluate(()=>window.fireOrderStart())
 const canvas=page.getByTestId('game-canvas'),box=await canvas.boundingBox(),cdp=await page.context().newCDPSession(page)
 for(let i=0;i<6;i++){
  if(i)await page.evaluate(()=>window.fireOrderStep())
  const row=await page.evaluate(()=>window.fireOrderRead());order.push(row)
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)))
  const capture=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:92,clip:{...box,scale:1},captureBeyondViewport:false})
  await writeFile(`tools/blender/swingout/rounds/fire-order-${Math.round(row.clipMs)}ms.jpg`,Buffer.from(capture.data,'base64'))
 }
 assert.ok(order.find(r=>Math.abs(r.clipMs-50)<.001).hammerAngle<.0001)
 assert.equal(order.find(r=>Math.abs(r.clipMs-50)<.001).bulletDraws,0)
 assert.ok(order.find(r=>Math.abs(r.clipMs-1000/15)<.001).bulletDraws>0)
 await writeFile('tools/blender/swingout/rounds/fire-order.json',JSON.stringify(order,null,2)+'\n')
 await writeFile('tools/blender/swingout/rounds/partial-reloads.json',JSON.stringify(result,null,2)+'\n')
 await page.evaluate(()=>window.viewer.getPlugin('EntityComponentPlugin').stop())
 console.log(JSON.stringify({passed:result.length+1,result,order}))
}finally{await browser.close()}
