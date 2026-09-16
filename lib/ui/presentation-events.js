// The world owns history. Cache only participant totals, never prune its log or
// change the absolute event cursors used by replication and other consumers.
const aggregates = new WeakMap()
const score = () => ({kills:0,damage:0,damageTaken:0,fired:0,hits:0})
const participant = () => ({kills:new Map(),waveScrap:new Map(),scrap:0,damage:0,fired:0,hits:0,score:score(),namedScore:score()})
const eventPlayer = (event, host) => event.playerId || (event.type==='shot'?event.by:['player_damage','kill'].includes(event.type)?host:null)

function discover(cache, start) {
  let added = false
  for (let i=start;i<cache.log.length;i++) {
    const event=cache.log[i]
    if(event.playerId && (event.type==='player_join' || event.type==='player_leave') && !cache.members.has(event.playerId)) {
      cache.members.set(event.playerId,event.name || 'Resistance Fighter')
      if(!cache.players.has(event.playerId)){cache.players.set(event.playerId,participant());added=true}
    }
    const id=eventPlayer(event,cache.host)
    if(id && event.playerName && !cache.named.has(id)) {
      cache.named.set(id,{name:event.playerName,index:i})
      if(!cache.players.has(id)){cache.players.set(id,participant());added=true}
    }
  }
  return added
}

function addScore(row,event,id) {
  if(event.type==='kill')row.kills++
  if(event.type==='unit_damage')row.damage+=event.amount || 0
  if(event.type==='player_damage')row.damageTaken+=event.amount || 0
  if(event.type==='shot' && event.by===id){row.fired++;if(event.hit)row.hits++}
}

function consume(cache,start,types) {
  for(let i=start;i<cache.log.length;i++) {
    const event=cache.log[i]
    // The newest mob call-out drives a timed HUD banner. Keeping it on the
    // delta walk costs no extra event reads.
    if(event.type==='mob_incoming')cache.mob={tick:event.tick,t:event.t,size:event.size,behind:Boolean(event.behind)}
    const id=eventPlayer(event,cache.host)
    const row=cache.players.get(id)
    if(row) {
      addScore(row.score,event,id)
      if(i>=cache.named.get(id)?.index)addScore(row.namedScore,event,id)
    }
    const player=cache.players.get(event.type==='shot'?event.by:event.playerId || cache.host)
    if(!player)continue
    if(event.type==='kill') {
      player.kills.set(event.unitType,(player.kills.get(event.unitType) || 0)+1)
      const scrap=types[event.unitType]?.scrap || 0
      player.scrap+=scrap
      // Map uses SameValueZero, whereas the original wave filter uses ===.
      if(!Number.isNaN(event.wave))player.waveScrap.set(event.wave,(player.waveScrap.get(event.wave) ?? 0)+scrap)
    }
    if(event.type==='player_damage')player.damage+=event.amount
    if(event.type==='shot'){player.fired++;if(event.hit)player.hits++}
  }
  cache.cursor=cache.log.length
  cache.tail=cache.log[cache.cursor-1]
}

export function presentationEvents(world) {
  const types=world.unitCatalog?.types || {}
  const prices=Object.entries(types).map(([id,type])=>[id,type?.scrap || 0])
  const roster=new Set([...world.players.values()].map(player=>player.id))
  if(world.player)roster.add(world.player.id)
  let cache=aggregates.get(world)
  // applySnapshot clones a replaced suffix, including our old boundary event.
  // This detects same-length and truncate/refill rewrites as well as shrinkage.
  // Retained prefixes must be immutable (World.emit/applySnapshot's contract).
  if(!cache || cache.log!==world.eventLog || cache.cursor>world.eventLog.length ||
    cache.tail!==world.eventLog[cache.cursor-1] || cache.host!==world.hostPlayerId ||
    cache.roster.size!==roster.size || [...roster].some(id=>!cache.roster.has(id)) ||
    cache.prices.length!==prices.length || prices.some(([id,value],i)=>id!==cache.prices[i][0] || !Object.is(value,cache.prices[i][1]))) {
    cache={log:world.eventLog,cursor:0,host:world.hostPlayerId,roster,prices,mob:null,members:new Map(),named:new Map(),players:new Map([...roster].map(id=>[id,participant()]))}
    aggregates.set(world,cache)
  }
  const added=discover(cache,cache.cursor)
  // A newly visible participant may have older unnamed combat. Recover it
  // once; do not retain counters for every unrelated enemy/unit ID forever.
  if(added && cache.cursor) {
    for(const id of cache.players.keys())cache.players.set(id,participant())
    consume(cache,0,types)
  } else consume(cache,cache.cursor,types)
  return cache
}
