/** Fixed-POV fog and key-angle isolation; deliberately not acceptance evidence. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
const out=process.argv[2];if(!out)throw Error('Choose a new evidence directory');await mkdir(out)
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8')),dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const b=await launchCaptureBrowser(),overrides=loadPilotOverrides(),report={purpose:'Diagnostic fog and key-angle isolation; original cameras; not acceptance evidence',git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),config,overrides:overrides?.manifest,variants:[]}
try{
 const page=await b.newPage({viewport:config.viewport});await overrides?.install(page)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(({seed,settings})=>{let s=seed>>>0;Math.random=()=>{s=(Math.imul(1664525,s)+1013904223)>>>0;return s/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url);await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html');await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 await page.evaluate(async config=>{const m=window.terminator.manager;m.update=()=>true;await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
 for(let tick=0;tick<=config.tick;tick++){m.world.tick=tick;m.mapView.sync(m.world);m.playerView.sync(m.world)}
 m.syncUi(true);m.hud.sync();window.__diagKeyOriginal=window.viewer.scene.getObjectByName('Map moon shadow key').position.toArray()
 },config)
 report.renderer=await rendererInfo(page)
 for(const variant of [
  {id:'courtyard-current',view:'01-courtyard'},
  {id:'courtyard-no-fog',view:'01-courtyard',density:0},
  {id:'courtyard-double-fog',view:'01-courtyard',density:.023},
  {id:'courtyard-linear-fog',view:'01-courtyard',linearFog:true},
  {id:'courtyard-helper-fog',view:'01-courtyard',helperFog:true},
  {id:'barracks-new-key',view:'03-barracks'},
  {id:'barracks-old-key',view:'03-barracks',key:[-25,12,38]},
  {id:'rooftop-current',view:'05-rooftop'},
  {id:'rooftop-bank-linear-fog',view:'05-rooftop',bankFog:true},
 ].filter(v=>!process.env.CAPTURE_LIGHT_VARIANTS||process.env.CAPTURE_LIGHT_VARIANTS.split(',').includes(v.id))){
 const state=await page.evaluate(async({variant,config})=>{
  const E=await import('threepipe'),v=window.viewer,m=window.terminator.manager,view=config.views.find(x=>x.id===variant.view),p=m.world.player
  p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
  const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-p.pos.y-1.65,dz=view.lookAt[2]-p.pos.z
  p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz));m.mapView.sync(m.world);m.playerView.sync(m.world)
  for(const rec of window.__fogHookRestores||[]){rec.mat.onBeforeCompile=rec.compile;rec.mat.customProgramCacheKey=rec.key;rec.mat.needsUpdate=true}window.__fogHookRestores=[]
  for(const handle of window.__fogHelperHandles||[])handle.dispose();window.__fogHelperHandles=[]
  window.__bankRestore?.();delete window.__bankRestore
  let bankDraws=[]
  const bank=v.scene.getObjectByName('V2 distant smoke bank 1')
  if(variant.id.startsWith('rooftop-')){
   if(!bank)throw Error('Requested smoke bank not found')
   const original=bank.material
   if(variant.bankFog){
    const {installV2LinearFog}=await import('/files/lib/view/v2/fog.js'),clone=new original.constructor().copy(original)
    clone.onBeforeCompile=original.onBeforeCompile;clone.customProgramCacheKey=original.customProgramCacheKey
    if(original.materialExtensions?.length)clone.registerMaterialExtensions([...original.materialExtensions])
    const fog=installV2LinearFog(clone,{owned:true});bank.material=clone
    window.__bankRestore=()=>{bank.material=original;fog.dispose();for(const key of Object.keys(clone))if(clone[key]?.isTexture)clone[key]=null;clone.setDirty();clone.unregisterMaterialExtensions([...clone.materialExtensions]);clone.dispose()}
   }
   const before=bank.onAfterRender;bank.onAfterRender=function(renderer,scene,camera,geometry,material,group){before?.call(this,renderer,scene,camera,geometry,material,group);if(camera!==m.playerView.camera)return
    const gl=renderer.getContext(),program=renderer.properties.get(material).currentProgram;if(!program?.fragmentShader)return
    const shader=gl.getShaderSource(program.fragmentShader);if(!shader.includes('fogFactor'))return
    const target=renderer.getRenderTarget();if(bankDraws.length<6)bankDraws.push({material:material.name,shader,blend:gl.isEnabled(gl.BLEND),srcRGB:gl.getParameter(gl.BLEND_SRC_RGB),dstRGB:gl.getParameter(gl.BLEND_DST_RGB),srcAlpha:gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha:gl.getParameter(gl.BLEND_DST_ALPHA),equationRGB:gl.getParameter(gl.BLEND_EQUATION_RGB),targetColorSpace:target?.texture?.colorSpace,targetSize:target?[target.width,target.height]:null,opacity:material.opacity,premultipliedAlpha:material.premultipliedAlpha})
   }
   window.__bankDrawRestore=()=>{bank.onAfterRender=before}
  }
  if(variant.helperFog){const {installV2LinearFog}=await import('/files/lib/view/v2/fog.js');const seen=new Set();m.mapView.root.traverse(o=>{for(const mat of Array.isArray(o.material)?o.material:[o.material]){if(!mat?.isPhysicalMaterial||!mat.fog||!mat.name.includes('V2')||seen.has(mat))continue;seen.add(mat);window.__fogHelperHandles.push(installV2LinearFog(mat,{owned:true}))}})}
  if(variant.linearFog){const seen=new Set();m.mapView.root.traverse(o=>{for(const mat of Array.isArray(o.material)?o.material:[o.material]){
   if(!mat?.isPhysicalMaterial||!mat.fog||!mat.name.includes('V2')||seen.has(mat))continue;seen.add(mat)
   const compile=mat.onBeforeCompile,key=mat.customProgramCacheKey;window.__fogHookRestores.push({mat,compile,key})
   mat.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>','').replace('#include <tonemapping_fragment>','#include <fog_fragment>\n#include <tonemapping_fragment>')}
   mat.customProgramCacheKey=function(){return key.call(this)+'|diagnostic-linear-fog-v1'};mat.needsUpdate=true
  }})}
  const key=v.scene.getObjectByName('Map moon shadow key');key.position.fromArray(variant.key||window.__diagKeyOriginal)
  if(variant.density!==undefined)v.scene.fog.density=variant.density
  v.renderManager.resetShadows();v.setDirty()
  for(let i=0;i<12;i++)await new Promise(resolve=>requestAnimationFrame(()=>{v.setDirty();resolve()}))
  const tone=v.getPlugin(E.TonemapPlugin),camera=m.playerView.camera
  const renderer=v.renderManager.webglRenderer,gl=renderer.getContext();let fragmentShader=null
  m.mapView.root.traverse(o=>{if(fragmentShader||!o.name?.includes('skyline'))return;const program=renderer.properties.get(o.material).currentProgram;if(program?.fragmentShader)fragmentShader=gl.getShaderSource(program.fragmentShader)})
  window.__bankDrawRestore?.();delete window.__bankDrawRestore
  return {bankDraws,fragmentShader,patchedMaterials:window.__fogHookRestores.length,helperMaterials:window.__fogHelperHandles.length,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov},fog:{density:v.scene.fog.density,color:v.scene.fog.color.toArray()},key:{position:key.position.toArray(),intensity:key.intensity},tonemap:tone?{exposure:tone.exposure,contrast:tone.contrast,saturation:tone.saturation,toneMapping:tone.toneMapping}:null}
 },{variant,config})
 await page.screenshot({path:out+'/'+variant.id+'.png'});report.variants.push({...variant,...state})
 }
 await page.evaluate(()=>{window.__bankRestore?.();delete window.__bankRestore;window.terminator.manager.stop()});report.errors=errors
 await writeFile(out+'/diagnostics.json',JSON.stringify(report,null,2)+'\n');if(errors.length)throw Error(errors.join('\n'))
 console.log('Saved fixed-camera fog/key diagnostics')
}finally{await b.close()}
