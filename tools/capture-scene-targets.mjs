/** Reproduce real PlayerView POVs without editing the scene or the user's editor. */
import {mkdir,readFile,writeFile,access,readdir} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser, browserOptions} from './v2/capture-browser.mjs'
import {loadPilotOverrides} from './v2/capture-pilot-overrides.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const config=JSON.parse(await readFile(resolve(root,'docs/scene-targets/views.json'),'utf8'))
const out=resolve(root,process.argv[2] || 'docs/evidence/scene-candidate')
await mkdir(out,{recursive:true})
const selectedViews=process.env.CAPTURE_VIEW ? config.views.filter(view=>process.env.CAPTURE_VIEW.split(',').includes(view.id)) : config.views
if(!selectedViews.length)throw Error('Unknown CAPTURE_VIEW')
for(const view of selectedViews) {
  try {await access(resolve(out,view.id+'.png'));throw new Error(`Refusing to overwrite ${view.id}. Choose a new output folder.`)}
  catch(error){if(error.code!=='ENOENT')throw error}
}
const dev=JSON.parse(await readFile(resolve(root,'.kite3d/dev.json'),'utf8'))
const pilotOverrides=loadPilotOverrides()
const transparencyDiagnostic=process.env.CAPTURE_TRANSPARENCY_DIAGNOSTIC==='1'
const browser=await launchCaptureBrowser()
const manifest={schema:3,config,launch:browserOptions(),captureEnvironment:{headless:browserOptions().headless,browserArgs:browserOptions().args},sourceCommit:process.env.CAPTURE_SOURCE_COMMIT||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceFiles:{},harnessSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),worktreeStatus:execFileSync('git',['status','--short'],{cwd:root,encoding:'utf8'}),git:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),browser:browser.version(),platform:process.platform,deviceScaleFactor:1,mode:'Actual PlayerView; first-wave start held still; default map state; fixed presentation tick; no enemies advanced',views:[]}
async function sourceTree(directory) {
 const result=[]
 for(const entry of await readdir(resolve(root,directory),{withFileTypes:true}).catch(()=>[])) {
  const path=directory+'/'+entry.name
  if(entry.isDirectory())result.push(...await sourceTree(path))
  else if(entry.isFile())result.push(path)
 }
 return result
}
manifest.browserCgroup=browser.captureCgroup
const sources=['lib/view/map.js','lib/view/map-batching.js','scripts/GameManager.script.js','main.js','package.json','assets/main.scene.gltf','assets/models/map/rubble-1x1p5x12-zh655b/rubble-1x1p5x12-zh655b.gltf',...await sourceTree('lib/core'),...await sourceTree('generators'),...await sourceTree('lib/view/v2'),...await sourceTree('assets/v2')]
for(const file of sources.sort())manifest.sourceFiles[file]=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')
manifest.harnessSources={}
for(const file of ['tools/capture-scene-targets.mjs','tools/v2/capture-browser.mjs','tools/v2/capture-gpu-timing.mjs','tools/v2/capture-pilot-overrides.mjs','tools/v2/capture-transparency-diagnostic.mjs'])manifest.harnessSources[file]=createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')
if(pilotOverrides){
 manifest.diagnosticOverrides=pilotOverrides.manifest
 // The immutable-mode validator must reject a diagnostic as final evidence.
 manifest.mode='Diagnostic browser module overrides; '+manifest.mode
 console.log('DIAGNOSTIC PILOT: browser-only module overrides; not integrated acceptance evidence')
}
if(transparencyDiagnostic){manifest.transparencyDiagnostic={purpose:'Unapproved temporary per-viewer compositor correction',equation:'a.rgb*(1.-b.a)+b.rgb'};manifest.mode='Diagnostic compositor override; '+manifest.mode}
const clean=value=>String(value).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
try {
 for(const view of selectedViews){
  const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1})
  await pilotOverrides?.install(page)
  const errors=[]
  page.on('pageerror',e=>errors.push(clean(e.message)))
  page.on('console',e=>{if(e.type()==='error')errors.push(clean(e.text()))})
  await page.addInitScript(({seed,settings})=>{
   let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296}
   localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))
  },config)
  await page.request.get(dev.url)
  await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
  const state=await page.evaluate(async({view,config,transparencyDiagnostic})=>{
   const m=window.terminator.manager
   m.update=()=>true // Stop simulation, not rendering; no scene/source mutation.
   await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup
   m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
   if(transparencyDiagnostic){const {installTransparencyDiagnostic}=await import('/files/tools/v2/capture-transparency-diagnostic.mjs');window.__transparencyDiagnostic=installTransparencyDiagnostic(window.viewer)}
   const p=m.world.player
   p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
   const support=m.world.playerSupportAt(p.pos,p.pos.y,{radius:.3,maxAbove:.05,maxBelow:.05})
   if(!support||!m.world.playerHasHeadClearance(p.pos,1.8,support))throw Error('Invalid standing POV: '+view.id)
   const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-(p.pos.y+1.65),dz=view.lookAt[2]-p.pos.z
   p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
   for(let tick=0;tick<=config.tick;tick++){m.world.tick=tick;m.mapView.sync(m.world);m.playerView.sync(m.world)}
   m.syncUi(true);m.hud.sync()
   const camera=m.playerView.camera
   window.referenceFrame=()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);window.viewer.setDirty()}
   window.viewer.addEventListener('preFrame',window.referenceFrame)
   const gl=window.viewer.canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info')
   const rm=window.viewer.renderManager,r=rm.webglRenderer
   const renderSettings={drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],pixelRatio:r.getPixelRatio(),renderScale:rm.renderScale,maxRenderScale:window.viewer.maxRenderScale??null,antialias:gl.getContextAttributes().antialias,msaa:rm.msaa??null,outputColorSpace:r.outputColorSpace,quality:m.mapView.quality}
   const moduleStats=Object.fromEntries((m.mapView.v2ModuleNames||[]).map((name,index)=>[name,JSON.parse(JSON.stringify(m.mapView.v2Handles?.[index]?.stats||{}))]))
   const coverRecords=m.mapData.colliders.filter(c=>c.v2ArchitectureCover)
   const declaredCover={records:JSON.parse(JSON.stringify(coverRecords)),originalColliderCount:m.mapData.colliders.length-coverRecords.length,compoundBoxes:coverRecords.reduce((n,c)=>n+(c.shapes?.length||0),0),renderedPileIds:[]}
   m.mapView.root.traverse(object=>{if(object.isMesh&&object.userData.v2PileCover)declaredCover.renderedPileIds.push(...object.userData.sourceColliderIds)})
   declaredCover.renderedPileIds=[...new Set(declaredCover.renderedPileIds)].sort()
   if(JSON.stringify(declaredCover.renderedPileIds)!==JSON.stringify(coverRecords.map(c=>c.id).sort()))throw Error('Declared cover and ready rendered pile IDs differ')
   const atmosphereTextures=[],seenTextures=new Set()
   m.mapView.root.traverse(object=>{for(const material of Array.isArray(object.material)?object.material:[object.material]){
    const texture=material?.map
    if(!texture?.name?.startsWith('V2 independent smoke volume ')||seenTextures.has(texture))continue
    seenTextures.add(texture);atmosphereTextures.push({name:texture.name,width:texture.image?.width,height:texture.image?.height,colorSpace:texture.colorSpace,bytes:texture.image?.data?.byteLength})
   }})
   atmosphereTextures.sort((a,b)=>a.name.localeCompare(b.name))
   const ssao=window.viewer.getPlugin('SSAOPlugin'),gbuffer=window.viewer.getPlugin('GBuffer')
   const plugins={ssao:ssao?{present:true,enabled:ssao.enabled,intensity:ssao.pass.intensity,occlusionWorldRadius:ssao.pass.occlusionWorldRadius,numSamples:ssao.pass.numSamples,bias:ssao.pass.bias,target:ssao.target?{width:ssao.target.width,height:ssao.target.height,sizeMultiplier:ssao.target.sizeMultiplier}:null}:{present:false},gbuffer:gbuffer?{present:true,enabled:gbuffer.enabled,target:gbuffer.target?{width:gbuffer.target.width,height:gbuffer.target.height,sizeMultiplier:gbuffer.target.sizeMultiplier}:null}:{present:false}}
   return {renderSettings,moduleStats,declaredCover,atmosphereTextures,plugins,feet:{...p.pos},support:JSON.parse(JSON.stringify(support)),camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far},tick:m.world.tick,mapState:m.world.mapState,weapon:p.activeWeapon,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'}
  },{view,config,transparencyDiagnostic})
  if(process.platform==='linux' && !/NVIDIA/.test(state.renderer))throw Error('Expected NVIDIA renderer, received '+state.renderer)
  await page.evaluate(()=>document.fonts.ready)
  await page.waitForTimeout(1800)
  const performance=await page.evaluate(async()=>{
   const samples=[];let previous
   for(let i=0;i<121;i++)await new Promise(resolve=>requestAnimationFrame(time=>{if(previous!==undefined)samples.push(time-previous);previous=time;resolve()}))
   const sorted=[...samples].sort((a,b)=>a-b),renderer=window.viewer.renderManager.webglRenderer
   return {samplesMs:samples,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,render:renderer?.info?.render,memory:renderer?.info?.memory}
  })
  const file=resolve(out,view.id+'.png')
  // Inspect the actual main-camera draw, without changing shaders or scene state.
  const volumeDraws=await page.evaluate(async()=>{
   const m=window.terminator.manager,records=[],restores=[]
   m.mapView.root.traverse(object=>{
    if(!object.userData.v2Volume)return
    const original=object.onAfterRender
    object.onAfterRender=function(renderer,scene,camera,geometry,material,group){
     original?.call(this,renderer,scene,camera,geometry,material,group)
     if(camera!==m.playerView.camera||records.some(record=>record.name===object.name))return
     const props=renderer.properties.get(material),program=props.currentProgram,gl=renderer.getContext()
     const texture=props.uniforms?.v2VolumeAtlas?.value,location=program?.program?gl.getUniformLocation(program.program,'v2VolumeAtlas'):null
     const unit=location===null?null:gl.getUniform(program.program,location),active=gl.getParameter(gl.ACTIVE_TEXTURE)
     let boundMatches=false
     try{if(Number.isInteger(unit)){gl.activeTexture(gl.TEXTURE0+unit);boundMatches=gl.getParameter(gl.TEXTURE_BINDING_2D)===renderer.properties.get(texture).__webglTexture}}
     finally{gl.activeTexture(active)}
     const uniform=key=>{const value=props.uniforms?.[key]?.value;return value?.toArray?.()??value??null}
     records.push({name:object.name,programId:program?.id,programLinked:!!program?.program&&gl.getProgramParameter(program.program,gl.LINK_STATUS),
      position:object.position.toArray(),quaternion:object.quaternion.toArray(),matrixWorld:object.matrixWorld.toArray(),contract:object.userData.v2Volume,
      vertices:geometry.attributes.position.count,triangles:(geometry.index?.count??geometry.attributes.position.count)/3,
      atlas:{name:texture?.name,width:texture?.image?.width,height:texture?.image?.height,bytes:texture?.image?.data?.byteLength,colorSpace:texture?.colorSpace,unit,boundMatches},
      halfSize:uniform('v2VolumeHalfSize'),step:uniform('v2VolumeStep'),right:uniform('v2VolumeRight'),up:uniform('v2VolumeUp'),forward:uniform('v2VolumeForward'),camera:uniform('v2VolumeCamera'),
      material:{depthTest:material.depthTest,depthWrite:material.depthWrite,blending:material.blending,premultipliedAlpha:material.premultipliedAlpha,transparent:material.transparent,side:material.side,forceSinglePass:material.forceSinglePass,fog:material.fog,renderToGBuffer:material.userData.renderToGBuffer}})
    }
    restores.push(()=>{object.onAfterRender=original})
   })
   try{if(restores.length)for(let i=0;i<3;i++){window.viewer.setDirty();await new Promise(resolve=>requestAnimationFrame(resolve))}}
   finally{for(const restore of restores)restore()}
   if(records.length!==restores.length)throw Error('Volume mesh did not produce an observed main-camera draw')
   return records
  })
  if(volumeDraws.some(draw=>!draw.programLinked||!draw.atlas.boundMatches))throw Error('Volume GPU program or atlas binding failed')
  const png=await page.screenshot({path:file,animations:'disabled'})
  manifest.views.push({id:view.id,...state,volumeDraws,performance,sha256:createHash('sha256').update(png).digest('hex'),errors})
  await page.evaluate(()=>{window.viewer.removeEventListener('preFrame',window.referenceFrame);window.__transparencyDiagnostic?.dispose();window.terminator.manager.stop()})
  await writeFile(resolve(out,'capture.json'),JSON.stringify(manifest,null,2)+'\n')
  await page.close()
  if(errors.length)throw new Error(errors.join('\n'))
  console.log(`Captured ${view.id} at ${state.camera.fov}° from supported player feet`)
 }
 await writeFile(resolve(out,'capture.json'),JSON.stringify(manifest,null,2)+'\n')
}catch(error){throw new Error(clean(error.message))}finally{await browser.close()}
