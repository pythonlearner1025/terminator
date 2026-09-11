#!/usr/bin/env node
// Same headless check entrypoint used by kite3d check, pinned to our server.
// Concurrent agents can replace the shared .kite3d/dev.json with stale metadata.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
const log=await readFile('.kite3d/w11-dev.log','utf8')
const url=new URL(log.match(/http:\/\/127\.0\.0\.1:4950\/\?t=[A-Za-z0-9._~-]+/)?.[0])
url.searchParams.set('headless','check');url.searchParams.set('frames','30')
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage()
  await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000})
  await page.waitForFunction('window.__kite3dCheckDone === true',null,{timeout:45000})
  const result=await page.evaluate(()=>window.__kite3dCheckResult)
  const serialized=JSON.stringify(result,null,2).replace(/\?t=[A-Za-z0-9._~-]+/g,'?t=[redacted]')
  await writeFile('docs/evidence/w11/kite3d-check.json',serialized+'\n')
  console.log(JSON.stringify(result.outcomes?.map(({name,status,summary,codes})=>({name,status,summary,codes}))||{keys:Object.keys(result)},null,2))
  if(!result.outcomes?.every(o=>o.status==='pass'))throw Error('Kite3D runtime outcomes did not all pass')
}finally {await browser.close()}
