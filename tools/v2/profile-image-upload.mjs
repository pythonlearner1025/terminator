// Bounded upload diagnostic. This suspends gameplay while sampling a separate
// context; none of these numbers are end-to-end startup or native combat FPS.
import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
assert.equal(process.env.STARTUP_GPU_GRANTED,'1')
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const port=process.env.STARTUP_DEV_PORT||'4755'
assert.equal(new URL(new URL(dev.url).origin).hostname,'127.0.0.1');assert.equal(new URL(new URL(dev.url).origin).port,port)
assert((process.platform==='darwin'?['4753','4755','4756']:['4755']).includes(port))
if(process.platform==='linux')assert.equal(JSON.parse(await readFile('../coordination/perf-budget-gpu.json','utf8')).owner,'perf-budget-startup')
const output=process.argv[2];assert(output,'Supply a fresh evidence path')
await readFile(output).then(()=>{throw Error('Refusing evidence overwrite')},e=>{if(e.code!=='ENOENT')throw e})
const report={schema:2,source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),method:'Three arms from actual current blobURL bytes: fresh DOM decode/upload, fresh DOM decode/Bitmap conversion/upload, direct Blob Bitmap decode/upload. Common blob read timed separately; fresh decode invocations do not flush browser/OS decoder caches. Isolated RGBA8/sRGB8 context; not cold startup/FPS acceptance',errors:[]}
const browser=await launchCaptureBrowser()
try {
  const page=await browser.newPage({viewport:{width:1920,height:1080}})
  page.on('pageerror',e=>report.errors.push(e.message))
  await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',fov:72,controlsSeen:true})))
  await page.request.get(dev.url)
  await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
  await page.evaluate(async()=>{const m=window.terminator.manager;await m.ui.startMatch();m.ui.screens.show(null)})
  report.renderer=await rendererInfo(page)
  report.samples=await page.evaluate(async()=>{
    const {sampleImageUploadArm}=await import('/files/tools/v2/image-upload-arms.mjs')
    const manager=window.terminator.manager,viewer=manager.ctx.viewer
    const previousRender=viewer.renderEnabled,previousUpdate=manager.update
    const textures=[],seen=new Set()
    viewer.scene.traverse(object=>{
      for(const material of (Array.isArray(object.material)?object.material:[object.material]))if(material)
        for(const texture of Object.values(material))if(texture?.isTexture&&!seen.has(texture.source)){
          const image=texture.source?.data
          if(image instanceof HTMLImageElement&&image.complete&&image.naturalWidth>=1024&&image.naturalWidth<=2048&&image.naturalHeight<=2048&&(image.currentSrc||image.src).startsWith('blob:')){seen.add(texture.source);textures.push(texture)}
        }
    })
    textures.sort((a,b)=>Number(/floor|endo/i.test(b.name))-Number(/floor|endo/i.test(a.name)))
    if(!textures.length)throw Error('No eligible original imported image')
    const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false,alpha:true,premultipliedAlpha:false})
    if(!gl)throw Error('WebGL2 unavailable')
    const framebuffer=gl.createFramebuffer(),results=[]
    viewer.renderEnabled=false;manager.update=()=>true
    const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)*p)]
    try {
      for(const texture of textures.slice(0,3)){
        const source=texture.source,image=source.data,width=image.naturalWidth,height=image.naturalHeight
        const url=image.currentSrc||image.src,readAt=performance.now(),response=await fetch(url)
        if(!response.ok)throw Error('Current image blob unavailable: '+response.status)
        const blob=await response.blob(),blobReadMs=performance.now()-readAt
        if(texture.source!==source||source.data!==image||(image.currentSrc||image.src)!==url||!image.complete||image.naturalWidth!==width||image.naturalHeight!==height)throw Error('Original decoded image changed during blob read')
        if(blob.size>16*1024*1024)throw Error('Image exceeds bounded probe payload')
        for(const flipY of [false,true])for(const premultiplyAlpha of [false,true]){
          const imageOptions={imageOrientation:flipY?'flipY':'none',premultiplyAlpha:premultiplyAlpha?'premultiply':'none',colorSpaceConversion:'none'}
          const arms={dom:[],bitmap:[],directBlob:[]},parity={}
          const upload=(source,readback)=>{
            const target=gl.createTexture()
            try {
              gl.bindTexture(gl.TEXTURE_2D,target)
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flipY)
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiplyAlpha)
              gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE)
              gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR)
              gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
              const levels=texture.generateMipmaps?Math.floor(Math.log2(Math.max(width,height)))+1:1
              gl.finish();const at=performance.now()
              gl.texStorage2D(gl.TEXTURE_2D,levels,texture.colorSpace==='srgb'?gl.SRGB8_ALPHA8:gl.RGBA8,width,height)
              gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,source)
              if(texture.generateMipmaps)gl.generateMipmap(gl.TEXTURE_2D)
              gl.finish();const finishedAt=performance.now(),ms=finishedAt-at
              let pixels
              if(readback){
                gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0)
                if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete sample framebuffer')
                pixels=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels)
                gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,null,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null)
              }
              const error=gl.getError();if(error!==gl.NO_ERROR)throw Error('GL sample error '+error)
              return {ms,finishedAt,pixels}
            }finally{gl.deleteTexture(target)}
          }
          // The already-rendered original is solely the parity reference. It is
          // never substituted for the fresh decode in the measured DOM arm.
          const reference=upload(image,true).pixels
          const kinds=['dom','bitmap','directBlob']
          for(let repeat=0;repeat<5;repeat++)for(let offset=0;offset<kinds.length;offset++){
            const kind=kinds[(repeat+offset)%kinds.length]
            gl.finish()
            const sample=await sampleImageUploadArm(kind,{blob,imageOptions,upload:input=>{
              if((input.naturalWidth||input.width)!==width||(input.naturalHeight||input.height)!==height)throw Error('Decoded dimensions changed')
              return upload(input,repeat===0)
            }})
            if(repeat===0){
              let differentBytes=0,maxError=0
              for(let i=0;i<reference.length;i++){const delta=Math.abs(reference[i]-sample.pixels[i]);differentBytes+=Number(delta!==0);maxError=Math.max(maxError,delta)}
              parity[kind]={comparedBytes:reference.length,differentBytes,maxError}
            }
            delete sample.pixels
            sample.blobReadPlusDecodeAndUploadMs=blobReadMs+sample.decodeAndUploadMs
            arms[kind].push(sample)
          }
          const medians=Object.fromEntries(kinds.map(kind=>[kind,Object.fromEntries(Object.keys(arms[kind][0]).map(key=>[key,percentile(arms[kind].map(sample=>sample[key]),.5)]))]))
          results.push({name:texture.name,width,height,colorSpace:texture.colorSpace,generateMipmaps:texture.generateMipmaps,flipY,premultiplyAlpha,imageOptions,
            blob:{source:'actual current blobURL; importer metadata unused',bytes:blob.size,mimeType:blob.type,readMs:blobReadMs},
            arms,medians,parity,exact:kinds.every(kind=>parity[kind].differentBytes===0),
            // Retain upload-only fields for old report readers; medians above
            // are the complete fresh-decode pipelines used for decisions.
            dom:arms.dom.map(s=>s.uploadMs),bitmap:arms.bitmap.map(s=>s.uploadMs),directBlob:arms.directBlob.map(s=>s.uploadMs),
            domMedian:medians.dom.uploadMs,bitmapMedian:medians.bitmap.uploadMs,directBlobMedian:medians.directBlob.uploadMs,
            creationMs:medians.bitmap.domToBitmapMs,directBlobDecodeMs:medians.directBlob.bitmapDecodeMs,
            comparedBytes:reference.length,differentBytes:Math.max(...kinds.map(kind=>parity[kind].differentBytes)),maxError:Math.max(...kinds.map(kind=>parity[kind].maxError))})
        }
      }
      return results
    }finally{
      gl.deleteFramebuffer(framebuffer);gl.getExtension('WEBGL_lose_context')?.loseContext()
      manager.update=previousUpdate;viewer.renderEnabled=previousRender;viewer.setDirty()
    }
  })
  report.exact=report.samples.every(sample=>sample.exact)
  await page.evaluate(()=>window.terminator.manager.stop())
  assert.deepEqual(report.errors,[])
  report.cgroup=browser.captureCgroup
}catch(error){report.error=error.stack;throw error}
finally{await browser.close();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({exact:report.exact,samples:report.samples.length,output}))
