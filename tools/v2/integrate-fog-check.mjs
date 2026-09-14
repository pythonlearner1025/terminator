import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const git=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8')),b=await launchCaptureBrowser(),overrides=loadPilotOverrides()
try{
 const p=await b.newPage({viewport:{width:1920,height:1080}});await overrides?.install(p);await p.addInitScript(c=>localStorage.setItem('terminator.settings.v1',JSON.stringify(c.settings)),config);await p.request.get(dev.url);await p.goto(dev.origin+'/files/tools/map-runtime.html');await p.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 const data=await p.evaluate(async config=>{
  const E=await import('threepipe')
  const m=window.terminator.manager;m.update=()=>true;await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup
  const view=config.views[0],player=m.world.player
  player.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};player.vel={x:0,y:0,z:0};player.crouch=false;player.aiming=false
  const dx=view.lookAt[0]-player.pos.x,dy=view.lookAt[1]-player.pos.y-1.65,dz=view.lookAt[2]-player.pos.z
  player.yaw=Math.atan2(dx,dz);player.pitch=Math.atan2(dy,Math.hypot(dx,dz))
  m.world.tick=120;m.mapView.sync(m.world);m.playerView.sync(m.world);window.viewer.setDirty()
  for(let i=0;i<5;i++)await new Promise(resolve=>requestAnimationFrame(resolve))
  const r=window.viewer.renderManager.webglRenderer,gl=r.getContext(),records=new Map()
  const owner=o=>{for(let n=o;n&&n!==m.mapView.root;n=n.parent){if(n.name==='V2 Ground Aggregate')return 'ground';if(n.name==='V2 Ruined Architecture')return /skyline/i.test(o.name)?'skyline':'architecture';if(/V2.*(light|atmosphere)/i.test(n.name))return 'atmosphere'}return /Selected/.test(o.material?.name||'')?'selectedProps':'originalWorld'}
  const draws=[],restore=[];let drawnFogShader=null
  m.mapView.root.traverse(o=>{if(!o.isMesh||owner(o)!=='skyline')return;const prior=o.onAfterRender;restore.push(()=>{o.onAfterRender=prior});o.onAfterRender=function(renderer,scene,camera,geometry,material,group){
   prior?.call(this,renderer,scene,camera,geometry,material,group)
   const program=renderer.properties.get(material).currentProgram;if(!program)return
   const point=new E.Vector3();geometry.boundingBox?.getCenter(point);point.applyMatrix4(o.matrixWorld)
   const depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z;if(depth<=0)return
   const value=key=>{const loc=gl.getUniformLocation(program.program,key);const v=loc?gl.getUniform(program.program,loc):null;return ArrayBuffer.isView(v)?Array.from(v):v}
   const density=value('fogDensity'),color=value('fogColor'),target=renderer.getRenderTarget()
   if(density!==null&&!drawnFogShader)drawnFogShader=gl.getShaderSource(program.fragmentShader)
   if(draws.length<160)draws.push({mesh:o.name,material:material.name,programId:program.id,camera:camera.uuid,mainCamera:camera===m.playerView.camera,target:target?{width:target.width,height:target.height,name:target.texture?.name}:null,worldPoint:point.toArray(),viewDepth:depth,cameraWorldScale:camera.getWorldScale(new E.Vector3()).toArray(),objectWorldScale:o.getWorldScale(new E.Vector3()).toArray(),fogDensity:density,fogColor:color,expectedUploadedFogFactor:density===null?null:1-Math.exp(-(density**2)*depth**2)})
  }})
  for(let i=0;i<3;i++){window.viewer.setDirty();await new Promise(resolve=>requestAnimationFrame(resolve))}
  restore.forEach(fn=>fn())
  m.mapView.root.traverse(o=>{if(!o.isMesh)return;for(const mat of Array.isArray(o.material)?o.material:[o.material]){
   if(!mat)continue;const id=mat.uuid+':'+owner(o);if(records.has(id)){records.get(id).meshes++;continue}
   const props=r.properties.get(mat),programs=props.programs?[...props.programs.values()]:props.currentProgram?[props.currentProgram]:[]
   const camera=m.playerView.camera,point=new E.Vector3()
   if(o.geometry.boundingBox)o.geometry.boundingBox.getCenter(point)
   else if(o.geometry.attributes.position)point.fromBufferAttribute(o.geometry.attributes.position,0)
   point.applyMatrix4(o.matrixWorld)
   const depth=-point.clone().applyMatrix4(camera.matrixWorldInverse).z
   const distance=point.distanceTo(camera.getWorldPosition(new E.Vector3()))
   const sample={worldPoint:point.toArray(),viewDepth:depth,euclideanDistance:distance,cameraWorldPosition:camera.getWorldPosition(new E.Vector3()).toArray(),cameraWorldScale:camera.getWorldScale(new E.Vector3()).toArray(),objectWorldScale:o.getWorldScale(new E.Vector3()).toArray(),expectedSceneFogFactor:1-Math.exp(-(window.viewer.scene.fog.density**2)*depth**2)}
   records.set(id,{sample,owner:owner(o),mesh:o.name,meshes:1,material:mat.name,type:mat.type,fog:mat.fog,transparent:mat.transparent,
    compiled:programs.map(program=>{const text=program.fragmentShader?gl.getShaderSource(program.fragmentShader):'';const uniforms=program.getUniforms?.().map||{};return {useFog:/^\s*#define USE_FOG\b/m.test(text||''),fogExp2:/^\s*#define FOG_EXP2\b/m.test(text||''),activeFogUniforms:Object.fromEntries(Object.entries(uniforms).filter(([key])=>key.startsWith('fog')).map(([key,uniform])=>{const value=gl.getUniform(program.program,uniform.addr);return [key,ArrayBuffer.isView(value)?Array.from(value):value]}))}})})
  }})
  const fog=window.viewer.scene.fog,result={fog:{type:fog?.type,color:fog?.color?.toArray(),density:fog?.density},drawnFogShader,tonemap:(()=>{const t=window.viewer.getPlugin(E.TonemapPlugin);return t?{exposure:t.exposure,contrast:t.contrast,saturation:t.saturation,toneMapping:t.toneMapping}:null})(),draws,materials:[...records.values()]};m.stop();return result
 },config)
 const renderer=await rendererInfo(p)
 await writeFile(process.argv[2]||'docs/evidence/v2-fog-driver.json',JSON.stringify({git,config,renderer,overrides:overrides?.manifest,...data},null,2)+'\n')
 console.log('Saved runtime material flags and compiled fog defines/uniforms')
}finally{await b.close()}
