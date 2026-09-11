#!/usr/bin/env node
// UI component tests with explicit fixtures. These are not running-game evidence.
import {readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const dev=JSON.parse(await readFile('/tmp/terminator-w10-dev.json','utf8'))
const weapons=JSON.parse(await readFile(new URL('../../../lib/core/data/weapons.json',import.meta.url),'utf8'))
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
const page=await browser.newPage({viewport:{width:1920,height:1080}})
const result={kind:'isolated UI component fixtures',checks:[]}
try{
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>Boolean(window.viewer),undefined,{timeout:15000})
 await page.evaluate(async({weapons})=>{
   const {Hud}=await import('/files/lib/ui/hud.js'),{Screens,markdown}=await import('/files/lib/ui/screens.js')
   document.querySelectorAll('.tm-hud').forEach(n=>n.remove())
   const hud=new Hud(window.viewer)
   const actions={settings:()=>{},input:()=>{},quotes:()=>({fillAmmo:40,fullArmor:180,medkit:150}),purchase:()=>({ok:false,error:'Not enough Scrap'}),dossier:()=>{},menu:()=>{}}
   const screens=new Screens(hud,actions)
   const view={tick:1,health:{value:18,ratio:.18,low:true,critical:true},armor:{value:40,ratio:.4},ammo:{mag:2,reserve:93,capacity:15,low:true,empty:false},weapon:{id:'pistol',name:'9mm Pistol',slot:1,reloadProgress:.5,reloading:true},wave:{current:3,total:10,remaining:8,phase:'intermission',timer:34,budget:1140,multiplier:1.2},skynet:{status:'FIXTURE AGENT',connected:true,fallbackCount:2,revs:{endo:7,scout:3,heavy:1}},scrap:400,grenades:3,sprintStamina:4,crosshair:{spread:3,reloadProgress:.5},killFeed:[{id:'one',text:'9MM PISTOL HEADSHOT T-800 ENDO',age:.2}],hitMarkers:[{id:'one',kind:'headshot'}],damageDirections:[{id:'one',angle:1.2,strength:1,age:.1}],nameplates:[],transmission:'Fixture transmission'}
   const extra={matchStarted:true,waveTotal:12,remaining:8,catalog:weapons.weapons,loadout:[{...weapons.weapons.pistol,mag:2,reserve:93,owned:true}],armor:40,grenades:3,mapName:'Bunker 7',stats:{survived:false,wave:3,kills:{scout:12,endo:8,heavy:1},accuracy:74,damage:180,scrap:2400,seconds:140},trader:{pos:{x:2,y:1,z:2},distance:24,bearing:0}}
   const lobby={code:'UITEST',agentName:'TEST AGENT',status:'Connected',installLine:'claude mcp add skynet -- npx terminator-skynet-mcp --url http://localhost:7802 --code UITEST'}
   screens.render(view,extra,lobby);hud.render(view,extra)
   window.uiTest={hud,screens,view,extra,lobby,markdown}
   window.viewer.addEventListener('preFrame',()=>hud.sync())
 },{weapons})
 await page.evaluate(()=>window.viewer.container.parentElement.requestFullscreen())
 for(const size of [{width:1280,height:720},{width:1920,height:1080},{width:2560,height:1440}]){
   await page.setViewportSize(size);await page.waitForTimeout(150)
   for(const route of ['main','lobby','pause','settings','trader','postmatch','dossier','quit']){
     await page.evaluate(route=>{const t=window.uiTest;t.screens.show(route);t.screens.render(t.view,t.extra,t.lobby);t.hud.sync()},route)
     const layout=await page.evaluate(()=>{const el=document.querySelector('.tm-screen'),hud=document.querySelector('.tm-hud');return {route:el.dataset.screen,width:hud.clientWidth,height:hud.clientHeight,horizontal:el.scrollWidth<=el.clientWidth,vertical:el.scrollHeight<=el.clientHeight+1}})
     assert.ok(layout.horizontal && layout.vertical,JSON.stringify(layout))
     result.checks.push(layout)
   }
 }
 await page.evaluate(()=>{const t=window.uiTest;t.screens.show('trader')})
 await page.locator('[data-action="purchase:m4"]').click()
 assert.equal(await page.locator('[data-live="purchaseFeedback"]').textContent(),'Not enough Scrap')
 await page.evaluate(()=>{const t=window.uiTest;t.screens.show('postmatch');t.screens.setDossier({markdown:'# Report\n**Text** <script>window.XSS=true</script>',traits:[{key:'<img src=x onerror=alert(1)>',value:'safe',confidence:.75}]});t.screens.dossierStart=0;t.screens.typeDossier()})
 assert.equal(await page.locator('.tm-dossier script,.tm-dossier img').count(),0)
 assert.equal(await page.locator('.tm-trait').count(),1)
 assert.equal(await page.locator('.tm-trait .tm-fill').evaluate(el=>el.style.width),'75%')
 await page.evaluate(()=>{window.uiTest.screens.dispose();window.uiTest.hud.dispose()})
 assert.equal(await page.locator('.tm-hud').count(),0)
 result.checks.push('purchase rejection, safe markdown and traits, cleanup')
 result.ok=true
}catch(e){result.ok=false;result.error=e.stack}
finally{await browser.close();await writeFile(new URL('ui-components-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n')}
console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1
