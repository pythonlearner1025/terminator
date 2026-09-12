// Run against this worktree's server on 4672. Never launches a visible window.
import {chromium} from 'playwright'
import {readFile,writeFile} from 'node:fs/promises'
const out='docs/evidence/weapons-view'
const dev=JSON.parse(await readFile('.kite3d/dev.json','utf8'))
if(new URL(dev.url).port!=='4672')throw Error('Expected local weapons server on 4672')
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--use-angle=metal']})
const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
const errors=[]
const sanitize=s=>String(s).replace(/\?t=[\w.~-]+/g,'?t=[redacted]')
page.on('pageerror',e=>errors.push(sanitize(e.message)))
page.on('console',m=>{if(m.type()==='error')errors.push(sanitize(m.text()))})
try {
  await page.addInitScript(()=>localStorage.setItem('terminator.settings.v1',JSON.stringify({quality:'high',controlsSeen:true})))
  await page.goto(dev.url,{waitUntil:'domcontentloaded'})
  await page.getByTestId('play').waitFor({timeout:30000});await page.getByTestId('play').click()
  await page.waitForFunction(()=>window.terminator?.manager?.world,null,{timeout:60000})
  await page.evaluate(async()=>{
    const m=window.terminator.manager,w=m.world,viewer=window.viewer
    m.ui.menuScene?.setActive(false);m.startViews();await m.visualWarmup;await m.mapView.ready
    m.started=false;m.input.stop();m.ui.screens.show(null)
    Object.assign(viewer.container.style,{position:'fixed',left:0,top:0,width:'1920px',height:'1080px',maxWidth:'none',maxHeight:'none',zIndex:'2147483000'})
    viewer.setSize({width:1920,height:1080});viewer.resize();viewer.renderManager.renderScale=1
    w.phase='wave';w.wave=5;w.player.hp=w.player.maxHp=100;w.player.armor=100
    Object.assign(w.player.pos,{x:-5,y:0,z:16});w.player.yaw=Math.PI;w.player.pitch=0;w.player.aiming=false
    // C1 owns gameplay data. These specs exist only inside this isolated visual fixture.
    w.weaponCatalog={...w.weaponCatalog,weapons:{...w.weaponCatalog.weapons,
      sniper:{id:'sniper',name:'M14 Marksman',rate:1.2,mag:10,reloadSeconds:2.6,aimFov:30},
      launcher:{id:'launcher',name:'M79 Launcher',rate:1,mag:1,reloadSeconds:2.2}}}
    for(const id of ['pistol','m4','shotgun','plasma','sniper','launcher'])w.player.ammo[id]={owned:true,mag:w.weaponCatalog.weapons[id].mag,reserve:60}
    for(const u of w.units)u.brain?.destroy?.();w.units.length=0;w.unitById.clear()
    for(let i=0;i<24;i++){
      const u=w.spawnUnit(['endo','heavy','scout'][i%3],{x:-12+(i%8)*2,y:0,z:-3-Math.floor(i/8)*2.6},{yaw:0})
      u.brain?.destroy?.();u.brain={tick(){}};u.intent.fire=false;u.vel.x=u.vel.z=0
    }
    window.pose=(ticks=1)=>{w.tick+=ticks;m.syncViews();viewer.setDirty()}
    window.select=id=>{w.player.activeWeapon=id;w.player.reloadTimer=0;w.player.aiming=false;window.pose(1);window.pose(40)}
    window.pose(1)
  })
  await page.waitForTimeout(750)
  const checks=await page.evaluate(()=>{
    const m=window.terminator.manager,w=m.world,v=m.playerView.weapons,result=[]
    const check=(name,ok)=>{if(!ok)throw Error(name);result.push(name)}
    for(const id of ['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher']){
      const r=v.rigs[id];check(id+' model',Boolean(r?.root&&r.right&&r.left))
      r.root.traverse(o=>{if(o.geometry)check(id+' mapped geometry',!!o.geometry.attributes.uv&&!!o.material.normalMap)})
    }
    window.select('sniper');w.player.aiming=true;window.pose(12);window.pose(12)
    check('core aimFov 30',Math.abs(m.playerView.camera.fov-30)<.01)
    check('scope visible while aimed',v.scope.visible)
    w.player.reloadTimer=2.6*.55;window.pose(12);check('scope hides on reload',!v.scope.visible)
    window.select('m4')
    const before=JSON.stringify({player:w.player,units:w.units.map(u=>({id:u.id,pos:u.pos,hp:u.hp})),projectiles:w.projectiles,events:w.eventLog,tick:w.tick})
    v.sync(w)
    check('view does not write core state',before===JSON.stringify({player:w.player,units:w.units.map(u=>({id:u.id,pos:u.pos,hp:u.hp})),projectiles:w.projectiles,events:w.eventLog,tick:w.tick}))
    return result
  })
  const capture=async name=>{
    await page.evaluate(()=>{window.viewer.setDirty();window.terminator.manager.playerView.weapons.beforeRender(window.terminator.manager.playerView.camera)})
    await page.waitForTimeout(250);await page.screenshot({path:`${out}/${name}.png`})
  }
  // Five sequential M4 shots through a sweep. The flight ages differ by two ticks.
  await page.evaluate(()=>{
    const w=window.terminator.manager.world
    window.select('m4')
    for(let i=0;i<5;i++){
      w.eventLog.push({type:'shot',tick:w.tick,by:w.player.id,playerId:w.player.id,weapon:'m4',
        origin:{x:-5,y:1.65,z:16},hitPoint:{x:-9+i*2,y:6+i*.4,z:-16},hit:false})
      window.pose(2)
    }
    window.pose(3)
  })
  await capture('01-m4-tracers')
  const tracerCount=await page.evaluate(()=>window.terminator.manager.playerView.weapons.tracers.pool.active)
  await page.evaluate(()=>{
    const w=window.terminator.manager.world;window.pose(120)
    w.projectiles=Array.from({length:9},(_,i)=>({id:'visual-bolt-'+i,type:i%3===0?'round':'bolt',owner:'unit',ownerId:'visual-enemy',
      pos:{x:-10+i*1.2,y:1.0+(i%3)*.4,z:-4+(i%3)*2.2},vel:{x:(5-i)*.7,y:0,z:18},born:w.tick/60}))
    window.pose(1)
    for(let tick=0;tick<20;tick++){
      for(const p of w.projectiles){p.pos.x+=p.vel.x/60;p.pos.z+=p.vel.z/60}
      window.pose(1)
    }
  })
  await capture('02-incoming-bolts')
  const projectileCount=await page.evaluate(()=>({...window.terminator.manager.playerView.weapons.projectiles.counts}))
  await page.evaluate(()=>{
    const w=window.terminator.manager.world;w.projectiles=[];window.select('sniper')
    w.eventLog.push({type:'reload',playerId:w.player.id,weapon:'sniper'})
    w.player.reloadTimer=2.6*.38;window.pose(1)
  })
  await capture('03-sniper-reload')
  const reload=await page.evaluate(()=>({...window.terminator.manager.playerView.weapons.animation.state}))
  await page.getByTestId('play').evaluate(b=>b.click())
  await page.waitForFunction(()=>!window.viewer.scene.getObjectByName('Player Runtime'),null,{timeout:15000})
  const cleanup=await page.evaluate(()=>!document.querySelector('[data-testid="sniper-scope"]')&&!document.querySelector('[data-testid="weapon-screen-fx"]'))
  const result={checks:checks.length,tracerCount,projectileCount,reload,cleanup,errors}
  await writeFile(`${out}/validation.json`,JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify(result))
  if(errors.length||!cleanup||tracerCount<3)throw Error('Visual validation failed')
} catch(e) {
  console.log(JSON.stringify({errors}));throw e
} finally {await browser.close()}
