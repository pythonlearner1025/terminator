import {holdStartupRendering} from './startup-rendering.js'
import {weaponSurfaceMaps} from './weapons-materials.js'

const cancelled = () => new DOMException('Match preparation stopped', 'AbortError')
function check(signal) { if(signal?.aborted) throw cancelled() }
function untilStopped(promise, signal) {
  if(!signal)return Promise.resolve(promise)
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(cancelled())}
    // Always observe the underlying promise, including rejection after Stop.
    Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})
    if(signal.aborted)abort()
    else signal.addEventListener('abort',abort,{once:true})
  })
}
function pause(ms, signal, frame=false) {
  return new Promise((resolve,reject)=>{
    const abort=()=>{(frame?cancelAnimationFrame:clearTimeout)(id);signal?.removeEventListener('abort',abort);reject(cancelled())}
    const id=(frame?requestAnimationFrame:setTimeout)(()=>{signal?.removeEventListener('abort',abort);resolve()},ms)
    if(signal?.aborted)abort()
    else signal?.addEventListener('abort',abort,{once:true})
  })
}

// Both projectile-light variants and all resident gameplay assets remain gates.
// Abort restores temporary pool/visibility state synchronously, before disposal.
export async function warmupMatch(manager, {signal, weaponReady} = {}) {
  const viewer=manager.ctx.viewer,renderer=viewer.renderManager.webglRenderer
  const measure=(name,work)=>manager.startup?manager.startup.measure(name,work):work()
  const releaseRender=holdStartupRendering(viewer)
  const visibility=[],counts=[],frustum=[],fixedPools=[]
  let releaseUnits,releaseGrenades,releaseWeapons,cleaned=false
  const cleanup=()=>{
    if(cleaned)return
    cleaned=true
    releaseRender()
    for(const [object,value] of frustum)object.frustumCulled=value
    for(const object of counts)object.count=0
    for(const object of visibility)object.visible=false
    for(const pool of fixedPools)pool.reset()
    releaseUnits?.();releaseGrenades?.();releaseWeapons?.()
    releaseUnits=releaseGrenades=releaseWeapons=null
  }
  signal?.addEventListener('abort',cleanup,{once:true})
  try {
    check(signal)
    await measure('asset-readiness',()=>untilStopped(Promise.all([
      manager.mapView?.ready,
      manager.unitView?.fx?.materials?.ready,
      manager.unitView?.fx?.gore?.ready,
      manager.unitView?.rosterFx?.ready,
      weaponReady ?? weaponSurfaceMaps().ready,
    ].filter(Boolean)),signal))
    check(signal)
    if(!manager.viewsStarted)return {cancelled:true}
    measure('prime-gameplay-pools',()=>{
      releaseUnits=manager.unitView?.primeWarmup?.()
      releaseGrenades=manager.grenadeView?.primeWarmup?.()
      releaseWeapons=manager.playerView?.weapons?.primeWarmup?.(viewer.scene.mainCamera)
      fixedPools.push(...Object.values(manager.playersView?.fx?.pools||{}),
        ...Object.values(manager.playerView?.weapons?.worldFx?.pools||{}))
      for(const pool of fixedPools)pool.prime(viewer.scene.mainCamera)
    })
    const targets=warmupTargets(viewer,manager.ui?.menuScene?.root)
    const {textures,materials}=measure('collect-resources',()=>collectRenderResources(viewer,targets))
    await measure('image-readiness',()=>waitForImages(textures,signal))
    check(signal)
    const menuObjects=new Set()
    manager.ui?.menuScene?.root?.traverse(object=>menuObjects.add(object))
    const reveal=object=>{if(object&&object.visible===false&&!menuObjects.has(object)){visibility.push(object);object.visible=true}}
    for(const rig of Object.values(manager.playerView?.weapons?.rigs||{}))reveal(rig.root)
    reveal(manager.playerView?.weapons?.fx?.flash)
    targets.forEach(object=>{
      if(object.visible===false&&(object.isMesh||object.isLine||object.isPoints))reveal(object)
      if(object.isInstancedMesh&&object.count===0){counts.push(object);object.count=1}
      if(object.isMesh||object.isLine||object.isPoints){frustum.push([object,object.frustumCulled]);object.frustumCulled=false}
    })
    // compile(scene, camera, targetScene) permits a subset of objects while
    // gathering the exact light/fog/environment state from the live scene.
    const compileRoot={traverse:visit=>targets.forEach(visit),traverseVisible:()=>{}}
    const compile=()=>untilStopped(renderer.compileAsync
      ?renderer.compileAsync(compileRoot,viewer.scene.mainCamera,viewer.scene)
      :renderer.compile(compileRoot,viewer.scene.mainCamera,viewer.scene),signal)
    const settle=async()=>{releaseRender();for(let frame=0;frame<2;frame++){check(signal);viewer.setDirty(manager);await pause(0,signal,true)}}
    renderer.shadowMap.needsUpdate=true
    // Submit this variant before uploads so the driver can compile while the
    // CPU submits textures. Images and pool state are already final. The idle
    // variant stays sequential: compileAsync polls each material's currentProgram.
    const activeCompile=measure('compile-active-lights',compile)
    // An upload may throw before we await compilation; still observe its later
    // rejection (including Stop), without releasing either readiness gate.
    Promise.resolve(activeCompile).catch(()=>{})
    check(signal)
    measure('texture-upload',()=>{for(const texture of textures)renderer.initTexture?.(texture)})
    await activeCompile
    check(signal)
    await measure('render-active-lights',settle)
    // Reset reveals the actual idle light state (including fixed-light pools),
    // but also hides tracer/projectile geometry. Prime that geometry again so
    // the real compositor renders its idle-light variants before first input.
    releaseWeapons?.();releaseWeapons=null
    const idleLights=(manager.playerView?.weapons?.projectiles?.lights||[]).map(light=>[light,light.visible,light.intensity])
    releaseWeapons=manager.playerView?.weapons?.primeWarmup?.(viewer.scene.mainCamera)
    for(const [light,visible,intensity] of idleLights){light.visible=visible;light.intensity=intensity}
    await measure('compile-inactive-lights',compile)
    check(signal)
    await measure('render-inactive-lights',settle)
    measure('gpu-finish',()=>renderer.getContext().finish())
    return {textures:textures.size,materials:materials.size,programs:renderer.info.programs?.length||0,
      deathPath:manager.unitView?.warmupReport||null}
  } catch(error) {
    if(signal?.aborted)return {cancelled:true}
    throw error
  } finally {
    signal?.removeEventListener('abort',cleanup)
    cleanup()
  }
}

export function warmupTargets(viewer, menuRoot) {
  const excluded=new Set()
  // Invisible authored sources have equivalent runtime copies. Do not compile
  // or upload their unused materials; shared resources reached from runtime
  // objects are still collected and warmed normally.
  const authored=(node,hidden=false)=>{
    hidden ||= node.visible===false
    if(hidden)excluded.add(node)
    for(const child of node.children || [])authored(child,hidden)
  }
  if(viewer.scene.modelRoot)authored(viewer.scene.modelRoot)
  menuRoot?.traverse(object=>excluded.add(object))
  const targets=[]
  viewer.scene.traverse(object=>{if(!excluded.has(object))targets.push(object)})
  return targets
}

function collectRenderResources(viewer,targets) {
  const textures=new Set(),materials=new Set(),visited=new WeakSet()
  const visit=(value,depth=0)=>{
    if(!value||depth>6)return
    if(value.isTexture){textures.add(value);return}
    if(value.isMaterial){materials.add(value);for(const item of Object.values(value))visit(item,depth+1);return}
    if(typeof value!=='object'||visited.has(value))return
    visited.add(value)
    if(value.isObject3D){
      value.traverse(object=>{
        const list=Array.isArray(object.material)?object.material:[object.material]
        for(const material of list)visit(material,0)
      })
      return
    }
    if(value.isWebGLRenderTarget){visit(value.texture,depth+1);visit(value.depthTexture,depth+1);return}
    if(ArrayBuffer.isView(value)||value instanceof WebGLRenderingContext||typeof WebGL2RenderingContext!=='undefined'&&value instanceof WebGL2RenderingContext)return
    for(const [key,item] of Object.entries(value)){
      if(['parent','domElement','_listeners','renderer','viewer','scene'].includes(key))continue
      visit(item,depth+1)
    }
  }
  for(const object of targets) {
    const list=Array.isArray(object.material)?object.material:[object.material]
    for(const material of list)visit(material)
  }
  visit(viewer.scene.environment);visit(viewer.scene.background)
  visit(viewer.renderManager.composerTarget);visit(viewer.renderManager.composerTarget2)
  for(const pass of viewer.renderManager.passes)visit(pass)
  return {textures,materials}
}

async function waitForImages(textures, signal) {
  const started=performance.now()
  while(true){
    const pending=[...textures].filter(texture=>{
      const source=texture.source?.data||texture.image
      if(Array.isArray(source))return source.some(image=>!imageReady(image))
      return !imageReady(source)
    })
    if(!pending.length)return
    if(performance.now()-started>20_000)throw new Error(`Texture warmup timed out with ${pending.length} image(s) pending: ${pending.map(texture=>texture.name||texture.source?.data?.src||texture.uuid).join(', ')}`)
    await pause(16, signal)
  }
}

function imageReady(image) {
  if(!image)return true
  if(image.complete===false)return false
  return Boolean(image.width||image.videoWidth||image.data?.width)
}
