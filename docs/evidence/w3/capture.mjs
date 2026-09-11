import {readFile, writeFile} from 'node:fs/promises'
import {chromium} from 'playwright'
const output = new URL('./', import.meta.url)
const connection = JSON.parse(await readFile('/tmp/terminator-map-connection.json', 'utf8'))
const browser = await chromium.launch({executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true})
const page = await browser.newPage({viewport: {width: 1600, height: 900}, deviceScaleFactor: 1})
const messages = []
const sanitize = v => String(v).replace(/\?t=[A-Za-z0-9._~-]+/g, '?t=[redacted]')
page.on('response', r => { if (r.status() >= 400) messages.push(`${r.status()} ${sanitize(r.url())}`) })
page.on('pageerror', e => messages.push(sanitize(e.stack || e.message)))
page.on('console', e => { if (['error', 'warning'].includes(e.type())) messages.push(sanitize(e.text())) })
const screenshots = [], assertions = []
async function verify(label, fn) { if (!await page.evaluate(fn)) throw Error(label); assertions.push(label) }
try {
  await page.goto(connection.url, {waitUntil: 'domcontentloaded'})
  await page.goto(new URL('/files/docs/evidence/w3/preview.html', connection.url).href)
  await page.waitForFunction(() => window.mapPreviewReady, null, {timeout:25000})
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForTimeout(1200)
  const bounds = await page.evaluate(() => window.terminator.manager.mapView.geometry.userData.mapVisualBounds)
  const boundsErrors = bounds.filter(b=> b.min.some((v,i)=>v<b.center[i]-b.size[i]/2-0.00001)||b.max.some((v,i)=>v>b.center[i]+b.size[i]/2+0.00001))
  if (boundsErrors.length) throw Error(`Visual collider bounds exceeded: ${JSON.stringify(boundsErrors)}`)
  await pose([0,0,9], Math.PI, -0.06)
  await capture('courtyard-player-start.png')
  await pose([-10,0,10], 2.5, -0.03)
  await capture('courtyard-wreck.png')
  await pose([-5,3.15,15.5], Math.PI, -0.22)
  await capture('balcony.png')
  await pose([6,0.1,25], 2, 0.14)
  await capture('interior-stairs.png')
  await pose([-22,0,0], -Math.PI / 2, 0)
  await capture('tunnel.png')
  await pose([15,0,5], 2.1, -0.04)
  await capture('dock.png')
  await pose([0,0,9], Math.PI, -0.06)
  for (let fog=0;fog<=3;fog++) {
    await state({fog}); await capture(`fog-${fog}.png`)
    await verify(`Fog ${fog} density`, () => Math.abs(window.viewer.scene.fog.density - [0.002,0.018,0.035,0.058][window.terminator.world.mapState.fog]) < 1e-8)
  }
  await state({fog:0, doors:{building_ground:'locked'}})
  await pose([0,0,12], 0, 0)
  await capture('locked-door.png')
  await verify('Locked door closes and shows red signal', () => { const d=window.terminator.manager.mapView.refs.doors.find(d=>d.id==='building_ground');return d.amount < 0.01 && d.signal.visible })
  await state({doors:{building_ground:'open'}}); await page.waitForTimeout(1000)
  await verify('Explicit open door retracts', () => window.terminator.manager.mapView.refs.doors.find(d=>d.id==='building_ground').amount > 0.98)
  await state({doors:{building_ground:'closed'}}); await page.waitForTimeout(1000)
  await verify('Closed door has no lock signal', () => {const d=window.terminator.manager.mapView.refs.doors.find(d=>d.id==='building_ground');return d.amount<0.01&&!d.signal.visible})
  await state({doors:{building_ground:'unlocked'}}); await page.waitForTimeout(1000)
  await verify('Unlocked door opens on approach', () => window.terminator.manager.mapView.refs.doors.find(d=>d.id==='building_ground').amount>0.98)
  await state({doors:{building_ground:'locked'}})
  await state({gates:['S1']})
  await pose([-10,0,-22], Math.PI, 0)
  await page.evaluate(() => { const w=window.terminator.world;w.unitById.set('gate-test',{pos:{x:-10,y:0,z:-28}});w.eventLog.push({type:'unit_spawn',unitId:'gate-test'}) })
  await capture('active-gate.png')
  await verify('Unit spawn opens active gate', () => { const g=window.terminator.manager.mapView.refs.gates.find(g=>g.id==='S1');return g.amount>0.95&&g.light.intensity>0 })
  await state({hazards:[{slot:'courtyard_center',kind:'electric'},{slot:'dock_ramp',kind:'steam'}]})
  await pose([8,0,8], -2.45, -0.24)
  await page.mouse.click(800,450)
  await capture('hazard-electric.png')
  await pose([14,0,0], 2.45, -0.12)
  await capture('hazard-steam.png')
  await verify('Electric arcs and steam particles follow slot state', () => {const h=window.terminator.manager.mapView.refs.hazards;return h[0].electric.visible&&!h[0].steam.visible&&!h[1].electric.visible&&h[1].steam.visible})
  await state({flankWallBroken:true})
  await pose([0,0,-23], Math.PI, -0.1)
  await capture('broken-wall.png')
  await pose([-7,0.1,20], 0, -0.22)
  await capture('open-trader.png')
  await pose([0,0,9], Math.PI, -0.06)
  await state({lights:{courtyard:'off',building:'off',dock:'off'}})
  await capture('light-zones-off.png')
  await verify('All three lights and fixtures switch off', () => window.terminator.manager.mapView.refs.zones.every(z=>z.light.intensity===0&&z.fixtureMaterial.emissiveIntensity===0))
  await state({lights:{courtyard:'on',building:'on',dock:'on'},fog:1,gates:['S1','E1','N1']})
  const checks = await page.evaluate(() => {
    const v = window.terminator.manager.mapView, w=window.terminator.world
    return {bounds: v.geometry.userData.mapVisualBounds.length, fogDensity:window.viewer.scene.fog.density,
      zones:v.refs.zones.map(z=>({id:z.id,intensity:z.light.intensity})),
      lockedDoor:v.refs.doors.find(d=>d.id==='building_ground').signal.visible,
      electric:v.refs.hazards[0].electric.visible, steam:v.refs.hazards[1].steam.visible,
      trader:v.refs.trader.amount, brokenPieces:v.refs.flank.filter(c=>c.piece.visible).length,
      audio:v.audio?.context.state, bloom:window.viewer.renderManager.pipeline.includes('map-bloom')}
  })
  const timings = await page.evaluate(async()=> {
    const samples = []
    let previous = await new Promise(requestAnimationFrame)
    for(let i=0;i<360;i++) { const now=await new Promise(requestAnimationFrame); samples.push(now-previous);previous=now }
    const sorted=[...samples].sort((a,b)=>a-b), sum=samples.reduce((a,b)=>a+b,0)
    const gl=window.viewer.renderManager.webglRenderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info')
    return {sampleCount:samples.length,meanMs:sum/samples.length,medianMs:sorted[180],p95Ms:sorted[342],p99Ms:sorted[356],maxMs:sorted.at(-1),fps:1000/(sum/samples.length),over20Ms:samples.filter(t=>t>20).length,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}
  })
  await page.evaluate(()=>window.stopMapPreview())
  await page.waitForTimeout(150)
  await verify('Stop removes runtime roots and bloom, and restores fog', () => !window.viewer.scene.getObjectByName('Map Runtime')&&!window.viewer.scene.getObjectByName('Player Runtime')&&!window.viewer.renderManager.pipeline.includes('map-bloom')&&window.viewer.scene.fog==null)
  const result={assertions,mode:'Isolated map fixture with real MapView and PlayerView, not full wave gameplay',viewport:{width:1600,height:900},checks,timings,screenshots,messages}
  await writeFile(new URL('render-results.json',output),JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result,null,2))
} finally { if(messages.length) console.log(JSON.stringify({messages},null,2));await browser.close() }
async function pose(pos,yaw,pitch) {
  await page.evaluate(({pos,yaw,pitch})=>{const p=window.terminator.world.player;p.pos={x:pos[0],y:pos[1],z:pos[2]};p.yaw=yaw;p.pitch=pitch},{pos,yaw,pitch})
  await page.waitForTimeout(150)
}
async function state(change) {
  await page.evaluate(change=>{const state=window.terminator.world.mapState;for(const [key,value]of Object.entries(change)){if(key==='lights'||key==='doors') Object.assign(state[key],value);else state[key]=value}},change)
  await page.waitForTimeout(100)
}
async function capture(name) {
  await page.waitForTimeout(800)
  await page.screenshot({path:new URL(name,output).pathname})
  screenshots.push(name)
}
