import assert from 'node:assert/strict'
import test from 'node:test'
import {World} from '../../../lib/core/world.js'
import {WaveDirector, buildRulesPayload, difficultyScaling, scaledWaveBudget} from '../../../lib/core/waves.js'
import {DIFFICULTIES, getDifficulty} from '../../../lib/core/data/difficulty.js'

const config = {spawns:[{t:0,gate:'N1',unit:'endo',count:1}],knobs:{gates:['N1']}}

test('difficulty budgets and unit health combine with each co-op tier', () => {
  const values = {normal:[1,1],hard:[1.25,1.15],suicidal:[1.5,1.35],hell:[1.8,1.6]}
  for (const [id,[budget,hp]] of Object.entries(values)) {
    assert.equal(DIFFICULTIES[id].budgetMultiplier,budget)
    assert.equal(DIFFICULTIES[id].unitHealthMultiplier,hp)
    for (let players=1;players<=3;players++) {
      const world=new World({seed:2029})
      for (let i=1;i<players;i++) world.addPlayer({id:`guest${i}`})
      const director=new WaveDirector(world,{difficulty:id})
      const base=difficultyScaling(players)
      assert.equal(director.start(config).ok,true)
      director.spawnDueUnits()
      assert.equal(world.waveBudget,Math.round(420*base.budgetMultiplier*budget))
      assert.equal(world.aliveUnits[0].maxHp,Math.round(300*base.unitHealthMultiplier*hp*10000)/10000)
      assert.equal(world.maxAlive,base.maxAlive,'difficulty does not change simultaneous unit cap')
      const guest=new World()
      guest.applySnapshot(world.snapshot())
      assert.equal(getDifficulty(guest.scaling.difficulty).id,id,'difficulty survives guest snapshots')
      assert.equal(buildRulesPayload({playerCount:players,difficulty:id}).scaling.unitHealthMultiplier,world.scaling.unitHealthMultiplier)
      world.destroy();guest.destroy()
    }
  }
})

test('selection is validated, lobby-only, and invalidates queued plans on change', () => {
  const world=new World()
  const director=new WaveDirector(world)
  assert.equal(director.submitConfig(config).ok,true)
  assert.equal(director.setDifficulty('hard'),true)
  assert.equal(director.pendingSubmission,null)
  assert.equal(director.getState().budget,525)
  assert.equal(director.setDifficulty('__proto__'),false)
  assert.equal(director.difficulty,'hard')
  director.start(config)
  assert.equal(director.setDifficulty('hell'),false)
  assert.equal(director.difficulty,'hard')
  assert.equal(getDifficulty('unknown').id,'normal')
  assert.equal(scaledWaveBudget(1).applied,420)
  world.destroy()
})

test('each difficulty retains deterministic core replay', () => {
  for (const difficulty of Object.keys(DIFFICULTIES)) {
    const run=()=>{
      const world=new World({seed:44})
      const director=new WaveDirector(world,{difficulty,now:()=>0})
      director.start(config)
      for(let i=0;i<120;i++)director.step({move:{x:0,z:1},yaw:0,pitch:0})
      const snapshot=world.snapshot();world.destroy();return snapshot
    }
    assert.deepEqual(run(),run())
  }
})
