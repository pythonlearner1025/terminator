import {presentationEvents} from './presentation-events.js'

// Read-only UI projections for fields absent from projectViewModel. Never mutate core state here.
export function presentationSnapshot(world, director, playerId=world.hostPlayerId) {
  const player=world.getPlayer(playerId) || world.player
  const scheduled=director.spawnSchedule || []
  const remaining=world.aliveUnits.length+Math.max(0,scheduled.length-director.nextSpawn)
  const pos=world.map.trader.pos
  const events=presentationEvents(world)
  const totals=events.players.get(player.id)
  const catalog=world.weaponCatalog.weapons
  const owned=world.weaponCatalog.slots.filter(id=>player.ammo[id]?.owned)
  return {
    difficulty:world.scaling?.difficulty || (world.phase==='lobby'?director.difficulty:'normal') || 'normal',
    nextBudget:world.phase==='intermission'?director.getState?.().budget:null,
    nextMultiplier:world.phase==='intermission'?director.getState?.().multiplier:null,
    matchStarted:director.phase!=='lobby',
    waveTotal:scheduled.length,
    remaining,
    remainingLabel:remainingLabel(world,remaining),
    waveScrap:totals.waveScrap.get(world.wave) ?? 0,
    // No stamina maximum is exported by the core. The bar uses a named display placeholder.
    staminaRatio:Math.min(1,player.sprintStamina/SPRINT_MAX_SECONDS_PLACEHOLDER),
    trader:{pos,distance:Math.hypot(pos.x-player.pos.x,pos.z-player.pos.z),bearing:Math.atan2(pos.x-player.pos.x,pos.z-player.pos.z)-player.yaw},
    catalog,
    loadout:owned.map(id=>({...catalog[id],...player.ammo[id]})),
    armor:player.armor,
    grenades:player.grenades,
    mapName:world.map.name || 'Bunker 7',
    localPlayerId:player.id,
    director:directorExtra(world),
    mobIncoming:mobBanner(events.mob,world),
    caches:cacheMarkers(world,player),
    scoreboard:world.phase==='ended'?scoreboardRows(world,events):[],
    scoreboardPartial:Boolean(world.localPlayerId && world.snapshotEventCursor>world.eventLog.length),
    stats:{survived:player.alive,wave:world.wave,kills:Object.fromEntries(Object.keys(world.unitCatalog.types).map(type=>[type,totals.kills.get(type) || 0])),accuracy:totals.fired?Math.round(totals.hits/totals.fired*100):0,damage:Math.round(totals.damage),scrap:totals.scrap,seconds:Math.floor(world.time)},
  }
}

// The pacer's four states, shortened for the Skynet panel.
export const DIRECTOR_STATE_WORDS=Object.freeze({build_up:'BUILD',sustain_peak:'PEAK',peak_fade:'FADE',relax:'RELAX'})
export const MOB_BANNER_SECONDS=2
export const CACHE_MARKER_METERS=30

// The trader is open during relax and during intermission. The director owns the
// flag; a world without one keeps the intermission-only rule.
export function traderOpenInView(view) {
  if(view?.wave?.phase==='intermission')return true
  return Boolean(view?.director?.traderOpen ?? view?.wave?.traderOpen)
}
// A wave is only countable once the pacer stops buying. While the reservoir
// holds budget, more units are still coming, so the panel reports what lives
// now. Without a director the legacy schedule is the whole wave, so it counts.
export function remainingLabel(world,remaining) {
  const reservoir=world.director?world.director.reservoir ?? 0:0
  if(reservoir>0)return `${world.aliveUnits.length} ALIVE`
  return `${remaining} LEFT`
}
function directorExtra(world) {
  const director=world.director
  if(!director)return null
  return {state:director.state || null,word:DIRECTOR_STATE_WORDS[director.state] || '',intensity:director.intensity ?? 0,
    reservoir:Math.max(0,Math.round(director.reservoir ?? 0)),reservoirMax:Math.max(0,Math.round(director.reservoirMax ?? 0)),
    traderOpen:Boolean(director.traderOpen ?? world.traderOpen)}
}
// The banner lives two seconds from the call-out. Event time keeps it in step
// with a replay or a paused clock.
function mobBanner(mob,world) {
  if(!mob)return null
  const now=Number(world.time) || 0
  const at=Number.isFinite(mob.t)?mob.t:now
  if(now-at>MOB_BANNER_SECONDS)return null
  return {id:mob.tick ?? at,size:mob.size ?? 0,behind:mob.behind,until:at+MOB_BANNER_SECONDS}
}
function cacheMarkers(world,player) {
  const active=world.pickups?.active
  if(!active?.length)return []
  return active.map(cache=>({id:cache.id,kind:cache.kind,pos:cache.pos,
    distance:Math.hypot(cache.pos.x-player.pos.x,cache.pos.z-player.pos.z)}))
    .filter(cache=>cache.distance<=CACHE_MARKER_METERS)
}

// Match-wide event history survives telemetry resets. Keep damage dealt for
// existing consumers; the terse results use damageTaken. Scrap is final balance.
export function scoreboardSnapshot(world) {
  return scoreboardRows(world,presentationEvents(world))
}
function scoreboardRows(world,events) {
  const rows=new Map([...world.players.values()].map(player=>[player.id,{id:player.id,name:player.name,scrap:player.scrap,connected:player.connected!==false}]))
  for(const [id,name] of events.members)if(!rows.has(id))rows.set(id,{id,name,scrap:null,connected:false})
  const fullHistory=new Set(rows.keys())
  for(const [id,{name}] of events.named)if(!rows.has(id))rows.set(id,{id,name,scrap:null,connected:false})
  return [...rows.values()].map(row=>{
    const totals=events.players.get(row.id)[fullHistory.has(row.id)?'score':'namedScore']
    return {id:row.id,name:row.name,...totals,scrap:row.scrap,connected:row.connected,damage:Math.round(totals.damage),damageTaken:Math.round(totals.damageTaken),accuracy:totals.fired?Math.round(totals.hits/totals.fired*100):0}
  })
}
export const SPRINT_MAX_SECONDS_PLACEHOLDER=6
export const LOBBY_UNAVAILABLE_PLACEHOLDER=Object.freeze({code:'------',status:'Lobby service unavailable',agentName:'',installLine:'Lobby code required before installing MCP.'})
