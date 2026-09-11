import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright'
const out=new URL('./',import.meta.url)
const log=await readFile('/tmp/terminator-w4-dev.log','utf8')
const url=log.match(/http:\/\/127\.0\.0\.1:4400\/\?t=[\w.~-]+/)?.[0]
if(!url) throw new Error('W4 server on 4400 did not provide a URL')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:process.env.HEADED!=='1'})
const page=await browser.newPage({viewport:{width:1600,height:1080},deviceScaleFactor:1})
if(process.env.PREVIEW_FALLBACK==='1') {
 for(const path of ['scripts/GameManager.script.js','lib/core/world.js','lib/core/waves.js','lib/ui/hud.js']) {
  await page.route(`**/files/${path}*`,route=>route.fulfill({status:200,contentType:'text/javascript',body:execFileSync('git',['show',`979a0c0:${path}`],{encoding:'utf8'})}))
 }
}
await page.addInitScript(()=>{ window.EventSource=class extends EventTarget { static OPEN=1; static CLOSED=2; readyState=1; close(){this.readyState=2} } })
const errors=[]
const sanitize=s=>String(s).replace(/\?t=[^\s"']+/g,'?t=[redacted]')
page.on('response',r=>{if(r.status()>=400) console.log('HTTP',r.status(),sanitize(r.url()))})
page.on('pageerror',e=>errors.push(sanitize(e.stack||e.message)))
page.on('console',m=>{if(['warning','error'].includes(m.type())){ errors.push(sanitize(m.text())); if(errors.length<5) console.log(sanitize(m.text())) }})
try {
 await page.goto(url,{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').waitFor({timeout:30000})
 await page.waitForTimeout(1300)
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>Boolean(window.terminator?.world),undefined,{timeout:30000})
 await page.waitForTimeout(1000)
 await page.evaluate(()=>{document.exitPointerLock?.();window.terminator.manager.unitView.toggleShowcase(true)})
 await page.waitForTimeout(1000)
 const info=await page.evaluate(()=>{
  const v=window.terminator.manager.unitView
  return {showcase:v.showcase.units.map(x=>({type:x.state.type,joints:Object.keys(x.rig.joints),children:x.object.children.map(c=>c.name)})),anatomy:v.showcase.units.map(x=>x.object.userData.unitAnatomy)}
 })
 console.log(JSON.stringify(info,null,2))
 for(const type of ['scout','endo','heavy']) {
   for(const [view,angle] of [['front',0],['three-quarter',.65]]) {
    await page.evaluate(({type,angle})=>Object.assign(window.terminator.manager.unitView.showcase,{focus:type,angle,cameraDistance:2.0,targetY:1.15,state:'idle'}),{type,angle})
    await page.waitForTimeout(500)
    await capture(`${type}-${view}.png`)
   }
 }
 await page.evaluate(()=>Object.assign(window.terminator.manager.unitView.showcase,{focus:null,angle:.12,cameraDistance:5.5,targetY:1.15,state:'idle'}))
 await page.waitForTimeout(500);await capture('three-units.png')
 await page.evaluate(()=>Object.assign(window.terminator.manager.unitView.showcase,{focus:'endo',angle:.4,cameraDistance:.95,targetY:1.67,state:'idle'}))
 await page.waitForTimeout(500);await capture('endo-skull.png')
 await page.evaluate(()=>window.terminator.manager.unitView.toggleShowcase(false))
 await page.getByTestId('play').click({force:true})
 await page.waitForTimeout(500)
 console.log(JSON.stringify({errors},null,2))
 await writeFile(new URL('browser-errors.json',out),JSON.stringify(errors,null,2)+'\n')
} catch(error) { console.log(JSON.stringify({errors:errors.slice(0,8)},null,2)); await page.screenshot({path:new URL('failure.png',out).pathname}); throw error } finally { await browser.close() }
async function capture(name) {
 const clip=await page.evaluate(()=>{const r=window.viewer.canvas.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})
 await page.screenshot({path:new URL(name,out).pathname,clip})
}
