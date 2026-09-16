import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../../../test/helpers/editor-driver.mjs'
import {chromium} from 'playwright'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {measure24} from './performance.mjs'
const project=resolve(process.argv[2]||'.kite3d/revolver-proof')
const performanceOnly=process.argv.includes('--performance-only')
const dev=JSON.parse(await readFile(resolve(project,'.kite3d/dev.json'),'utf8'))
if(['4300','4310'].includes(new URL(dev.url).port))throw Error('Use an isolated server')
const output=resolve('docs/evidence/blender-revolver/pass3');await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1}),errors=[],captures=[]
const safe=s=>String(s).replace(/([?&]t=)[^&\s"']+/g,'$1[private]')
page.on('pageerror',e=>errors.push(safe(e.message)))
page.on('console',e=>{if(e.type()==='error')errors.push(safe(e.text()))})
page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+new URL(r.url()).pathname)})
async function advance(wallFrames){await page.evaluate(count=>{const m=window.terminator.manager;m.capturePaused=false;for(let i=0;i<count;i++)m.update({deltaTime:1000/60});m.capturePaused=true;m.syncViews()},wallFrames)}
async function capture(name){
 await page.waitForTimeout(160)
 const state=await page.evaluate(()=>{
  const m=window.terminator.manager,w=m.playerView.weapons,r=w.rigs.pistol,cp=r.clipPlayer,pool=w.bullets.pool
  const active=pool.items.filter(p=>p.active)
  return {tick:m.world.tick,scale:m.range.clock.scale,clip:cp.name,clipTime:cp.actions.get(cp.name).time,shots:w.animation.stats.shots,reloads:w.animation.stats.reloads,bullets:active.map(p=>({from:p.from.toArray(),position:p.position.toArray(),age:p.age})),muzzle:w.muzzlePosition.toArray(),cylinder:r.magazine.position.toArray(),hands:r.root.getObjectsByProperty('name','HandRight').length+r.root.getObjectsByProperty('name','HandLeft').length}
 })
 await page.screenshot({path:resolve(output,name+'.png')});captures.push({name,...state})
}
try{
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await waitForProjectLoaded(page,{timeout:90000});await runEditor(page)
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:60000})
 await page.evaluate(()=>window.terminator.manager.ready)
 await page.evaluate(()=>{
  const m=window.terminator.manager,v=window.viewer;m.capturePaused=true
  Object.assign(v.container.style,{position:'fixed',left:'0',top:'0',width:'1920px',height:'1080px',maxWidth:'none',maxHeight:'none',zIndex:999})
  v.setSize({width:1920,height:1080});v.resize()
  m.ui.rangePanel.root.hidden=true;m.lab.root.style.visibility='hidden';m.hud.root.style.visibility='hidden'
  m.range.equip('pistol');m.rangeView.equip('pistol');m.range.setReloads(true);m.range.clock.setScale(.25)
  m.lab.setClip(null);m.rangeView.setInspect(false);m.syncViews()
 })
 if(!performanceOnly){
 await advance(220);await capture('range-rest')
 for(let i=0;i<3;i++){
  await page.evaluate(()=>{window.terminator.manager.range.firePulse=true})
  await advance(48)
  if(i===0)await capture('range-fire')
  await advance(150)
 }
 await page.evaluate(()=>{if(!window.terminator.manager.range.reload())throw Error('Reload did not start')})
 await advance(312);await capture('range-reload')
 await advance(500)
 await page.evaluate(()=>{const m=window.terminator.manager;m.ui.sample=()=>({yaw:m.world.player.yaw,pitch:0,aim:true})})
 await advance(72);await capture('range-aim')
 if(captures.at(-1).shots!==3)throw Error('Expected three core shot events')
 const fire=captures.find(c=>c.name==='range-fire');if(fire.clip!=='Fire'||Math.abs(fire.clipTime-.2)>.025)throw Error('Fire capture is not at the clip midpoint')
 if(captures.find(c=>c.name==='range-reload').clip!=='Reload')throw Error('Reload clip missing')
 if(captures.at(-1).clip!=='AimIdle')throw Error('Aim clip missing')
 if(errors.length)throw Error(errors.join('\n'))
 await writeFile(resolve(output,'range-proof.json'),JSON.stringify({headless:true,port:new URL(dev.url).port,viewport:[1920,1080],captures,errors},null,2)+'\n')
 }
 const performance=await page.evaluate(measure24)
 performance.runtimeErrors=errors.length
 if(errors.length)throw Error(errors.join('\n'))
 await writeFile(resolve(output,'performance-24.json'),JSON.stringify(performance,null,2)+'\n')
 await page.screenshot({path:resolve(output,'range-performance-24.png')})
 // Stop through the same editor control after restoring the canvas layout.
 await page.evaluate(()=>{window.viewer.container.removeAttribute('style');window.viewer.resize()})
 await stopEditor(page)
 console.log(performanceOnly?'Measured 24 enemies in isolation.':'Three core shots, reload, and aim at 0.25x. Four frames. Zero console errors.')
}finally{await browser.close()}
