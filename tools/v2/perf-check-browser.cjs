// Route Kite3D's check browser through the same guarded GPU launcher. This is
// process-local; the shared dependency tree stays read-only.
const {createRequire}=require('node:module')
const {pathToFileURL}=require('node:url')
const path=require('node:path')
const {chromium}=createRequire(path.resolve('package.json'))('playwright')
const original=chromium.launch
async function launch(){
  chromium.launch=original
  try{
    const browser=await (await import(pathToFileURL(path.resolve('tools/v2/capture-browser.mjs')))).launchCaptureBrowser()
    const newPage=browser.newPage.bind(browser)
    browser.newPage=async (...args)=>{
      const page=await newPage(...args)
      const redact=s=>String(s).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
      page.on('pageerror',error=>console.error('[check page]',redact(error.message)))
      page.on('console',message=>{if(message.type()==='error')console.error('[check console]',redact(message.text()))})
      const wait=page.waitForFunction.bind(page)
      // The CLI's fixed 45 s includes both full preview loads plus warmup and
      // the persistence reload. Extend only this completion deadline, not any
      // assertion or runtime workload, for the unchanged full R10 assets.
      page.waitForFunction=(fn,arg,options)=>wait(fn,arg,fn==='window.__kite3dCheckDone === true'?{...options,timeout:120000}:options)
      return page
    }
    return browser
  }
  finally{chromium.launch=launch}
}
chromium.launch=launch
