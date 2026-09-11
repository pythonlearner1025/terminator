#!/usr/bin/env node
// Headless only. Uses the installed runtime, authored scene and real view modules.
import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const out = new URL('./', import.meta.url)
await mkdir(out, {recursive: true})
const dev = JSON.parse(await readFile(root + '.kite3d/w15-dev.json', 'utf8'))
assert.equal(new URL(dev.origin).port, '4580', 'Use the soldier server on port 4580')
const browser = await chromium.launch({headless: true,
  executablePath: process.env.SOLDIER_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'})
const page = await browser.newPage({viewport: {width: 1440, height: 1000}, deviceScaleFactor: 1,
  extraHTTPHeaders: {'X-Kite3D-Token': dev.token}})
const messages = [], screenshots = []
const safe = text => String(text).replace(/([?&]t=)[^&\s"']+/g, '$1[redacted]')
page.on('pageerror', error => messages.push(safe(error.stack)))
page.on('console', message => {
  if (['error', 'warning'].includes(message.type()) && !message.text().includes('GPU stall due to ReadPixels')) messages.push(safe(message.text()))
})
try {
  const importMap = await (await page.request.get(dev.origin + '/api/import-map')).json()
  await page.route('**/__soldier_evidence', route => route.fulfill({contentType: 'text/html', body: `<!doctype html><html><head>
    <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#03070d}canvas{width:100%;height:100%;display:block}</style>
    <script type="importmap">${JSON.stringify(importMap)}</script></head><body><canvas id="canvas"></canvas><script type="module">
    import {createGame} from '@kite3d/engine';
    createGame({base:location.origin+'/files/',canvas:document.querySelector('canvas')})
      .then(game=>window.soldierGame=game).catch(error=>{console.error(error);window.soldierError=error.message});
    </script></body></html>`}))
  await page.goto(dev.origin + '/__soldier_evidence', {waitUntil: 'domcontentloaded'})
  await page.waitForFunction(() => window.soldierGame || window.soldierError, undefined, {timeout: 60000})
  assert.equal(await page.evaluate(() => window.soldierError), undefined)
  console.log('Runtime loaded')
  const api = await page.evaluate(async () => {
    const {PlayersView} = await import('/files/lib/view/players.js')
    const manager = window.terminator.manager, viewer = window.viewer
    manager.playersView.stop()
    const source = viewer.scene.modelRoot.getObjectByName('Soldier_Template') || viewer.scene.modelRoot.getObjectByName('Soldier Template')
    const fingerprint = () => {
      const values = []; source.traverse(o => values.push([o.name, o.position.toArray(), o.quaternion.toArray(), o.scale.toArray(), o.visible, o.geometry?.uuid, o.material?.uuid])); return JSON.stringify(values)
    }
    const before = fingerprint()
    const state = (id, x) => ({id, pos: {x, y: 0, z: 3}, yaw: 0, pitch: 0, hp: 100, alive: true,
      downed: false, crouch: false, moving: false, sprinting: false, weapon: 'm4', firing: false, reloading: false})
    const local = state('local', 0), olive = state('guest-olive', -.7), gray = state('guest-gray', .7)
    const world = {tick: 0, player: local, players: new Map([[local.id, local], [olive.id, olive], [gray.id, gray]]), eventLog: []}
    const view = new PlayersView(viewer); view.start(world, local.id)
    const [a, b] = [...view.visuals.values()]
    const skin = o => {let result; o.traverse(c => {if(c.isSkinnedMesh)result=c});return result}
    const sharing = {bodyGeometry: skin(a.object).geometry === skin(b.object).geometry,
      separateSkeletons: skin(a.object).skeleton !== skin(b.object).skeleton,
      templateSkeletonUnchanged: skin(a.object).skeleton !== skin(source).skeleton,
      weaponGeometry: a.weapon.active.body.children.find(c=>c.isMesh).geometry === b.weapon.active.body.children.find(c=>c.isMesh).geometry,
      weaponMaterial: a.weapon.active.body.children.find(c=>c.isMesh).material === b.weapon.active.body.children.find(c=>c.isMesh).material,
      variants: [a.variant, b.variant]}
    const states = {}, floorBounds = {}
    for (const [name, patch] of Object.entries({idle: {}, walk: {moving: true}, run: {moving: true, sprinting: true},
      crouch: {crouch: true}, aim: {aim: true}, fire: {firing: true}, reload: {reloading: true},
      hit: {hp: 80}, death: {alive: false, hp: 0}, downed: {downed: true}})) {
      Object.assign(olive, state(olive.id, -.7), patch)
      for (let i = 0; i < (name === 'hit' ? 1 : 70); i++) {world.tick++;view.sync()}
      states[name] = a.rig.state
      if (['crouch', 'downed', 'death'].includes(name)) {
        a.object.updateMatrixWorld(true); const mesh=skin(a.object); mesh.skeleton.update(); mesh.computeBoundingBox()
        floorBounds[name] = mesh.boundingBox.min.y
      }
    }
    const weaponChecks = {}, grips = {}
    Object.assign(olive, state(olive.id, -.7), {aim: true})
    for (const id of ['pistol', 'm4', 'shotgun', 'plasma', 'knife', 'grenade']) {
      olive.weapon = id
      for (let i = 0; i < 40; i++) {world.tick++;view.sync()}
      a.object.updateMatrixWorld(true)
      const targets = {}
      for (const side of ['Right', 'Left']) {
        const expected = a.weapon.active[side === 'Right' ? 'rightGrip' : 'leftGrip'].clone()
        a.weapon.root.localToWorld(expected)
        const actual = a.rig.joints['Hand ' + side].getWorldPosition(expected.clone())
        targets[side] = actual.distanceTo(expected)
      }
      grips[id] = targets
      weaponChecks[id] = a.weapon.id === id && Object.values(a.weapon.rigs).filter(r=>r.root.visible).length === 1
    }
    const flashesBefore = view.fx.stats.minigunShots + view.fx.stats.plasmaShots
    olive.weapon = 'pistol'; olive.firing = true; world.tick++; view.sync()
    const muzzleFlash = view.fx.stats.minigunShots + view.fx.stats.plasmaShots > flashesBefore
    world.players = Object.fromEntries(world.players); world.tick++; view.sync()
    const objectSnapshot = view.visuals.size === 2
    delete world.players['guest-gray']; world.tick++; view.sync()
    const removed = view.visuals.size === 1 && !b.object.parent
    world.players['guest-gray'] = gray; world.tick++; view.sync()
    const rejoined = view.visuals.size === 2
    const frameTimes = []
    for (let i = 0; i < 600; i++) {world.tick++;const start=performance.now();view.sync();frameTimes.push(performance.now()-start)}
    frameTimes.sort((a,b)=>a-b)
    const performanceMs = {median:frameTimes[300],p95:frameTimes[570],mean:frameTimes.reduce((a,b)=>a+b,0)/600,frames:600}
    const templateUnchanged = fingerprint() === before
    view.stop(); view.stop()
    const stopped = !view.root && !view.owner && view.visuals.size === 0 && !document.querySelector('[data-testid="soldier-showcase"]')
    view.start(world, 'guest-olive'); const localSwitch = !view.visuals.has('guest-olive') && view.visuals.has('local'); view.stop()
    const {World} = await import('/files/lib/core/world.js')
    const cooperative = new World({seed: 2029}), integration = {}
    if (cooperative.players instanceof Map && cooperative.addPlayer) {
      const guest = cooperative.addPlayer({id: 'evidence-guest', name: 'Evidence Guest'})
      view.start(cooperative, cooperative.player.id)
      integration.remoteRendered = view.visuals.has(guest.id) && view.visuals.size === 1
      for(let i=0;i<10;i++){cooperative.step({[guest.id]:{move:{x:1,z:0},sprint:false}});view.sync()}
      integration.walk = view.visuals.get(guest.id).rig.state === 'walk'
      for(let i=0;i<10;i++){cooperative.step({[guest.id]:{move:{x:1,z:0},sprint:true}});view.sync()}
      integration.run = view.visuals.get(guest.id).rig.state === 'run'
      const before = view.fx.stats.minigunShots
      cooperative.playerFire(guest.id); view.sync()
      integration.shotEvent = view.fx.stats.minigunShots > before
      view.stop()
    }
    cooperative.destroy?.()
    manager.playersView.start(manager.world, manager.world.player?.id || 'player')
    manager.playersView.autoSync = () => manager.playersView.sync()
    return {localSkipped: !a.id.includes('local') && !b.id.includes('local'), sharing, states, weaponChecks, grips,
      muzzleFlash, objectSnapshot, removed, rejoined, templateUnchanged, stopped, localSwitch, performanceMs, floorBounds, integration,
      anatomy: manager.playersView.preview.userData.soldierAnatomy}
  })
  for (const key of ['localSkipped','muzzleFlash','objectSnapshot','removed','rejoined','templateUnchanged','stopped','localSwitch']) assert.equal(api[key], true, key)
  for (const [key, value] of Object.entries(api.sharing)) if (key !== 'variants') assert.equal(value, true, key)
  assert.deepEqual(api.sharing.variants, ['olive','gray'])
  for (const [key, value] of Object.entries(api.states)) assert.equal(value, key, 'animation ' + key)
  for (const [key, value] of Object.entries(api.weaponChecks)) assert.equal(value, true, key)
  for (const [key, value] of Object.entries(api.floorBounds)) assert.ok(value >= -.02, key+' penetrated floor: '+value)
  for (const [key, value] of Object.entries(api.integration)) assert.equal(value, true, 'core integration '+key)
  for (const [id, grips] of Object.entries(api.grips)) {
    assert.ok(grips.Right < .025, id + ' trigger hand detached: ' + grips.Right)
    if (!['knife','grenade'].includes(id)) assert.ok(grips.Left < .025, id + ' support hand detached: ' + grips.Left)
  }
  console.log('API, state and resource assertions passed', JSON.stringify(api.performanceMs))
  await page.keyboard.press('F10')
  await page.waitForFunction(() => window.terminator.manager.playersView.showcase)
  const inFront = await page.evaluate(() => {
    const view=window.terminator.manager.playersView, show=view.showcase, p=view.viewer.scene.mainCamera.position
    return show.players.size === 2 && Math.abs(show.stage.position.distanceTo(p)-Math.hypot(4,p.y-show.stage.position.y)) < .01
  })
  assert.ok(inFront, 'F10 did not create the two soldiers in front of the camera')
  async function pose(name, options = {}) {
    await page.evaluate(({name,options}) => {
      const show=window.terminator.manager.playersView.showcase
      show.set({studio:true,state:name,time:0,frozen:false,weapon:'m4',angle:0,distance:4.3,targetY:1,focus:null,elevation:.05,...options})
      for(let i=0;i<72;i++){show.last=performance.now()-1000/60;show.update()}
      show.frozen=true;show.update()
      if(name==='fire')for(const visual of show.visuals)show.view.fire(visual,show.view.world.tick)
    }, {name, options})
    await page.waitForTimeout(150)
  }
  async function capture(name) {
    await page.screenshot({path:new URL(name,out).pathname});screenshots.push(name);console.log('Captured '+name)
  }
  await pose('idle'); await capture('front.png'); await capture('both-variants.png')
  await pose('idle',{angle:.65}); await capture('three-quarter.png')
  for(const weapon of ['pistol','m4','shotgun','plasma','knife','grenade']) {
    await pose('aim',{weapon,angle:.85,focus:'olive',distance:3.2,targetY:1.05});await capture('weapon-'+weapon+'.png')
  }
  for(const state of ['walk','run','crouch','aim','fire','reload','hit','death','downed']) {
    await pose(state,{angle:.45,distance:4.3,targetY:state==='death'||state==='downed'?.45:1,elevation:state==='death'||state==='downed'?1.0:.05});await capture(state+'.png')
  }
  await page.keyboard.press('F10')
  assert.equal(await page.evaluate(()=>Boolean(window.terminator.manager.playersView.showcase||document.querySelector('[data-testid="soldier-showcase"]'))),false)
  const cleanup = await page.evaluate(() => window.soldierGame.dispose())
  assert.equal(cleanup.ok,true)
  assert.deepEqual(messages,[],'Browser console errors or warnings')
  const report = {capturedAt:new Date().toISOString(),serverPort:4580,headless:true,api,inFront,screenshots,messages,cleanup}
  await writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({passed:true,screenshots:screenshots.length,cleanup:cleanup.status},null,2))
} catch(error) {
  await page.screenshot({path:new URL('failure.png',out).pathname}).catch(()=>{})
  console.error(safe(error.stack));console.error(JSON.stringify(messages,null,2));process.exitCode=1
} finally { await browser.close() }
