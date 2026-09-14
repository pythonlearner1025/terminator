// Share only immutable, byte-identical imported images before the target Texture
// has a GPU allocation. Texture UUIDs, transforms, samplers and color spaces stay
// independent; Three's Source+upload-key cache decides GPU compatibility.
const png=[137,80,78,71,13,10,26,10]
export function staticImageKind(bytes) {
  const b=ArrayBuffer.isView(bytes)?new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength):new Uint8Array(bytes),word=(at,n)=>String.fromCharCode(...b.subarray(at,at+n))
  if(b.length>=3&&b[0]===255&&b[1]===216&&b[2]===255)return 'jpeg'
  if(b.length>=8&&png.every((v,i)=>b[i]===v)) {
    const view=new DataView(b.buffer,b.byteOffset,b.byteLength)
    for(let at=8;at+12<=b.length;) {
      const length=view.getUint32(at),type=word(at+4,4)
      if(type==='acTL')return null // Animated PNG is mutable even with a blob URL.
      if(at+12+length>b.length)return null
      if(type==='IEND')return 'png'
      at+=12+length
    }
    return null
  }
  if(b.length>=12&&word(0,4)==='RIFF'&&word(8,4)==='WEBP') {
    const view=new DataView(b.buffer,b.byteOffset,b.byteLength)
    for(let at=12;at+8<=b.length;) {
      const length=view.getUint32(at+4,true),type=word(at,4)
      if(at+8+length>b.length)return null
      if(type==='ANIM'||type==='ANMF'||type==='VP8X'&&(b[at+8]&2))return null
      at+=8+length+(length&1)
    }
    return 'webp'
  }
  return null // GIF, SVG, video, compressed/cube/data and unknown decoders excluded.
}
const defaultImage=image=>typeof HTMLImageElement!=='undefined'&&image instanceof HTMLImageElement&&!image.srcset&&image.complete&&image.naturalWidth>0&&image.naturalHeight>0&&image.width===image.naturalWidth&&image.height===image.naturalHeight
const imageUrl=image=>image.currentSrc||image.src||''
const dimensions=image=>[image.naturalWidth||image.width,image.naturalHeight||image.height]
const slots=material=>material?Object.values(material).filter(value=>value?.isTexture):[]
function collectTextures(imported) {
  const found=new Set()
  const add=value=>{
    if(!value)return
    if(Array.isArray(value)){value.forEach(add);return}
    if(value.isTexture){found.add(value);return}
    if(value.isMaterial){slots(value).forEach(t=>found.add(t));return}
    if(value.traverse)value.traverse(object=>{for(const m of (Array.isArray(object.material)?object.material:[object.material]))slots(m).forEach(t=>found.add(t))})
  }
  add(imported);return found
}
export function exactImageBytesEqual(a,b) {
  if(a.byteLength!==b.byteLength)return false
  let index=0
  if(a.byteOffset%4===0&&b.byteOffset%4===0){
    const length=a.byteLength>>>2,x=new Uint32Array(a.buffer,a.byteOffset,length),y=new Uint32Array(b.buffer,b.byteOffset,length)
    for(let i=0;i<length;i++)if(x[i]!==y[i])return false
    index=length*4
  }
  for(;index<a.byteLength;index++)if(a[index]!==b[index])return false
  return true
}
export function createExactImageSourceCache({hasUploaded=()=>true,isImage=defaultImage,
  readBytes=blob=>blob.arrayBuffer(),fetchBlob=url=>fetch(url).then(r=>{if(!r.ok)throw Error('Image blob unavailable');return r.blob()}),
  maxEntries=512,maxCacheBytes=64*1024*1024,maxImageBytes=16*1024*1024,hashConcurrency=4}={}) {
  if(!Number.isInteger(maxEntries)||maxEntries<1)throw new RangeError('Image cache size must be a positive integer')
  if(!Number.isInteger(maxCacheBytes)||maxCacheBytes<1)throw new RangeError('Image byte budget must be positive')
  if(!Number.isInteger(hashConcurrency)||hashConcurrency<1||hashConcurrency>8)throw new RangeError('Image read concurrency must be 1–8')
  let active=true,sourceReads=new WeakMap(),seen=new WeakMap(),running=0,nextId=0
  const jobs=[],entries=new Map(),buckets=new Map()
  const stats={imports:0,considered:0,reads:0,readMs:0,compareMs:0,firstReadAt:null,lastReadAt:null,peakReads:0,encodedBytesRead:0,cacheBytes:0,peakCacheBytes:0,shared:0,estimatedSharedRgbaBytes:0,skippedUploaded:0,skippedUnsupported:0,failed:0,disposed:false}
  function pump() {
    if(!active){for(const job of jobs.splice(0))job.resolve(null);return}
    while(running<hashConcurrency&&jobs.length){
      const job=jobs.shift();running++;stats.peakReads=Math.max(stats.peakReads,running)
      Promise.resolve().then(job.work).then(value=>{running--;job.resolve(value);pump()},error=>{running--;job.reject(error);pump()})
    }
  }
  const enqueue=work=>new Promise((resolve,reject)=>{jobs.push({work,resolve,reject});pump()})
  const descriptor=texture=>{
    if(!texture?.isTexture||texture.isCubeTexture||texture.isDataTexture||texture.isDataArrayTexture||texture.isData3DTexture||texture.isCompressedTexture||texture.isVideoTexture||texture.isRenderTargetTexture||texture.isFramebufferTexture||texture.mipmaps?.length)return null
    const source=texture.source,image=source?.data
    if(!isImage(image)||!texture.version)return null
    const url=imageUrl(image)
    // Read the blob actually decoded by this image. __sourceBlob is importer
    // provenance and can survive an editor replacing Texture.source/image.
    if(!url.startsWith('blob:'))return null
    return {source,image,url,version:texture.version,size:dimensions(image)}
  }
  const valid=d=>isImage(d.image)&&d.source.data===d.image&&imageUrl(d.image)===d.url&&dimensions(d.image).every((n,i)=>n===d.size[i])
  const live=entry=>{
    const source=entry?.source.deref(),image=entry?.image.deref()
    return source&&image&&valid({source,image,url:entry.url,size:entry.size})?source:null
  }
  function evict(entry){
    entries.delete(entry.id);const bucket=buckets.get(entry.key);bucket?.delete(entry);if(!bucket?.size)buckets.delete(entry.key)
    stats.cacheBytes-=entry.bytes?.byteLength||0;entry.bytes=null
  }
  async function resolveSource(d) {
    let pending=sourceReads.get(d.source)
    if(pending&&pending.image===d.image&&pending.url===d.url){const entry=await pending.task;if(entry&&live(entry))return entry}
    const task=enqueue(async()=>{
      if(!active)return null
      const before=performance.now();stats.firstReadAt??=before
      const blob=await fetchBlob(d.url)
      if(blob.size>Math.min(maxImageBytes,maxCacheBytes)){stats.skippedUnsupported++;return null}
      const bytes=new Uint8Array(await readBytes(blob)),kind=staticImageKind(bytes)
      stats.reads++;stats.encodedBytesRead+=bytes.byteLength;stats.lastReadAt=performance.now();stats.readMs+=stats.lastReadAt-before
      if(!active||!kind||!valid(d))return null
      const key=`${kind}:${d.size.join('x')}:${bytes.byteLength}`
      let match=null;const compareAt=performance.now()
      for(const candidate of buckets.get(key)||[]){if(candidate.bytes&&live(candidate)&&exactImageBytesEqual(bytes,candidate.bytes)){match=candidate;break}}
      stats.compareMs+=performance.now()-compareAt
      if(match){if(entries.has(match.id)){entries.delete(match.id);entries.set(match.id,match)};return match}
      const entry={id:++nextId,key,bytes,source:new WeakRef(d.source),image:new WeakRef(d.image),url:d.url,size:d.size}
      entries.set(entry.id,entry);if(!buckets.has(key))buckets.set(key,new Set());buckets.get(key).add(entry)
      stats.cacheBytes+=bytes.byteLength
      while(entries.size>maxEntries||stats.cacheBytes>maxCacheBytes)evict(entries.values().next().value)
      stats.peakCacheBytes=Math.max(stats.peakCacheBytes,stats.cacheBytes)
      return entry
    })
    pending={image:d.image,url:d.url,task};sourceReads.set(d.source,pending)
    task.catch(()=>{if(sourceReads.get(d.source)===pending)sourceReads.delete(d.source)})
    return task
  }
  async function share(texture) {
    if(!active)return
    const d=descriptor(texture)
    if(!d){stats.skippedUnsupported++;return}
    const previous=seen.get(texture)
    if(previous?.source===d.source&&previous.image===d.image&&previous.url===d.url)return
    stats.considered++
    if(hasUploaded(texture)){stats.skippedUploaded++;return}
    const entry=await resolveSource(d),canonical=live(entry)
    if(!active||!canonical||!valid(d)||texture.source!==d.source||texture.version!==d.version)return
    if(hasUploaded(texture)){stats.skippedUploaded++;return}
    if(canonical!==d.source){texture.source=canonical;stats.shared++;stats.estimatedSharedRgbaBytes+=d.size[0]*d.size[1]*4*(texture.generateMipmaps?4/3:1)}
    seen.set(texture,{source:texture.source,image:texture.source.data,url:imageUrl(texture.source.data)})
  }
  return {stats,
    async process(imported){
      if(!active)return imported
      stats.imports++
      await Promise.all([...collectTextures(imported)].map(async texture=>{if(!active)return;try{await share(texture)}catch{stats.failed++}}))
      return imported
    },
    dispose(){active=false;pump();for(const entry of [...entries.values()])evict(entry);sourceReads=new WeakMap();seen=new WeakMap();stats.disposed=true},
    get size(){return entries.size},
  }
}
export function installExactImageSourceSharing(importer,options) {
  const original=importer.processRaw,cache=createExactImageSourceCache(options),holds=new Set()
  async function processRaw(...args) {
    const release=this===importer?options?.holdRendering?.():null
    let released=false
    const unlock=()=>{if(released)return;released=true;holds.delete(unlock);release?.()}
    holds.add(unlock)
    try {
      const result=await original.apply(this,args)
      return this===importer?await cache.process(result):result
    } finally {unlock()}
  }
  importer.processRaw=processRaw
  return {...cache,stats:cache.stats,dispose(){cache.dispose();for(const unlock of [...holds])unlock();if(importer.processRaw===processRaw)importer.processRaw=original}}
}
