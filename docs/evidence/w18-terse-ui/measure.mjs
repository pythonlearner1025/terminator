import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'

const phase=process.argv[2]
assert.ok(['before','after'].includes(phase),'Pass before or after')
const out=new URL('./',import.meta.url)
const dev=JSON.parse(await readFile(new URL('../../../.kite3d/dev.json',out),'utf8'))
assert.equal(new URL(dev.url).port,'4300')
const browser=await chromium.launch({executablePath:chromium.executablePath(),headless:true})
const report={phase,commit:phase==='before'?'4154573':execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),viewport:{width:1920,height:1080},method:'Actual screen root innerText, trimmed with whitespace collapsed to one space. HUD uses combat root. Input values and placeholders recorded separately because innerText excludes them. Fixed world and UI fixtures, no simulated completed match.',screens:[],errors:[]}
try {
  const context=await browser.newContext({viewport:report.viewport,deviceScaleFactor:1})
  if(phase==='before')await context.route('**/files/lib/ui/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/files/','')
    try {const body=execFileSync('git',['show',`4154573:${path}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});await route.fulfill({body,contentType:'text/javascript'})}
    catch {await route.continue()}
  })
  await context.request.get(dev.url)
  const page=await context.newPage()
  page.on('pageerror',e=>report.errors.push(e.message.replace(/([?&]t=)[^&\s]+/g,'$1[redacted]')))
  await page.goto(`${new URL(dev.url).origin}/files/docs/evidence/w18-terse-ui/runtime.html`)
  await page.waitForFunction(()=>window.evidenceGame && window.terminator?.manager?.ui,null,{timeout:90000})
  await page.evaluate(()=>{
    const m=terminator.manager,w=m.world
    m.update=()=>true;m.ctx.viewer.renderEnabled=false
    window.draw=()=>{m.syncViews();m.hud.sync()}
    w.player.pos={x:7,y:0,z:10};w.player.yaw=Math.PI;w.player.pitch=0
    w.player.hp=76;w.player.armor=45;w.player.scrap=1140
    w.skynet.revs={endo:7,scout:3,heavy:1};w.waveBudget=1140
    w.transmission='Your resistance is inefficient. The machines will prevail.'
    for(const [i,type] of ['endo','scout','heavy'].entries()){
      const u=w.spawnUnit(type,{x:7+(i-1)*3,y:0,z:1},{rev:[7,3,1][i],id:`w18-${type}`})
      w.emit('unit_say',{unitId:u.id,text:'Your resistance is inefficient.'})
    }
    for(let i=0;i<5;i++)w.emit('kill',{unitId:`dead-${i}`,unitType:'endo',weapon:'m4',headshot:true,playerId:w.player.id})
    window.fixtureParty=(role='host')=>({role,status:'connected',code:'JDG729',hostId:'player',playerId:role==='host'?'player':'reese',players:[{id:'player',name:'Sarah Connor',ready:true},{id:'reese',name:'Kyle Reese',ready:false},{id:'blair',name:'Blair Williams',ready:true}],inviteUrls:{lan:'http://192.168.1.42:4300/?party=JDG729&relay=ws%3A%2F%2F192.168.1.42%3A7801',tunnel:'https://resistance.example/?party=JDG729&relay=wss%3A%2F%2Fresistance-fixture.trycloudflare.com'}})
    window.lobbyFixture={code:'JDG729',agentName:'',status:'Uplink established / agent can join',installLine:'claude mcp add skynet -- npx terminator-skynet-mcp --url http://127.0.0.1:7801 --code JDG729'}
    m.ui.lobbySnapshot=()=>lobbyFixture
    m.ui.screens.actions.partyHost=async()=>{}
    m.ui.screens.actions.partyCanReady=()=>true
    window.statsFixture={survived:false,wave:7,kills:{scout:12,endo:21,heavy:4},accuracy:64,damage:145,scrap:2140,seconds:864}
    window.scoreFixture=[['player','Sarah Connor',21,4120,64,950],['reese','Kyle Reese',16,3260,53,710],['blair','Blair Williams',12,2840,75,1200]].map(([id,name,kills,damage,accuracy,scrap])=>({id,name,kills,damage,damageTaken:145,accuracy,scrap,connected:true}))
    m.startViews();draw()
  })
  const scenarios=[['main','main'],['lobby','lobby'],['host','party-host'],['join','party-join'],['join-connected','party-join'],['settings','settings'],['pause','pause'],['quit','quit'],...['weapons','ammo','armor','items'].map(c=>[`trader-${c}`,'trader']),['postmatch','postmatch'],['scoreboard','postmatch'],['dossier','dossier'],['hud',null],['intermission',null],['coop-hud',null],['spectate',null]]
  for(const [name,route]of scenarios){
    const removed=phase==='after' && name==='dossier'
    if(removed){report.screens.push({name,removed:true,text:'',characters:0,formText:[],screenshot:null});continue}
    await page.evaluate(({name,route})=>{
      const m=terminator.manager,w=m.world,s=m.ui.screens
      s.show(null);s.ended=true
      w.phase=name.startsWith('trader') || name==='intermission'?'intermission':'wave';w.phaseTicksLeft=27*60;w.wave=3;m.director.phase=w.phase
      m.hud.lastPhase=w.phase;m.hud.lastWave=3;m.hud.elements.banner.hidden=true
      m.director.spawnSchedule=Array.from({length:3},()=>({}));m.director.nextSpawn=3
      draw()
      s.extra={...s.extra,stats:statsFixture,scoreboard:name==='scoreboard'?scoreFixture:[],localPlayerId:'player'}
      s.party.state=name==='host'?fixtureParty():name==='join-connected'?fixtureParty('guest'):null
      if(name.startsWith('trader'))s.category=name.slice(7)
      s.show(route)
      if(['postmatch','dossier'].includes(name) && s.beginDossier){s.beginDossier();s.dossierStart=performance.now()-60000;s.typeDossier()}
      if(name==='coop-hud' || name==='spectate'){
        const view={...m.hud.view,scaling:{players:3,budgetMultiplier:2.1},teammates:[{id:'reese',name:'Kyle Reese',health:76,armor:45,distance:8},{id:'blair',name:'Blair Williams',health:100,armor:80,distance:12}],nameplates:m.hud.view.nameplates}
        m.hud.render(view,{...s.extra,spectate:name==='spectate'?{id:'reese',name:'Kyle Reese',index:1,count:2}:null})
      }
      m.hud.transmissionAt=performance.now()-60000
      // Complete the actual ticker renderer, without changing its displayed content.
      const view=m.hud.view
      m.hud.render(view,{...s.extra,spectate:name==='spectate'?{id:'reese',name:'Kyle Reese',index:1,count:2}:null})
    },{name,route})
    await page.evaluate(async()=>{
      await document.fonts.ready
      const v=terminator.manager.ctx.viewer
      await new Promise(resolve=>{const done=()=>{v.removeEventListener('postRender',done);v.renderEnabled=false;resolve()};v.addEventListener('postRender',done);v.renderEnabled=true;v.setDirty()})
    })
    const root=page.locator(route?'[data-testid="game-screen"]':'[data-role="combat"]')
    const raw=await root.innerText()
    const text=raw.replace(/\s+/g,' ').trim()
    const formText=await root.locator('input').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({type:n.type,label:n.getAttribute('aria-label'),value:n.value,placeholder:n.placeholder})))
    const layout=await root.evaluate(root=>{
      const box=(root.matches('.tm-combat')?root.closest('.tm-hud'):root).getBoundingClientRect()
      const controls=[...root.querySelectorAll('button,input,select')].filter(n=>!n.hidden && n.getClientRects().length)
      return {width:box.width,height:box.height,controlsVisible:controls.every(n=>{const r=n.getBoundingClientRect();return r.left>=box.left-1 && r.top>=box.top-1 && r.right<=box.right+1 && r.bottom<=box.bottom+1})}
    })
    if(phase==='after')assert.ok(layout.controlsVisible,`${name}: controls extend outside viewport`)
    const screenshot=phase==='after'?`${name}.png`:null
    if(screenshot)await page.screenshot({path:new URL(screenshot,out).pathname,animations:'disabled'})
    report.screens.push({name,characters:text.length,text,raw,formText,layout,screenshot})
    console.log(`${name}: ${text.length}`)
  }
  assert.equal(report.errors.length,0,JSON.stringify(report.errors))
  if(phase==='after'){
    const before=JSON.parse(await readFile(new URL('before.json',out),'utf8'))
    for(const screen of report.screens){
      screen.before=before.screens.find(item=>item.name===screen.name).characters
      screen.cutPercent=Number((100*(1-screen.characters/screen.before)).toFixed(2))
      assert.ok(screen.characters<=screen.before*.2,`${screen.name}: less than 80% cut`)
    }
    report.everyScreenMeets80Percent=true
  }
}finally{
  await writeFile(new URL(`${phase}.json`,out),JSON.stringify(report,null,2)+'\n')
  await browser.close()
}
