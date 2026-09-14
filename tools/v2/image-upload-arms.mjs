// Each arm starts from the same encoded Blob. In particular, the DOM baseline
// pays for a fresh Image.decode(), and DOM-to-Bitmap pays for both preparations.
export async function loadProbeDOMImage(blob) {
  const url=URL.createObjectURL(blob),image=new Image()
  let released=false
  const release=()=>{if(released)return;released=true;image.src='';URL.revokeObjectURL(url)}
  try {image.src=url;await image.decode();return {image,release}}
  catch(error){release();throw error}
}

export async function sampleImageUploadArm(kind,{blob,imageOptions,upload,
  loadDOMImage=loadProbeDOMImage,createBitmap=(source,options)=>createImageBitmap(source,options),now=()=>performance.now()}) {
  if(!['dom','bitmap','directBlob'].includes(kind))throw Error('Unknown image upload arm')
  const start=now()
  let dom,bitmap,domDecodeMs=0,domToBitmapMs=0,bitmapDecodeMs=0
  try {
    if(kind!=='directBlob'){
      const at=now();dom=await loadDOMImage(blob);domDecodeMs=now()-at
    }
    if(kind!=='dom'){
      const at=now();bitmap=await createBitmap(kind==='directBlob'?blob:dom.image,imageOptions)
      if(kind==='directBlob')bitmapDecodeMs=now()-at
      else domToBitmapMs=now()-at
    }
    const prepareMs=now()-start
    const result=await upload(bitmap||dom.image)
    return {domDecodeMs,domToBitmapMs,bitmapDecodeMs,prepareMs,uploadMs:result.ms,
      // The upload records completion before optional readback. This is a
      // contiguous elapsed interval, not a sum of independent median timings.
      decodeAndUploadMs:result.finishedAt-start,pixels:result.pixels}
  }finally{bitmap?.close();dom?.release()}
}
