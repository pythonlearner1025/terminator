import {waitForProjectLoaded,runEditor,stopEditor,getCanvas} from '../../test/helpers/editor-driver.mjs'
import {readFile,writeFile} from 'node:fs/promises'
import {launchCaptureBrowser} from './capture-browser.mjs'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(new URL(dev.url).origin).port!=='4755')throw Error('Wrong owned port')
const browser=await launchCaptureBrowser()
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}})
 await page.goto(dev.url)
 await waitForProjectLoaded(page,{timeout:120000})
 await waitForProjectLoaded(page,{timeout:120000})
 await runEditor(page)
 await page.waitForFunction(()=>window.terminator?.manager?.ui?.menuLoadError||window.terminator?.manager?.ui?.screens.route==='main',null,{timeout:90000})
 const result=await page.evaluate(()=>{
  const m=window.terminator.manager,figures=[]
  m.ctx.viewer.scene.modelRoot.traverse(o=>{if(o.userData.unitAssetDetail!=='high'||!/Endo/i.test(o.name))return
   const local=new Set();o.traverse(b=>local.add(b))
   const info=b=>({name:b.name,uuid:b.uuid,userData:b.userData,parent:b.parent?.name,inFigure:local.has(b)})
   const record={name:o.name,bones:[],skins:[]};o.traverse(b=>{if(b.isBone)record.bones.push(info(b));if(b.isSkinnedMesh)record.skins.push({name:b.name,bones:b.skeleton.bones.map(info)})});figures.push(record)
  });return {error:m.ui.menuLoadError,figures}
 })
 await writeFile('../coordination/perf-budget-rig-diagnostic.json',JSON.stringify(result,null,2)+'\n')
 console.log(JSON.stringify({error:result.error,figures:result.figures.map(f=>({name:f.name,bones:f.bones.length,skins:f.skins.length}))}))
}finally{await browser.close()}
