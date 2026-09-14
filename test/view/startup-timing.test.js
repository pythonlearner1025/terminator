import test from 'node:test'
import assert from 'node:assert/strict'
import {startupTiming} from '../../tools/v2/startup-timing.mjs'

// The observed Mac24 discrepancy: automation waits before dispatching Play.
const raw={editorAt:1540.6,actualEditorClickAt:5032.4,actualMenuClickAt:7200,actualLobbyClickAt:7300,at:13180.4}
test('actual click latency excludes only proven pre-event automation waiting, retaining the legacy total',()=>{
  const result=startupTiming('cold-editor',raw,7100)
  assert.equal(result.startTrigger,'editor DOM click')
  assert.equal(result.actualStartToReadyMs,8148)
  assert(Math.abs(result.automationBeforeStartMs-3491.8)<1e-9)
  assert(Math.abs(result.automationIntentToReadyMs-11639.8)<1e-9)
  assert.equal(result.actualMenuClickToReadyMs,raw.at-raw.actualMenuClickAt)
  assert.equal(result.actualLobbyClickToReadyMs,raw.at-raw.actualLobbyClickAt)
})
test('missing or unordered actual events cannot silently fall back to an intent timestamp',()=>{
  for(const change of [{actualEditorClickAt:undefined},{actualEditorClickAt:NaN},{actualEditorClickAt:14000},{actualMenuClickAt:5000},{actualLobbyClickAt:14000},{editorAt:6000}])assert.throws(()=>startupTiming('cold-editor',{...raw,...change},7100))
})
test('manager restart is explicitly labeled and retains all preparation before readiness',()=>{
  const result=startupTiming('restart',{...raw,editorAt:5032.4},7100)
  assert.equal(result.startTrigger,'manager.start()');assert.equal(result.automationBeforeStartMs,0)
  assert.equal(result.actualStartToReadyMs,result.automationIntentToReadyMs)
})
