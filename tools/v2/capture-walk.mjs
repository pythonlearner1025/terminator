/** Supplemental real simulator movement. Does not replace the fixed five POVs. */
import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {launchCaptureBrowser, browserOptions} from './capture-browser.mjs'
import {loadPilotOverrides} from './capture-pilot-overrides.mjs'

const out = resolve(process.argv[2] || 'docs/evidence/v2-integration-walk')
// Refuse existing evidence directories, including partial prior runs.
await mkdir(out)
const config = JSON.parse(await readFile('docs/scene-targets/views.json', 'utf8'))
const dev = JSON.parse(await readFile('.kite3d/dev.json', 'utf8'))
const routeIds=['02-cargo','03-barracks','04-service'].filter(id=>!process.env.CAPTURE_WALK_VIEW||id===process.env.CAPTURE_WALK_VIEW)
if(!routeIds.length)throw Error('Unknown CAPTURE_WALK_VIEW')
const pilotOverrides = loadPilotOverrides()
if(process.env.CAPTURE_SPALL_AB&&!pilotOverrides)throw Error('Spall A/B is diagnostic only')
const browser = await launchCaptureBrowser()
const report = {
  git: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  worktreeStatus: execFileSync('git', ['status', '--short'], {encoding: 'utf8'}),
  browser: browser.version(), launch: browserOptions(), config,
  mode: 'Supplemental actual World.step movement from original POVs; original FOV and PlayerView',
  sourceFiles: {}, routes: [], errors: [],
}
if(pilotOverrides)report.diagnosticOverrides=pilotOverrides.manifest
if(process.env.CAPTURE_SPALL_AB){report.diagnosticSpallAB=true;report.mode+='; endpoint spall weight disabled for isolated diagnostic'}
const files = execFileSync('git', ['ls-files', 'lib', 'generators', 'assets/v2', 'main.js', 'package.json', 'assets/main.scene.gltf','assets/models/map/rubble-1x1p5x12-zh655b/rubble-1x1p5x12-zh655b.gltf', 'tools/v2/capture-walk.mjs', 'tools/v2/capture-browser.mjs','tools/v2/capture-pilot-overrides.mjs'], {encoding: 'utf8'}).trim().split('\n')
for (const file of files) report.sourceFiles[file] = createHash('sha256').update(await readFile(file)).digest('hex')
try {
  for (const id of routeIds) {
    const view = config.views.find(item => item.id === id)
    const page = await browser.newPage({viewport: config.viewport, deviceScaleFactor: 1})
    await pilotOverrides?.install(page)
    page.on('pageerror', error => report.errors.push(error.message.replace(/([?&]t=)[^&\s]+/g, '$1[redacted]')))
    await page.addInitScript(({seed, settings}) => {
      let state = seed >>> 0
      Math.random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296 }
      localStorage.setItem('terminator.settings.v1', JSON.stringify(settings))
    }, config)
    await page.request.get(dev.url)
    await page.goto(dev.origin + '/files/tools/map-runtime.html')
    await page.waitForFunction(() => window.terminator?.manager?.ui?.screens?.route === 'main', null, {timeout: 120000})
    const renderer = await page.evaluate(async ({view, tick}) => {
      const m = window.terminator.manager
      m.update = () => true
      await m.ui.startMatch(); await m.mapView.ready; await m.visualWarmup
      m.ui.screens.show(null); m.input.stop(); m.unitView.toggleShowcase(false)
      const p = m.world.player
      p.pos = {x: view.feet[0], y: view.feet[1], z: view.feet[2]}
      p.vel = {x: 0, y: 0, z: 0}; p.grounded = true; p.crouch = false; p.aiming = false
      const dx = view.lookAt[0] - p.pos.x, dy = view.lookAt[1] - (p.pos.y + 1.65), dz = view.lookAt[2] - p.pos.z
      p.yaw = Math.atan2(dx, dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz))
      for (let i = 0; i <= tick; i++) { m.world.tick = i; m.mapView.sync(m.world); m.playerView.sync(m.world) }
      window.walkFrame = () => { m.mapView.sync(m.world); m.playerView.sync(m.world); window.viewer.setDirty() }
      window.viewer.addEventListener('preFrame', window.walkFrame)
      const gl = window.viewer.canvas.getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info')
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown'
    }, {view, tick: config.tick})
    assert.match(renderer, /NVIDIA/)
    const route = {id, renderer, frames: []}
    report.routes.push(route)
    // Cargo strafes expose fire-card parallax; interiors walk along existing routes.
    const moves = id === '02-cargo' ? [{x: -1, z: 0}, {x: 1, z: 0}, {x: 0, z: 1}] : [{x: 0, z: 1}, {x: 0, z: 1}, {x: 0, z: 1}]
    for (let frame = 0; frame <= moves.length; frame++) {
      const state = await page.evaluate(({move, steps}) => {
        const m = window.terminator.manager, p = m.world.player
        const yaw = p.yaw, pitch = p.pitch, path = []
        for (let step = 0; step < steps; step++) {
          m.world.step({move, yaw, pitch})
          const support = m.world.playerSupportAt(p.pos, p.pos.y, {radius: .3, maxAbove: .05, maxBelow: .05})
          const clear = !!support && m.world.playerHasHeadClearance(p.pos, 1.8, support)
          path.push({feet: {...p.pos}, supported: !!support, clear})
          m.mapView.sync(m.world); m.playerView.sync(m.world)
        }
        m.syncUi(true); m.hud.sync(); window.walkFrame()
        const camera = m.playerView.camera
        return {tick: m.world.tick, input: move, steps, path, feet: {...p.pos}, camera: {position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: camera.fov}}
      }, {move: frame ? moves[frame - 1] : {x: 0, z: 0}, steps: frame ? 30 : 0})
      assert.equal(state.camera.fov, config.settings.fov)
      assert(state.path.every(point => point.supported && point.clear), `${id}: unsupported movement or lost head clearance`)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(frame ? 350 : 1800)
      const filename = `${id}-step-${frame * 30}.png`
      const png = await page.screenshot({path: resolve(out, filename), animations: 'disabled'})
      route.frames.push({...state, filename, sha256: createHash('sha256').update(png).digest('hex')})
    }
    if(process.env.CAPTURE_SPALL_AB){
      route.spallAB=await page.evaluate(async()=>{
        const m=window.terminator.manager,seen=new Set(),records=[];window.__spallRestores=[]
        m.mapView.root.traverse(o=>{for(const mat of Array.isArray(o.material)?o.material:[o.material]){
          if(!mat?.userData.v2MaterialOwned||!['fracture','fracture-masked'].includes(mat.userData.v2Surface)||seen.has(mat))continue
          seen.add(mat);const compile=mat.onBeforeCompile,key=mat.customProgramCacheKey,record={name:mat.name,kind:mat.userData.v2Surface,compiled:false};records.push(record)
          mat.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);const token='step(.25,seed)*.88';if(!shader.fragmentShader.includes(token))throw Error('Expected exact R5 spall weight expression');shader.fragmentShader=shader.fragmentShader.replace(token,'step(.25,seed)*0.');record.compiled=true}
          mat.customProgramCacheKey=function(){return key.call(this)+'|diagnostic-spall-zero'};mat.needsUpdate=true
          window.__spallRestores.push(()=>{mat.onBeforeCompile=compile;mat.customProgramCacheKey=key;mat.needsUpdate=true})
        }})
        window.viewer.setDirty();for(let i=0;i<12;i++)await new Promise(resolve=>requestAnimationFrame(resolve))
        const c=m.playerView.camera;return {records,camera:{position:c.position.toArray(),quaternion:c.quaternion.toArray(),fov:c.fov},tick:m.world.tick}
      })
      assert(route.spallAB.records.some(r=>r.compiled),'Expected actual visible spall shader compilation')
      assert.deepEqual(route.spallAB.camera,route.frames.at(-1).camera);assert.equal(route.spallAB.tick,route.frames.at(-1).tick)
      route.spallAB.filename=`${id}-step-90-spall-off.png`
      const png=await page.screenshot({path:resolve(out,route.spallAB.filename),animations:'disabled'});route.spallAB.sha256=createHash('sha256').update(png).digest('hex')
      await page.evaluate(()=>{for(const restore of window.__spallRestores)restore();delete window.__spallRestores})
    }
    await page.evaluate(() => { window.viewer.removeEventListener('preFrame', window.walkFrame); window.terminator.manager.stop() })
    await page.close()
    await writeFile(resolve(out, 'walk.json'), JSON.stringify(report, null, 2) + '\n')
  }
  assert.deepEqual(report.errors, [])
  report.pass = true
} finally {
  await writeFile(resolve(out, 'walk.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(`PASS: ${routeIds.join(', ')} actual walking at original FOV with supported simulator movement${report.diagnosticSpallAB ? '; diagnostic spall A/B' : ''}`)
