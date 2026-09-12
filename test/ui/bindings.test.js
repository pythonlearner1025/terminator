import test from 'node:test'
import assert from 'node:assert/strict'
import {ACTIONS,DEFAULT_BINDINGS,rebind,normalizeBindings,BindingInput} from '../../lib/ui/bindings.js'
import {normalizeSettings} from '../../lib/ui/settings.js'

test('bindings survive settings normalization and swap collisions only in overlapping contexts', () => {
  const changed=rebind(DEFAULT_BINDINGS,'forward','KeyS')
  assert.equal(changed.backward,'KeyW')
  assert.deepEqual(normalizeSettings({bindings:changed}).bindings,changed)
  assert.equal(changed.reload,'KeyR')
  assert.equal(changed.ready,'KeyR','reload and ready intentionally share a contextual key')
  assert.equal(DEFAULT_BINDINGS.slot5,'Digit5');assert.equal(DEFAULT_BINDINGS.slot6,'Digit6')
  for(const [action] of ACTIONS){
    const mapped=rebind(DEFAULT_BINDINGS,action,'KeyP')
    assert.equal(normalizeBindings(mapped)[action],'KeyP',action)
  }
  assert.equal(normalizeSettings(null).controlsSeen,false)
  assert.equal(normalizeSettings({bindings:{fire:'<script>'}}).bindings.fire,'Mouse0')
})

test('physical inputs produce remapped movement, one-shot actions and held mouse aim', () => {
  const previousWindow=globalThis.window
  globalThis.window=new EventTarget()
  const canvas=new EventTarget()
  let lockRequests=0
  const input={viewer:{canvas},keys:new Set(),yaw:0,pitch:0,sample:()=>({fire:true,reload:true,switchTo:'next'}),requestLock:()=>lockRequests++}
  const bindings={...DEFAULT_BINDINGS,forward:'KeyI',fire:'KeyF',aim:'Mouse1',reload:'KeyL',jump:'Space'}
  const adapter=new BindingInput(input,bindings)
  const dispatch=(target,type,props)=>{const event=new Event(type,{cancelable:true});Object.assign(event,props);target.dispatchEvent(event)}
  try{
    adapter.setActive(true)
    dispatch(window,'keydown',{code:'KeyW'})
    assert.equal(adapter.sample().move.z,0,'old binding is inactive')
    dispatch(window,'keydown',{code:'KeyI'})
    dispatch(window,'keydown',{code:'KeyL'})
    dispatch(window,'keydown',{code:'Space'})
    dispatch(canvas,'mousedown',{button:1})
    let sampled=adapter.sample()
    assert.equal(lockRequests,1,'rebound mouse aim can still request pointer lock')
    assert.equal(sampled.move.z,1);assert.equal(sampled.reload,true);assert.equal(sampled.jump,true);assert.equal(sampled.aim,true);assert.equal(sampled.fire,false)
    assert.equal(sampled.switchTo,'next')
    assert.equal(adapter.sample().reload,false);assert.equal(adapter.sample().jump,false)
    dispatch(window,'keydown',{code:'KeyL',repeat:true})
    assert.equal(adapter.sample().reload,false)
    dispatch(window,'blur',{})
    assert.equal(adapter.sample().aim,false)
    adapter.setActive(false)
    dispatch(window,'keydown',{code:'KeyI'})
    assert.equal(adapter.sample().move.z,0)
  }finally{adapter.dispose();globalThis.window=previousWindow}
})
