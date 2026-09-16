import test from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
test('V2 particles render, freeze, depth-occlude and clean up in real Threepipe', {skip:process.env.V2_EFFECTS_RENDER !== '1', timeout:60000}, async()=>{
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader']})
try{
const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[]
page.on('pageerror',e=>{errors.push(e.message);console.log('Page error:',e.message)})
page.on('console',e=>{if(e.type()==='error'){errors.push(e.text());console.log('Console error:',e.text().slice(0,1800))}})
await page.route('**/files/tools/map-runtime.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0;background:#02050a}canvas{width:100vw;height:100vh;display:block}</style><canvas id="game"></canvas>'}))
await page.goto(dev.url,{waitUntil:'domcontentloaded'});await page.goto(new URL(dev.url).origin+'/files/tools/map-runtime.html')
const info=await page.evaluate(async tokenQuery=>{
const html=await fetch('/'+tokenQuery).then(r=>r.text()),match=html.match(/<script[^>]+type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);if(!match)throw Error('Editor HTML did not contain an import map');const script=document.createElement('script');script.type='importmap';script.textContent=match[1];document.head.append(script)
const E=await import('threepipe'),{mountV2Effects}=await import('/files/lib/view/v2/effects.js')
const viewer=new E.ThreeViewer({canvas:document.getElementById('game'),msaa:false,tonemap:true,rgbm:false,backgroundColor:'#030811'})
const root=new E.Group();viewer.scene.addObject(root)
const colliders=[]
function block(name,center,size){const object=new E.Mesh2(new E.BoxGeometry(...size),new E.PhysicalMaterial({color:0x28313d,roughness:.72}));object.name=name;object.position.fromArray(center);root.add(object);colliders.push({id:name,kind:'wall',blocksSight:true,center:{x:center[0],y:center[1],z:center[2]},size:{x:size[0],y:size[1],z:size[2]}})}
block('floor',[0,-.15,0],[12,.3,12]);block('back wall',[0,1.6,-2],[12,3.2,.3]);block('side wall',[-3,1.6,0],[.3,3.2,5]);block('cover',[1.2,.45,0],[.8,.9,.7])
for(const x of [-1.2,1.2]){const barrel=new E.Mesh2(new E.CylinderGeometry(.39,.39,1.25,24),new E.PhysicalMaterial({color:0x12181c,roughness:.65,metalness:.6}));barrel.position.set(x,.625,-.5);root.add(barrel);colliders.push({id:'barrel'+x,kind:'barrel',center:{x,y:.625,z:-.5},size:{x:.8,y:1.25,z:.8},blocksSight:true})}
const key=new E.DirectionalLight(0x9bbdff,2.2);key.position.set(-2,5,-1);root.add(key)
root.add(new E.HemisphereLight(0x809bc0,0x080b12,.35))
const fx=mountV2Effects({viewer,root,map:{colliders,environment:{vents:[{x:-2.75,y:.4,z:-1}],sparks:[{x:-2.5,y:2.5,z:-1}]}}});await fx.ready;fx.sync({tick:120})
const camera=viewer.scene.mainCamera;camera.position.set(3.5,2.1,6);camera.target.set(-.6,1.1,-.3);camera.autoLookAtTarget=true;camera.controlsMode='';camera.setDirty();viewer.setDirty()
window.fx=fx;window.viewer=viewer;window.E=E
const gl=viewer.canvas.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info')
return {stats:fx.stats,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown'}
},new URL(dev.url).search)
await page.waitForTimeout(2500)
const first=await page.screenshot({path:'.kite3d/effects-isolated.png'})
await page.evaluate(()=>{fx.sync({tick:120});viewer.setDirty()});await page.waitForTimeout(300)
const frozen=await page.screenshot();info.frozenPixelHashEqual=createHash('sha256').update(first).digest('hex')===createHash('sha256').update(frozen).digest('hex')
await page.evaluate(()=>{const wall=new E.Mesh2(new E.BoxGeometry(30,30,.25),new E.UnlitMaterial({color:0x101e30}));wall.position.set(0,1,2);viewer.scene.addObject(wall);viewer.setDirty()})
await page.waitForTimeout(400);const occluded=await page.screenshot()
await page.evaluate(()=>{fx.root.visible=false;viewer.setDirty()});await page.waitForTimeout(400);const hidden=await page.screenshot()
info.depthOcclusionPixelHashEqual=createHash('sha256').update(occluded).digest('hex')===createHash('sha256').update(hidden).digest('hex')
info.errors=errors
assert.equal(info.frozenPixelHashEqual,true,'fixed tick must render identical pixels')
assert.equal(info.depthOcclusionPixelHashEqual,true,'opaque wall must fully hide particles')
assert.deepEqual(errors,[],'no shader or runtime errors')
info.cleanup=await page.evaluate(()=>{const root=fx.root.parent;fx.dispose();return !root.children.some(o=>o.name.startsWith('V2 localized'))})
assert.equal(info.cleanup,true)
await writeFile('.kite3d/effects-isolated.json',JSON.stringify(info,null,2));console.log(JSON.stringify(info))
}finally{await browser.close()}

})
