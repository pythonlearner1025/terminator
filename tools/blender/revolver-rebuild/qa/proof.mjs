// Actual editor Play + GameManager/WeaponView, one private Linux Chromium tab.
// Invoke through run.sh: the lock and cgroup are part of the proof contract.
import {chromium} from 'playwright'
import {readFile, writeFile, mkdir, copyFile, access} from 'node:fs/promises'
import {execFile, execFileSync} from 'node:child_process'
import {promisify} from 'node:util'
import {resolve,dirname} from 'node:path'
import {freezeGate,digest,SOURCE} from './export-contract.mjs'
const run = promisify(execFile)
if (process.env.REVOLVER_QA_LOCKED !== '1') throw Error('Use qa/run.sh for resource isolation')
const argv=process.argv.slice(2),option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1]}
const mode=option('--mode','gameplay')
if(!['gameplay','check'].includes(mode))throw Error('Use --mode gameplay or --mode check')
const out=resolve(option('--out',`.kite3d/revolver-imported-${mode}`))
const manifestPath=resolve(option('--manifest','../coordination/revolver-retarget-ready.json'))
const exportPath=resolve(option('--export','tools/blender/revolver-rebuild/generated/assembled-imported/revolver-rebuild.gltf'))
const freeze=await freezeGate(manifestPath,option('--approved-manifest-sha'),exportPath)
await mkdir(out,{recursive:true})
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4777')throw Error('Expected QA private port 4777')
const safe=s=>String(s).replace(/([?&]t=)[^&\s"']+/g,'$1[private]').replaceAll(dev.token||'\0','[private]')
const pkg=JSON.parse(await readFile('package.json','utf8'))
const registeredPath='assets/models/weapons/revolver-rebuild/revolver-rebuild.gltf'
const original=JSON.parse(await readFile(exportPath,'utf8')),registered=await readFile(registeredPath)
for(const n of original.nodes)n.extras={...n.extras,gltfUUID:n.extras?.gltfUUID||'weapon-revolver-rebuild-'+n.name}
for(const a of original.animations)a.extras={...a.extras,rootRefs:['RevolverRebuildRig']}
if(JSON.stringify(original)!==JSON.stringify(JSON.parse(registered)))throw Error('Registered asset differs from the approved export plus register.mjs metadata')
for(const [name,hash]of Object.entries(freeze.contract.hashes))if(!name.endsWith('.gltf')&&digest(await readFile(resolve(dirname(registeredPath),name)))!==hash)throw Error('Registered resource differs: '+name)
const report={schema:2,startedAt:new Date().toISOString(),mode,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),reviewedBase:'d314ccd',kite:pkg.devDependencies.kite3d,mainScene:pkg.mainScene,freezeManifest:freeze.manifest,freezeManifestSha256:freeze.manifestSha256,exportHashes:freeze.contract.hashes,registeredGltfSha256:digest(registered),importedContract:freeze.contract,sourceCredit:SOURCE,viewport:[960,640],port:4777,captures:[],ownership:[],errors:[],warnings:[],httpErrors:[],requestFailures:[],stages:[],resources:[],limitations:['Actual WeaponsLab runtime with deterministic normal input stepping; not a performance benchmark.','Inspect alone uses authored clip sampling because gameplay has no Inspect binding.','The revolver has no crosshair; ADS target is canvas center.','Only the active rebuild variant is checked for retired geometry; other authored weapon templates retain their own assets.']}
const sourceFiles=execFileSync('git',['ls-files','main.js','lib','scripts','package.json','tools/blender/revolver-rebuild/qa'],{encoding:'utf8'}).trim().split('\n')
report.sourceFileHashes=Object.fromEntries(await Promise.all([...sourceFiles,pkg.mainScene,'assets.json'].map(async file=>[file,digest(await readFile(file))])))
let saveQueue=Promise.resolve()
const save=()=>{const json=JSON.stringify(report,null,2)+'\n';saveQueue=saveQueue.catch(()=>{}).then(()=>writeFile(`${out}/proof.json`,json));return saveQueue}
const stage = async name => {report.stages.push({name,ms:Date.now()-started});console.log(name);await save()}
const started=Date.now()
let browser,page,deadline,resourceTimer
const pendingRequests=new Map()
const resourceSample=async()=>{if(!report.cgroup)return;const row={ms:Date.now()-started};for(const f of ['memory.current','memory.peak','memory.events','pids.current','pids.events'])try{row[f]=(await readFile(`/sys/fs/cgroup${report.cgroup}/${f}`,'utf8')).trim()}catch{};row.pendingRequests=[...pendingRequests.values()].slice(0,12).map(r=>({path:r.path,ageMs:Date.now()-r.started}));try{const state=JSON.parse(await readFile('.kite3d/state.json','utf8'));row.editor={updatedAt:state.updatedAt,playState:state.playState,lastLoadError:safe(state.lastLoadError)}}catch{};report.resources.push(row)}
async function ownership(label) {
 const data=await page.evaluate(async label=>{
  if(label.startsWith('stop-'))return window.revolverQAStopped
  const E=await import('@kite3d/engine'),v=label==='after-official-check'?window.revolverQAEditor:window.viewer,m=window.terminator?.manager
  const snapshot=()=>{
   const names=[],byOwner={};let sceneNodes=0,authoredNodes=0
   v.scene.traverse(o=>{sceneNodes++;const r=o.userData.kite3dRuntime;if(r){names.push(o.name);byOwner[r.ownerId]=(byOwner[r.ownerId]||0)+1}})
   v.scene.modelRoot.traverse(()=>authoredNodes++)
   const c=v.scene.mainCamera
   return {running:v.getPlugin('EntityComponentPlugin')?.running||false,started:m?.started||false,sceneNodes,authoredNodes,names,byOwner,cleanup:E.runtimeCleanupReport(v),hud:document.querySelectorAll('[data-testid="terminator-hud"]').length,camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,near:c.near,controlsMode:c.controlsMode}}
  }
  if(label.startsWith('play-'))window.revolverQA.snapshot=snapshot
  return snapshot()
 },label)
 report.ownership.push({label,...data});await save()
}
async function advance(count,input={}) {await page.evaluate(({count,input})=>{for(let i=0;i<count;i++)window.revolverQA.step(input)}, {count,input})}
async function capture(name,method='world-input',requested={}) {
 await stage('capture:'+name)
 await page.evaluate(()=>{window.terminator.manager.ctx.viewer.setDirty();return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})
 const data=await page.evaluate(()=>{
  const m=window.terminator.manager,w=m.playerView.weapons,r=w.rigs.pistol,cp=r.clipPlayer,T=window.revolverQA.T,v=m.ctx.viewer,c=m.playerView.camera
  w.beforeRender(c);v.scene.updateMatrixWorld(true);r.root.traverse(n=>{if(n.isSkinnedMesh)n.skeleton.update()})
  const rect=v.canvas.getBoundingClientRect(), bounds={},sights={}
  const point=new T.Vector3(),project=p=>p.clone().applyMatrix4(c.matrixWorldInverse).applyMatrix4(w.camera.projectionMatrix)
  const handMeshes=r.root.userData.viewModel.embeddedHandMeshes
  for(const name of ['FrontSight','RearSight','Frame','Cylinder','Hammer',...handMeshes]){
   const o=r.root.getObjectByName(name);if(!o)continue
   let vertices=[]
   o.traverse(n=>{if(!n.isMesh||!n.visible)return;const a=n.geometry.attributes.position;for(let i=0;i<a.count;i++){if(n.getVertexPosition)n.getVertexPosition(i,point);else point.fromBufferAttribute(a,i);vertices.push(n.localToWorld(point.clone()))}})
   if(!vertices.length)continue
   const ps=vertices.map(project),zs=vertices.map(p=>p.clone().applyMatrix4(c.matrixWorldInverse).z)
   bounds[name]={pixels:[Math.min(...ps.map(p=>(p.x+1)*rect.width/2)),Math.min(...ps.map(p=>(1-p.y)*rect.height/2)),Math.max(...ps.map(p=>(p.x+1)*rect.width/2)),Math.max(...ps.map(p=>(1-p.y)*rect.height/2))],vertices:ps.length,offscreenVertices:ps.filter(p=>Math.abs(p.x)>1||Math.abs(p.y)>1).length,nearClippedVertices:zs.filter(z=>z>-w.camera.near).length}
   if(name.endsWith('Sight')){
    const local=vertices.map(p=>r.root.worldToLocal(p.clone())),top=Math.max(...local.map(p=>p.y)),selected=local.filter(p=>p.y>top-1e-5),center=selected.reduce((s,p)=>s.add(p),new T.Vector3()).multiplyScalar(1/selected.length),p=project(r.root.localToWorld(center))
    sights[name]={pixel:[(p.x+1)*rect.width/2,(1-p.y)*rect.height/2],offsetFromCenter:[p.x*rect.width/2,-p.y*rect.height/2],selectedTopVertices:selected.length}
   }
  }
  const retiredGeometry=[];r.root.traverse(n=>{if(n.isMesh&&/^(HandMesh(Right|Left)|Sleeve(Right|Left)|RightHand|LeftHand)$/.test(n.name))retiredGeometry.push(n.name)})
  const skin=[];r.root.traverse(n=>{if(n.isSkinnedMesh){const a=n.geometry.attributes.position,samples=[];for(let i=0;i<a.count;i+=Math.max(1,Math.floor(a.count/128))){n.getVertexPosition(i,point);samples.push([i,...point.toArray()])}skin.push({name:n.name,vertices:a.count,bones:n.skeleton.bones.map(b=>b.name),boneCount:n.skeleton.bones.length,bonePose:n.skeleton.bones.map(b=>({name:b.name,position:b.position.toArray(),quaternion:b.quaternion.toArray()})),samples,sourceSkeletonReused:window.revolverQA.authoredSkeletons.includes(n.skeleton)})}})
  const cartridges=Object.fromEntries(['Case','Fresh','Bullet'].map(prefix=>[prefix,Array.from({length:6},(_,i)=>{const n=r.root.getObjectByName(prefix+i);return {name:n?.name,scale:n?.scale.toArray(),position:n?.position.toArray(),visible:n?.visible}})]))
  return {cartridges,spent:[...cp.spent],retiredGeometry,manager:m.constructor.ComponentType,embeddedHandMeshes:handMeshes,skin,markerPositions:Object.fromEntries(['Muzzle','HandRight','HandLeft','Cylinder','Hammer'].map(name=>[name,r.root.getObjectByName(name)?.getWorldPosition(new T.Vector3()).toArray()])),tick:m.world.tick,activeVariant:w.variant,clip:cp.name,clipTime:cp.actions.get(cp.name)?.time,clipDuration:cp.actions.get(cp.name)?.getClip().duration,clipFraction:cp.actions.get(cp.name)?cp.actions.get(cp.name).time/cp.actions.get(cp.name).getClip().duration:null,reloadProgress:m.world.player.reloadTimer>0?1-m.world.player.reloadTimer/m.world.weaponCatalog.weapons.pistol.reloadSeconds:0,clips:[...cp.actions.keys()],aimAmount:w.animation.aimAmount,shots:cp.shots,ammo:{...m.world.player.ammo.pistol},reloadTimer:m.world.player.reloadTimer,velocity:{...m.world.player.vel},canvas:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},weaponFov:w.camera.fov,worldFov:c.fov,reticle:[rect.width/2,rect.height/2],bounds,sights,hammer:r.root.getObjectByName('Hammer').quaternion.toArray(),cylinder:r.root.getObjectByName('Cylinder').quaternion.toArray(),freshScales:Array.from({length:6},(_,i)=>r.root.getObjectByName('Fresh'+i)?.scale.toArray()),fx:{...w.fx.revolver?.stats},renderer:v.renderManager.webglRenderer.info.render}
 })
 await page.getByTestId('game-canvas').screenshot({path:`${out}/${name}.png`,timeout:10000})
 const png=await readFile(`${out}/${name}.png`)
 report.captures.push({name,method,...requested,imageSha256:digest(png),imageSize:[png.readUInt32BE(16),png.readUInt32BE(20)],...data});await save()
 if(data.skin.length!==1||data.skin[0].boneCount!==49||data.skin[0].sourceSkeletonReused||data.retiredGeometry.length||JSON.stringify(data.embeddedHandMeshes)!==JSON.stringify(data.skin.map(s=>s.name)))throw Error('Live imported skin contract failed; see capture JSON')
}
async function enterMatch() {
 await stage('play-requested')
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:45000})
 await stage('manager-started')
 await page.evaluate(async()=>{
  const m=window.terminator.manager
  if(m.constructor.ComponentType!=='WeaponsLab')throw Error('Expected WeaponsLab manager')
  await m.ready;m.range.setReloads(true);m.rangeView.setInspect(false)
  m.lobby?.stop();m.director.pauseWaves()
  const authoredSkeletons=[];m.ctx.viewer.scene.modelRoot.traverse(n=>{if(n.isSkinnedMesh)authoredSkeletons.push(n.skeleton)})
  window.revolverQA={T:await import('threepipe'),authoredSkeletons,originalUpdate:m.update,originalStyle:m.ctx.viewer.container.getAttribute('style')}
  // Freeze wall time; each action still goes through World.step and all view adapters.
  m.update=()=>true
  m.playerView.weapons.selectVariant('revolver-rebuild');m.mapView.bindWeapon(m.playerView.weapons.materials)
  m.world.player.yaw=0;m.world.player.pitch=0;m.syncViews()
  window.revolverQA.step=(input={})=>{const controls={yaw:0,pitch:0,...input};if(m.range){m.director.pauseWaves();m.director.step(m.range.input(controls,null));m.range.afterStep();m.cameraFeel.consume(m.world)}else m.world.step(controls);m.syncViews()}
 })
 await advance(70)
 await stage('gameplay-ready')
}
async function stop() {
 await page.evaluate(()=>{const m=window.terminator.manager,q=window.revolverQA;m.update=q.originalUpdate;const container=m.ctx.viewer.container;if(q.originalStyle===null)container.removeAttribute('style');else container.setAttribute('style',q.originalStyle);m.ctx.viewer.resize()})
 await page.evaluate(()=>{const ecp=window.terminator.manager.ctx.ecp,original=ecp.stop;ecp.stop=function(...args){const value=original.apply(this,args);window.revolverQAStopped=window.revolverQA.snapshot();return value}})
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>!window.kite3dGame)
 // Do not retain closures containing a disposed Play viewer across restart.
 await page.evaluate(()=>{delete window.revolverQA})
 await stage('editor-stopped')
}
try {
 const mem=Number((await readFile('/proc/meminfo','utf8')).match(/MemAvailable:\s+(\d+)/)[1]);report.memAvailableKiB=mem
 if(mem<3145728)throw Error('MemAvailable fell below 3 GiB before launch')
 const cg=(await readFile('/proc/self/cgroup','utf8')).split('\n').find(s=>s.startsWith('0::'))?.slice(3)
 report.cgroup=cg
 report.caps=Object.fromEntries(await Promise.all(['memory.max','memory.high','pids.max','cpu.max'].map(async f=>[f,await readFile(`/sys/fs/cgroup${cg}/${f}`,'utf8').then(s=>s.trim()).catch(()=>f==='cpu.max'?'CPUQuota=200% requested via systemd (legacy CPU controller)':'unavailable')])))
 if(report.caps['memory.max']!=='1887436800'||report.caps['pids.max']!=='192')throw Error('Required cgroup caps missing')
 const fullBrowser=chromium.executablePath(),headlessShell=fullBrowser.replace('/chromium-','/chromium_headless_shell-').replace('/chrome-linux64/chrome','/chrome-headless-shell-linux64/chrome-headless-shell')
 const executable=process.env.REVOLVER_QA_CHROMIUM||headlessShell
 await access(executable)
 report.browserExecutable=executable
 resourceTimer=setInterval(()=>{resourceSample().then(save).catch(()=>{})},2500)
 browser=await chromium.launch({headless:true,executablePath:executable,timeout:15000,args:['--no-sandbox','--use-angle=vulkan','--enable-features=Vulkan','--disable-vulkan-surface','--ignore-gpu-blocklist','--disable-dev-shm-usage','--renderer-process-limit=1','--num-raster-threads=2','--autoplay-policy=no-user-gesture-required']})
 report.browserVersion=browser.version()
 deadline=setTimeout(()=>browser.close().catch(()=>{}),115000-(Date.now()-started))
 page=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:1})
 page.setDefaultTimeout(15000)
 page.on('pageerror',e=>report.errors.push(safe(e.message)))
 page.on('console',e=>{if(e.type()==='error')report.errors.push(safe(e.text()));else if(e.type()==='warning')report.warnings.push(safe(e.text()))})
 page.on('request',r=>pendingRequests.set(r,{path:new URL(r.url()).pathname,started:Date.now()}))
 page.on('requestfinished',r=>pendingRequests.delete(r))
 page.on('requestfailed',r=>{pendingRequests.delete(r);report.requestFailures.push({path:new URL(r.url()).pathname,error:safe(r.failure()?.errorText)})})
 page.on('response',r=>{if(r.status()>=400)report.httpErrors.push({status:r.status(),path:new URL(r.url()).pathname})})
 await stage('browser-started')
 await page.goto(dev.url,{waitUntil:'domcontentloaded',timeout:30000})
 await page.getByTestId('play').waitFor({timeout:30000})
 await stage('editor-loaded')
 await page.evaluate(()=>{window.revolverQAEditor=window.viewer})
 await page.waitForTimeout(2500)
 report.initialDialogs=await page.locator('.bp5-dialog').allTextContents();await save()
 console.log(JSON.stringify({dialogs:report.initialDialogs}))
 for(let i=0;i<6;i++){const buttons=page.getByRole('button',{name:'OK',exact:true});if(!await buttons.count())break;await buttons.first().click();await page.waitForTimeout(100)}
 if(mode==='gameplay'){
 await enterMatch();await stage('gameplay-started')
 await ownership('play-1')
 await capture('00-editor-hip')
 await page.evaluate(()=>{const v=window.viewer;Object.assign(v.container.style,{position:'fixed',left:'0',top:'0',width:'960px',height:'640px',maxWidth:'none',maxHeight:'none',zIndex:'999'});v.setSize({width:960,height:640});v.resize()})
 await capture('01-hip')
 await advance(45,{aim:true});await capture('02-ads')
 await advance(45)
 await advance(1,{fire:true});await advance(3);await capture('03-fire')
 await advance(50);await capture('04-after-fire')
 for(let shot=0;shot<5;shot++){await advance(1,{fire:true});if(shot<4)await advance(40)}
 report.reloadStart=await page.evaluate(()=>{const m=window.terminator.manager;return {tick:m.world.tick,timerBeforeRequest:m.world.player.reloadTimer,ammo:m.world.player.ammo.pistol.mag,authoredShots:m.playerView.weapons.rigs.pistol.clipPlayer.shots,fxShots:m.playerView.weapons.fx.revolver.stats.shots}})
 await advance(1,{reload:true})
 for(const [name,fraction]of[['open',.17],['eject',.34],['insert',.67],['close',.84],['return',.96]]){
  const timing=await page.evaluate(target=>{
   const m=window.terminator.manager,duration=m.world.weaponCatalog.weapons.pistol.reloadSeconds,tolerance=1/60/duration+1e-6
   const progress=()=>1-m.world.player.reloadTimer/duration
   if(m.world.player.reloadTimer<=0)throw Error('Reload is not active')
   if(progress()>target+tolerance)throw Error('Requested reload phase already passed: '+target+' < '+progress())
   let steps=0;while(progress()<target&&steps<600){window.revolverQA.step();steps++}
   const clip=m.playerView.weapons.rigs.pistol.clipPlayer,action=clip.actions.get(clip.name),actual=action.time/action.getClip().duration
   if(clip.name!=='Reload'||Math.abs(actual-target)>tolerance)throw Error('Reload clip fraction does not match request')
   return {requestedReloadFraction:target,actualReloadFraction:actual,phaseTolerance:tolerance,phaseAdvanceTicks:steps}
  },fraction)
  await capture(`05-reload-${name}`,'world-input',timing)
 }
 await advance(80);await capture('06-reloaded')
 await advance(35,{move:{x:0,z:1},sprint:true});await capture('07-sprint')
 await advance(45)
 await page.evaluate(()=>{const w=window.terminator.manager.playerView.weapons;w.rigs.pistol.clipPlayer.sample('Inspect',w.rigs.pistol.clipPlayer.actions.get('Inspect').getClip().duration*.5);window.viewer.setDirty()})
 await capture('08-inspect','authored Inspect midpoint in live WeaponsLab renderer; no gameplay binding')
 await stage('captures-complete')
 await stop();await ownership('stop-1')
 const cdp=await page.context().newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');await cdp.detach()
 report.garbageCollectionBetweenPlays=true
 await enterMatch();await ownership('play-2');await capture('09-restarted-hip');await stop();await ownership('stop-2')
 await stage('restart-complete')
 }
 if(mode==='check'){
 // Require a live stopped editor; official CLI then uses this same tab.
 let state
 for(let attempt=0;attempt<100;attempt++){try{state=JSON.parse(await readFile('.kite3d/state.json','utf8'));if(Date.parse(state.updatedAt)>=started&&state.projectLoaded&&state.playState==='stopped')break}catch{};await new Promise(r=>setTimeout(r,250))}
 if(!state)throw Error('Connected editor did not publish state')
 report.stateBeforeCheck={updatedAt:state.updatedAt,playState:state.playState,clientId:state.clientId}
 if(Date.now()-Date.parse(state.updatedAt)>15000)throw Error('Editor state stale; refusing a fallback second browser')
 const remaining=Math.min(85000,108000-(Date.now()-started))
 if(remaining<5000)throw Error('Insufficient time remaining for official check')
 await stage('official-check-requested')
 try {const result=await run('npx',['--no-install','kite3d','check'],{timeout:remaining,maxBuffer:1024*1024,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:resolve(out,'no-fallback-browser')}});report.checkOutput=safe(result.stdout+result.stderr)}catch(e){report.checkOutput=safe((e.stdout||'')+(e.stderr||'')+'\n'+e.message)}
 const checkText=await readFile('.kite3d/check.json','utf8').catch(()=>null)
 if(!checkText)throw Error('Official check did not produce check.json within the bounded run')
 report.check=JSON.parse(checkText)
 if(Date.parse(report.check.checkedAt)<started)throw Error('Official check.json predates this run')
 await copyFile('.kite3d/check.json',`${out}/check.json`)
 await ownership('after-official-check')
 await stage('official-check-complete')
 }
 report.completed=true
} catch(e) {report.failure=safe(e.stack||e);process.exitCode=1;console.error(safe(e.message));if(page)try{report.pageText=safe(await page.locator('body').innerText({timeout:2000}));await page.screenshot({path:`${out}/failure.png`,timeout:3000})}catch{}}
finally {
 clearTimeout(deadline);clearInterval(resourceTimer)
 await resourceSample()
 if(browser)await browser.close().catch(()=>{})
 report.elapsedMs=Date.now()-started;report.closedOwnBrowser=true
 for(const file of ['state.json','console.log'])try{await writeFile(`${out}/${file}`,safe(await readFile(`.kite3d/${file}`,'utf8')))}catch{}
 await save()
 console.log(JSON.stringify({output:out,completed:report.completed||false,captures:report.captures.length,errors:report.errors.length,elapsedMs:report.elapsedMs}))
}
