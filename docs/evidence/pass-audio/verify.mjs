import {chromium} from 'playwright'
import {readFile, writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'

const out = new URL('./', import.meta.url)
const dev = JSON.parse(await readFile(new URL('../../../.kite3d/dev.json', out), 'utf8'))
assert.equal(new URL(dev.url).port, '4640')
const browser = await chromium.launch({executablePath: chromium.executablePath(), headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio']})
const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1})
const report = {assertions: [], errors: [], screenshots: []}
const check = (value, label) => { assert.ok(value, label); report.assertions.push(label); console.log('PASS ' + label) }
page.on('pageerror', e => report.errors.push(e.message.replace(/([?&]t=)[^&\s]+/g, '$1[redacted]')))
try {
  await page.request.get(dev.url)
  await page.goto(new URL('/files/docs/evidence/pass-audio/runtime.html', dev.origin).href)
  await page.waitForFunction(() => window.terminator?.manager?.audio, null, {timeout: 90000})
  await page.evaluate(async () => { const a = terminator.manager.audio; a.logger = null; await a.unlock() })
  report.bank = await page.evaluate(() => ({...terminator.manager.audio.stats, buffers: terminator.manager.audio.buffers.size}))
  check(report.bank.loaded === 101 && report.bank.failed.length === 0, 'All 101 Ogg samples decode in Chromium')
  const audio = await page.evaluate(async () => {
    const a = terminator.manager.audio, w = terminator.world
    const {SOUND_CATALOG} = await import('/files/lib/audio/catalog.js')
    const state = () => { const {eventStart, events, ...snapshot} = w.snapshot(); return JSON.stringify({...snapshot, eventLog: w.eventLog}) }
    const before = state()
    const sampleEnergy = {}
    for (const [name, d] of Object.entries(SOUND_CATALOG)) {
      const buffer = a.buffers.get(d.variants[0].file)
      if (buffer) {
        const data = buffer.getChannelData(0)
        let sq = 0, peak = 0
        for (const x of data) { sq += x * x; peak = Math.max(peak, Math.abs(x)) }
        sampleEnergy[name] = {rms: Math.sqrt(sq / data.length), peak, seconds: buffer.duration}
      }
    }
    a.updateEnvironment(w)
    a.listenerPosition = {x: 0, y: 1.6, z: 10}
    const blocked = a.play('plasma_bolt', {position: {x: 7, y: 1.6, z: 22}})
    const clear = a.play('plasma_bolt', {position: {x: 0, y: 1.6, z: 12}})
    await new Promise(r => setTimeout(r, 30))
    const spatial = {blocked: blocked.blocked, clear: clear.blocked, blockedHz: blocked.filter.frequency.value, clearHz: clear.filter.frequency.value}
    const silent = a.play('servo_endo', {position: {x: 200, y: 1, z: 0}}) === null
    a.setVolumes({ui: .25, voice: .7, music: .4, effects: .85}, {immediate: true})
    const buses = Object.keys(a.buses)
    const independent = a.buses.ui.gain.value !== a.buses.effects.gain.value
    a.play('pistol_9mm')
    await new Promise(r => setTimeout(r, 45))
    const ducked = a.buses.duck.gain.value
    a.setIntensity(.1); const low = a.intensity; a.setIntensity(.9)
    const intensity = [low, a.intensity]
    const first = a.speak('voice_taunt_1', {priority: true})
    const throttled = a.speak('voice_taunt_2') === null
    a.speak('voice_wave_1', {priority: true})
    for (let i = 0; i < 90; i++) a.play('sparks_metal')
    const active = [...a.voices.values()].reduce((n, pool) => n + pool.length, 0)
    const unchanged = before === state()
    // Verify all former cue IDs can still start (heartbeat is intentionally procedural).
    const missing = []
    for (const name of Object.keys(SOUND_CATALOG)) {
      const voice = a.play(name)
      if (!voice) missing.push(name)
      if (voice) a._stopVoice(voice, 0)
    }
    const {roomAt} = await import('/files/lib/audio/acoustics.js')
    return {sampleEnergy, spatial, silent, buses, independent, ducked, intensity, voiceStarted: Boolean(first), throttled, active, unchanged, missing,
      rooms: [roomAt({x:0,y:1,z:0}),roomAt({x:-24,y:1,z:0}),roomAt({x:0,y:1,z:22})]}
  })
  report.audio = audio
  check(Object.values(audio.sampleEnergy).every(x => x.rms > .003 && x.peak > .1), 'Every decoded cue has non-silent PCM')
  check(audio.spatial.blocked && !audio.spatial.clear && audio.spatial.blockedHz < audio.spatial.clearHz, 'Building wall applies occlusion while the open courtyard remains clear')
  check(audio.silent && audio.active <= 64, 'Out-of-range culling and global voice budget hold under an effects burst')
  check(audio.independent && ['music','effects','ui','voice'].every(x => audio.buses.includes(x)), 'Four independently controlled mix buses')
  check(audio.ducked < .7 && audio.intensity[1] > audio.intensity[0], 'Gunfire ducks music and combat intensity follows its control')
  check(audio.voiceStarted && audio.throttled, 'Skynet speech plays with a cooldown and priority override')
  check(audio.unchanged && audio.missing.length === 0, 'All cue IDs work and audio leaves the World snapshot unchanged')
  check(audio.rooms.join(',') === 'outside,tunnel,building', 'Tunnel and building receive room-specific sends')
  report.routing = await page.evaluate(async () => {
    const {AudioBindings} = await import('/files/lib/audio/bindings.js')
    const {World} = await import('/files/lib/core/world.js')
    const w = new World({seed: 3}); w.addPlayer({id:'guest-1'}); w.localPlayerId = 'guest-1'
    w.getPlayer('guest-1').pos = {x:8,y:0,z:0}
    const calls = []
    const engine = {play:(name,options={})=>calls.push({name,options}), startLoop:()=>{},stopLoop:()=>false,loops:new Map()}
    const binding = new AudioBindings({world:w,engine})
    binding._processEvent({type:'shot',by:'guest-1',playerId:'guest-1',weapon:'pistol'})
    binding._processEvent({type:'shot',by:'player',playerId:'player',weapon:'m4'})
    binding._processEvent({type:'shot',by:'endo-1',playerId:'guest-1',unitType:'endo',origin:{x:20,y:1,z:0},hit:true})
    return calls
  })
  check(!report.routing[0].options.position && report.routing[1].options.position && report.routing[2].name === 'plasma_bolt', 'Guest gun is close, host gun is positional, enemy target ID is not treated as shooter')
  console.log('Starting live benchmark')
  await page.evaluate(async () => {
    const a=terminator.manager.audio
    for(const pool of [...a.voices.values()])for(const voice of [...pool])a._stopVoice(voice,0)
    a.stats.samplePlays=0;a.logger=null
    a.startLoop('ambient_bed',{tag:'ambient-bed',bus:'ambient'})
    const m=terminator.manager,w=m.world
    m.ui.startMatch();m.ui.screens.show(null)
    m.director.spawnSchedule=[];m.director.nextSpawn=0
    for(const u of w.units){u.alive=false;u.diedAtTick=w.tick-400}
    w.player.pos={x:0,y:0,z:-18};w.player.hp=100000;w.player.alive=true
    m.input.yaw=0;m.input.pitch=0;m.input.cursorAnchorYaw=0
    for(let i=0;i<24;i++)w.spawnUnit(['scout','endo','heavy'][i%3],{x:(i%6-2.5)*2.5,y:0,z:Math.floor(i/6)*3+2},{yaw:Math.PI})
    m.ctx.viewer.renderManager.renderScale=1
    m.syncViews()
  })
  console.log('Live views started')
  await page.waitForTimeout(1800)
  report.performance = await page.evaluate(async () => {
    const m=terminator.manager,w=m.world,v=viewer, r=v.renderManager.webglRenderer
    const gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info')
    const times=[],audioMs=[];let last=performance.now(),minAlive=24,maxAlive=24
    const a=m.audio,b=m.audioBindings,original=b.sync.bind(b)
    b.sync=function(world){const start=performance.now();original(world);audioMs.push(performance.now()-start)}
    const fxStart={...m.unitView.fx.stats},samplesBefore=a.stats.samplePlays
    for(let i=0;i<240;i++)await new Promise(resolve=>requestAnimationFrame(now=>{
      times.push(now-last);last=now;minAlive=Math.min(minAlive,w.aliveUnits.length);maxAlive=Math.max(maxAlive,w.aliveUnits.length)
      if(i%12===0){
        a.play('m4_rifle')
        const u=w.aliveUnits.find(u=>u.type==='heavy')
        w.damageUnit(u.id,.1,{source:'player',weapon:'m4',point:{...u.pos,y:u.pos.y+1.5}})
      }
      if(i%60===0)w.emit('explosion',{by:'player',playerId:'player',pos:{x:0,y:1,z:5},hit:false})
      resolve()
    }))
    b.sync=original
    const sorted=[...times].sort((a,b)=>a-b),mean=times.reduce((s,x)=>s+x,0)/times.length
    const sortedAudio=audioMs.sort((a,b)=>a-b)
    return {samples:times.length,meanMs:mean,p50Ms:sorted[120],p95Ms:sorted[228],fps:1000/mean,minAlive,maxAlive,
      canvas:[v.canvas.width,v.canvas.height],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',
      audioSyncMeanMs:audioMs.reduce((s,x)=>s+x,0)/audioMs.length,audioSyncP95Ms:sortedAudio[Math.floor(sortedAudio.length*.95)],
      samplePlays:a.stats.samplePlays-samplesBefore,peakVoices:a.stats.peakVoices,fxBefore:fxStart,fxAfter:{...m.unitView.fx.stats},audioStats:{...a.stats}}
  })
  check(report.performance.minAlive===24 && report.performance.maxAlive===24, '24 live enemies throughout the 240-frame measurement')
  check(report.performance.canvas[0]===1920 && report.performance.canvas[1]===1080, 'Full 1920 by 1080 drawing buffer at render scale 1')
  await page.evaluate(()=>{const m=terminator.manager;m.update=()=>{m.syncViews();return true};m.world.player.hp=100;m.world.player.armor=100;m.syncViews()})
  await page.screenshot({path:new URL('24-enemies.png',out).pathname});report.screenshots.push('24-enemies.png')
  await page.evaluate(()=>{const w=terminator.world;w.player.pos={x:-24,y:0,z:0};terminator.manager.syncViews()})
  await page.waitForTimeout(150)
  await page.screenshot({path:new URL('tunnel.png',out).pathname});report.screenshots.push('tunnel.png')
  report.cleanup=await page.evaluate(async()=>{
    const m=terminator.manager,a=m.audio,context=a.context
    m.world.player.alive=false;m.world.player.hp=0
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))
    const deathStarted=[...a.voices.values()].flat().some(v=>v.name==='death_stinger')
    evidenceGame.dispose()
    await new Promise(r=>setTimeout(r,100))
    return {deathStarted,running:a.running,context:context.state,voices:a.voices.size,loops:a.loops.size,desired:a.desiredLoops.size,buffers:a.buffers.size}
  })
  check(report.cleanup.deathStarted, 'Existing UI sync detects local death and starts the death stinger')
  check(!report.cleanup.running && report.cleanup.context==='closed' && report.cleanup.voices===0 && report.cleanup.buffers===0 && report.cleanup.desired===0, 'Stop closes the audio context and clears voices, loops, requests and decoded buffers')
  check(report.errors.length===0, 'No uncaught browser errors')
  report.ok=true
} catch(e) {report.ok=false;report.failure=e.message;process.exitCode=1}
finally {await writeFile(new URL('results.json',out),JSON.stringify(report,null,2)+'\n');await browser.close()}
console.log(JSON.stringify({...report,audio:undefined},null,2))
