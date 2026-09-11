// Read-only UI projections for fields absent from projectViewModel. Never mutate core state here.
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
    nextBudget:world.phase==='intermission'?director.getState?.().budget:null,
    nextMultiplier:world.phase==='intermission'?director.getState?.().multiplier:null,
    matchStarted:director.phase!=='lobby',
    waveTotal:scheduled.length,
    remaining,
    nameplateHeights:Object.fromEntries(world.aliveUnits.map(unit=>[unit.id,world.unitCatalog.types[unit.type].height+.35])),
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
    stats:{survived:player.alive,wave:world.wave,kills:Object.fromEntries(['scout','endo','heavy'].map(type=>[type,kills.filter(e=>e.unitType===type).length])),accuracy:shots.length?Math.round(shots.filter(e=>e.hit).length/shots.length*100):0,damage:Math.round(damage.reduce((sum,e)=>sum+e.amount,0)),scrap:earned(kills),seconds:Math.floor(world.time)},
  }
}

// Match-wide event history survives the telemetry reset between waves. Damage is
// damage dealt, and scrap is each player's final balance (including purchases).
export function scoreboardSnapshot(world) {
  const rows=new Map([...world.players.values()].map(player=>[player.id,{id:player.id,name:player.name,kills:0,damage:0,fired:0,hits:0,scrap:player.scrap,connected:player.connected!==false}]))
  for(const event of world.eventLog){
    if(!event.playerId || rows.has(event.playerId) || !['player_join','player_leave'].includes(event.type))continue
    rows.set(event.playerId,{id:event.playerId,name:event.name || 'Resistance Fighter',kills:0,damage:0,fired:0,hits:0,scrap:null,connected:false})
  }
  for(const event of world.eventLog){
    const id=event.playerId || (event.type==='shot'?event.by:null)
    let row=rows.get(id)
    if(!row && id && event.playerName){row={id,name:event.playerName,kills:0,damage:0,fired:0,hits:0,scrap:null,connected:false};rows.set(id,row)}
    if(!row)continue
    if(event.type==='kill')row.kills++
    if(event.type==='unit_damage')row.damage+=event.amount || 0
    if(event.type==='shot' && event.by===id){row.fired++;if(event.hit)row.hits++}
  }
  return [...rows.values()].map(row=>({...row,damage:Math.round(row.damage),accuracy:row.fired?Math.round(row.hits/row.fired*100):0}))
}
export const SPRINT_MAX_SECONDS_PLACEHOLDER=6
export const DOSSIER_UNAVAILABLE_PLACEHOLDER=Object.freeze({markdown:'# No dossier received\n\nSkynet has not supplied a player analysis. Connect an agent to receive its observations after the match.',traits:[]})
export const LOBBY_UNAVAILABLE_PLACEHOLDER=Object.freeze({code:'------',status:'Lobby service unavailable',agentName:'',installLine:'Lobby code required before installing MCP.'})
