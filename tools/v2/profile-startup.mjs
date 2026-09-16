import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../../test/helpers/editor-driver.mjs'
// Run only after the coordinator grants this worktree the GPU lane.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
if(process.env.STARTUP_GPU_GRANTED!=='1')throw Error('Explicit GPU lane grant required (STARTUP_GPU_GRANTED=1)')
// This path selects an untouched source worktree/server, not intercepted assets.
const projectRoot=resolve(process.env.STARTUP_PROJECT_ROOT||'.')
const dev=JSON.parse(await readFile(projectRoot+'/.kite3d/dev.json','utf8'))
const ownPort=process.env.STARTUP_DEV_PORT||'4752'
assert(['4752','4753'].includes(ownPort),'Unsupported owned startup port')
assert.equal(new URL(new URL(dev.url).origin).hostname,'127.0.0.1')
assert.equal(new URL(new URL(dev.url).origin).port,ownPort,'Startup server must match explicit owned port')
const output=process.argv[2]
if(!output)throw Error('Supply a new evidence JSON path')
await readFile(output).then(()=>{throw Error('Refusing to replace evidence')},e=>{if(e.code!=='ENOENT')throw e})
const config=JSON.parse(await readFile(projectRoot+'/docs/scene-targets/views.json','utf8'))
const ownGroup=(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::'))?.slice(3)
const memory=async()=>Object.fromEntries(await Promise.all(['memory.current','memory.max','memory.events'].map(async key=>[key,await readFile(`/sys/fs/cgroup${ownGroup}/../${key}`,'utf8')])) )
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:projectRoot}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8',cwd:projectRoot}).trim(),settings:config.settings,viewport:config.viewport,memoryBefore:await memory(),runs:[]}
const browser=await launchCaptureBrowser()
try {
  const context=await browser.newContext({viewport:config.viewport,deviceScaleFactor:1})
  await context.addInitScript(settings=>{
    localStorage.setItem('terminator.settings.v1',JSON.stringify({...settings,controlsSeen:true}))
    performance.setResourceTimingBufferSize(5000)
    window.__startupLongTasks=[]
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(window.__startupLongTasks.length<2000)window.__startupLongTasks.push({start:e.startTime,ms:e.duration})}).observe({type:'longtask',buffered:true})
  },config.settings)
  const page=await context.newPage(),cdp=await context.newCDPSession(page)
  await cdp.send('Network.enable')
  let requests=new Map(),errors=[],pageErrors=[]
  const path=url=>{try{return new URL(url).pathname}catch{return '[non-url]'}}
  cdp.on('Network.requestWillBeSent',e=>requests.set(e.requestId,{path:path(e.request.url),start:e.timestamp,wallStart:e.wallTime*1000,initiator:e.initiator.type}))
  cdp.on('Network.responseReceived',e=>Object.assign(requests.get(e.requestId)||{},{status:e.response.status,mime:e.response.mimeType,cache:e.response.fromDiskCache||e.response.fromServiceWorker||false,timing:e.response.timing}))
  cdp.on('Network.loadingFinished',e=>Object.assign(requests.get(e.requestId)||{},{end:e.timestamp,encodedBytes:e.encodedDataLength}))
  cdp.on('Network.loadingFailed',e=>Object.assign(requests.get(e.requestId)||{},{end:e.timestamp,error:e.errorText}))
  page.on('pageerror',e=>{if(pageErrors.length<500)pageErrors.push(e.message)})
  page.on('console',e=>{if(e.type()==='error'&&errors.length<500)errors.push(e.text())})
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval',{interval:2000})
  for(const mode of ['cold-editor','warm-editor','restart']) {
    requests=new Map();errors=[];pageErrors=[]
    if(mode==='cold-editor')await cdp.send('Network.clearBrowserCache')
    if(mode!=='restart') {
      await page.goto(dev.url,{waitUntil:'domcontentloaded'})
      await waitForProjectLoaded(page,{timeout:180000})
      await page.waitForFunction(()=>window.viewer?.scene?.modelRoot?.getObjectByName('Map'),null,{timeout:180000})
      await cdp.send('Profiler.start')
      await page.evaluate(()=>{window.__editorPlayAt=performance.now()})
      await runEditor(page)
    } else {
      await cdp.send('Profiler.start')
      await page.evaluate(()=>{window.__startupLongTasks=[];performance.clearResourceTimings();window.__editorPlayAt=performance.now();window.terminator.manager.start()})
    }
    await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:180000})
    const menuAt=await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return performance.now()})
    // Fixed dwell, reported separately; not subtracted from end-to-end time.
    await page.waitForTimeout(3000)
    await page.evaluate(()=>{window.__menuPlayAt=performance.now()})
    await page.getByTestId('menu-play').click()
    await page.getByTestId('start-match').click()
    await page.waitForFunction(()=>{const m=window.terminator?.manager;return m?.director.phase==='wave'&&m.viewsStarted&&m.visualWarmupReport&&!m.ui.screens.route},null,{timeout:180000})
    const ready=await page.evaluate(()=>{
      const m=window.terminator.manager
      return {at:performance.now(),position:{...m.world.player.pos},tick:m.world.tick,editorAt:window.__editorPlayAt,menuPlayAt:window.__menuPlayAt}
    })
    const {profile:cpu}=await cdp.send('Profiler.stop')
    const cpuFile=output.replace(/\.json$/,'')+'-'+mode+'.cpuprofile'
    for(const node of cpu.nodes)node.callFrame.url=path(node.callFrame.url)
    await mkdir(dirname(cpuFile),{recursive:true});await writeFile(cpuFile,JSON.stringify(cpu))
    const sampleTimes=new Map()
    for(let i=0;i<(cpu.samples||[]).length;i++)sampleTimes.set(cpu.samples[i],(sampleTimes.get(cpu.samples[i])||0)+(cpu.timeDeltas[i]||0))
    const cpuFunctions=cpu.nodes.map(n=>({name:n.callFrame.functionName,path:n.callFrame.url,line:n.callFrame.lineNumber+1,selfMs:(sampleTimes.get(n.id)||0)/1000})).filter(n=>n.selfMs>0).sort((a,b)=>b.selfMs-a.selfMs).slice(0,40)
    await page.keyboard.down('w');await page.waitForTimeout(1500);await page.keyboard.up('w')
    // Keep the real director/spawns. Do not replace gameplay with empty views.
    await page.waitForFunction(()=>window.terminator.manager.world.aliveUnits.length>=4,null,{timeout:30000})
    const observedDraws=await page.evaluate(async()=>{
      const m=window.terminator.manager,r=window.viewer.renderManager.webglRenderer,draws=new Set(),restores=[]
      for(const [id,visual] of m.unitView.visuals){
        visual.object.traverse(object=>{if(!object.isMesh)return
          const original=object.onAfterRender
          object.onAfterRender=function(...args){original?.apply(this,args);if(args[0]===r&&args[2]===m.playerView.camera)draws.add(id)}
          restores.push(()=>{object.onAfterRender=original})
        })
      }
      try{for(let i=0;i<4;i++){window.viewer.setDirty();await new Promise(requestAnimationFrame)}}finally{for(const restore of restores)restore()}
      return [...draws]
    })
    const result=await page.evaluate(()=>{
      const m=window.terminator.manager,r=window.viewer.renderManager.webglRenderer
      return {profile:m.startup,position:{...m.world.player.pos},tick:m.world.tick,enemies:m.world.aliveUnits.length,visuals:m.unitView.visuals.size,
        ownedEnemyMeshes:[...m.unitView.visuals].filter(([id,v])=>m.world.aliveUnits.some(u=>u.id===id)).map(([id,v])=>{let meshes=0;v.object.traverse(o=>{if(o.isMesh)meshes++});return {id,meshes,owned:m.unitView.root.getObjectById(v.object.id)===v.object}}),drawingBuffer:[r.domElement.width,r.domElement.height],pixelRatio:r.getPixelRatio(),renderEnabled:window.viewer.renderEnabled,warmup:m.visualWarmupReport,quality:m.ui.screens.settings.quality,fov:m.playerView.camera.fov,renderScale:window.viewer.renderManager.renderScale,
        resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,start:e.startTime,ms:e.duration,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize})),longTasks:window.__startupLongTasks,
        gpuResources:{...r.info.memory,programs:r.info.programs.length},enemyPlates:document.querySelectorAll('.tm-nameplate:not(.teammate),.tm-boss,.tm-range-ruler').length}
    })
    result.observedEnemyDrawIds=observedDraws
    result.walkDistance=Math.hypot(result.position.x-ready.position.x,result.position.z-ready.position.z)
    delete result.profile?.measure;delete result.profile?.mark
    report.runs.push({mode,cpuFile,cpuFunctions,menuDwellMs:3000,editorToMenuMs:menuAt-ready.editorAt,menuPlayToWorldMs:ready.at-ready.menuPlayAt,editorToWorldMs:ready.at-ready.editorAt,ready,result,requests:[...requests.values()],errors,pageErrors})
    assert(result.tick>ready.tick);assert(result.enemies>=4);assert(result.walkDistance>.1)
    assert(result.ownedEnemyMeshes.length>=4);assert(result.ownedEnemyMeshes.every(v=>v.owned&&v.meshes>0))
    assert.equal(result.pixelRatio,1);assert.equal(result.renderEnabled,true);assert.deepEqual(pageErrors,[])
    // The existing unavailable lobby falls back to built-in Skynet. Preserve
    // those network errors, while rejecting shader/render and other failures.
    assert(errors.every(e=>e.includes('net::ERR_CONNECTION_REFUSED')||e.includes('status of 404')),JSON.stringify(errors))
    if(process.env.STARTUP_EXPECT_NO_ENEMY_OVERLAYS==='1')assert.equal(result.enemyPlates,0)
    assert([...requests.values()].filter(r=>r.status>=400).every(r=>r.status===404&&r.path==='/favicon.ico'),'Unexpected failed HTTP asset')
    assert.equal(result.quality,'high');assert.equal(result.fov,72)
    await page.screenshot({path:output.replace(/\.json$/,'')+'-'+mode+'.png'})
    console.log(JSON.stringify({mode,editorToMenuMs:menuAt-ready.editorAt,menuPlayToWorldMs:ready.at-ready.menuPlayAt,enemies:result.enemies,visuals:result.visuals}))
    if(mode==='cold-editor')await stopEditor(page)
  }
  await stopEditor(page)
  report.renderer=await rendererInfo(page)
  report.cgroup=browser.captureCgroup
  report.browser=browser.version()
} catch(error) {
  report.error=error.stack
  throw error
} finally {
  await browser.close()
  report.memoryAfter=await memory()
  await mkdir(dirname(output),{recursive:true})
  await writeFile(output,JSON.stringify(report,null,2).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')+'\n')
}
