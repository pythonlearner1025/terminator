// Read-only UI projections for fields absent from projectViewModel. Never mutate core state here.
export function presentationSnapshot(world, director) {
  const player=world.player
  const scheduled=director.spawnSchedule || []
  const remaining=world.aliveUnits.length+Math.max(0,scheduled.length-director.nextSpawn)
  const pos=world.map.trader.pos
  const kills=world.eventLog.filter(e=>e.type==='kill')
  const shots=world.eventLog.filter(e=>e.type==='shot' && e.by==='player')
  const damage=world.eventLog.filter(e=>e.type==='player_damage')
  const earned=items=>items.reduce((sum,e)=>sum+(world.unitCatalog.types[e.unitType]?.scrap || 0),0)
  const catalog=world.weaponCatalog.weapons
  const owned=world.weaponCatalog.slots.filter(id=>player.ammo[id]?.owned)
  return {
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
    stats:{survived:player.alive,wave:world.wave,kills:Object.fromEntries(['scout','endo','heavy'].map(type=>[type,kills.filter(e=>e.unitType===type).length])),accuracy:shots.length?Math.round(shots.filter(e=>e.hit).length/shots.length*100):0,damage:Math.round(damage.reduce((sum,e)=>sum+e.amount,0)),scrap:earned(kills),seconds:Math.floor(world.time)},
  }
}
export const SPRINT_MAX_SECONDS_PLACEHOLDER=6
export const DOSSIER_UNAVAILABLE_PLACEHOLDER=Object.freeze({markdown:'# No dossier received\n\nSkynet has not supplied a player analysis. Connect an agent to receive its observations after the match.',traits:[]})
export const LOBBY_UNAVAILABLE_PLACEHOLDER=Object.freeze({code:'------',status:'Lobby service unavailable',agentName:'',installLine:'Lobby code required before installing MCP.'})
