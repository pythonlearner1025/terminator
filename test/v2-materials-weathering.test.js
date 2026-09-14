import test from 'node:test'
import assert from 'node:assert/strict'
import {sampleV2Ash} from '../lib/view/v2/materials-weathering.js'

test('R3 ash is rare, subordinate and absent from walls and ceilings',()=>{
 let visible=0, sum=0, count=0
 for(let x=-30;x<30;x+=.3)for(let z=-30;z<30;z+=.3){
  const p=[x,.01,z],ash=sampleV2Ash(p)
  assert.ok(ash>=0&&ash<=1)
  assert.equal(sampleV2Ash(p,[0,-1,0]),0)
  assert.equal(sampleV2Ash(p,[1,0,0]),0)
  visible+=ash>.05;sum+=ash;count++
 }
 assert.ok(visible/count<.06)
 assert.ok(sum/count<.01)
})
