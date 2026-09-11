#!/usr/bin/env node
// node docs/evidence/w14-ads/capture.mjs
// W14_PROJECT may name an isolated copy running kite3d dev --port 4570 --no-open.
// No wave director or enemies: fixed World ticks make each pose reproducible.
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
const out = 'docs/evidence/w14-ads'
await mkdir(out, {recursive: true})
const project = process.env.W14_PROJECT || (await readFile('.kite3d/w14-project-path', 'utf8')).trim()
const dev = JSON.parse(await readFile(resolve(project, '.kite3d/dev.json'), 'utf8'))
assert.equal(new URL(dev.url).port, '4570')
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
})
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
const errors = [], warnings = []
const sanitize = value => String(value).replace(/([?&]t=)[A-Za-z0-9._~-]+/g, '$1[redacted]')
page.on('pageerror', error => errors.push(sanitize(error.message)))
page.on('console', message => {
  if (message.type() === 'error') errors.push(sanitize(message.text()))
  if (message.type() === 'warning') warnings.push(sanitize(message.text()))
})
try {
  await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
  await page.getByTestId('play').waitFor({timeout: 30000})
  await page.waitForTimeout(1500)
  if (!await page.evaluate(() => Boolean(window.terminator?.world))) await page.getByTestId('play').click()
  await page.waitForFunction(() => Boolean(window.terminator?.manager?.playerView?.weapons), null, {timeout: 30000})
  await page.evaluate(() => {
    const m = window.terminator.manager, w = m.world
    m.ui.screens.show(null); m.started = false
    w.phase = 'wave'; w.player.pos = {x: 5, y: 0, z: 10}
    w.player.hp = 100; w.player.armor = 100
    for (const id of w.weaponCatalog.slots) w.player.ammo[id] = {owned: true, mag: w.weaponCatalog.weapons[id].mag, reserve: 100}
    m.input.start({yaw: Math.PI, pitch: 0})
    window.w14Advance = (count, input) => {
      for (let i = 0; i < count; i++) {
        w.step(input ? {yaw: Math.PI, pitch: 0, ...input} : m.input.sample())
        m.cameraFeel.consume(w); m.syncViews()
      }
      window.viewer.setDirty()
    }
    window.w14Advance(30, {})
  })
  const clip = await page.evaluate(() => {
    const r = window.viewer.canvas.getBoundingClientRect()
    return {x: r.x, y: r.y, width: r.width, height: r.height}
  })
  const records = []
  async function capture(id, pose) {
    await page.evaluate(() => window.viewer.setDirty())
    await page.waitForTimeout(160)
    const file = `${out}/${id}-${pose}.png`
    await page.screenshot({path: file, clip})
    const state = await page.evaluate(() => {
      const m = window.terminator.manager, v = m.playerView.weapons, w = m.world
      const rig=v.rigs[v.animation.shown], front={pistol:-.244,m4:-.79,shotgun:-.82,plasma:-.7}[rig.id]
      const sight=rig.root.localToWorld(rig.root.position.clone().set(0,rig.sight.height,front))
        .applyMatrix4(m.playerView.camera.matrixWorldInverse).applyMatrix4(v.camera.projectionMatrix)
      const rect=window.viewer.canvas.getBoundingClientRect()
      return {aiming: w.player.aiming, spread: w.playerSpread, viewAiming:m.hud.view.weapon.aiming, viewSpread:m.hud.view.weapon.spread,
        sightCenterErrorPixels:{x:sight.x*rect.width/2,y:-sight.y*rect.height/2}, worldFov: m.playerView.camera.fov,
        viewmodelFov: v.camera.fov, animation: {...v.animation.state}, pose: v.rigs[v.animation.shown].root.position.toArray()}
    })
    records.push({file, ...state})
    return state
  }
  for (const id of ['pistol', 'm4', 'shotgun', 'plasma']) {
    await page.evaluate(id => {window.w14Advance(1, {switchTo: id}); window.w14Advance(30, {})}, id)
    await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2)
    const hip = await capture(id, 'hip')
    assert.equal(hip.aiming, false); assert.equal(hip.worldFov, 72)
    const shotsBefore = await page.evaluate(() => window.terminator.world.telemetry.counters.shots)
    await page.mouse.down({button: 'right'})
    const transition = await page.evaluate(() => Array.from({length:8},()=>{window.w14Advance(1);return window.terminator.manager.playerView.weapons.animation.aimAmount}))
    assert.ok(transition[0]>0 && transition[6]<1 && transition[7]===1)
    assert.ok(transition[1]-transition[0]>transition[6]-transition[5])
    const sights = await capture(id, 'sights')
    assert.equal(sights.aiming, true); assert.equal(sights.worldFov, 55)
    assert.equal(sights.animation.aimProgress, 1)
    assert.equal(sights.viewAiming,true);assert.equal(sights.viewSpread,sights.spread)
    assert.ok(Math.abs(sights.sightCenterErrorPixels.x)<2 && Math.abs(sights.sightCenterErrorPixels.y)<3)
    assert.ok(sights.viewmodelFov < hip.viewmodelFov)
    assert.equal(await page.evaluate(() => window.terminator.world.telemetry.counters.shots), shotsBefore)
    assert.equal(await page.evaluate(() => window.terminator.world.replay.at(-1).aim), true)
    await page.mouse.up({button: 'right'})
    await page.evaluate(() => window.w14Advance(8))
    assert.equal(await page.evaluate(() => window.terminator.world.player.aiming), false)
    console.log('Captured hip and sights:', id)
  }
  const verification = await page.evaluate(async () => {
    const World = window.terminator.world.constructor
    const InputController = window.terminator.manager.input.constructor
    const setEffectiveAim = (viewer, aiming) => {viewer.input.aiming = aiming}
    const checks = []
    const assert = (name, pass, detail) => {checks.push({name, pass, detail}); if (!pass) throw Error(`${name}: ${JSON.stringify(detail)}`)}
    const near = (a, b) => Math.abs(a - b) < 1e-9
    const spread = []
    for (const id of ['pistol', 'm4', 'shotgun', 'plasma']) {
      const sample = aim => {
        const w = new World({seed: 2029}), rays = []
        w.player.ammo[id].owned = true
        const original = w.hitscan.bind(w)
        w.hitscan = args => {
          rays.push([Math.atan2(args.direction.x, args.direction.z), Math.asin(args.direction.y)])
          return original(args)
        }
        while (w.telemetry.shots[id].fired < 30 && w.tick < 4000) {
          w.step({aim, fire: true, switchTo: w.tick === 0 ? id : null, reload: w.player.ammo[id].mag === 0})
          if (w.player.ammo[id].reserve === 0) w.player.ammo[id].reserve = 100
        }
        return {shots: w.telemetry.shots[id].fired, spreadDeg: w.playerSpread,
          rmsAngleDeg: Math.sqrt(rays.reduce((sum, [x, y]) => sum + x*x + y*y, 0) / rays.length) * 180 / Math.PI,
          rays}
      }
      const hip = sample(false), aim = sample(true)
      assert(`${id}: 30 shots with spread and each ray at 35%`, hip.shots === 30 && aim.shots === 30
        && near(aim.spreadDeg, hip.spreadDeg * 0.35)
        && aim.rays.every(([x,y], i) => near(x, hip.rays[i][0]*0.35) && near(y, hip.rays[i][1]*0.35)))
      spread.push({id, shotsPerPose: 30, pelletsPerPose: hip.rays.length, hipDeg: hip.spreadDeg, aimDeg: aim.spreadDeg,
        hipRmsAngleDeg: hip.rmsAngleDeg, aimRmsAngleDeg: aim.rmsAngleDeg})
    }
    const movement = {}
    for (const [name, input] of Object.entries({hip: {}, sprint: {sprint: true}, aim: {aim: true}, aimSprint: {aim: true, sprint: true}})) {
      const w = new World(); w.player.pos = {x: 5, y: 0, z: 10}
      const from = {...w.player.pos}
      for (let i = 0; i < 30; i++) w.step({move: {x: 0, z: 1}, yaw: Math.PI, ...input})
      movement[name] = {speed: Math.hypot(w.player.vel.x, w.player.vel.z), distanceInHalfSecond: Math.hypot(w.player.pos.x-from.x,w.player.pos.z-from.z), stamina: w.player.sprintStamina}
    }
    assert('aim speed 3 m/s, hip 5, sprint 7.5, aim refuses sprint', near(movement.hip.speed, 5) && near(movement.sprint.speed, 7.5)
      && near(movement.aim.speed, 3) && near(movement.aimSprint.speed, 3) && movement.aimSprint.stamina === 6, movement)
    assert('crosshair DOM removed', !document.querySelector('.tm-cross,.tm-cross-center,[data-role="cross"]'))
    const m = window.terminator.manager, w = m.world, v = m.playerView.weapons
    const feedback = m.hud.elements.centerFeedback.getBoundingClientRect(), canvas = window.viewer.canvas.getBoundingClientRect()
    assert('hit and reload feedback remains centered', Math.abs(feedback.x-canvas.x-canvas.width/2)<0.05 && Math.abs(feedback.y-canvas.y-canvas.height/2)<0.05, {x:feedback.x-canvas.x-canvas.width/2,y:feedback.y-canvas.y-canvas.height/2})
    m.hud.showHit('headshot')
    assert('headshot and damage direction elements retained', m.hud.elements.hit.classList.contains('headshot') && !!m.hud.elements.damage)
    const context = new MouseEvent('contextmenu', {button: 2, bubbles: true, cancelable: true})
    assert('context menu suppressed', !window.viewer.canvas.dispatchEvent(context) && context.defaultPrevented)
    window.w14Advance(1, {switchTo: 'pistol', fire: true, aim: true})
    window.w14Advance(1, {reload: true, aim: true})
    assert('reload suppresses aim and displays ring', !w.player.aiming && !m.hud.elements.reload.hasAttribute('hidden'))
    window.w14Advance(100, {aim: true})
    assert('held aim resumes after reload', w.player.aiming && v.animation.aimAmount === 1)
    m.cameraFeel.kick = .035; m.playerView.sync(w); m.cameraFeel.apply(m.playerView.camera); v.beforeRender(m.playerView.camera)
    assert('ADS sight picture follows camera recoil without hip counter-rotation', m.playerView.camera.rotation.x > w.player.pitch && near(v.feel.rotation.x,0))
    window.w14Advance(1, {fire: true, aim: true})
    assert('firing recoils from the sight pose', Math.abs(v.rigs.pistol.root.position.x) < .002 && v.rigs.pistol.root.position.z > -.5)
    for (const action of ['melee','grenade']) {
      window.w14Advance(90, {aim: true}); window.w14Advance(1, {[action]: true, aim: true})
      assert(`${action}: no sight pose`, !v.animation.state.aiming && !v.rigs[v.animation.shown].sight)
    }
    // Exercise input listeners independently on an unattached canvas. Pointer lock
    // is stubbed only here; screenshot inputs above use Playwright's real RMB.
    const inputCanvas = document.createElement('canvas')
    inputCanvas.getBoundingClientRect = () => ({left:0,top:0,width:1000,height:800})
    const viewer = {canvas: inputCanvas}, input = new InputController(viewer)
    viewer.input = input; input.requestLock = () => {}; input.start()
    const move = () => document.dispatchEvent(new MouseEvent('mousemove', {movementX:20,movementY:10}))
    input.locked = true; move(); const hipYaw=input.yaw, hipPitch=input.pitch
    input.yaw=0;input.pitch=0;setEffectiveAim(viewer,true);move()
    const sensitivity = {hipYaw, aimYaw:input.yaw, hipPitch, aimPitch:input.pitch}
    assert('locked mouse sensitivity scales by 0.6',near(input.yaw,hipYaw*.6) && near(input.pitch,hipPitch*.6),sensitivity)
    input.locked=false;input.cursor=null;input.yaw=0;input.pitch=0;input.cursorAnchorYaw=0;input.cursorAnchorPitch=0
    setEffectiveAim(viewer,false);input.updateCursor({clientX:550,clientY:430})
    const oldYaw=input.yaw,oldPitch=input.pitch
    setEffectiveAim(viewer,true);input.updateCursor({clientX:550,clientY:430})
    assert('cursor fallback does not jump entering aim',near(input.yaw,oldYaw)&&near(input.pitch,oldPitch))
    input.updateCursor({clientX:570,clientY:440});const aimDelta=input.yaw-oldYaw
    setEffectiveAim(viewer,false);input.updateCursor({clientX:570,clientY:440});const newYaw=input.yaw
    input.updateCursor({clientX:590,clientY:450})
    assert('cursor fallback sensitivity scales by 0.6',near(aimDelta,(input.yaw-newYaw)*.6))
    inputCanvas.dispatchEvent(new MouseEvent('mousedown',{button:2,bubbles:true,cancelable:true,clientX:500,clientY:400}))
    assert('RMB aims without firing',input.sample().aim && !input.fire)
    window.dispatchEvent(new Event('blur'))
    assert('blur releases aim',!input.sample().aim)
    input.stop();inputCanvas.dispatchEvent(new MouseEvent('mousedown',{button:2}))
    assert('stop removes input listeners',!input.sample().aim)
    m.cameraFeel.dispose();window.w14Advance(100,{})
    const fovSetting=m.input.fov
    m.input.fov=90;window.w14Advance(8,{aim:true});const zoomed=m.playerView.camera.fov
    window.w14Advance(8,{})
    assert('zoom returns to configured base FOV',zoomed===55&&m.playerView.camera.fov===90)
    m.input.fov=fovSetting
    const motionSample = aim => {
      const state = new World(), animation = new v.animation.constructor(v.rigs,v.fx)
      animation.sync(state)
      state.tick=60;state.player.aiming=aim;state.player.vel.x=3;state.player.yaw=.1;state.player.pitch=.1
      animation.sync(state)
      const pose=v.rigs.pistol.root
      return {x:pose.position.x-(aim?0:.17),y:pose.position.y+(aim?v.rigs.pistol.sight.height:.18),
        z:pose.position.z+(aim?.5:.78),pitch:pose.rotation.x-(aim?0:.035)}
    }
    const hipMotion=motionSample(false),aimMotion=motionSample(true)
    assert('equal-speed sway, bob and breath scale to one third',Object.keys(hipMotion).every(key=>near(aimMotion[key],hipMotion[key]/3)),{hip:hipMotion,aim:aimMotion})
    m.syncViews()
    const camera=m.playerView.camera,saved=m.playerView.savedCamera,oldRoot=m.playerView.root
    m.playerView.stop()
    assert('stop restores camera and removes weapon runtime',camera.fov===saved.fov && camera.position.equals(saved.position)
      && camera.quaternion.equals(saved.quaternion) && oldRoot.parent===null && !m.input.aiming)
    m.playerView.start(w)
    assert('weapon view can restart cleanly',!!m.playerView.weapons && m.playerView.root!==oldRoot)
    return {checks,spread,movement,sensitivity}

  })
  await page.evaluate(() => document.exitPointerLock())
  await page.waitForFunction(() => !document.pointerLockElement)
  await page.getByTestId('play').click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="terminator-hud"]'), null, {timeout: 10000})
  await writeFile(`${out}/results.json`, JSON.stringify({records, verification, errors, warnings}, null, 2)+'\n')
  console.log(JSON.stringify({screenshots:records.length, checks:verification.checks.length, spread:verification.spread, movement:verification.movement, errors,warnings},null,2))
  assert.equal(errors.length,0,'No browser errors')
} finally {await browser.close()}
