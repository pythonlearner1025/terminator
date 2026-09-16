// Verification-only preload for Kite3D's official headless check runner.
// DISPLAY=:1 NODE_OPTIONS="--import ./tools/v2/check-browser-policy.mjs" taskset -c 0,1 npx kite3d check
// The installed runner otherwise launches default Chromium with no cgroup guard.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import {browserOptions} from './capture-browser.mjs'
const launch=chromium.launch.bind(chromium)
chromium.launch=async options=>{
 const cg='/sys/fs/cgroup'+(await readFile('/proc/self/cgroup','utf8')).split('\n').find(x=>x.startsWith('0::')).slice(3)
 await writeFile(cg+'/memory.reclaim',String(1024**3)).catch(()=>{})
 const report={policy:'One 480x270 browser; official sequential headless check; JS old-space768MiB; own-cgroup abort3.5GiB',peakCgroupBytes:0}
 let browser,monitor,reclaiming=false
 const save=()=>writeFile('.kite3d/check-browser-policy.json',JSON.stringify(report,null,2))
 monitor=setInterval(async()=>{const n=Number(await readFile(cg+'/memory.current','utf8'));report.peakCgroupBytes=Math.max(n,report.peakCgroupBytes);if(n>3.5*1024**3&&!report.aborted){report.aborted='cgroup >3.5GiB';console.error(report.aborted);await save();await browser?.close()}else if(n>3*1024**3&&!reclaiming){reclaiming=true;try{const stats=await readFile(cg+'/memory.stat','utf8'),inactive=Number(stats.match(/^inactive_file (\d+)/m)?.[1]||0);if(inactive>128*1024**2){await writeFile(cg+'/memory.reclaim',String(Math.min(inactive,1024**3)));report.fileReclaims=(report.fileReclaims||0)+1}}catch{}finally{reclaiming=false}}},100)
 try{
  const configured=browserOptions()
  browser=await launch({...options,...configured,args:[...configured.args,'--js-flags=--max-old-space-size=768'],env:{...process.env,DBUS_SESSION_BUS_ADDRESS:'unix:path=/nonexistent-kite3d-capture-bus'}})
  const cdp=await browser.newBrowserCDPSession(),info=await cdp.send('SystemInfo.getProcessInfo');await cdp.detach()
  for(const proc of info.processInfo){const group=(await readFile(`/proc/${proc.id}/cgroup`,'utf8')).split('\n').find(x=>x.startsWith('0::')).slice(3);if('/sys/fs/cgroup'+group!==cg)throw Error('Browser escaped cgroup')}
  const newPage=browser.newPage.bind(browser)
  browser.newPage=options=>newPage({viewport:{width:480,height:270},deviceScaleFactor:1,...options})
  const close=browser.close.bind(browser)
  browser.close=async(...args)=>{try{return await close(...args)}finally{clearInterval(monitor);await save()}}
  return browser
 }catch(error){clearInterval(monitor);await browser?.close();await save();throw error}
}
