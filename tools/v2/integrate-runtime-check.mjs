import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const out=process.argv[2]||'docs/evidence/v2-integration-checks'
const browser=await launchCaptureBrowser()
const pilotOverrides=loadPilotOverrides()
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),cycles:[],errors:[]}
if(pilotOverrides)report.diagnosticOverrides=pilotOverrides.manifest
try {
 const page=await browser.newPage({viewport:config.viewport})
 await pilotOverrides?.install(page)
 page.on('pageerror',e=>report.errors.push(e.message.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]')))
 await page.addInitScript(settings=>localStorage.setItem('terminator.settings.v1',JSON.stringify(settings)),config.settings)
 await page.request.get(dev.url)
 await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 report.renderer=await rendererInfo(page)
 for(let cycle=0;cycle<3;cycle++){
  const result=await page.evaluate(async({cycle,views})=>{
   const m=window.terminator.manager
   if(cycle)m.start()
   m.prepareMap?.() // Preparation is deferred until after the menu paints.
   m.update=()=>true
   const mapBefore=JSON.stringify(m.mapData)
   const renderPass=window.viewer.renderManager.renderPass,originalBlend=renderPass._blendPass
   const originalBlendState={material:originalBlend.material,shader:originalBlend.material.fragmentShader,uniforms:originalBlend.uniforms,compile:originalBlend.material.onBeforeCompile,key:originalBlend.material.customProgramCacheKey}
   const originalBlendCallbacks=[...(originalBlend.material._listeners?.dispose||[])]
   const renderer=window.viewer.renderManager.webglRenderer, originalRender=renderer.render, originalModes=renderer.renderWithModes, originalAuto=window.viewer.scene.matrixWorldAutoUpdate
   const gpuResources=()=>{const r=window.viewer.renderManager.webglRenderer;return {...r.info.memory,programs:r.info.programs?.length||0}}
   const initialResources=gpuResources()
   const materialState=mat=>JSON.stringify({color:mat.color?.toArray(),emissive:mat.emissive?.toArray(),emissiveIntensity:mat.emissiveIntensity,
    roughness:mat.roughness,metalness:mat.metalness,fog:mat.fog,opacity:mat.opacity,transparent:mat.transparent,side:mat.side,
    normalScale:mat.normalScale?.toArray(),envMapIntensity:mat.envMapIntensity,
    maps:Object.fromEntries(['map','normalMap','roughnessMap','metalnessMap','emissiveMap','aoMap','alphaMap'].map(key=>{
     const t=mat[key];return [key,t?{uuid:t.uuid,repeat:t.repeat.toArray(),offset:t.offset.toArray(),rotation:t.rotation,wrapS:t.wrapS,wrapT:t.wrapT,colorSpace:t.colorSpace}:null]
    }))})
   const sourceMaterials=new Map()
   const authoredPlacements=[...m.mapView.batching.placements]
   const placementState=authoredPlacements.map(p=>({object:p,position:p.position.toArray(),quaternion:p.quaternion.toArray(),scale:p.scale.toArray()}))
   for(const source of [window.viewer.scene.modelRoot,...authoredPlacements,...(m.mapView.previewState?[m.mapView.previewState.node]:[])])source.traverse(o=>{if(o.material)for(const mat of Array.isArray(o.material)?o.material:[o.material])sourceMaterials.set(mat,materialState(mat))})
   const sourceTextureListeners=new Map()
   for(const material of sourceMaterials.keys())if(/^Selected rubble \d:/.test(material.name)&&material.map){const texture=material.map;sourceTextureListeners.set(texture,texture._listeners?.update?.length||0)}
   const sourceBatches=m.mapView.batching.batches.map(mesh=>({mesh,geometry:mesh.geometry,
    provenance:JSON.stringify(mesh.geometry.userData.mapSourceRanges)}))
   const counts=geometry=>{
    const totals=new Map(),ranges=geometry.userData.mapSourceRanges
    if(ranges?.version!==1||ranges.unit!=='draw-elements')throw Error('Missing canonical source provenance')
    let end=0
    for(const r of ranges.entries){if(r.start!==end||r.count<=0||r.count%3)throw Error('Invalid source range');end+=r.count;totals.set(r.pieceId,(totals.get(r.pieceId)||0)+r.count)}
    if(end!==(geometry.index?.count??geometry.attributes.position.count))throw Error('Source ranges do not cover draw stream')
    return totals
   }
   const originals=sourceBatches.map(record=>counts(record.geometry))
   await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup
   const mapView=m.mapView
   const before={compositorOwned:mapView.v2Transparency?.attached===true&&renderPass._blendPass!==originalBlend,gpuResources:gpuResources(),initialResources,modules:mapView.v2Handles?.length||0,previewVisible:mapView.previewState?.node.visible ?? (window.viewer.scene.modelRoot.getObjectByName('V2 Environment Preview') || window.viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview'))?.visible,
    authoringLights:mapView.hiddenLights.map(([light,originalVisible])=>({name:light.name,visible:light.visible,originalVisible})),
    detachedPreviewGroups:mapView.previewState?.generated?.length||0,
    detachedPreviewRoots:mapView.previewState?.node.parent===null?1:0,
    roots:window.viewer.scene.children.filter(n=>n.name==='Map Runtime').length,
    supports:views.map(view=>{const pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};const support=m.world.playerSupportAt(pos,pos.y,{radius:.3,maxAbove:.05,maxBelow:.05});return {id:view.id,supported:!!support,clearance:!!support&&m.world.playerHasHeadClearance(pos,1.8,support)}})}
   const walls=new Set(m.mapData.colliders.filter(c=>['wall','building_wall','tunnel_wall','column'].includes(c.kind)).map(c=>c.id))
   before.provenance={batches:sourceBatches.length,changedBatches:0,removedWallTriangles:0,foreignChanges:[]}
   for(let i=0;i<sourceBatches.length;i++){
    const record=sourceBatches[i],current=counts(record.mesh.geometry)
    if(record.mesh.geometry!==record.geometry)before.provenance.changedBatches++
    for(const [id,count]of originals[i]){
     const removed=count-(current.get(id)||0)
     if(removed&& !walls.has(id))before.provenance.foreignChanges.push({id,removedElements:removed})
     else if(removed)before.provenance.removedWallTriangles+=removed/3
    }
    if(JSON.stringify(record.geometry.userData.mapSourceRanges)!==record.provenance)throw Error('Original source provenance mutated')
   }
   before.walks=views.map(view=>{
    const p=m.world.player;p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.grounded=true
    const yaw=Math.atan2(view.lookAt[0]-p.pos.x,view.lookAt[2]-p.pos.z)
    for(let tick=0;tick<20;tick++)m.world.step({move:{x:0,z:1},yaw})
    return {id:view.id,distance:Math.hypot(p.pos.x-view.feet[0],p.pos.z-view.feet[2]),end:{...p.pos}}
   })
   for(let tick=0;tick<180;tick++){m.world.tick=tick;m.mapView.sync(m.world)}
   const windowLights=['west','east'].map(side=>window.viewer.scene.getObjectByName(`V2 barracks ${side} window crosslight`))
   if(windowLights.some(light=>!light?.isSpotLight))throw Error('Missing integrated barracks window lights')
   const lights=m.world.mapState.lights,savedBuilding=lights.building,hadBuilding=Object.hasOwn(lights,'building')
   const originalWindowPower=windowLights.map(light=>light.intensity)
   before.windowZones={names:windowLights.map(light=>light.name),on:originalWindowPower}
   try {
    lights.building='off';m.mapView.sync(m.world)
    before.windowZones.off=windowLights.map(light=>light.intensity)
    lights.building='on';m.mapView.sync(m.world)
    before.windowZones.reenabled=windowLights.map(light=>light.intensity)
   } finally {
    if(hadBuilding)lights.building=savedBuilding;else delete lights.building
    m.mapView.sync(m.world)
   }
   before.windowZones.restored=windowLights.every((light,i)=>light.intensity===originalWindowPower[i])
   before.changedSourceMaterials=[...sourceMaterials].filter(([mat,snapshot])=>snapshot!==materialState(mat)).map(([mat])=>mat.name)
   const mapUnchanged=JSON.stringify(m.mapData)===mapBefore
   const authoringLights=mapView.hiddenLights.map(([light,originalVisible])=>({light,originalVisible}))
   m.stop()
   for(let frame=0;frame<3;frame++)await new Promise(resolve=>requestAnimationFrame(resolve))
   const changed=[]
   for(const [mat,snapshot] of sourceMaterials)if(snapshot!==materialState(mat))changed.push(mat.name)
   const after={frameRenderingRestored:renderer.render===originalRender&&renderer.renderWithModes===originalModes&&window.viewer.scene.matrixWorldAutoUpdate===originalAuto,placementsRestored:placementState.every(({object,position,quaternion,scale})=>object.parent&&JSON.stringify([object.position.toArray(),object.quaternion.toArray(),object.scale.toArray()])===JSON.stringify([position,quaternion,scale])),compositorRestored:renderPass._blendPass===originalBlend&&originalBlend.material===originalBlendState.material&&originalBlend.material.fragmentShader===originalBlendState.shader&&originalBlend.uniforms===originalBlendState.uniforms&&originalBlend.material.onBeforeCompile===originalBlendState.compile&&originalBlend.material.customProgramCacheKey===originalBlendState.key&&JSON.stringify((originalBlend.material._listeners?.dispose||[]).map(fn=>originalBlendCallbacks.indexOf(fn)))===JSON.stringify(originalBlendCallbacks.map((_,i)=>i)),sourceTextureListenerChanges:[...sourceTextureListeners].filter(([texture,count])=>(texture._listeners?.update?.length||0)!==count).map(([texture,before])=>({name:texture.name,before,after:texture._listeners?.update?.length||0})),batchGeometryRestored:sourceBatches.every(r=>r.mesh.geometry===r.geometry),
    sourceProvenancePreserved:sourceBatches.every(r=>JSON.stringify(r.geometry.userData.mapSourceRanges)===r.provenance),gpuResources:gpuResources(),authoringLightsRestored:authoringLights.every(({light,originalVisible})=>light.visible===originalVisible),roots:window.viewer.scene.children.filter(n=>n.name==='Map Runtime').length,
    previewVisible:(window.viewer.scene.modelRoot.getObjectByName('V2 Environment Preview') || window.viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview'))?.visible,
    handles:mapView.v2Handles?.length||0,changedSourceMaterials:changed,mapUnchanged}
   return {before,after}
  },{cycle,views:config.views})
  report.cycles.push(result)
  assert.equal(result.before.modules,5)
  assert.equal(result.before.compositorOwned,true)
  assert.equal(result.after.compositorRestored,true)
  assert.equal(result.after.frameRenderingRestored,true)
  assert.equal(result.after.placementsRestored,true)
  assert.equal(result.before.roots,1)
  assert.deepEqual(result.before.provenance.foreignChanges,[])
  assert.equal(result.after.batchGeometryRestored,true)
  assert.equal(result.after.sourceProvenancePreserved,true)
  assert.deepEqual(result.after.sourceTextureListenerChanges,[])
  assert.equal(result.before.previewVisible,false)
  assert.equal(result.before.detachedPreviewGroups,1)
  assert.equal(result.before.authoringLights.length,2)
  assert(result.before.authoringLights.every(light=>!light.visible))
  assert(result.before.supports.every(p=>p.supported&&p.clearance))
  assert(result.before.walks.every(w=>w.distance>.1))
  assert(result.before.windowZones.on.every(power=>power>0))
  assert.deepEqual(result.before.windowZones.off,[0,0])
  assert.deepEqual(result.before.windowZones.reenabled,result.before.windowZones.on)
  assert.equal(result.before.windowZones.restored,true)
  assert.deepEqual(result.before.changedSourceMaterials,[])
  assert.equal(result.after.roots,0)
  assert.equal(result.after.handles,0)
  assert.equal(result.after.previewVisible,true)
  assert.equal(result.after.mapUnchanged,true)
  assert.equal(result.after.authoringLightsRestored,true)
  assert.deepEqual(result.after.changedSourceMaterials,[])
 }
 report.earlyDispose=await page.evaluate(async()=>{
  const m=window.terminator.manager;m.start();m.startViews()
  const ready=m.mapView.ready;m.stop();await ready
  return {roots:window.viewer.scene.children.filter(n=>n.name==='Map Runtime').length,previewVisible:(window.viewer.scene.modelRoot.getObjectByName('V2 Environment Preview') || window.viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview'))?.visible}
 })
 assert.equal(report.earlyDispose.roots,0)
 assert.equal(report.earlyDispose.previewVisible,true)
 assert.deepEqual(report.errors,[])
 report.pass=true
} finally {
 try {
  await mkdir(out,{recursive:true})
  await writeFile(out+'/runtime.json',JSON.stringify(report,null,2)+'\n')
 } finally {await browser.close()}
}
console.log('PASS: three real start/stop cycles, module cleanup, five standing supports, source materials and gameplay map preserved')
