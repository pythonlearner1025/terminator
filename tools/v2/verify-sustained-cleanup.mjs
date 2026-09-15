// Sequential follow-up after sustained capture. Never launches a parallel browser.
// DISPLAY=:1 taskset -c 0,1 node tools/v2/verify-sustained-cleanup.mjs
import {readFile,writeFile,appendFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {launchCaptureBrowser,browserOptions} from './capture-browser.mjs'
// Lower only the verification browser's JS GC threshold; visual settings stay high.
process.env.CHROME_ARGS=JSON.stringify([...browserOptions().args,'--js-flags=--max-old-space-size=768'])
const cg='/sys/fs/cgroup'+(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::')).slice(3)
const report={startedAt:new Date().toISOString(),errors:[],starts:[],stops:[],notes:['Follow-up after the natural sustained restart hit the memory guard. Explicit GC occurs only after Stop and is recorded; this tests reachable cleanup, not automatic GC behavior.']}
report.chromeArgs=browserOptions().args
const out='docs/evidence/sustained-cleanup.json'
let browser,monitor,child,timer,diagnostics
const stopCheck=()=>{if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{}}}
const save=()=>writeFile(out,JSON.stringify(report,null,2)+'\n')
const progress=async text=>{console.log(text);await appendFile('../coordination/sustained-validation.findings.md',`\n${new Date().toISOString()} ${text}\n`);await save()}
try{
 monitor=setInterval(async()=>{const n=Number(await readFile(cg+'/memory.current','utf8'));report.peakCgroupBytes=Math.max(n,report.peakCgroupBytes||0);if(n>3.5*1024**3&&!report.aborted){report.aborted='cgroup >3.5 GiB';console.error(report.aborted+' bytes='+n);stopCheck();await save();await browser?.close()}},250)
 timer=setTimeout(()=>{report.aborted='5 minute follow-up deadline';stopCheck();browser?.close()},300000)
 await writeFile(cg+'/memory.reclaim',String(1024**3)).catch(()=>{})
 browser=await launchCaptureBrowser()
 report.browserProcesses=browser.captureCgroup?.processes;browser.on('disconnected',()=>{report.browserDisconnectedAt=new Date().toISOString();stopCheck();console.error('Owned browser disconnected');save()})
 const ctx=await browser.newContext({viewport:{width:480,height:270},deviceScaleFactor:1,ignoreHTTPSErrors:true})
 const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
 let page=await ctx.newPage();page.on('pageerror',e=>report.errors.push(e.message))
 if(process.env.CHECK_DEBUG==='1'){
  const debuggerSession=await ctx.newCDPSession(page);await debuggerSession.send('Debugger.enable')
  debuggerSession.on('Debugger.paused',async event=>{report.pausedStack=event.callFrames.map(f=>({functionName:f.functionName,url:f.url,location:f.location}));console.log('PAUSED '+JSON.stringify(report.pausedStack));await save();await debuggerSession.send('Debugger.resume')})
  setTimeout(()=>debuggerSession.send('Debugger.pause').catch(e=>console.log(e.message)),20000)
 }
 const pending=new Set();report.diagnostics=[]
 page.on('request',r=>pending.add(new URL(r.url()).pathname));page.on('requestfinished',r=>pending.delete(new URL(r.url()).pathname));page.on('requestfailed',r=>pending.delete(new URL(r.url()).pathname))
 page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/check'&&r.status()!==200){report.checkHttpError=await r.text();await save()}})
 diagnostics=setInterval(async()=>{try{const state=await page.evaluate(()=>({ready:document.readyState,manager:!!window.terminator?.manager,route:window.terminator?.manager?.ui?.screens?.route,renderEnabled:window.terminator?.manager?.ctx?.viewer?.renderEnabled,viewsStarted:window.terminator?.manager?.viewsStarted,spans:window.terminator?.manager?.startup?.spans?.map(x=>({name:x.name,status:x.status,ms:x.ms})),canvas:[...document.querySelectorAll('canvas')].map(x=>({width:x.width,height:x.height,classes:x.className}))}));report.diagnostics.push({at:new Date().toISOString(),pending:[...pending].slice(0,20),state});await progress('Check diagnosis '+JSON.stringify(report.diagnostics.at(-1)))}catch{}},15000)
 const editorOpenedAt=Date.now()
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(async opened=>{const s=await fetch('/api/state').then(r=>r.json());return s.projectLoaded&&!s.lastLoadError&&Date.parse(s.updatedAt)>=opened},editorOpenedAt,{timeout:120000})
 const setupSession=await ctx.newCDPSession(page)
 await setupSession.send('HeapProfiler.collectGarbage');await setupSession.detach()
 await writeFile(cg+'/memory.reclaim',String(512*1024**2)).catch(()=>{})
 report.editorSetupGc=true;report.beforeCheckCgroupBytes=Number(await readFile(cg+'/memory.current','utf8'))
 await progress('Fresh sole owned editor loaded; explicit loading-GC + own-cgroup file reclaim before check. Bytes='+report.beforeCheckCgroupBytes)
 child=spawn('npx',['kite3d','check'],{detached:true,stdio:['ignore','pipe','pipe']});let log=''
 child.stdout.on('data',s=>{log+=s;process.stdout.write(s)});child.stderr.on('data',s=>{log+=s;process.stderr.write(s)})
 report.checkExit=await new Promise(resolve=>child.once('exit',resolve));child=null
 await writeFile('docs/evidence/sustained-check.log',log)
 clearInterval(diagnostics);diagnostics=null
 if(report.checkExit!==0){report.checkError=report.aborted||report.checkHttpError||'Check did not complete';process.exitCode=1}
 else report.check=JSON.parse(await readFile('.kite3d/check.json','utf8'))
 await progress('Editor check exit '+report.checkExit+'. Closing editor before short runtime restart diagnosis.')
 await page.close().catch(()=>{})
 // A fresh context destroys the editor renderer before the two runtime cycles.
 await ctx.close().catch(()=>{});await browser.close();browser=null
 if(report.aborted){report.checkAbort=report.aborted;delete report.aborted}
 await progress('First owned browser closed; launching one sequential fresh browser for short Stop/GC/retry probe.')
 await writeFile(cg+'/memory.reclaim',String(1024**3)).catch(()=>{})
 browser=await launchCaptureBrowser()
 const runtime=await browser.newContext({viewport:{width:480,height:270},deviceScaleFactor:1,ignoreHTTPSErrors:true})
 await runtime.addInitScript(()=>{
  localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',fov:72,controlsSeen:true}))
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-testid="start-match"]'))window.__click=performance.now()},true)
 })
 page=await runtime.newPage();page.setDefaultTimeout(90000);page.on('pageerror',e=>report.errors.push(e.message))
 await page.request.get(dev.url);await page.goto(dev.origin+'/files/tools/map-runtime.html',{waitUntil:'domcontentloaded'})
 const cdp=await runtime.newCDPSession(page)
 for(let cycle=0;cycle<2;cycle++){
  await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main')
  await page.getByTestId('menu-play').click();await page.getByTestId('start-match').click()
  await page.waitForFunction(()=>window.terminator.manager.visualWarmupReport&&!window.terminator.manager.ui.screens.route&&window.terminator.manager.input.active)
  report.starts.push(await page.evaluate(async()=>{await new Promise(requestAnimationFrame);const m=window.terminator.manager,r=m.ctx.viewer.renderManager.webglRenderer;return {clickToNextFrameMs:performance.now()-window.__click,memory:{...r.info.memory},programs:r.info.programs.length,heap:performance.memory?.usedJSHeapSize}}))
  await page.waitForTimeout(1000)
  const stop=await page.evaluate(async()=>{const m=window.terminator.manager,v=m.ctx.viewer;m.stop();await new Promise(requestAnimationFrame);return {runtimeRoots:v.scene.children.filter(o=>/Runtime|Endo menu stage/.test(o.name)).map(o=>o.name),memory:{...v.renderManager.webglRenderer.info.memory},programs:v.renderManager.webglRenderer.info.programs.length,heap:performance.memory?.usedJSHeapSize,started:m.started,world:m.world,renderEnabled:v.renderEnabled}})
  if(stop.runtimeRoots.length||stop.world||stop.started||!stop.renderEnabled)throw Error('Stop left runtime state')
  report.stops.push(stop);await save()
  await cdp.send('HeapProfiler.collectGarbage')
  stop.afterExplicitGc=await page.evaluate(()=>{const r=window.terminator.manager.ctx.viewer.renderManager.webglRenderer;return {memory:{...r.info.memory},programs:r.info.programs.length,heap:performance.memory?.usedJSHeapSize}})
  await progress(`Short cycle${cycle+1}: START ${report.starts[cycle].clickToNextFrameMs.toFixed(1)}ms; Stop roots empty; GPU ${stop.memory.geometries}/${stop.memory.textures}/${stop.programs}; explicit-GC heap ${stop.afterExplicitGc.heap}.`)
  if(cycle===0)await page.evaluate(()=>window.terminator.manager.start())
 }
 await cdp.detach()
}catch(e){report.error=e.stack;console.error(e.stack);process.exitCode=1}
finally{clearInterval(diagnostics);clearInterval(monitor);clearTimeout(timer);stopCheck();await browser?.close();report.finishedAt=new Date().toISOString();report.memoryEvents=await readFile(cg+'/memory.events','utf8');await save()}
