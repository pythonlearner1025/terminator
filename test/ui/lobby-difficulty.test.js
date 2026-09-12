import test from 'node:test'
import assert from 'node:assert/strict'
import {bindLobbyDifficulty} from '../../lib/ui/lobby-difficulty.js'

test('lobby forwards authoritative budgets before resolving its first plan', async()=>{
  const calls=[]
  const director={phase:'lobby',world:{scaling:{difficulty:'hard'}},getState:()=>({budget:525})}
  const post=async(route,body)=>{calls.push([route,body])}
  const fetchPlan=async(wave,force)=>{calls.push(['plan',{wave,force}])}
  const lobby={baseUrl:'http://local',active:true,post,fetchPlan}
  const bridge=bindLobbyDifficulty(lobby,director)
  await lobby.fetchPlan(1,false)
  assert.deepEqual(calls,[],'no stale default plan during selection')
  await bridge.prepare()
  assert.equal(calls[0][0],'/game/phase')
  assert.equal(calls[0][1].budget,525)
  assert.deepEqual(calls[1],['plan',{wave:1,force:true}])
  director.phase='intermission'
  await lobby.post('/game/wave_summary',{budget:420,summary:{}},true)
  assert.equal(calls.at(-1)[1].budget,525)
  assert.deepEqual(calls.at(-1)[1].summary.scaling,{difficulty:'hard'})
  bridge.dispose()
  assert.equal(lobby.post,post);assert.equal(lobby.fetchPlan,fetchPlan)
})
