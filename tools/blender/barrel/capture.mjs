// Only headless Chrome. No OS input and no changes to saved scene or core data.
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
const root=new URL('../../../',import.meta.url)
const round=Number(process.argv[2]||1)
const output=new URL(`tools/blender/cache/round-${round}/`,root)
await mkdir(output,{recursive:true})
const dev=JSON.parse(await readFile(new URL('.kite3d/dev.json',root),'utf8'))
assert.equal(new URL(dev.origin).port,'4692')
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
page.on('pageerror',e=>errors.push(e.message.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]')))
try{
 await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
 await page.request.get(dev.url)
 await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>window.terminator?.manager?.world,null,{timeout:90000})
 const report=await page.evaluate(async()=>{
  const m=window.terminator.manager
  m.ui.menuScene?.setActive(false);m.startViews();await m.visualWarmup;await m.mapView.ready
  m.ui.screens.show(null);m.unitView.toggleShowcase(false);m.input.stop()
  m.playerView.root.visible=false;m.update=()=>true
  for(const e of document.body.querySelectorAll(':scope > *:not(canvas):not(script)'))e.style.display='none'
  window.barrelCaptureFrame=()=>{m.world.tick++;m.mapView.sync(m.world);window.viewer.setDirty()}
  window.viewer.addEventListener('preFrame',window.barrelCaptureFrame)
  const placements=m.mapView.batching.placements.filter(o=>o.userData.mapPiece.assetId.includes('barrel-'))
  const batches=m.mapView.batching.batches.filter(o=>o.material.name.includes('Barrel'))
  return {placements:placements.map(o=>({name:o.name,visible:o.visible,position:o.getWorldPosition(new window.viewer.scene.position.constructor()).toArray()})),batches:batches.map(o=>({name:o.name,triangles:o.geometry.attributes.position.count/3,maps:['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].map(k=>[k,!!o.material[k]])})),fires:m.mapView.refs.fires.length}
 })
 assert.equal(report.placements.length,4);assert.equal(report.fires,4)
 for(let i=0;i<(round===4?4:1);i++){
  const pos=report.placements[i].position
  await page.evaluate(({pos})=>{
   const m=window.terminator.manager,c=window.viewer.scene.mainCamera
   const eye=[pos[0]+1.30,pos[1]+1.07,pos[2]+1.65]
   m.world.player.pos={x:eye[0],y:eye[1]-1.65,z:eye[2]}
   c.controlsMode='';c.autoLookAtTarget=false;c.position.set(...eye);c.lookAt(pos[0],pos[1]+.14,pos[2]);c.fov=54;c.updateProjectionMatrix();c.updateMatrixWorld(true);window.viewer.setDirty()
  },{pos})
  await page.waitForTimeout(1100)
  await page.screenshot({path:new URL(`scene-${i+1}.png`,output).pathname})
 }
 await writeFile(new URL('runtime.json',output),JSON.stringify({...report,errors},null,2)+'\n')
 assert.deepEqual(errors,[])
 console.log(JSON.stringify(report))
}finally{await browser.close()}
