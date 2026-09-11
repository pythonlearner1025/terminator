import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'

const log=await readFile('/tmp/terminator-w17-dev.log','utf8')
const url=new URL(log.match(/http:\/\/[^\s]+\?t=[^\s]+/)[0])
if(url.port!=='4595')throw Error('Use the UI development server on port 4595')
url.searchParams.set('headless','check');url.searchParams.set('frames','30')
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true})
const issues=[]
try{
  const page=await browser.newPage()
  page.on('pageerror',error=>issues.push(error.message.replace(/([?&]t=)[^&\s)]+/g,'$1[redacted]')))
  await page.goto(url.href,{waitUntil:'domcontentloaded'})
  await page.waitForFunction(()=>window.__kite3dCheckDone===true,null,{timeout:120000,polling:200})
  const result=await page.evaluate(()=>window.__kite3dCheckResult)
  await writeFile(new URL('kite3d-native-check.json',import.meta.url),JSON.stringify({launcher:'Headless full Chromium, unchanged Kite3D checker, 120s deadline',...result,issues},null,2)+'\n')
  console.log(JSON.stringify({ok:result.ok,outcomes:result.outcomes.map(({name,status,summary})=>({name,status,summary})),issues}))
  if(!result.ok || issues.length)process.exitCode=1
}finally{await browser.close()}
