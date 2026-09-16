// Runs inside a private headless page. This changes only its temporary range World.
export async function measure24() {
  const m=window.terminator.manager,v=window.viewer,w=m.world
  m.capturePaused=true
  v.renderManager.renderScale=1;v.resize();m.mapView.post.settings.motionBlur=true;m.hud.root.style.visibility='visible'
  for(const u of w.units)u.brain?.destroy?.()
  w.units.length=0;w.unitById.clear();m.range.layout=[];m.range.targets.clear()
  w.scaling.maxAlive=24
  const p=w.player,forward={x:Math.sin(p.yaw),z:Math.cos(p.yaw)},right={x:Math.cos(p.yaw),z:-Math.sin(p.yaw)}
  for(let i=0;i<24;i++){
    const distance=9+Math.floor(i/6)*3,offset=(i%6-2.5)*1.2
    const u=w.spawnUnit(['scout','endo','heavy'][i%3],{x:p.pos.x+forward.x*distance+right.x*offset,y:0,z:p.pos.z+forward.z*distance+right.z*offset},{yaw:Math.atan2(-forward.x,-forward.z)})
    if(!u)throw Error('24-enemy setup failed')
    u.brain?.destroy?.();u.brain={tick(self,sense,act){act.aimAt({...p.pos,y:1.65});if(u.type!=='scout')act.fire()}}
    u.hp=u.maxHp=1e8;u.intent.aimAt={...p.pos,y:1.65};u.intent.fire=u.type!=='scout';u.reactionReadyTick=0
  }
  m.range.equip('pistol');m.range.setReloads(false);m.range.clock.setScale(1)
  m.ui.sample=()=>({yaw:p.yaw,pitch:0,fire:w.tick%24<12});m.director.step=input=>w.step(input)
  m.capturePaused=false;m.syncViews()
  // The placed lab templates retain preview bind offsets. Correct only this fixture.
  for(const visual of m.unitView.visuals.values()){
    const mesh=visual.rig.mesh
    mesh.bind(mesh.skeleton,mesh.bindMatrix.clone().identity())
    mesh.computeBoundingSphere()
  }
  await new Promise(r=>setTimeout(r,7000))
  const renderer=v.renderManager.webglRenderer,gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')
  const rendered=new Set(),anyRendered=new Set(),drawCameras=new Set(),drawHooks=[]
  for(const [id,visual] of m.unitView.visuals){
    const mesh=visual.rig.mesh,original=mesh.onBeforeRender
    mesh.onBeforeRender=function(...args){anyRendered.add(id);drawCameras.add(args[2]?.uuid);if(args[2]===v.scene.mainCamera)rendered.add(id);original?.apply(this,args)}
    drawHooks.push(()=>{mesh.onBeforeRender=original})
  }
  const intervals=[],work=[],gpu=[],pending=[],counts=[],projectiles=[]
  let start=0,last=0,query=null
  const pre=()=>{const now=performance.now();if(last)intervals.push(now-last);last=now;start=now}
  const beforeRender=()=>{if(ext&&!query){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}}
  const afterRender=()=>{if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(query);query=null}}
  const poll=()=>{while(pending.length&&gl.getQueryParameter(pending[0],gl.QUERY_RESULT_AVAILABLE)){
    const q=pending.shift();if(!gl.getParameter(ext.GPU_DISJOINT_EXT))gpu.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)
  }}
  const post=()=>{work.push(performance.now()-start);counts.push(w.aliveUnits.length);projectiles.push(w.projectiles?.length||0);if(ext)poll()}
  v.addEventListener('preFrame',pre);v.addEventListener('postFrame',post);v.addEventListener('preRender',beforeRender);v.addEventListener('postRender',afterRender)
  await new Promise(r=>setTimeout(r,10000))
  v.removeEventListener('preFrame',pre);v.removeEventListener('postFrame',post);v.removeEventListener('preRender',beforeRender);v.removeEventListener('postRender',afterRender)
  if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(query)}
  if(ext){for(let i=0;i<30&&pending.length;i++){poll();await new Promise(r=>setTimeout(r,20))}for(const q of pending)gl.deleteQuery(q)}
  for(const restore of drawHooks)restore()
  m.capturePaused=true
  const summary=a=>{a.sort((a,b)=>a-b);const q=f=>a[Math.min(a.length-1,Math.floor(a.length*f))];return a.length?{samples:a.length,mean:a.reduce((s,x)=>s+x,0)/a.length,p50:q(.5),p95:q(.95),p99:q(.99),max:a.at(-1)}:null}
  const debug=gl.getExtension('WEBGL_debug_renderer_info')
  const camera=v.scene.mainCamera;camera.updateMatrixWorld(true)
  const visibleEnemies=[...m.unitView.visuals.values()].filter(visual=>{const point=visual.object.position.clone();point.y+=1;point.project(camera);return point.z>-1&&point.z<1&&Math.abs(point.x)<1&&Math.abs(point.y)<1}).length
  const result={headless:true,viewport:[v.canvas.width,v.canvas.height],scene:'Weapons Lab range',roster:'8 Scout, 8 Endo, 8 Heavy',aliveMin:Math.min(...counts),aliveMax:Math.max(...counts),visibleEnemies,unitsSubmittedToMainCamera:rendered.size,unitsSubmittedToAnyCamera:anyRendered.size,drawCameras:[...drawCameras],mainCamera:camera.uuid,unitRenderState:[...m.unitView.visuals.values()].slice(0,3).map(v=>({name:v.object.name,scale:v.object.scale.toArray(),meshVisible:v.rig.mesh.visible,meshScale:v.rig.mesh.scale.toArray(),meshLayer:v.rig.mesh.layers.mask,cameraLayer:camera.layers.mask,ancestors:(()=>{const a=[];for(let n=v.rig.mesh;n;n=n.parent)a.push([n.name,n.visible]);return a})(),bounds:v.rig.mesh.boundingSphere?{center:v.rig.mesh.boundingSphere.center.toArray(),radius:v.rig.mesh.boundingSphere.radius}:null})),hudVisible:m.hud.root.style.visibility==='visible',warmupSeconds:7,measureSeconds:10,weapon:'pistol',playerFirePulses:true,enemyFireIntent:true,brainFixture:'Stationary aim-and-fire callbacks',bindingFixture:'Reset inherited lab preview bind offsets for temporary unit meshes',maxCoreProjectiles:Math.max(...projectiles),frameIntervalMs:summary(intervals),cpuFrameMs:summary(work),gpuFrameMs:summary(gpu),gpuTimerSupported:Boolean(ext),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),postSettings:{...m.mapView.post.settings},quality:{...m.mapView.post.quality},passes:v.renderManager.passes.map(p=>({name:p.passId,enabled:p.enabled})),limitation:'Measures the range and its available effects. This is not a Bunker 7 combat benchmark. The owner continued using the Mac.'}
  if(result.unitsSubmittedToMainCamera!==24)throw Error('Expected 24 rendered unit meshes, got '+result.unitsSubmittedToMainCamera)
  if(result.aliveMin!==24||result.aliveMax!==24)throw Error('Enemy count changed during measurement')
  return result
}
