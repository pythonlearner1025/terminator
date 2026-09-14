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
const ownPort=process.env.STARTUP_DEV_PORT||'4755'
assert((process.platform==='darwin'?['4753','4756','4755','4745']:['4755','4745']).includes(ownPort),'Unsupported owned startup port')
assert.equal(new URL(dev.origin).hostname,'127.0.0.1')
assert.equal(new URL(dev.origin).port,ownPort,'Startup server must match explicit owned port')
const output=process.argv[2]
if(!output)throw Error('Supply a new evidence JSON path')
await readFile(output).then(()=>{throw Error('Refusing to replace evidence')},e=>{if(e.code!=='ENOENT')throw e})
const config=JSON.parse(await readFile(projectRoot+'/docs/scene-targets/views.json','utf8'))
const ownGroup=process.platform==='linux'?(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::'))?.slice(3):null
const memory=async()=>!ownGroup?null:Object.fromEntries(await Promise.all(['memory.current','memory.max','memory.events'].map(async key=>[key,await readFile(`/sys/fs/cgroup${ownGroup}/../${key}`,'utf8')])) )
const report={source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',cwd:projectRoot}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8',cwd:projectRoot}).trim(),settings:config.settings,viewport:config.viewport,memoryBefore:await memory(),runs:[]}
if(process.platform==='linux'){const ownership=JSON.parse(await readFile('../coordination/perf-budget-gpu.json','utf8'));assert.equal(ownership.owner,'perf-budget-startup')}
const profiling=process.env.STARTUP_CPU_PROFILE==='1'
const deviceScaleFactor=Number(process.env.STARTUP_DPR||1)
const viewport=process.env.STARTUP_VIEWPORT?JSON.parse(process.env.STARTUP_VIEWPORT):config.viewport
report.viewport=viewport;report.deviceScaleFactor=deviceScaleFactor
const browser=await launchCaptureBrowser()
try {
  const context=await browser.newContext({viewport,deviceScaleFactor})
  await context.addInitScript(settings=>{
    localStorage.setItem('terminator.settings.v1',JSON.stringify({...settings,controlsSeen:true}))
    performance.setResourceTimingBufferSize(5000)
    window.__startupLongTasks=[]
    document.addEventListener('click',event=>{
      const id=event.target.closest?.('[data-testid]')?.getAttribute('data-testid')
      if(id==='play')window.__actualEditorClickAt=performance.now()
      if(id==='menu-play')window.__actualMenuClickAt=performance.now()
      if(id==='start-match')window.__actualLobbyClickAt=performance.now()
    },true)
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
  for(const mode of (process.env.STARTUP_MODES||'cold-editor,warm-editor,restart').split(',')) {
    requests=new Map();errors=[];pageErrors=[]
    if(mode==='cold-editor')await cdp.send('Network.clearBrowserCache')
    if(mode!=='restart') {
      await page.goto(dev.url,{waitUntil:'domcontentloaded'})
      await page.getByTestId('play').waitFor({timeout:180000})
      await page.waitForFunction(()=>window.viewer?.scene?.modelRoot?.getObjectByName('Map'),null,{timeout:180000})
      await page.waitForFunction(async()=>{const state=await fetch('/api/state').then(r=>r.json());return state.projectLoaded&&!state.lastLoadError},null,{timeout:180000})
      await page.waitForFunction(()=>{const node=document.querySelector('[data-testid="play"]');return node&&!node.disabled},null,{timeout:180000})
      if(profiling)await cdp.send('Profiler.start')
      await page.evaluate(()=>{window.__startupAuthoringViewer=window.viewer;window.__editorPlayAt=performance.now()})
      await page.getByTestId('play').click()
    } else {
      if(profiling)await cdp.send('Profiler.start')
      await page.evaluate(()=>{window.__startupLongTasks=[];performance.clearResourceTimings();window.__editorPlayAt=performance.now();window.__actualEditorClickAt=window.__editorPlayAt;window.terminator.manager.start()})
    }
    await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main'||window.terminator?.manager?.ui?.menuLoadError,null,{timeout:180000})
    const menuError=await page.evaluate(()=>window.terminator?.manager?.ui?.menuLoadError)
    if(menuError)throw Error(JSON.stringify(menuError))
    const menuAt=await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);return performance.now()})
    // Immediate actual menu/lobby transitions; no synthetic menu dwell.
    await page.evaluate(()=>{window.__menuPlayAt=performance.now()})
    await page.getByTestId('menu-play').click()
    await page.getByTestId('start-match').click()
    await page.waitForFunction(()=>{const m=window.terminator?.manager;return m?.director.phase==='wave'&&m.viewsStarted&&m.visualWarmupReport&&!m.ui.screens.route},null,{timeout:180000})
    const ready=await page.evaluate(()=>{
      const m=window.terminator.manager
      return {at:performance.now(),position:{...m.world.player.pos},tick:m.world.tick,editorAt:window.__editorPlayAt,menuPlayAt:window.__menuPlayAt,actualEditorClickAt:window.__actualEditorClickAt,actualMenuClickAt:window.__actualMenuClickAt,actualLobbyClickAt:window.__actualLobbyClickAt}
    })
    const {profile:cpu}=profiling?await cdp.send('Profiler.stop'):{profile:{nodes:[],samples:[],timeDeltas:[]}}
    const cpuFile=output.replace(/\.json$/,'')+'-'+mode+'.cpuprofile'
    for(const node of cpu.nodes)node.callFrame.url=path(node.callFrame.url)
    await mkdir(dirname(cpuFile),{recursive:true});await writeFile(cpuFile,JSON.stringify(cpu))
    const sampleTimes=new Map()
    for(let i=0;i<(cpu.samples||[]).length;i++)sampleTimes.set(cpu.samples[i],(sampleTimes.get(cpu.samples[i])||0)+(cpu.timeDeltas[i]||0))
    const cpuFunctions=cpu.nodes.map(n=>({name:n.callFrame.functionName,path:n.callFrame.url,line:n.callFrame.lineNumber+1,selfMs:(sampleTimes.get(n.id)||0)/1000})).filter(n=>n.selfMs>0).sort((a,b)=>b.selfMs-a.selfMs).slice(0,40)
    const inputAt=await page.evaluate(()=>performance.now())
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
        ownedEnemyMeshes:[...m.unitView.visuals].filter(([id,v])=>m.world.aliveUnits.some(u=>u.id===id)).map(([id,v])=>{let meshes=0;v.object.traverse(o=>{if(o.isMesh)meshes++});return {id,meshes,owned:m.unitView.root.getObjectById(v.object.id)===v.object}}),drawingBuffer:[r.domElement.width,r.domElement.height],pixelRatio:r.getPixelRatio(),renderEnabled:window.viewer.renderEnabled,warmup:m.visualWarmupReport,v2Stats:m.mapView.v2Handles.map(h=>h.stats),quality:m.ui.screens.settings.quality,fov:m.playerView.camera.fov,renderScale:window.viewer.renderManager.renderScale,
        resources:performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,start:e.startTime,ms:e.duration,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize})),longTasks:window.__startupLongTasks,
        gpuResources:{...r.info.memory,programs:r.info.programs.length},enemyPlates:document.querySelectorAll('.tm-nameplate:not(.teammate),.tm-boss,.tm-range-ruler').length}
    })
    result.textureInventory=await page.evaluate(()=>{
      const textures=new Map(),materials=new Set(),v=window.terminator.manager.ctx.viewer
      v.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m)})
      const visited=new WeakSet(),visit=(o,depth=0)=>{if(!o||typeof o!=='object'||depth>5||visited.has(o))return;visited.add(o)
        if(o.isTexture){const im=o.source?.data||o.image;const src=im?.currentSrc||im?.src||o.userData?.rootPath||'';textures.set(o.uuid,{name:o.name,source:o.source?.uuid,path:src.startsWith('http')?new URL(src).pathname:src,width:im?.width,height:im?.height,mipmap:o.generateMipmaps,colorSpace:o.colorSpace});return}
        if(ArrayBuffer.isView(o)||o.isObject3D)return
        for(const [k,x]of Object.entries(o))if(!['parent','_listeners','renderer','viewer','scene'].includes(k))visit(x,depth+1)
      };for(const m of materials)visit(m)
      return [...textures.values()]
    })
    result.imageSourceSharing=await page.evaluate(()=>({runtime:{...window.terminator.manager.ctx.viewer.getPlugin('V2ExactImageSourceSharing')?.stats},editor:{...window.__startupAuthoringViewer?.getPlugin('V2ExactImageSourceSharing')?.stats}}))
    result.observedEnemyDrawIds=observedDraws
    result.editorOverlayMarks=await page.evaluate(()=>performance.getEntriesByType('mark').filter(e=>e.name.startsWith('terminator:editor-')).map(e=>({name:e.name,at:e.startTime})))
    result.inputAt=inputAt;result.firstUseLongTasks=result.longTasks.filter(t=>t.start>=ready.at)
    result.responsiveAt=await page.evaluate(()=>performance.now())
    result.walkDistance=Math.hypot(result.position.x-ready.position.x,result.position.z-ready.position.z)
    delete result.profile?.measure;delete result.profile?.mark
    report.runs.push({mode,cpuFile,cpuFunctions,menuDwellMs:0,profiling,editorToMenuMs:menuAt-ready.editorAt,menuPlayToWorldMs:ready.at-ready.menuPlayAt,editorToWorldMs:ready.at-ready.editorAt,ready,result,requests:[...requests.values()],errors,pageErrors})
    assert(result.tick>ready.tick);assert(result.enemies>=4);assert(result.walkDistance>.1)
    assert(result.ownedEnemyMeshes.length>=4);assert(result.ownedEnemyMeshes.every(v=>v.owned&&v.meshes>0))
    assert(result.drawingBuffer.every(n=>n>0));assert.equal(result.renderEnabled,true);assert.deepEqual(pageErrors,[])
    // The existing unavailable lobby falls back to built-in Skynet. Preserve
    // those network errors, while rejecting shader/render and other failures.
    // Editor file previews may read the heartbeat file through a stale revision.
    // Record this exact volatile-metadata race, never whitelist gameplay assets.
    const metadataFailures=[...requests.values()].filter(r=>r.status===412&&r.path==='/files/.kite3d/state.json')
    report.runs.at(-1).editorMetadataFailures=metadataFailures
    const onlyMetadata412=[...requests.values()].filter(r=>r.status===412).every(r=>r.path==='/files/.kite3d/state.json')
    assert(errors.every(e=>e.includes('net::ERR_CONNECTION_REFUSED')||e.includes('status of 404')||e.includes('status of 412')&&metadataFailures.length&&onlyMetadata412),JSON.stringify(errors))
    if(process.env.STARTUP_EXPECT_BAKED==='1'){assert(result.v2Stats[0].bakedReuse);assert(result.v2Stats[1].bakedReuse)}
    if(process.env.STARTUP_EXPECT_NO_ENEMY_OVERLAYS==='1')assert.equal(result.enemyPlates,0)
    assert([...requests.values()].filter(r=>r.status>=400).every(r=>r.status===404&&['/favicon.ico','/files/.kite3d/console.log'].includes(r.path)||r.status===412&&r.path==='/files/.kite3d/state.json'),'Unexpected failed HTTP asset')
    assert.equal(result.quality,'high');assert.equal(result.fov,72)
    await page.screenshot({path:output.replace(/\.json$/,'')+'-'+mode+'.png'})
    console.log(JSON.stringify({mode,editorToMenuMs:menuAt-ready.editorAt,menuPlayToWorldMs:ready.at-ready.menuPlayAt,enemies:result.enemies,visuals:result.visuals}))
    if(mode==='cold-editor')await page.getByTestId('play').click()
  }
  if(await page.evaluate(()=>window.terminator?.manager?.started))await page.getByTestId('play').click()
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
