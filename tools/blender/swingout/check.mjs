import {chromium} from 'playwright'
import {readFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import assert from 'node:assert/strict'
const run=promisify(execFile),dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const browser=await chromium.launch({headless:true,args:['--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--no-sandbox']})
try{
 const page=await browser.newPage({viewport:{width:1280,height:720}})
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').click({timeout:90000})
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:90000})
 await page.evaluate(()=>window.terminator.manager.ready)
 await page.evaluate(()=>{const m=window.terminator.manager;m.playerView.weapons.selectVariant('swingout');m.mapView.bindWeapon(m.playerView.weapons.materials);m.syncViews()})
 await page.waitForTimeout(500)
 await page.getByTestId('play').click()
 await page.waitForTimeout(1000)
 assert.equal(await page.evaluate(()=>Boolean(window.viewer.scene.getObjectByName('Swingout muzzle and cylinder gas'))),false)
 const result=await run('npx',['kite3d','check'],{timeout:180000,maxBuffer:1024*1024})
 console.log(result.stdout);console.error(result.stderr)
}catch(error){console.error(error.stdout||error.message);process.exitCode=1}
finally{await browser.close()}
