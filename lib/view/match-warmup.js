import {weaponSurfaceMaps} from './weapons-materials.js'

const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve))

// Resolve image decodes, force every resident texture onto the GPU, and compile
// hidden gameplay and menu variants before the director can start the first wave.
export async function warmupMatch(manager) {
  const viewer=manager.ctx.viewer,renderer=viewer.renderManager.webglRenderer
  await Promise.all([
    manager.mapView?.ready,
    manager.unitView?.fx?.materials?.ready,
    manager.unitView?.fx?.gore?.ready,
    manager.unitView?.rosterFx?.ready,
    weaponSurfaceMaps().ready,
  ].filter(Boolean))
  if(!manager.viewsStarted)return {cancelled:true}

  const releaseUnits=manager.unitView?.primeWarmup?.()
  const releaseGrenades=manager.grenadeView?.primeWarmup?.()
  const fixedPools=[
    ...Object.values(manager.playersView?.fx?.pools||{}),
    ...Object.values(manager.playerView?.weapons?.worldFx?.pools||{}),
  ]
  for(const pool of fixedPools)pool.prime(viewer.scene.mainCamera)

  const {textures,materials}=collectRenderResources(viewer,manager.ui?.menuScene?.root)
  await waitForImages(textures)
  for(const texture of textures)renderer.initTexture?.(texture)

  const visibility=[],counts=[],frustum=[],menuObjects=new Set()
  manager.ui?.menuScene?.root?.traverse(object=>menuObjects.add(object))
  const reveal=object=>{if(object&&object.visible===false&&!menuObjects.has(object)){visibility.push(object);object.visible=true}}
  for(const rig of Object.values(manager.playerView?.weapons?.rigs||{}))reveal(rig.root)
  reveal(manager.playerView?.weapons?.fx?.flash)
  viewer.scene.traverse(object=>{
    if(object.visible===false&&(object.isMesh||object.isLine||object.isPoints))reveal(object)
    if(object.isInstancedMesh&&object.count===0){counts.push(object);object.count=1}
    if(object.isMesh||object.isLine||object.isPoints){frustum.push([object,object.frustumCulled]);object.frustumCulled=false}
  })
  try{
    renderer.shadowMap.needsUpdate=true
    renderer.compile(viewer.scene,viewer.scene.mainCamera)
    if(renderer.compileAsync)await renderer.compileAsync(viewer.scene,viewer.scene.mainCamera)
    for(let frame=0;frame<4;frame++){viewer.setDirty(manager);await nextFrame()}
    renderer.getContext().finish()
  }finally{
    for(const [object,value] of frustum)object.frustumCulled=value
    for(const object of counts)object.count=0
    for(const object of visibility)object.visible=false
    for(const pool of fixedPools)pool.reset()
    releaseUnits?.()
    releaseGrenades?.()
  }
  return {textures:textures.size,materials:materials.size,programs:renderer.info.programs?.length||0,
    deathPath:manager.unitView?.warmupReport||null}
}

function collectRenderResources(viewer,extraRoot) {
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
  visit(viewer.scene);visit(extraRoot)
  visit(viewer.scene.environment);visit(viewer.scene.background)
  visit(viewer.renderManager.composerTarget);visit(viewer.renderManager.composerTarget2)
  for(const pass of viewer.renderManager.passes)visit(pass)
  return {textures,materials}
}

async function waitForImages(textures) {
  const started=performance.now()
  while(true){
    const pending=[...textures].filter(texture=>{
      const source=texture.source?.data||texture.image
      if(Array.isArray(source))return source.some(image=>!imageReady(image))
      return !imageReady(source)
    })
    if(!pending.length)return
    if(performance.now()-started>20_000)throw new Error(`Texture warmup timed out with ${pending.length} image(s) pending: ${pending.map(texture=>texture.name||texture.source?.data?.src||texture.uuid).join(', ')}`)
    await new Promise(resolve=>setTimeout(resolve,16))
  }
}

function imageReady(image) {
  if(!image)return true
  if(image.complete===false)return false
  return Boolean(image.width||image.videoWidth||image.data?.width)
}
