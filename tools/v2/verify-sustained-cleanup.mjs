// Follow-up lifecycle probe for the rewrite editor. The rewrite has no engine Check contract.
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {launchCaptureBrowser} from './capture-browser.mjs'
import {runEditor,stopEditor,waitForProjectLoaded} from '../../test/helpers/editor-driver.mjs'

const out='docs/evidence/sustained-cleanup.json'
const report={startedAt:new Date().toISOString(),cycles:[],errors:[]}
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const browser=await launchCaptureBrowser()

async function snapshot(page) {
  return page.evaluate(()=>{
    const viewer=window.viewer,names=[]
    viewer.scene.traverse(object=>{if(/Runtime|Endo menu stage|Weapons Lab Environment/.test(object.name))names.push(object.name)})
    return {
      running:Boolean(viewer.getPlugin('EntityComponentPlugin')?.running),
      sceneChildren:viewer.scene.children.length,
      sceneNodes:(()=>{let count=0;viewer.scene.traverse(()=>count++);return count})(),
      runtimeRoots:names.sort(),
      hud:document.querySelectorAll('[data-testid="terminator-hud"]').length,
      gameStyles:document.querySelectorAll('[data-terminator-hud-style],[data-terminator-range-style]').length,
      viewerListenerTypes:Object.keys(viewer._listeners||{}).sort(),
    }
  })
}

try {
  const page=await browser.newPage({viewport:{width:960,height:540}})
  page.on('pageerror',error=>report.errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text())})
  await page.goto(dev.url,{waitUntil:'domcontentloaded'})
  await waitForProjectLoaded(page)
  report.baseline=await snapshot(page)
  for(let cycle=1;cycle<=3;cycle++){
    await runEditor(page)
    await page.waitForFunction(()=>window.terminator?.manager?.started,null,{timeout:120000})
    await page.waitForFunction(()=>window.terminator?.manager?.ui?.screens?.route==='main'||window.terminator?.manager?.constructor?.ComponentType==='WeaponsLab',null,{timeout:120000})
    const playing=await snapshot(page)
    await stopEditor(page)
    await page.waitForFunction(()=>!window.viewer.getPlugin('EntityComponentPlugin').running,null,{timeout:30000})
    const stopped=await snapshot(page)
    assert.deepEqual(stopped.runtimeRoots,[])
    assert.equal(stopped.hud,0)
    assert.equal(stopped.gameStyles,0)
    assert.equal(stopped.sceneChildren,report.baseline.sceneChildren)
    assert.equal(stopped.sceneNodes,report.baseline.sceneNodes)
    assert.deepEqual(stopped.viewerListenerTypes,report.baseline.viewerListenerTypes)
    report.cycles.push({cycle,playing,stopped})
  }
  assert.deepEqual(report.errors,[])
  report.completed=true
}catch(error){report.failure=error.stack;process.exitCode=1}
finally{report.finishedAt=new Date().toISOString();await browser.close();await writeFile(out,JSON.stringify(report,null,2)+'\n')}
