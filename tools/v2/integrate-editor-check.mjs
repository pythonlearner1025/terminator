import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const out=process.argv[2]||'docs/evidence/v2-integration-checks'
await mkdir(out,{recursive:true})
const browser=await launchCaptureBrowser(),errors=[]
const pilotOverrides=loadPilotOverrides()
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}})
 await pilotOverrides?.install(page)
 page.on('pageerror',e=>errors.push(e.message.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]')))
 const openedAt=Date.now()
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>{const root=window.viewer?.scene.modelRoot;return (root?.getObjectByName('V2 Environment Preview') || root?.getObjectByName('V2_Environment_Preview'))?.children.length>0},null,{timeout:120000})
 await page.waitForFunction(async openedAt=>{const state=await fetch('/api/state').then(r=>r.json());return state.projectLoaded===true && Date.parse(state.updatedAt)>openedAt && !state.lastLoadError},openedAt,{timeout:120000})
 await page.waitForFunction(()=>{
  const ids=new Set()
  window.viewer.scene.modelRoot.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){
   const match=m?.name?.match(/^Selected rubble (\d):/)
   if(match&&m.map)ids.add(match[1])
  }})
  return ids.size===5
 },null,{timeout:120000})
 const initialGenerator=await page.evaluate(async()=>{
  const viewer=window.viewer,generator=viewer.getPlugin('EntityComponentPlugin').getComponentsOfType('Generator').find(c=>c.module==='generators/v2-preview.js')
  if(!generator)throw Error('V2 Generator component unavailable')
  const count=()=>{let meshes=0;generator.object.traverse(o=>{if(o.isMesh)meshes++});return meshes}
  const beforeWait=count()
  await generator.constructor.waitForViewer(viewer)
  const afterWait=count()
  // Initial scene generation can precede imported atlas loading and use owned
  // fallback maps. Regenerate once after all authored atlases exist so repeated
  // measurements compare the same borrowed-resource path.
  const atlasListeners=()=>{const ts=new Set();viewer.scene.modelRoot.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(/^Selected rubble \d:/.test(m?.name||'')&&m.map)ts.add(m.map)});return [...ts].map(t=>({uuid:t.uuid,name:t.name,count:t._listeners?.update?.length||0}))}
  const beforeSourceWarmup=atlasListeners()
  await generator.run()
  return {beforeWait,afterWait,afterSourceWarmup:count(),beforeSourceWarmup,afterSourceWarmupListeners:atlasListeners()}

 })
 const before=await page.evaluate(()=>{
  const viewer=window.viewer;window.__v2EditorViewer=viewer;const node=(viewer.scene.modelRoot.getObjectByName('V2 Environment Preview') || viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview'));let meshes=0
  node.traverse(n=>{if(n.isMesh)meshes++})
  return {visible:node.visible,meshes,camera:{position:viewer.scene.mainCamera.position.toArray(),target:viewer.scene.mainCamera.target.toArray()},running:viewer.getPlugin('EntityComponentPlugin').running}
 })
 assert.equal(before.running,false);assert.equal(before.visible,true);assert(before.meshes>0)
 const regeneration=await page.evaluate(async()=>{
  const viewer=window.__v2EditorViewer,ecp=viewer.getPlugin('EntityComponentPlugin')
  const generator=ecp.getComponentsOfType('Generator').find(c=>c.module==='generators/v2-preview.js')
  if(!generator)throw Error('V2 Generator component unavailable')
  const sourceTextures=new Set(),atlasIds=new Set()
  // Match the architecture source lookup: linked authored atlases can live
  // elsewhere under modelRoot in the stopped editor.
  viewer.scene.modelRoot.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){
   const match=m?.name?.match(/^Selected rubble (\d):/)
   if(match&&m.map){sourceTextures.add(m.map);atlasIds.add(match[1])}
  }})
  if(atlasIds.size!==5)throw Error('Expected all five authored rubble atlases before regeneration')
  const listenerCounts=new Map([...sourceTextures].map(texture=>[texture,texture._listeners?.update?.length||0]))
  let disposed=0;const onDispose=()=>disposed++
  for(const texture of sourceTextures)texture.addEventListener('dispose',onDispose)
  const previewCallbacks=()=>{const callbacks=new Set();generator.object.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.__textureUpdate)callbacks.add(m.__textureUpdate)});return callbacks}
  const initialPreviewCallbacks=previewCallbacks()
  const stableCallbacks=new Map([...sourceTextures].map(t=>[t,(t._listeners?.update||[]).filter(fn=>!initialPreviewCallbacks.has(fn))]))
  const counts=[],listenerStages=[],callbackChanges=[],callbackIds=new Map();let nextCallbackId=1
  const snapshot=stage=>{
   const currentPreview=previewCallbacks()
   for(const [texture,stable] of stableCallbacks){
    const actual=(texture._listeners?.update||[]).filter(fn=>!currentPreview.has(fn))
    if(actual.length!==stable.length||stable.some(fn=>!actual.includes(fn)))callbackChanges.push({stage,name:texture.name,expectedStable:stable.length,actualStable:actual.length})
   }
   const live=new Map(),all=new Set(viewer.assetManager.materials.getAllMaterials())
   viewer.scene.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material]){if(!m)continue;all.add(m);if(!live.has(m))live.set(m,[]);live.get(m).push(o.name)}})
   listenerStages.push({stage,textures:[...sourceTextures].map(t=>({name:t.name,uuid:t.uuid,listeners:(t._listeners?.update||[]).map(fn=>{
    if(!callbackIds.has(fn))callbackIds.set(fn,nextCallbackId++)
    return {id:callbackIds.get(fn),owners:[...all].filter(m=>m.__textureUpdate===fn).map(m=>({uuid:m.uuid,name:m.name,liveObjects:live.get(m)||[],currentMap:m.map===t,refs:m._mapRefs?.has(t)||false}))}
   })}))})
  }
  snapshot('before')
  try{
   for(let cycle=0;cycle<2;cycle++){
    await generator.run()
    let meshes=0;generator.object.traverse(o=>{if(o.isMesh)meshes++})
    counts.push({meshes,generatedRoots:generator.object.children.filter(o=>o.userData.kite3dGenerated).length})
    snapshot(`after-regeneration-${cycle+1}`)
   }
   viewer.setDirty()
   for(let frame=0;frame<3;frame++)await new Promise(resolve=>requestAnimationFrame(resolve))
   snapshot('after-render')
   return {sourceAtlases:atlasIds.size,sourceTextureInstances:sourceTextures.size,disposed,counts,listenerStages,callbackChanges,listenerChanges:[...listenerCounts].filter(([texture,count])=>(texture._listeners?.update?.length||0)!==count).map(([texture,before])=>({name:texture.name,before,after:texture._listeners?.update?.length||0}))}
  }finally{for(const texture of sourceTextures)texture.removeEventListener('dispose',onDispose)}
 })
 await writeFile(out+'/editor-regeneration.json',JSON.stringify({initialGenerator,before,regeneration,errors},null,2)+'\n')
 assert.equal(regeneration.disposed,0)
 assert.deepEqual(regeneration.listenerChanges,[])
 assert.deepEqual(regeneration.callbackChanges,[])
 assert(regeneration.counts.every(c=>c.generatedRoots===1&&c.meshes===before.meshes))
 await page.screenshot({path:out+'/stopped-editor.png'})
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>window.viewer?.getPlugin('EntityComponentPlugin')?.running === true)
 await page.evaluate(()=>{window.__v2RuntimeScene=window.viewer.scene})
 assert.equal(await page.evaluate(()=>(window.viewer.scene.modelRoot.getObjectByName('V2 Environment Preview') || window.viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview')).visible),false)
 await page.getByTestId('play').click()
 await page.waitForFunction(()=>window.__v2EditorViewer.renderEnabled === true && window.__v2EditorViewer.getPlugin('EntityComponentPlugin').running === false)
 const after=await page.evaluate(()=>{
  const viewer=window.__v2EditorViewer
  return {previewVisible:(viewer.scene.modelRoot.getObjectByName('V2 Environment Preview') || viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview')).visible,runtimeRoots:window.__v2RuntimeScene.children.filter(n=>n.name==='Map Runtime').length}
 })
 assert.equal(after.previewVisible,true);assert.equal(after.runtimeRoots,0);assert.deepEqual(errors,[])
 await writeFile(out+'/editor.json',JSON.stringify({git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),...(pilotOverrides?{diagnosticOverrides:pilotOverrides.manifest}:{}),initialGenerator,before,regeneration,after,errors,pass:true},null,2)+'\n')
 console.log('PASS: stopped selectable Generator, actual editor Play/Stop, preview exclusion and runtime cleanup')
}finally{await browser.close()}
