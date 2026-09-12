// Forward the director's chosen budget through the existing lobby API. The UI
// never recalculates it. Delay first-wave planning until the lobby choice is final.
export function bindLobbyDifficulty(lobby, director) {
  const originalPost = lobby.post
  const originalFetchPlan = lobby.fetchPlan
  let preparing = false
  let lastBudget = null
  let pending = Promise.resolve()
  lobby.post = function(route, body, wait) {
    if (route === '/game/wave_summary') body = {...body, budget:director.getState().budget,
      summary:{...body.summary,scaling:structuredClone(director.world.scaling)}}
    return originalPost.call(this,route,body,wait)
  }
  lobby.fetchPlan = function(wave, force) {
    if (director.phase === 'lobby' && !preparing) return Promise.resolve()
    return originalFetchPlan.call(this,wave,force)
  }
  const sync = () => {
    if (!lobby.baseUrl || !lobby.active || director.phase !== 'lobby') return pending
    const budget = director.getState().budget
    if (lastBudget === budget) return pending
    lastBudget = budget
    pending = pending.catch(()=>{}).then(()=>originalPost.call(lobby,'/game/phase',{
      phase:'lobby', wave:0, budget, t:0,
    },true)).catch(error=>{lastBudget=null;throw error})
    return pending
  }
  return {
    sync,
    async prepare() {
      if (!lobby.baseUrl) return
      await sync()
      preparing = true
      try {await lobby.fetchPlan(1,true)} finally {preparing = false}
    },
    dispose() {lobby.post=originalPost;lobby.fetchPlan=originalFetchPlan},
  }
}
