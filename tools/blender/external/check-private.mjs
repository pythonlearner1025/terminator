// Keep a private headless editor connected while the unchanged Kite3D CLI checks this scene.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'../../..'),proof=resolve(root,'.kite3d/external-proof')
const dev=JSON.parse(await readFile(resolve(proof,'.kite3d/dev.json'),'utf8'))
if(['4300','4310'].includes(new URL(dev.url).port))throw Error('Private server required')
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal']})
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}})
 await page.goto(dev.url,{waitUntil:'domcontentloaded'})
 await page.getByTestId('play').waitFor({timeout:90000})
 await page.waitForFunction(()=>window.viewer?.scene?.modelRoot?.getObjectByName('Candidates')?.children.every(o=>o.children.length>0),null,{timeout:90000})
 await page.waitForTimeout(3000)
 const child=spawn('npx',['--no-install','kite3d','check'],{cwd:proof,stdio:['ignore','pipe','pipe']});let log=''
 child.stdout.on('data',chunk=>log+=chunk);child.stderr.on('data',chunk=>log+=chunk)
 const status=await new Promise((yes,no)=>{child.on('exit',yes);child.on('error',no)})
 await writeFile(resolve(root,'.kite3d/external-check.log'),log)
 const report=await readFile(resolve(proof,'.kite3d/check.json'),'utf8')
 await writeFile(resolve(root,'.kite3d/check.json'),report)
 console.log(log);process.exitCode=status||0
}finally{await browser.close()}
