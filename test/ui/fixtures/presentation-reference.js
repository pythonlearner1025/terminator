// Frozen full-history oracle from c51bc46:lib/ui/presentation.js.
// Keep independent of the incremental implementation, including its two-pass
// row discovery, amount fallbacks, strict filters and event-order reductions.
export function presentationSnapshot(world, director, playerId=world.hostPlayerId) {
  const player=world.getPlayer(playerId) || world.player
  const scheduled=director.spawnSchedule || []
  const remaining=world.aliveUnits.length+Math.max(0,scheduled.length-director.nextSpawn)
  const pos=world.map.trader.pos
  const kills=world.eventLog.filter(e=>e.type==='kill' && (e.playerId || world.hostPlayerId)===player.id)
  const shots=world.eventLog.filter(e=>e.type==='shot' && e.by===player.id)
  const damage=world.eventLog.filter(e=>e.type==='player_damage' && (e.playerId || world.hostPlayerId)===player.id)
  const earned=items=>items.reduce((sum,e)=>sum+(world.unitCatalog.types[e.unitType]?.scrap || 0),0)
  const catalog=world.weaponCatalog.weapons
  const owned=world.weaponCatalog.slots.filter(id=>player.ammo[id]?.owned)
  return {
    difficulty:world.scaling?.difficulty || (world.phase==='lobby'?director.difficulty:'normal') || 'normal',
    nextBudget:world.phase==='intermission'?director.getState?.().budget:null,
    nextMultiplier:world.phase==='intermission'?director.getState?.().multiplier:null,
    matchStarted:director.phase!=='lobby',
    waveTotal:scheduled.length,
    remaining,
    waveScrap:earned(kills.filter(e=>e.wave===world.wave)),
    // No stamina maximum is exported by the core. The bar uses a named display placeholder.
    staminaRatio:Math.min(1,player.sprintStamina/SPRINT_MAX_SECONDS_PLACEHOLDER),
    trader:{pos,distance:Math.hypot(pos.x-player.pos.x,pos.z-player.pos.z),bearing:Math.atan2(pos.x-player.pos.x,pos.z-player.pos.z)-player.yaw},
    catalog,
    loadout:owned.map(id=>({...catalog[id],...player.ammo[id]})),
    armor:player.armor,
    grenades:player.grenades,
    mapName:world.map.name || 'Bunker 7',
    localPlayerId:player.id,
    scoreboard:world.phase==='ended'?scoreboardSnapshot(world):[],
    scoreboardPartial:Boolean(world.localPlayerId && world.snapshotEventCursor>world.eventLog.length),
    stats:{survived:player.alive,wave:world.wave,kills:Object.fromEntries(Object.keys(world.unitCatalog.types).map(type=>[type,kills.filter(e=>e.unitType===type).length])),accuracy:shots.length?Math.round(shots.filter(e=>e.hit).length/shots.length*100):0,damage:Math.round(damage.reduce((sum,e)=>sum+e.amount,0)),scrap:earned(kills),seconds:Math.floor(world.time)},
  }
}

// Match-wide event history survives telemetry resets. Keep damage dealt for
// existing consumers; the terse results use damageTaken. Scrap is final balance.
export function scoreboardSnapshot(world) {
  const rows=new Map([...world.players.values()].map(player=>[player.id,{id:player.id,name:player.name,kills:0,damage:0,damageTaken:0,fired:0,hits:0,scrap:player.scrap,connected:player.connected!==false}]))
  for(const event of world.eventLog){
    if(!event.playerId || rows.has(event.playerId) || !['player_join','player_leave'].includes(event.type))continue
    rows.set(event.playerId,{id:event.playerId,name:event.name || 'Resistance Fighter',kills:0,damage:0,damageTaken:0,fired:0,hits:0,scrap:null,connected:false})
  }
  for(const event of world.eventLog){
    const id=event.playerId || (event.type==='shot'?event.by:['player_damage','kill'].includes(event.type)?world.hostPlayerId:null)
    let row=rows.get(id)
    if(!row && id && event.playerName){row={id,name:event.playerName,kills:0,damage:0,damageTaken:0,fired:0,hits:0,scrap:null,connected:false};rows.set(id,row)}
    if(!row)continue
    if(event.type==='kill')row.kills++
    if(event.type==='unit_damage')row.damage+=event.amount || 0
    if(event.type==='player_damage')row.damageTaken+=event.amount || 0
    if(event.type==='shot' && event.by===id){row.fired++;if(event.hit)row.hits++}
  }
  return [...rows.values()].map(row=>({...row,damage:Math.round(row.damage),damageTaken:Math.round(row.damageTaken),accuracy:row.fired?Math.round(row.hits/row.fired*100):0}))
}
export const SPRINT_MAX_SECONDS_PLACEHOLDER=6
export const LOBBY_UNAVAILABLE_PLACEHOLDER=Object.freeze({code:'------',status:'Lobby service unavailable',agentName:'',installLine:'Lobby code required before installing MCP.'})
