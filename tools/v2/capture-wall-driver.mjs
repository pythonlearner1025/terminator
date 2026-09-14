/** Read-only actual main-camera wall shader/sampler audit; does not alter shading. */
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
if(!process.argv[2])throw Error('Choose a fresh driver evidence directory')
const output=resolve(process.argv[2]);await mkdir(output)
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const overrides=loadPilotOverrides();assert(overrides,'Explicit owner pins required')
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),config,launch:browserOptions(),diagnosticOverrides:overrides.manifest,mode:'Read-only actual main-camera shader and texture-unit bindings; original barracks camera; no shading change',errors:[],sourceFiles:{}}
for(const file of execFileSync('git',['ls-files','lib/view','assets/v2','main.js','package.json','tools/v2/capture-wall-driver.mjs','tools/v2/capture-browser.mjs','tools/v2/capture-pilot-overrides.mjs'],{encoding:'utf8'}).trim().split('\n'))report.sourceFiles[file]=createHash('sha256').update(await readFile(file)).digest('hex')
const clean=value=>String(value).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
if(process.env.CAPTURE_WALL_CHANNELS==='1')report.mode+='; explicitly diagnostic raw-photo/view-normal/direct-diffuse/indirect-diffuse views bypass wall lighting or select light channels and bypass wall fog; never progress-gallery evidence'
const browser=await launchCaptureBrowser();report.browser=browser.version()
try{
 const page=await browser.newPage({viewport:config.viewport,deviceScaleFactor:1});await overrides.install(page)
 page.on('pageerror',e=>report.errors.push(clean(e.message)))
 page.on('console',e=>{if(e.type()==='error')report.errors.push(clean(e.text()))})
 await page.addInitScript(({seed,settings})=>{let state=seed>>>0;Math.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};localStorage.setItem('terminator.settings.v1',JSON.stringify(settings))},config)
 await page.request.get(dev.url);await page.goto(dev.origin+'/files/tools/map-runtime.html')
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 report.driver=await page.evaluate(async config=>{
  const m=window.terminator.manager,viewer=window.viewer;m.update=()=>true
  await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
  const view=config.views.find(v=>v.id==='03-barracks'),p=m.world.player
  p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
  const support=m.world.playerSupportAt(p.pos,p.pos.y,{radius:.3,maxAbove:.05,maxBelow:.05});if(!support||!m.world.playerHasHeadClearance(p.pos,1.8,support))throw Error('Unsupported original POV')
  const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-(p.pos.y+1.65),dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz))
  for(let i=0;i<=config.tick;i++){m.world.tick=i;m.mapView.sync(m.world);m.playerView.sync(m.world)}m.syncUi(true);m.hud.sync()
  const renderer=viewer.renderManager.webglRenderer,gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info')
  const records=[],restores=[],seen=new Set(),frame=()=>{m.mapView.sync(m.world);m.playerView.sync(m.world);viewer.setDirty()}
  m.mapView.root.traverse(object=>{
   const materials=Array.isArray(object.material)?object.material:[object.material]
   if(!materials.some(mat=>mat?.userData.v2MaterialOwned&&mat.customProgramCacheKey().includes('-wall')))return
   const original=object.onAfterRender
   object.onAfterRender=function(r,scene,camera,geometry,material,group){
    original?.call(this,r,scene,camera,geometry,material,group)
    if(camera!==m.playerView.camera||!material?.userData.v2MaterialOwned||!material.customProgramCacheKey().includes('-wall'))return
    const props=r.properties.get(material),program=props.currentProgram
    if(!program?.program||seen.has(program.id))return
    seen.add(program.id)
    const samplers={},active=gl.getParameter(gl.ACTIVE_TEXTURE)
    try{
     for(const key of ['v2WallAlbedo','v2WallNormal','v2WallSurface']){
      const texture=props.uniforms?.[key]?.value,location=gl.getUniformLocation(program.program,key),unit=location===null?null:gl.getUniform(program.program,location)
      let boundMatches=false,minFilter=null
      if(Number.isInteger(unit)){gl.activeTexture(gl.TEXTURE0+unit);boundMatches=gl.getParameter(gl.TEXTURE_BINDING_2D)===r.properties.get(texture).__webglTexture;minFilter=gl.getTexParameter(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER)}
      samplers[key]={unit,active:location!==null,boundMatches,minFilter,name:texture?.name,width:texture?.image?.width,height:texture?.image?.height,colorSpace:texture?.colorSpace,generateMipmaps:texture?.generateMipmaps,anisotropy:texture?.anisotropy}
     }
    }finally{gl.activeTexture(active)}
    const vec=v=>v?.toArray?.()??v
    const lights=Object.fromEntries(['directionalLights','hemisphereLights','pointLights','ambientLightColor'].map(key=>[key,JSON.parse(JSON.stringify(props.uniforms?.[key]?.value??null,(_,v)=>v?.isVector3||v?.isColor?vec(v):v))]))
    records.push({mesh:object.name,sourceColliderIds:object.userData.sourceColliderIds,material:material.name,programId:program.id,cacheKey:material.customProgramCacheKey(),samplers,lights,fragmentShader:gl.getShaderSource(program.fragmentShader),vertexShader:gl.getShaderSource(program.vertexShader)})
   }
   restores.push(()=>{object.onAfterRender=original})
  })
  if(!restores.length)throw Error('No runtime wall material receivers found')
  viewer.addEventListener('preFrame',frame)
  try{for(let i=0;i<30;i++)await new Promise(resolve=>requestAnimationFrame(resolve))}finally{for(const restore of restores)restore();viewer.removeEventListener('preFrame',frame)}
  const camera=m.playerView.camera
  return {records,receiverCount:restores.length,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unknown',feet:{...p.pos},tick:m.world.tick,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,near:camera.near,far:camera.far},materialStats:JSON.parse(JSON.stringify(m.mapView.v2Handles[m.mapView.v2ModuleNames.indexOf('materials')].stats))}
 },config)
 assert.match(report.driver.renderer,/NVIDIA/)
 assert(report.driver.records.length,'Expected actual wall draw records')
 for(const [index,record] of report.driver.records.entries()){
  for(const slot of Object.values(record.samplers)){assert(slot.active&&slot.boundMatches,'Actual texture-unit binding mismatch');assert.equal(slot.width,1024);assert.equal(slot.height,1024)}
  for(const type of ['fragmentShader','vertexShader']){
   const text=record[type],filename=`wall-${index}-${type}.glsl`;await writeFile(resolve(output,filename),text)
   record[type]={filename,sha256:createHash('sha256').update(text).digest('hex'),bytes:Buffer.byteLength(text)}
  }
 }
 await page.evaluate(()=>document.fonts.ready)
 const png=await page.screenshot({path:resolve(output,'03-barracks.png'),animations:'disabled'});report.screenshotSha256=createHash('sha256').update(png).digest('hex')
 if(process.env.CAPTURE_WALL_CHANNELS==='1'){
  report.channels=[]
  await page.evaluate(()=>{
   const mats=new Set();window.terminator.manager.mapView.root.traverse(object=>{for(const mat of Array.isArray(object.material)?object.material:[object.material])if(mat?.userData.v2MaterialOwned&&mat.customProgramCacheKey().includes('-wall'))mats.add(mat)})
   window.wallChannelOriginals=[...mats].map(mat=>({mat,compile:mat.onBeforeCompile,key:mat.customProgramCacheKey,fog:mat.fog}))
  })
  try{
   for(const channel of ['raw-photo','view-normal','direct-diffuse','indirect-diffuse']){
    const state=await page.evaluate(async channel=>{
     window.wallChannelShaders=[]
     for(const saved of window.wallChannelOriginals){
      saved.mat.onBeforeCompile=function(shader,renderer){
       saved.compile.call(this,shader,renderer)
       for(const token of ['float v2Dust=0.;','vec3 wallColor=mix(ca,cb,choose);','#include <opaque_fragment>','#include <fog_fragment>'])if(!shader.fragmentShader.includes(token))throw Error('Unexpected wall diagnostic shader layout: '+token)
       shader.fragmentShader=shader.fragmentShader.replace('float v2Dust=0.;','vec3 v2RawWallPhoto=vec3(0.); float v2Dust=0.;')
        .replace('vec3 wallColor=mix(ca,cb,choose);','vec3 wallColor=mix(ca,cb,choose); v2RawWallPhoto=wallColor;')
        .replace('#include <fog_fragment>','/* wall fog bypassed only for channel diagnostic */')
       const expression={'raw-photo':'v2RawWallPhoto','view-normal':'normal*.5+.5','direct-diffuse':'reflectedLight.directDiffuse','indirect-diffuse':'reflectedLight.indirectDiffuse'}[channel]
       shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight=${expression};\n#include <opaque_fragment>`)
       window.wallChannelShaders.push({material:this.name,fragment:shader.fragmentShader})
      }
      saved.mat.customProgramCacheKey=function(){return saved.key.call(this)+'|wall-channel-diagnostic-'+channel};saved.mat.needsUpdate=true
     }
     for(let i=0;i<24;i++){window.viewer.setDirty();await new Promise(resolve=>requestAnimationFrame(resolve))}
     const m=window.terminator.manager,c=m.playerView.camera
     return {camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov,near:c.near,far:c.far},feet:{...m.world.player.pos},tick:m.world.tick,compiled:window.wallChannelShaders}
    },channel)
    assert.deepEqual(state.camera,report.driver.camera);assert.deepEqual(state.feet,report.driver.feet);assert.equal(state.tick,report.driver.tick)
    assert(state.compiled.length,'Expected actual channel shader compilation')
    for(const [index,shader] of state.compiled.entries()){const filename=`${channel}-${index}.glsl`;await writeFile(resolve(output,filename),shader.fragment);shader.fragment={filename,sha256:createHash('sha256').update(shader.fragment).digest('hex')}}
    const filename=`03-barracks-${channel}.png`,bytes=await page.screenshot({path:resolve(output,filename),animations:'disabled'})
    report.channels.push({channel,filename,sha256:createHash('sha256').update(bytes).digest('hex'),...state});assert.deepEqual(report.errors,[])
   }
  }finally{
   report.channelHooksRestored=await page.evaluate(()=>{for(const s of window.wallChannelOriginals){s.mat.onBeforeCompile=s.compile;s.mat.customProgramCacheKey=s.key;s.mat.needsUpdate=true}const restored=window.wallChannelOriginals.every(s=>s.mat.onBeforeCompile===s.compile&&s.mat.customProgramCacheKey===s.key&&s.mat.fog===s.fog);delete window.wallChannelOriginals;delete window.wallChannelShaders;return restored})
  }
  assert(report.channelHooksRestored)
 }
 await page.evaluate(()=>window.terminator.manager.stop())
 assert.deepEqual(report.errors,[]);report.pass=true
 console.log(JSON.stringify({pass:true,programs:report.driver.records.length,receivers:report.driver.receiverCount,errors:report.errors}))
}catch(error){throw new Error(clean(error.message))}finally{await writeFile(resolve(output,'driver.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}
