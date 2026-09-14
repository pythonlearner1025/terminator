/** Controlled actual ExtendedRenderPass readback; diagnostics only, no engine edits. */
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
const out=process.argv[2];if(!out)throw Error('Choose a new evidence directory');await mkdir(out)
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8')),dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const sources={}
for(const file of ['lib/view/map.js','lib/view/v2/transparency.js','tools/v2/capture-alpha-calibration.mjs'])sources[file]=createHash('sha256').update(await readFile(file)).digest('hex')
const browser=await launchCaptureBrowser()
try{
 const page=await browser.newPage({viewport:config.viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(config=>localStorage.setItem('terminator.settings.v1',JSON.stringify(config.settings)),config)
 await page.request.get(dev.url);await page.goto(dev.origin+'/files/tools/map-runtime.html');await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 const renderer=await rendererInfo(page)
 const result=await page.evaluate(async config=>{
  const E=await import('threepipe'),m=window.terminator.manager,v=window.viewer;m.update=()=>true;await m.ui.startMatch();await m.mapView.ready;await m.visualWarmup;m.ui.screens.show(null);m.input.stop();m.unitView.toggleShowcase(false)
  const view=config.views.find(x=>x.id==='05-rooftop'),p=m.world.player;p.pos={x:view.feet[0],y:view.feet[1],z:view.feet[2]};p.vel={x:0,y:0,z:0};p.crouch=false;p.aiming=false
  const dx=view.lookAt[0]-p.pos.x,dy=view.lookAt[1]-p.pos.y-1.65,dz=view.lookAt[2]-p.pos.z;p.yaw=Math.atan2(dx,dz);p.pitch=Math.atan2(dy,Math.hypot(dx,dz));m.world.tick=config.tick;m.mapView.sync(m.world);m.playerView.sync(m.world)
  const rm=v.renderManager,r=rm.webglRenderer,gl=r.getContext(),camera=m.playerView.camera,pass=rm.renderPass,blend=pass._blendPass
  const root=new E.Group();root.name='Diagnostic alpha calibration';v.scene.add(root)
  const hidden=[];v.scene.traverse(o=>{if(o.isMesh&&o.visible&&(Array.isArray(o.material)?o.material:[o.material]).some(mat=>mat?.transparent)){hidden.push(o);o.visible=false}})
  const geometry=new E.PlaneGeometry(20,20),black=new E.UnlitMaterial({color:0x000000,fog:false,toneMapped:false,depthTest:false,depthWrite:false}),red=new E.UnlitMaterial({color:0xff0000,opacity:.5,transparent:true,fog:false,toneMapped:false,depthTest:false,depthWrite:false})
  const glass=new E.PhysicalMaterial({color:0xffffff,transmission:1,roughness:0,metalness:0,ior:1.5,thickness:.1,fog:false,depthTest:false,depthWrite:false})
  const green=new E.UnlitMaterial({color:0x00ff00,opacity:.5,transparent:true,fog:false,toneMapped:false,depthTest:false,depthWrite:false}),second=new E.Mesh2(geometry,green);second.renderOrder=100002;second.visible=false;root.add(second)
  const bg=new E.Mesh2(geometry,black),card=new E.Mesh2(geometry,red);bg.name='Diagnostic black background';card.name='Diagnostic half alpha red';bg.renderOrder=100000;card.renderOrder=100001;root.add(bg,card)
  camera.updateMatrixWorld(true);for(const [mesh,distance] of [[bg,2],[card,1.9],[second,1.8]]){mesh.position.set(0,0,-distance).applyMatrix4(camera.matrixWorld);camera.getWorldQuaternion(mesh.quaternion);mesh.frustumCulled=false}
  const half=n=>{const s=(n&0x8000)?-1:1,e=(n>>10)&31,f=n&1023;return e===0?s*2**-14*(f/1024):e===31?f?NaN:s*Infinity:s*2**(e-15)*(1+f/1024)}
  const read=target=>{const type=target.texture.type,buf=type===E.HalfFloatType?new Uint16Array(4):type===E.FloatType?new Float32Array(4):new Uint8Array(4);r.readRenderTargetPixels(target,Math.floor(target.width/2),Math.floor(target.height*.7),1,1,buf);const rgba=Array.from(buf,n=>type===E.HalfFloatType?half(n):type===E.FloatType?n:n/255);return {type,colorSpace:target.texture.colorSpace,size:[target.width,target.height],raw:Array.from(buf),rgba,linear:target.texture.colorSpace==='rgbm-16'?rgba.slice(0,3).map(n=>n*rgba[3]*16):rgba.slice(0,3)}}
  const records=[],draws=[],original=blend.render;let recording=true
  card.onAfterRender=function(renderer,scene,cam,geo,material){if(!recording||cam!==camera||draws.length>=3)return;const program=renderer.properties.get(material).currentProgram;draws.push({targetColorSpace:renderer.getRenderTarget()?.texture.colorSpace,shader:program?.fragmentShader?gl.getShaderSource(program.fragmentShader):null,srcRGB:gl.getParameter(gl.BLEND_SRC_RGB),dstRGB:gl.getParameter(gl.BLEND_DST_RGB),srcAlpha:gl.getParameter(gl.BLEND_SRC_ALPHA),dstAlpha:gl.getParameter(gl.BLEND_DST_ALPHA),premultipliedAlpha:material.premultipliedAlpha})}
  blend.render=function(renderer,write,readBuffer,...rest){const record=recording&&records.length<3?{transparent:read(pass.transparentTarget),opaque:read(readBuffer)}:null;const value=original.call(this,renderer,write,readBuffer,...rest);if(record){record.composited=read(write);record.actualShader=(()=>{const program=renderer.properties.get(this.material).currentProgram;return program?.fragmentShader?gl.getShaderSource(program.fragmentShader):null})();records.push(record)}return value}
  const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>{v.setDirty();resolve()}))
  let correction;try{
   if(config.corrected){const {installTransparencyDiagnostic}=await import('/files/tools/v2/capture-transparency-diagnostic.mjs');correction=installTransparencyDiagnostic(v)}
   const scenarios=config.sweep?[
    ...[0,.25,.5,1].map(alpha=>({id:'normal-'+alpha,alpha,background:[0,0,0]})),
    {id:'premultiplied-half',alpha:.5,premultiplied:true,background:[0,0,0]},
    {id:'red-green-over-blue',alpha:.5,second:true,background:[0,0,1]},
    {id:'additive-over-blue',alpha:.5,additive:true,background:[0,0,1]},
    {id:'additive-behind-normal-over-blue',alpha:.5,additive:true,second:true,background:[0,0,1]},
    {id:'additive-in-front-of-normal-over-blue',alpha:.5,additive:true,second:true,front:true,background:[0,0,1]},
    {id:'transmissive-over-blue',alpha:0,transmission:true,background:[0,0,1]},
    {id:'clear-after-layers',alpha:0,background:[0,0,1]},
   ]:[{id:'normal-half',alpha:.5,background:[0,0,0]}]
   const results=[]
   for(const scenario of scenarios){
    recording=false;card.material=scenario.transmission?glass:red;red.opacity=scenario.alpha;red.premultipliedAlpha=!!scenario.premultiplied;red.blending=scenario.additive?E.AdditiveBlending:E.NormalBlending;red.needsUpdate=true
    black.color.setRGB(...scenario.background);black.setDirty();second.visible=!!scenario.second;card.renderOrder=scenario.front?100003:100001
    for(let i=0;i<5;i++)await frame()
    records.length=0;draws.length=0;recording=true
    for(let i=0;i<5;i++)await frame()
    if(records.length!==3)throw Error('Missing calibrated compositor draws: '+scenario.id)
    const predicted=records.map(row=>row.transparent.linear.map((n,i)=>n+(1-row.transparent.rgba[3])*row.opaque.linear[i]))
    const correctNormal=!scenario.additive&&!scenario.transmission
    const oracle=scenario.second?[.25,.5,.25]:scenario.background.map((n,i)=>(i===0?scenario.alpha:0)+(1-scenario.alpha)*n)
    const errors=records.map((row,j)=>Math.max(...row.composited.linear.map((n,i)=>Math.abs(n-predicted[j][i]))))
    const normalErrors=correctNormal?records.map(row=>Math.max(...row.composited.linear.map((n,i)=>Math.abs(n-oracle[i])))):null
    results.push({...scenario,records:[...records],draws:[...draws],predictedAssociated:predicted,normalOracle:correctNormal?oracle:null,maxCompositionError:Math.max(...errors),maxNormalOracleError:normalErrors?Math.max(...normalErrors):null})
   }
   return {corrected:!!config.corrected,productionAdapter:m.mapView.v2Transparency?.attached===true,camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov},scenarios:results,records:results[0].records,draws:results[0].draws,blendFragment:blend.material.fragmentShader}
  }
  finally{correction?.dispose();blend.render=original;for(const mesh of hidden)mesh.visible=true;root.removeFromParent();black.dispose();red.dispose();green.dispose();glass.dispose();geometry.dispose();m.stop()}
 },{...config,corrected:process.env.CAPTURE_TRANSPARENCY_DIAGNOSTIC==='1',sweep:process.env.CAPTURE_ALPHA_SWEEP==='1'})
 await writeFile(out+'/calibration.json',JSON.stringify({purpose:'Controlled known-color actual GPU alpha compositor diagnostic; no global edits',git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:sources,worktreeStatus:execFileSync('git',['status','--short'],{encoding:'utf8'}),renderer,result,errors},null,2)+'\n');if(errors.length)throw Error(errors.join('\n'));if(result.productionAdapter&&result.scenarios.some(row=>row.maxCompositionError>.004||row.maxNormalOracleError>.004))throw Error('Calibrated composition differs from independent oracle; see saved evidence');console.log(JSON.stringify(result.scenarios.map(({id,maxCompositionError,maxNormalOracleError,records})=>({id,maxCompositionError,maxNormalOracleError,transparent:records.at(-1).transparent.rgba,linear:records.at(-1).composited.linear}))))
}finally{await browser.close()}
