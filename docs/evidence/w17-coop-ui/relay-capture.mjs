import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {startTestServer} from '../../../test/server/helpers.js'

const out=new URL('./',import.meta.url)
const source=await readFile('/tmp/terminator-w17-dev.log','utf8')
const devUrl=source.match(/http:\/\/[^\s]+\?t=[^\s]+/)?.[0]
assert.equal(new URL(devUrl).port,'4595')
const origin=new URL(devUrl).origin
const relay=await startTestServer({party:{lanHost:'127.0.0.1'}})
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true})
const issues=[],assertions=[],screenshots=[]
const safe=value=>String(value).replace(/([?&]t=)[^&\s)"']+/g,'$1[redacted]')
const check=(value,message)=>{assert.ok(value,message);assertions.push(message)}
async function client(name){
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1})
  await context.request.get(devUrl)
  const page=await context.newPage()
  page.on('pageerror',error=>issues.push({name,error:safe(error.stack || error.message)}))
  await page.addInitScript(relay=>{globalThis.PARTY_RELAY_URL=relay},relay.url)
  await page.goto(`${origin}/files/docs/evidence/w17-coop-ui/runtime.html`)
  await page.waitForFunction(()=>window.evidenceGame && window.terminator?.manager?.ui,null,{timeout:60000,polling:200})
  await page.evaluate(name=>{document.getElementById('fixture-label').textContent=`REAL LOCAL RELAY / ${name.toUpperCase()} / HEADLESS CHROMIUM`},name)
  console.log('Relay client booted:',name)
  return page
}
async function capture(page,name){
  await page.evaluate(async()=>{
    const m=terminator.manager,v=m.ctx.viewer
    m.syncViews();m.hud.sync();await document.fonts.ready
    await new Promise(resolve=>{const done=()=>{v.removeEventListener('postRender',done);v.renderEnabled=false;resolve()};v.addEventListener('postRender',done);v.renderEnabled=true;v.setDirty()})
  })
  await page.screenshot({animations:'disabled',path:new URL(name,out).pathname})
  screenshots.push(name)
}
try{
  const host=await client('host'),guest=await client('guest')
  await host.getByTestId('host-party').click()
  await host.getByLabel('Your name',{exact:true}).fill('Sarah Connor')
  await host.getByTestId('create-party').click()
  await host.waitForFunction(()=>terminator.manager.partyState?.status==='lobby')
  const code=await host.evaluate(()=>terminator.manager.partyState.code)
  await capture(host,'26-relay-host-created.png')
  await guest.getByTestId('join-party').click()
  await guest.getByLabel('Your name',{exact:true}).fill('Kyle Reese')
  await guest.getByLabel('Party code or invite link',{exact:true}).fill(`${origin}/?party=${code}&relay=${encodeURIComponent(relay.url)}`)
  await guest.getByTestId('join-party-submit').click()
  await Promise.all([host.waitForFunction(()=>terminator.manager.partyState?.players.length===2),guest.waitForFunction(()=>terminator.manager.partyState?.players.length===2)])
  check(await host.getByTestId('party-start').isDisabled(),'Real host cannot start before the squad is ready')
  await capture(host,'27-relay-host-two-players.png')
  await capture(guest,'28-relay-guest-connected.png')
  await host.getByTestId('party-ready').click()
  await guest.getByTestId('party-ready').click()
  await host.waitForFunction(()=>terminator.manager.partyState.players.every(player=>player.ready))
  check(await host.getByTestId('party-start').isEnabled(),'Ready messages travel through the relay and enable host Start')
  await capture(host,'29-relay-squad-ready.png')
  await host.getByTestId('party-start').click()
  await Promise.all([host.waitForFunction(()=>terminator.world.phase==='wave'),guest.waitForFunction(()=>terminator.world.phase==='wave' && terminator.manager.ui.screens.route===null)])
  check(await guest.evaluate(()=>terminator.manager.localPlayerId==='guest-1'),'Guest uses its own player identity after joining')
  await guest.evaluate(()=>terminator.manager.party.step({move:{x:1,z:-1},yaw:0,pitch:0}))
  await host.waitForFunction(()=>terminator.manager.party.latestInputs.has('guest-1'))
  await host.evaluate(()=>{const m=terminator.manager;for(let i=0;i<30;i++)m.party.step({move:{x:0,z:0},yaw:0,pitch:0});m.party.sendSnapshot()})
  await guest.waitForFunction(()=>terminator.world.tick>=30)
  await guest.waitForTimeout(600)
  await capture(guest,'30-relay-guest-in-match.png')
  check((await guest.getByTestId('teammates').innerText()).includes('Sarah Connor'),'Guest HUD shows the host as a teammate')
  check((await guest.getByTestId('wave-scaling').innerText())==='2 PLAYERS x1.6','Live match displays authoritative two-player scaling')
  // The death trigger is controlled. Delivery, guest world adoption, UI transition,
  // and camera following use the real host, relay, and guest snapshot paths.
  await host.evaluate(()=>{const m=terminator.manager,p=m.world.getPlayer('guest-1');p.hp=0;p.alive=false;p.downed=true;m.party.sendSnapshot()})
  await guest.waitForFunction(()=>!terminator.world.getPlayer(terminator.manager.localPlayerId).alive)
  await capture(guest,'31-relay-guest-spectating.png')
  check((await guest.getByTestId('spectating').innerText()).includes('SPECTATING Sarah Connor'),'Guest death snapshot activates the spectate camera')
  await host.evaluate(()=>{const m=terminator.manager;m.world.respawnDeadPlayers();m.party.sendSnapshot()})
  await guest.waitForFunction(()=>terminator.world.player.alive)
  await guest.evaluate(()=>terminator.manager.syncViews())
  check(await guest.evaluate(()=>terminator.manager.input.listeners.length>0),'Respawn snapshot restores guest input')
  await host.evaluate(()=>terminator.manager.leaveParty())
  await guest.waitForFunction(()=>terminator.manager.ui.screens.route==='main')
  await capture(guest,'32-relay-host-left.png')
  check((await guest.locator('.tm-toast').innerText()).includes('Host left'),'Host departure produces a clear main-menu notice')
  for(const page of [host,guest])await page.evaluate(()=>evidenceGame.dispose())
  check(issues.length===0,'Two real relay clients produced no uncaught browser errors')
  await writeFile(new URL('relay-results.json',out),JSON.stringify({mode:'Real local WebSocket relay; two isolated headless Chromium contexts. Controlled death/respawn triggers sent through actual snapshots.',viewport:{width:1920,height:1080},assertions,screenshots,issues},null,2)+'\n')
  console.log(JSON.stringify({assertions:assertions.length,screenshots:screenshots.length,issues},null,2))
}catch(error){console.error(JSON.stringify({error:safe(error.message),issues}));throw error}
finally{await browser.close();await relay.close()}
