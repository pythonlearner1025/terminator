// Execute the unchanged benchmark workload. Route baseline view sources only.
// node test/view/tracers2-benchmark.mjs --baseline=45a439f --port=4676 --weapon-burst=on
import {chromium} from 'playwright'
import {execFileSync} from 'node:child_process'
const revision=process.argv.find(arg=>arg.startsWith('--baseline='))?.slice(11)
if(revision) {
  const sources=new Map(['tracers.js','projectiles.js','fx-screen.js'].map(file=>
    [file,execFileSync('git',['show',`${revision}:lib/view/${file}`],{encoding:'utf8'})]))
  const launch=chromium.launch.bind(chromium)
  chromium.launch=async options=>{
    if(options.headless!==true)throw Error('Only headless browsers are permitted')
    const browser=await launch(options),newPage=browser.newPage.bind(browser)
    browser.newPage=async options=>{
      const page=await newPage(options)
      for(const [file,body] of sources)await page.route('**/lib/view/'+file+'*',route=>route.fulfill({contentType:'text/javascript',body}))
      return page
    }
    return browser
  }
}
await import('../../tools/benchmark-browser.mjs')
