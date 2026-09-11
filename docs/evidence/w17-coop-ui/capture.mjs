import {chromium} from 'playwright'
import {readFile, writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'

const out = new URL('./', import.meta.url)
const source = await readFile('/tmp/terminator-w17-dev.log', 'utf8')
const devUrl = source.match(/http:\/\/[^\s]+\?t=[^\s]+/)?.[0]
if (!devUrl || new URL(devUrl).port !== '4595') throw Error('Start kite3d dev --port 4595 --no-open with output redirected to /tmp/terminator-w17-dev.log')
const origin = new URL(devUrl).origin
const browser = await chromium.launch({executablePath:chromium.executablePath(),headless:true,args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']})
const errors = [], screenshots = [], assertions = []
const safe = value => String(value).replace(/([?&]t=)[^&\s)"']+/g, '$1[redacted]')
const check = (value, description) => { assert.ok(value, description); assertions.push(description) }
async function client(role) {
  const context = await browser.newContext({viewport: {width:1920,height:1080},deviceScaleFactor:1})
  await context.request.get(devUrl)
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(safe(error.message)))
  page.on('console',message=>{if(message.type()==='error')console.log(role,'console:',safe(message.text()).slice(0,600))})
  await page.goto(`${origin}/files/docs/evidence/w17-coop-ui/runtime.html`)
  try { await page.waitForFunction(() => window.evidenceGame && window.terminator?.manager?.ui, null, {timeout:60000,polling:200}) } catch(error) { console.log(role,await page.evaluate(()=>({game:!!window.evidenceGame,manager:!!window.terminator?.manager,ui:!!window.terminator?.manager?.ui,canvas:!!window.viewer?.canvas,body:document.body.innerText}))); throw error }
  await page.evaluate(role => {
    const m = window.terminator.manager
    // Controlled UI fixtures, not a relay or a claim of multiplayer transport.
    window.evidenceCalls = []
    window.originalUpdate = m.update
    m.update = () => true
    m.ctx.viewer.renderEnabled=false
    window.draw = () => { m.syncViews(); m.hud.sync(); m.ctx.viewer.setDirty() }
    window.partyFixture = (count=3,ready=false) => ({
      role, status:'connected', code:'JDG729', hostId:'player', playerId:role==='host'?'player':'reese',
      players:[{id:'player',name:'Sarah Connor',ready:true},{id:'reese',name:'Kyle Reese',ready},{id:'blair',name:'Blair Williams',ready}].slice(0,count),
      inviteUrls:{lan:'http://192.168.1.42:4595/?party=JDG729&relay=ws%3A%2F%2F192.168.1.42%3A7801',tunnel:'https://resistance.example/?party=JDG729&relay=wss%3A%2F%2Fresistance-fixture.trycloudflare.com'},
    })
    window.setParty = state => { m.partyState=state; m.ui.party.receive(state); window.draw() }
    window.labelFixture = text => { document.getElementById('fixture-label').textContent=`UI FIXTURE / ${text} / NO RELAY` }
    window.draw()
  }, role)
  console.log('Booted',role)
  return {context,page}
}
async function capture(page, name) {
  await page.evaluate(async () => { window.draw(); await document.fonts.ready; const viewer=terminator.manager.ctx.viewer; await new Promise(resolve=>{const done=()=>{viewer.removeEventListener('postRender',done);viewer.renderEnabled=false;resolve()};viewer.addEventListener('postRender',done);viewer.renderEnabled=true;viewer.setDirty()}) })
  await page.waitForTimeout(180)
  await page.screenshot({animations:'disabled',path:new URL(name,out).pathname})
  screenshots.push(name)
}
async function installHooks(page, role) {
  await page.evaluate(role => {
    const m=window.terminator.manager
    m.startHost=async options=>{evidenceCalls.push({hook:'startHost',options});return partyFixture(1)}
    m.joinParty=async options=>{evidenceCalls.push({hook:'joinParty',options});return partyFixture(3)}
    m.setPartyReady=value=>{evidenceCalls.push({hook:'setPartyReady',value});const state=m.ui.party.state;state.players.find(p=>p.id===state.playerId).ready=value;setParty({...state})}
    m.leaveParty=()=>{evidenceCalls.push({hook:'leaveParty'});m.partyState=null}
    m.startMatch=options=>{evidenceCalls.push({hook:'startMatch',options});setParty({...m.ui.party.state,status:'playing'});return {ok:true}}
    labelFixture(`${role.toUpperCase()} PARTY`)
  }, role)
}

try {
  const host=await client('host'), guest=await client('guest')
  const h=host.page,g=guest.page
  await capture(h,'01-main-menu.png')
  await h.getByTestId('host-party').click()
  await capture(h,'02-host-create.png')
  await h.evaluate(()=>{window.terminator.manager.startHost=undefined})
  await h.getByTestId('create-party').click()
  check((await h.locator('[data-party="error"]').innerText()).includes('unavailable in this build'),'Missing transport displays an honest unavailable state')
  await capture(h,'03-host-service-unavailable.png')
  await installHooks(h,'host')
  await h.getByLabel('Your name',{exact:true}).fill('Sarah Connor')
  await h.getByTestId('create-party').click()
  await capture(h,'04-host-one-player.png')
  check(await h.getByTestId('party-start').isEnabled(),'Host can start when the only fighter is ready')
  await h.evaluate(()=>setParty(partyFixture(2)))
  await capture(h,'05-host-two-players-waiting.png')
  check(await h.getByTestId('party-start').isDisabled(),'Start is disabled while a teammate is not ready')
  await h.evaluate(()=>setParty(partyFixture(3)))
  await capture(h,'06-host-three-players-waiting.png')
  await h.getByLabel('Start even if someone is not ready').check()
  check(await h.getByTestId('party-start').isEnabled(),'Explicit host override enables Start')
  await capture(h,'07-host-override.png')
  await h.evaluate(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}})})
  await h.getByTestId('copy-party-lan').click()
  await h.getByTestId('copy-party-tunnel').click()
  check((await h.evaluate(()=>window.copied)).length===2,'LAN and tunnel copy buttons pass their exact invites to the clipboard API')
  await h.getByLabel('Start even if someone is not ready').uncheck()
  await h.evaluate(()=>setParty(partyFixture(3,true)))
  await capture(h,'08-host-everyone-ready.png')
  await h.getByTestId('party-start').click()
  check(await h.evaluate(()=>evidenceCalls.some(x=>x.hook==='startMatch')),'Start calls the GameManager hook')

  await g.getByTestId('join-party').click()
  await capture(g,'09-join-empty.png')
  await g.getByLabel('Party code or invite link',{exact:true}).fill('BAD!')
  await g.getByTestId('join-party-submit').click()
  check((await g.locator('[data-party="error"]').innerText()).startsWith('Bad party code'),'Malformed codes are rejected before transport')
  await capture(g,'10-join-bad-code.png')
  await installHooks(g,'guest')
  await g.getByLabel('Your name',{exact:true}).fill('Kyle Reese')
  await g.getByLabel('Party code or invite link',{exact:true}).fill('https://resistance.example/?party=jdg729&relay=wss%3A%2F%2Fresistance-fixture.trycloudflare.com')
  await capture(g,'11-join-pasted-invite.png')
  await g.getByTestId('join-party-submit').click()
  check(await g.evaluate(()=>evidenceCalls.some(x=>x.hook==='joinParty' && x.options.code==='JDG729' && x.options.relay==='wss://resistance-fixture.trycloudflare.com' && x.options.name==='Kyle Reese')),'Pasted invite parses party, relay and player name')
  await capture(g,'12-guest-connected-not-ready.png')
  await g.getByTestId('party-ready').click()
  await capture(g,'13-guest-ready.png')
  check(await g.evaluate(()=>evidenceCalls.some(x=>x.hook==='setPartyReady' && x.value)),'Guest Ready invokes its hook')
  for(const [code,file] of [['relay_unreachable','14-join-relay-unreachable.png'],['party_full','15-join-party-full.png'],['host_left','16-join-host-left.png']]) {
    await g.getByTestId('leave-party').click()
    await g.getByTestId('join-party').click()
    await g.evaluate(code=>{window.terminator.manager.joinParty=async()=>{throw {code}}},code)
    await g.getByTestId('join-party-submit').click()
    await capture(g,file)
    check(await g.locator('[data-party="error"]').isVisible(),`${code} has an inline error`)
  }
  await g.evaluate(()=>setParty({status:'host_left',error:{code:'host_left'}}))
  await capture(g,'17-host-left-main-notice.png')
  check(await g.getByTestId('host-party').isVisible(),'Host departure returns guest to the main menu')

  await h.evaluate(async()=>{
    const m=window.terminator.manager,w=m.world
    const {difficultyScaling}=await import('/files/lib/core/waves.js')
    w.player.name='Sarah Connor'
    w.addPlayer({id:'reese',name:'Kyle Reese'});w.addPlayer({id:'blair',name:'Blair Williams'})
    w.player.pos={x:0,y:0,z:-6};w.player.yaw=0;w.player.pitch=0
    Object.assign(w.getPlayer('reese'),{pos:{x:-3,y:0,z:1},hp:76,armor:45,yaw:0})
    Object.assign(w.getPlayer('blair'),{pos:{x:3,y:0,z:3},hp:100,armor:80,yaw:.15})
    w.phase='wave';w.wave=3;w.scaling=difficultyScaling(3);m.director.phase='wave'
    m.ui.screens.show(null);m.hud.lastPhase='wave';m.hud.lastWave=3;m.hud.elements.banner.hidden=true
    labelFixture('THREE PLAYER CORE STATE');draw()
  })
  await capture(h,'18-match-teammates-nameplates.png')
  check(await h.locator('.tm-nameplate.teammate:visible').count()===2,'Both teammate nameplates project onto the real scene')
  check((await h.getByTestId('wave-scaling').innerText())==='3 PLAYERS x2.1','Wave block shows actual three-player scaling')
  await h.evaluate(()=>{const p=terminator.world.getPlayer('blair');p.hp=0;p.alive=false;p.downed=true;draw()})
  await capture(h,'19-match-teammate-downed.png')
  check((await h.locator('.tm-teammate.downed').innerText()).includes('DOWN'),'Downed teammate retains a clear HUD marker')
  await h.evaluate(()=>{Object.assign(terminator.world.getPlayer('blair'),{hp:82,alive:true,downed:false});Object.assign(terminator.world.player,{hp:0,alive:false,downed:true});draw()})
  await capture(h,'20-spectating-reese.png')
  check((await h.getByTestId('spectating').innerText()).includes('SPECTATING Kyle Reese'),'Death activates teammate spectating')
  await h.mouse.click(950,500,{button:'left'})
  await h.evaluate(()=>draw())
  await capture(h,'21-spectating-blair.png')
  check((await h.getByTestId('spectating').innerText()).includes('SPECTATING Blair Williams'),'Left mouse cycles forward')
  await h.mouse.click(950,500,{button:'right'})
  await h.evaluate(()=>draw())
  check((await h.getByTestId('spectating').innerText()).includes('SPECTATING Kyle Reese'),'Right mouse cycles backward')
  check(await h.evaluate(()=>{const m=terminator.manager,p=m.world.getPlayer('reese'),c=m.playerView.camera;return Math.abs(c.position.x-p.pos.x)<.001 && Math.abs(c.position.y-p.pos.y-1.65)<.001 && !m.input.listeners.length}),'Spectate camera follows target coordinates and gameplay input is stopped')
  await h.evaluate(()=>{terminator.world.removePlayer('reese');draw()})
  check((await h.getByTestId('spectating').innerText()).includes('SPECTATING Blair Williams'),'Spectating switches when target leaves')
  await capture(h,'22-spectating-one-survivor.png')
  await h.evaluate(()=>{const w=terminator.world;w.addPlayer({id:'reese',name:'Kyle Reese'});w.respawnDeadPlayers();Object.assign(w.player,{hp:100,alive:true,downed:false});w.wave=4;draw()})
  await capture(h,'23-next-wave-respawn.png')
  check(await h.getByTestId('spectating').isHidden(),'Respawn removes spectate banner')
  check(await h.evaluate(()=>terminator.manager.playerView.gun.visible && terminator.manager.input.listeners.length>0),'Respawn restores weapon visibility and gameplay input')
  await h.evaluate(()=>{
    const m=terminator.manager,w=m.world
    // Explicit result fixture. Real aggregation code receives deterministic events.
    w.eventLog=[]
    for(const [id,kills,damage,fired,hits,scrap] of [['player',21,4120,100,64,950],['reese',16,3260,80,42,710],['blair',12,2840,60,45,1200]]){
      const p=w.getPlayer(id);p.scrap=scrap;p.alive=false;p.hp=0;p.downed=true
      for(let i=0;i<kills;i++)w.eventLog.push({type:'kill',playerId:id,playerName:p.name,unitType:'endo',tick:i,t:0})
      w.eventLog.push({type:'unit_damage',playerId:id,amount:damage,t:0})
      for(let i=0;i<fired;i++)w.eventLog.push({type:'shot',by:id,playerId:id,weapon:'m4',hit:i<hits,t:0})
    }
    w.phase='ended';w.wave=7;w.tick=864*60;m.director.phase='ended';labelFixture('MATCH RESULTS');draw()
  })
  await capture(h,'24-postmatch-scoreboard.png')
  check((await h.getByTestId('coop-scoreboard').innerText()).includes('4,120'),'Scoreboard aggregates per-player damage')
  check(await h.getByTestId('dossier-reveal').count()===0,'Scoreboard is presented before the dossier')
  await h.evaluate(()=>{const m=terminator.manager;m.world.localPlayerId='player';m.world.snapshotEventCursor=m.world.eventLog.length+10;m.ui.screens.ended=false;m.ui.screens.show(null);draw();labelFixture('PARTIAL RECEIVED MATCH HISTORY')})
  await capture(h,'33-postmatch-partial-history.png')
  check((await h.locator('.tm-scoreboard-note').innerText()).includes('Partial history'),'Incomplete guest history is labeled instead of presented as full match totals')
  await h.getByTestId('postmatch-dossier').click()
  await h.waitForTimeout(1900)
  await capture(h,'25-postmatch-dossier.png')
  check(await h.getByTestId('dossier-reveal').isVisible(),'Continue reveals the dossier')

  for(const page of [h,g]){
    const cleanup=await page.evaluate(()=>{
      const m=terminator.manager,viewer=m.ctx.viewer
      m.stop()
      return {hud:document.querySelectorAll('.tm-hud').length,styles:document.querySelectorAll('[data-terminator-style]').length,runtime:viewer.scene.children.filter(n=>n.name==='Player Runtime' || n.name==='Players Runtime').length}
    })
    check(cleanup.hud===0 && cleanup.styles===0 && cleanup.runtime===0,'Stop removes UI and runtime objects')
  }
  check(errors.length===0,'No uncaught browser errors during evidence capture')
  await writeFile(new URL('results.json',out),JSON.stringify({mode:'headless Chromium; two isolated contexts; explicit UI fixtures, no relay',viewport:{width:1920,height:1080},screenshots,assertions,errors},null,2)+'\n')
  console.log(JSON.stringify({screenshots:screenshots.length,assertions:assertions.length,errors},null,2))
} catch(error) { console.error(JSON.stringify({error:safe(error.message),errors})); throw error } finally { await browser.close() }
