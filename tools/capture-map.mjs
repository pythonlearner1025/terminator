import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const root=new URL('../',import.meta.url)
const dev=JSON.parse(await readFile(new URL('.kite3d/dev.json',root),'utf8'))
assert.equal(new URL(dev.origin).port,'4680')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[],shots=[]
const clean=s=>String(s).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
page.on('pageerror',e=>errors.push(clean(e.message)))
page.on('console',e=>{if(e.type()==='error')errors.push(clean(e.text()))})
try {
 await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
 await page.request.get(dev.url)
 await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.terminator?.manager?.world,null,{timeout:90000})
 await page.evaluate(async()=>{
  const m=window.terminator.manager
  m.ui.menuScene?.setActive(false);m.startViews();await m.visualWarmup;await m.mapView.ready
  m.ui.screens.show(null);m.unitView.toggleShowcase(false);m.input.stop()
  m.playerView.root.visible=false;m.update=()=>true
  m.world.configureMap({doors:Object.fromEntries(m.world.map.doors.map(d=>[d.id,'unlocked']))})
  m.world.mapState.gates=m.world.map.spawnGates.map(g=>g.id)
  for(const e of document.body.querySelectorAll(':scope > *:not(canvas):not(script)'))e.style.display='none'
  window.mapCaptureFrame=()=>{m.world.tick++;m.mapView.sync(m.world);window.viewer.setDirty()}
  window.viewer.addEventListener('preFrame',window.mapCaptureFrame)
 })
 const output=process.argv[2]||'/Users/minjunes/games/terminator-evidence/docs/evidence/map'
 await mkdir(new URL(output+'/',root),{recursive:true})
 for(const [name,pos,target] of [
  ['tunnel',[-36,-1.85,-12.5],[-35.7,-1.85,10]],
  ['house-interior',[36,1.65,5.5],[36,1.55,22]],
  ['colonnade',[14,1.65,13],[32,1.9,13]],
  ['roof-overview',[31.55,8.1,5.5],[-6,-7,-5]],
 ]){
  await page.evaluate(({pos,target})=>{
   const m=window.terminator.manager,c=window.viewer.scene.mainCamera
   m.world.player.pos={x:pos[0],y:pos[1]-1.65,z:pos[2]}
   c.controlsMode='';c.autoLookAtTarget=false;c.position.set(...pos);c.lookAt(...target);c.fov=68;c.updateProjectionMatrix();c.updateMatrixWorld(true)
   window.viewer.setDirty()
  },{pos,target})
  await page.waitForTimeout(1200)
  const path=output+'/'+name+'.png'
  await page.screenshot({path:new URL(path,root).pathname})
  shots.push(path)
 }
 const report=await page.evaluate(()=>{
  const m=window.terminator.manager
  const solid=new Set();m.mapView.root.traverse(o=>{if(o.isMesh&&!o.material?.transparent&&o.material?.isMeshStandardMaterial)solid.add(o.material)})
  return {size:[1920,1080],quality:m.performanceQuality?.id,localLights:m.mapView.localLights.length,
   opaquePbrMaterials:solid.size,missingPbr:[...solid].filter(m=>!m.map||!m.normalMap||!m.roughnessMap).map(m=>m.name)}
 })
 await page.evaluate(()=>{const m=window.terminator.manager;window.viewer.removeEventListener('preFrame',window.mapCaptureFrame);m.stop()})
 assert.deepEqual(errors,[]);assert.deepEqual(report.missingPbr,[])
 console.log(JSON.stringify({shots,...report,errors},null,2))
 await writeFile(new URL(output+'/capture.json',root),JSON.stringify({shots,...report,errors},null,2)+'\n')
}finally{await browser.close()}
