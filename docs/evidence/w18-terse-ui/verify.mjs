import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {startTestServer} from '../../../test/server/helpers.js'

const out=new URL('./',import.meta.url)
const dev=JSON.parse(await readFile(new URL('../../../.kite3d/dev.json',out),'utf8'))
assert.equal(new URL(dev.url).port,'4300')
const relay=await startTestServer({party:{lanHost:'127.0.0.1'}})
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true})
const report={mode:'Actual GameManager, core purchases and local HTTP/WebSocket relay, two isolated headless Chromium contexts. Controlled world state for combat/results.',assertions:[],errors:[],screenshots:[]}
const check=(value,label)=>{assert.ok(value,label);report.assertions.push(label);console.log('PASS '+label)}
const action=(page,name)=>page.locator(`[data-action="${name}"]:visible`).first().click()
async function client(name){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1})
  await context.request.get(dev.url)
  await context.addInitScript(url=>{globalThis.PARTY_RELAY_URL=url},relay.url)
  const page=await context.newPage()
  page.on('pageerror',e=>report.errors.push(e.message.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]')))
  await page.goto(`${new URL(dev.url).origin}/files/docs/evidence/w18-terse-ui/runtime.html?skynetServer=${encodeURIComponent(relay.url)}`)
  await page.waitForFunction(()=>window.evidenceGame && window.terminator?.manager?.ui,null,{timeout:90000})
  await page.evaluate(name=>{
    terminator.manager.ui.screens.party.name=name
    document.getElementById('fixture-label').textContent='W18 / REAL LOCAL RELAY / HEADLESS'
    window.copied=[]
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}})
  },name)
  console.log('Booted '+name)
  return page
}
async function capture(page,name){
  await page.evaluate(async()=>{
    const m=terminator.manager,v=m.ctx.viewer;m.syncViews();m.hud.sync();await document.fonts.ready
    await new Promise(resolve=>{const done=()=>{v.removeEventListener('postRender',done);v.renderEnabled=false;resolve()};v.addEventListener('postRender',done);v.renderEnabled=true;v.setDirty()})
  })
  await page.screenshot({path:new URL(name,out).pathname,animations:'disabled'})
  report.screenshots.push(name)
}
try{
  const host=await client('Sarah Connor'),guest=await client('Kyle Reese')
  check(await host.locator('[data-action*="dossier"]').count()===0,'Main menu has no dossier action')
  await action(host,'settings')
  await host.getByLabel('FOV',{exact:true}).evaluate(el=>{el.value='84';el.dispatchEvent(new Event('input',{bubbles:true}))})
  await host.getByLabel('Quality',{exact:true}).selectOption('medium')
  check(await host.evaluate(()=>JSON.parse(localStorage.getItem('terminator.settings.v1')).fov===84),'Settings persist in browser storage')
  await action(host,'back');await action(host,'settings')
  check(await host.getByLabel('FOV',{exact:true}).inputValue()==='84','Settings values survive reopening')
  await action(host,'back');await action(host,'quit');await action(host,'main-menu')
  check(await host.getByTestId('menu-play').isVisible(),'Quit returns to menu')
  await action(host,'play')
  await host.waitForFunction(()=>Boolean(terminator.manager.lobby.code))
  await host.evaluate(()=>terminator.manager.syncViews())
  await action(host,'copy-mcp')
  check(await host.evaluate(()=>copied.at(-1)===terminator.manager.ui.lobbySnapshot().installLine),'Copy preserves the complete executable MCP command')
  await action(host,'start-match')
  await host.waitForFunction(()=>terminator.world.phase==='wave')
  await host.keyboard.press('Escape')
  check(await host.evaluate(()=>terminator.manager.ui.frozen),'Pause freezes solo simulation')
  await action(host,'settings');await action(host,'back')
  check(await host.evaluate(()=>terminator.manager.ui.screens.route==='pause'),'Settings returns to Pause')
  await action(host,'resume')
  check(await host.evaluate(()=>terminator.manager.input.listeners.length>0),'Resume restores gameplay input')
  await host.evaluate(()=>{
    const m=terminator.manager,w=m.world;m.update=()=>true
    w.phase='intermission';m.director.phase='intermission';w.phaseTicksLeft=1620
    w.player.scrap=3000;w.player.armor=40;w.player.hp=50;w.player.pos={...w.map.trader.pos}
    w.player.ammo.pistol.reserve=0;m.syncViews()
  })
  await host.keyboard.press('e')
  check(await host.evaluate(()=>terminator.manager.ui.screens.route==='trader'),'E opens Trader')
  await action(host,'purchase:m4');await host.evaluate(()=>terminator.manager.syncViews())
  check(await host.evaluate(()=>terminator.world.player.ammo.m4.owned),'Weapon purchase uses the core API')
  await action(host,'category:ammo');await action(host,'purchase:ammo:pistol')
  check(await host.evaluate(()=>terminator.world.player.ammo.pistol.reserve>0),'Ammo purchase works')
  await action(host,'purchase:fill-ammo');await action(host,'purchase:full-armor')
  check(await host.evaluate(()=>terminator.world.player.armor===100),'Bulk armor purchase works')
  check(await host.evaluate(()=>terminator.world.player.ammo.m4.reserve===terminator.world.weaponCatalog.weapons.m4.reserveMax),'Bulk ammunition purchase fills owned weapons')
  await action(host,'category:items');await action(host,'purchase:medkit')
  check(await host.evaluate(()=>terminator.world.player.hp>50),'Medkit purchase works')
  await action(host,'purchase:grenade')
  check(await host.evaluate(()=>terminator.world.player.grenades>1),'Grenade purchase works')
  await host.evaluate(()=>{terminator.world.player.scrap=0;terminator.manager.syncViews()})
  await action(host,'category:weapons');await action(host,'purchase:plasma')
  check(await host.evaluate(()=>!terminator.world.player.ammo.plasma.owned),'Insufficient scrap leaves the weapon unpurchased')
  await capture(host,'trader-denied.png')
  await host.keyboard.press('r')
  check(await host.evaluate(()=>terminator.manager.ui.screens.route===null && terminator.manager.ui.sample().ready),'R leaves Trader and emits Ready')
  await host.evaluate(()=>{const m=terminator.manager;m.world.phase='ended';m.director.phase='ended';m.world.player.alive=false;m.ui.screens.ended=false;m.syncViews()})
  check(await host.locator('[data-testid="dossier-reveal"]').count()===0,'Post-match has no dossier reveal')
  await action(host,'play-again')
  check(await host.evaluate(()=>terminator.manager.ui.screens.route==='lobby' && terminator.world.phase==='lobby'),'Play Again creates a fresh game')
  await action(host,'main-menu')
  await host.evaluate(()=>{terminator.manager.ui.screens.party.name='Sarah Connor'})
  await action(host,'host-party')
  await host.waitForFunction(()=>terminator.manager.partyState?.status==='lobby')
  check(await host.locator('[data-party="invite"]').count()===1 && await host.locator('[data-action^="copy-party-"]').count()===1,'Host exposes one invite and one copy action')
  await action(host,'copy-party-invite')
  check(await host.evaluate(()=>copied.at(-1)===document.querySelector('[data-party="invite"]').value),'Host copy sends the exact invite')
  const code=await host.evaluate(()=>terminator.manager.partyState.code)
  await action(guest,'join-party')
  check(await guest.locator('form input').count()===2,'Join has exactly code and relay inputs')
  await guest.getByLabel('Party code or invite link',{exact:true}).fill('BAD!')
  await action(guest,'join-party-submit')
  check(await guest.locator('[data-party="error"]').innerText()==='Invalid code','Invalid code receives a short error label')
  await capture(guest,'join-invalid-code.png')
  await guest.getByLabel('Party code or invite link',{exact:true}).fill(`${new URL(dev.url).origin}/?party=${code}&relay=${encodeURIComponent(relay.url)}`)
  await action(guest,'join-party-submit')
  await Promise.all([host.waitForFunction(()=>terminator.manager.partyState?.players.length===2),guest.waitForFunction(()=>terminator.manager.partyState?.players.length===2)])
  await capture(host,'host-real-relay.png');await capture(guest,'join-real-relay.png')
  check(await host.getByTestId('party-start').isDisabled(),'Host Start waits for player readiness')
  await host.getByLabel('Start even if someone is not ready').check()
  check(await host.getByTestId('party-start').isEnabled(),'Host override remains available')
  await host.getByLabel('Start even if someone is not ready').uncheck()
  await action(host,'party-ready');await action(guest,'party-ready')
  await host.waitForFunction(()=>terminator.manager.partyState.players.every(p=>p.ready))
  check(await host.getByTestId('party-start').isEnabled(),'Real relay readiness enables Start')
  await action(host,'party-start')
  await Promise.all([host.waitForFunction(()=>terminator.world.phase==='wave'),guest.waitForFunction(()=>terminator.world.phase==='wave' && !terminator.manager.ui.screens.route)])
  check(await guest.evaluate(()=>terminator.manager.localPlayerId==='guest-1'),'Joined guest keeps its own player identity')
  await host.evaluate(()=>{const m=terminator.manager,p=m.world.getPlayer('guest-1');p.hp=0;p.alive=false;p.downed=true;m.party.sendSnapshot()})
  await guest.waitForFunction(()=>!terminator.world.getPlayer(terminator.manager.localPlayerId).alive)
  await capture(guest,'spectate-real-relay.png')
  check(await guest.locator('[data-spectate="name"]').innerText()==='Sarah Connor','Death snapshot follows the living teammate')
  check(await guest.getByLabel('Next player',{exact:true}).isDisabled(),'Single-survivor spectate disables cycling')
  await host.evaluate(()=>{const m=terminator.manager;m.world.respawnDeadPlayers();m.party.sendSnapshot()})
  await guest.waitForFunction(()=>terminator.world.getPlayer(terminator.manager.localPlayerId).alive)
  await guest.evaluate(()=>terminator.manager.syncViews())
  check(await guest.evaluate(()=>terminator.manager.input.listeners.length>0),'Respawn snapshot restores input')
  await host.evaluate(()=>terminator.manager.leaveParty())
  await guest.waitForFunction(()=>terminator.manager.ui.screens.route==='main')
  check(await guest.getByTestId('menu-play').isVisible(),'Host departure returns guest to menu')
  await host.evaluate(()=>{
    const m=terminator.manager,w=m.world;m.update=()=>true
    for(const id of [...w.players.keys()])if(id!==w.hostPlayerId)w.removePlayer(id)
    w.addPlayer({id:'reese',name:'Kyle Reese'});w.addPlayer({id:'blair',name:'Blair Williams'})
    w.player.alive=false;w.player.hp=0;w.player.downed=true;w.phase='wave';m.director.phase='wave'
    m.ui.screens.show(null);m.syncViews()
  })
  const firstTarget=await host.locator('[data-spectate="name"]').innerText()
  await action(host,'spectate-next');await host.evaluate(()=>terminator.manager.syncViews())
  check(await host.locator('[data-spectate="name"]').innerText()!==firstTarget,'Spectate next button cycles between living players')
  await action(host,'spectate-previous');await host.evaluate(()=>terminator.manager.syncViews())
  check(await host.locator('[data-spectate="name"]').innerText()===firstTarget,'Spectate previous button cycles backward')
  await host.mouse.click(950,500,{button:'left'});await host.evaluate(()=>terminator.manager.syncViews())
  check(await host.locator('[data-spectate="name"]').innerText()!==firstTarget,'Headless left mouse cycles spectate forward')
  await host.mouse.click(950,500,{button:'right'});await host.evaluate(()=>terminator.manager.syncViews())
  check(await host.locator('[data-spectate="name"]').innerText()===firstTarget,'Headless right mouse cycles spectate backward')
  await host.evaluate(()=>{
    const m=terminator.manager,w=m.world
    w.eventLog=[]
    for(const [id,amount]of [['player',145],['reese',72],['blair',31]]){
      w.eventLog.push({type:'player_damage',playerId:id,amount,t:0})
      w.eventLog.push({type:'unit_damage',playerId:id,amount:999,t:0})
      w.eventLog.push({type:'kill',playerId:id,unitType:'endo',t:0})
      w.eventLog.push({type:'shot',playerId:id,by:id,hit:true,t:0})
    }
    w.phase='ended';m.director.phase='ended';m.ui.screens.ended=false;m.syncViews()
  })
  const rows=await host.locator('.tm-scoreboard tbody tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.innerText)))
  check(rows.length===3 && rows.map(row=>row[3]).join(',')==='145,72,31','Scoreboard uses per-player damage taken, excluding damage dealt')
  check(rows.map(row=>row[0]).join(',')==='SC,KR,BW','Scoreboard initials preserve distinct player identities')
  check(await host.locator('.tm-score-name').first().getAttribute('aria-label')==='Sarah Connor','Scoreboard retains full accessible names')
  check(rows.every(row=>row[1]==='1' && row[2]==='100%'),'Scoreboard preserves kills and accuracy per player')
  await action(host,'play-again')
  check(await host.evaluate(()=>terminator.manager.ui.screens.route==='lobby'),'Co-op scoreboard Play Again restarts')
  for(const page of [host,guest]){
    await page.evaluate(()=>evidenceGame.dispose())
    check(await page.locator('.tm-hud').count()===0,'Stop cleans up all HUD and screen DOM')
  }
  check(report.errors.length===0,'No uncaught browser errors')
  report.ok=true
}catch(error){report.ok=false;report.failure=error.message;process.exitCode=1}
finally{await writeFile(new URL('verification.json',out),JSON.stringify(report,null,2)+'\n');await browser.close();await relay.close()}
console.log(JSON.stringify(report,null,2))
