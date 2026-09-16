import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {dirname} from 'node:path'
import {execFileSync} from 'node:child_process'
import {launchCaptureBrowser,rendererInfo} from './capture-browser.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const scan=JSON.parse(await readFile('assets/v2/architecture/rubble-cover.json','utf8'))
const config=JSON.parse(await readFile('docs/scene-targets/views.json','utf8'))
const output=process.argv[2]||'docs/evidence/v2-cover17-checks/readiness.json'
await readFile(output).then(()=>{throw Error('Refusing to overwrite readiness evidence')},e=>{if(e.code!=='ENOENT')throw e})
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),pageErrors:[],expectedConsoleErrors:[],pass:false}
const browser=await launchCaptureBrowser()
let releaseGate
try {
 const page=await browser.newPage({viewport:config.viewport})
 page.on('pageerror',e=>report.pageErrors.push(e.message))
 page.on('console',e=>{if(e.type()==='error')report.expectedConsoleErrors.push(e.text())})
 await page.addInitScript(settings=>localStorage.setItem('terminator.settings.v1',JSON.stringify(settings)),config.settings)
 await page.request.get(dev.url);await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
 const menu=()=>page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main',null,{timeout:120000})
 await menu();report.renderer=await rendererInfo(page)
 const pattern=`**/assets/models/selected/${scan.source}/scene.bin`
 // Install only after the authored scene and stopped preview loaded: fail the
 // new runtime pile fetch without sabotaging the original imported source.
 let failedRequests=0
 const fail=async route=>{failedRequests++;await route.fulfill({status:503,body:'Intentional cover-readiness test failure'})}
 await page.route(pattern,fail)
 report.failure=await page.evaluate(async()=>{
  const m=window.terminator.manager;let error=null
  try{await m.ui.startMatch()}catch(e){error=e.message}
  const mv=m.mapView
  const result={error,phase:m.director.phase,reportedError:mv.v2Error?.message,coverRootPresent:!!mv.root.getObjectByName('V2 Declared Collapse Cover'),warmupPublished:!!m.visualWarmupReport}
  const sources=[...mv.batching.placements]
  m.stop()
  result.sourcesRestored=sources.every(p=>!!p.parent)
  result.runtimeRootsAfterStop=window.viewer.scene.children.filter(o=>o.name==='Map Runtime').length
  return result
 })
 assert.equal(report.failure.sourcesRestored,true)
 assert.equal(failedRequests,1);assert.match(report.failure.error,/503/);assert.match(report.failure.reportedError,/503/)
 assert.equal(report.failure.phase,'lobby');assert.equal(report.failure.coverRootPresent,false);assert.equal(report.failure.warmupPublished,false);assert.equal(report.failure.runtimeRootsAfterStop,0)
 await page.unroute(pattern,fail)
 await page.evaluate(()=>window.terminator.manager.start());await menu()
 let entered,timeout
 const observed=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>releaseGate=resolve)
 const hold=async route=>{entered();await gate;await route.abort('failed').catch(()=>{})}
 await page.route(pattern,hold)
 await page.evaluate(()=>{
  const m=window.terminator.manager;m.startViews();window.__coverReadySettled=false
  window.__coverPending=Promise.allSettled([m.mapView.ready,m.visualWarmup]).then(results=>{window.__coverReadySettled=true;return results.map(r=>({status:r.status,cancelled:r.value?.cancelled,error:r.reason?.message}))})
 })
 try {await Promise.race([observed,new Promise((_,reject)=>timeout=setTimeout(()=>reject(Error('Runtime cover request was not observed')),60000))])}finally{clearTimeout(timeout)}
 report.cancellation=await page.evaluate(()=>{
  const m=window.terminator.manager,mv=m.mapView
  const result={settledBeforeAsset:window.__coverReadySettled,phase:m.director.phase,declaredRecords:m.mapData.colliders.filter(c=>c.v2ArchitectureCover).length}
  const sources=[...mv.batching.placements]
  m.stop();result.sourcesRestored=sources.every(p=>!!p.parent);result.runtimeRootsAfterStop=window.viewer.scene.children.filter(o=>o.name==='Map Runtime').length
  result.previewVisible=(window.viewer.scene.modelRoot.getObjectByName('V2 Environment Preview')||window.viewer.scene.modelRoot.getObjectByName('V2_Environment_Preview'))?.visible
  return result
 })
 releaseGate();report.cancellation.promises=await page.evaluate(()=>window.__coverPending)
 assert.equal(report.cancellation.settledBeforeAsset,false);assert.equal(report.cancellation.phase,'lobby');assert.equal(report.cancellation.declaredRecords,7)
 assert.equal(report.cancellation.sourcesRestored,true)
 assert.equal(report.cancellation.runtimeRootsAfterStop,0);assert.equal(report.cancellation.previewVisible,true)
 assert(report.cancellation.promises.every(r=>r.status==='fulfilled'));assert.equal(report.cancellation.promises[1].cancelled,true)
 assert.deepEqual(report.pageErrors,[])
 assert(report.expectedConsoleErrors.every(s=>s.includes('503')||s.includes('V2 scene failed to initialize')))
 report.pass=true
} finally {
 releaseGate?.()
 try{await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')+'\n')}finally{await browser.close()}
}
console.log('PASS: real runtime cover failure prevents wave start; pending asset stop cancels readiness and restores preview')
