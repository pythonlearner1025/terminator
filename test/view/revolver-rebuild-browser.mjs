import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {getCanvas,runEditor,stopEditor,waitForProjectLoaded} from '../helpers/editor-driver.mjs'

const dev=JSON.parse(await readFile(process.argv[2]||'.kite3d/dev.json','utf8'))
assert.notEqual(new URL(dev.url).port,'4321','Never use the busy main checkout server')
const output=process.env.REVOLVER_PROOF_DIR||'.kite3d/revolver-proof/after'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({
  headless:true,
  executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args:['--use-angle=metal'],
})
const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1})
const errors=[]
const safe=value=>String(value).replace(/([?&]t=)[^&\s"']+/g,'$1[private]')
page.on('pageerror',error=>errors.push(safe(error.message)))
page.on('console',event=>{
  const text=event.text()
  if(event.type()==='error'&&!text.includes('Failed to load resource')&&!text.includes('Object inside an asset does not contain _tpRootPath'))errors.push(safe(text))
})

try {
  await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
  await page.goto(dev.url,{waitUntil:'domcontentloaded'})
  await waitForProjectLoaded(page)
  await runEditor(page)
  await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:120_000})
  await page.locator('[data-action=play]').waitFor({state:'visible',timeout:120_000})
  await page.locator('[data-action=play]').click()
  await page.locator('[data-action=start-match]').click()
  await page.waitForFunction(()=>window.terminator.manager.viewsStarted&&window.terminator.manager.director.phase!=='lobby',null,{timeout:120_000})
  await page.evaluate(()=>{
    const m=window.terminator.manager,v=window.viewer
    m.update=()=>true
    m.director.pauseWaves()
    if(m.hud?.root)m.hud.root.style.display='none'
    Object.assign(v.container.style,{position:'fixed',left:'0',top:'0',width:'640px',height:'480px',maxWidth:'none',maxHeight:'none',zIndex:'999'})
    v.setSize({width:640,height:480});v.resize();m.syncViews();v.setDirty()
  })

  const report=await page.evaluate(async()=>{
    const T=await import('threepipe')
    const m=window.terminator.manager,w=m.playerView.weapons,rig=w.rigs.pistol,c=m.playerView.camera
    const poses=['Idle','Fire','Reload','AimIdle','Sprint','Inspect'],clearance=.02,results={}
    function bounds(){
      window.viewer.scene.updateMatrixWorld(true)
      rig.root.traverse(node=>{if(node.isSkinnedMesh)node.skeleton.update()})
      const worldBox=new T.Box3().setFromObject(rig.root,true),cameraBox=new T.Box3()
      for(const x of[worldBox.min.x,worldBox.max.x])for(const y of[worldBox.min.y,worldBox.max.y])for(const z of[worldBox.min.z,worldBox.max.z])cameraBox.expandByPoint(new T.Vector3(x,y,z).applyMatrix4(c.matrixWorldInverse))
      return {min:cameraBox.min.toArray(),max:cameraBox.max.toArray()}
    }
    for(const name of poses){
      const rows=[]
      for(let frame=0;frame<=120;frame++){
        const fraction=frame/120
        w.animation.aimAmount=name==='AimIdle'?1:0
        c.fov=name==='AimIdle'?55:72;c.updateProjectionMatrix()
        w.animation.setClipTime(name,fraction,m.world);w.beforeRender(c)
        rows.push({fraction,...bounds()})
      }
      const closest=rows.reduce((a,row)=>row.max[2]>a.max[2]?row:a)
      if(closest.max[2]>-(c.near+clearance))throw Error(`${name} crosses the camera clearance plane: ${JSON.stringify(closest)}`)
      results[name]={samples:rows.length,closest,maxClearance:-(c.near+closest.max[2])}
    }
    const bone=rig.root.getObjectByName('L_wrist_04'),right=rig.root.getObjectByName('R_wrist_027')
    if(!bone?.isBone||!right?.isBone)throw Error('native left and right wrist bones must remain bound')
    const position=(node,name,fraction)=>{
      w.animation.aimAmount=0;c.fov=72;c.updateProjectionMatrix()
      w.animation.setClipTime(name,fraction,m.world);w.beforeRender(c)
      window.viewer.scene.updateMatrixWorld(true)
      return node.getWorldPosition(new T.Vector3())
    }
    const leftIdle=position(bone,'Idle',0),leftReload=position(bone,'Reload',.48)
    const rightIdle=position(right,'Idle',0),rightReload=position(right,'Reload',.48)
    const leftMotion=leftIdle.distanceTo(leftReload),rightMotion=rightIdle.distanceTo(rightReload)
    if(leftMotion<=.1)throw Error(`left wrist did not follow Reload (${leftMotion} m)`)
    if(rightMotion<=.01)throw Error(`right wrist did not follow Reload (${rightMotion} m)`)
    const vm=rig.root.userData.viewModel
    return {variant:w.variant,rootName:rig.root.name,viewModel:{scale:rig.root.scale.x,fov:vm.fov,aimFov:vm.aimFov,hip:vm.hip,hipRotation:vm.hipRotation,sight:vm.sight},cameraNear:c.near,requiredClearance:clearance,poses:results,bones:{leftIdle:leftIdle.toArray(),leftReload:leftReload.toArray(),leftMotion,rightIdle:rightIdle.toArray(),rightReload:rightReload.toArray(),rightMotion}}
  })
  assert.equal(report.variant,'revolver-rebuild')
  assert.equal(report.rootName,'revolver-rebuild viewmodel')
  assert.deepEqual(errors,[])

  for(const [name,fraction] of [['Idle',0],['Fire',.2],['Reload',.48]]){
    await page.evaluate(({name,fraction})=>{
      const m=window.terminator.manager,w=m.playerView.weapons,c=m.playerView.camera
      w.animation.aimAmount=0;c.fov=72;c.updateProjectionMatrix()
      w.animation.setClipTime(name,fraction,m.world);w.beforeRender(c);window.viewer.setDirty()
    },{name,fraction})
    await page.waitForTimeout(250)
    await getCanvas(page).screenshot({path:`${output}/game-${name.toLowerCase()}.png`})
  }
  await writeFile(`${output}/bounds-report.json`,JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
  await stopEditor(page)
} catch(error) {
  console.error(safe(error.stack))
  await page.screenshot({path:`${output}/browser-failure.png`})
  process.exitCode=1
} finally {
  await browser.close()
}
