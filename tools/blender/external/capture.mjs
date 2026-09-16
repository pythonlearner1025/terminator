import {chromium} from 'playwright'
import {readFile, writeFile, mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
const root = resolve(import.meta.dirname, '../../..')
const dev = JSON.parse(await readFile(resolve(root, '.kite3d/external-proof/.kite3d/dev.json'), 'utf8'))
if (['4300','4310'].includes(new URL(dev.url).port)) throw Error('Private server required')
const output = resolve(root, 'docs/evidence/external-weapons'); await mkdir(output, {recursive: true})
const browser = await chromium.launch({headless: true, executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=metal']})
const page = await browser.newPage({viewport: {width:1920,height:1080}, deviceScaleFactor:1})
const errors = [], failures=[]
page.on('pageerror', error => errors.push(error.message))
page.on('console', event => {if(event.type()==='error') errors.push(event.text().replace(/([?&]t=)[^&\s]+/g,'$1[private]'))})
page.on('response', response => {if(response.status()>=400) failures.push([response.status(),new URL(response.url()).pathname])})
try {
 await page.goto(dev.url, {waitUntil:'domcontentloaded'})
 await page.getByTestId('play').waitFor({timeout:90000})
 await page.waitForFunction(() => window.viewer?.scene?.modelRoot?.getObjectByName('Candidates')?.children.length >= 10, null, {timeout:90000})
 await page.waitForFunction(() => window.viewer.scene.modelRoot.getObjectByName('Candidates').children.every(o=>{let count=0;o.traverse(c=>{if(c.isMesh)count++});return count>0}), null, {timeout:90000})
 const candidates=await page.evaluate(()=>{
  const v=window.viewer,group=v.scene.modelRoot.getObjectByName('Candidates')
  return group.children.map(o=>({name:o.name,position:o.position.toArray(),meshes:(()=>{let n=0;o.traverse(c=>{if(c.isMesh)n++});return n})()}))
 })
 const result={headless:true,port:new URL(dev.url).port,candidates,errors,failures}
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:60000})
 await page.evaluate(()=>window.terminator.manager.ready)
 await page.evaluate(()=>{
  const m=window.terminator.manager;m.capturePaused=true;m.lab.root.style.visibility='hidden';m.hud.root.style.visibility='hidden';m.ui.rangePanel.root.hidden=true
  m.playerView.weapons.root.visible=false
  m.update=()=>{}
  const v=window.viewer,c=v.scene.mainCamera
  c.controlsMode='';c.position.set(-31,3,-14);c.target.set(-19,1.5,-14);c.autoLookAtTarget=false;c.lookAt(c.target);c.fov=60;c.updateProjectionMatrix();c.updateMatrixWorld(true);c.setDirty?.()
  Object.assign(v.container.style,{position:'fixed',left:'0',top:'0',width:'1920px',height:'1080px',zIndex:999})
  v.setSize({width:1920,height:1080});v.resize();v.setDirty()
 })
 await page.waitForTimeout(2000)
 await page.screenshot({path:resolve(output,'lab-candidates.png')})
 await page.evaluate(()=>{window.viewer.container.removeAttribute('style');window.viewer.resize()})
 await page.getByTestId('play').click()
 await writeFile(resolve(output,'scene-result.json'),JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify(result))
 if(errors.length||failures.length||candidates.some(c=>!c.meshes))throw Error('Candidate scene validation failed')
} finally {await browser.close()}
