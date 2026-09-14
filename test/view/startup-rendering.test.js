import test from 'node:test'
import assert from 'node:assert/strict'
import {holdCoveredEditorRendering} from '../../lib/view/startup-rendering.js'
test('covered editor pauses before ready, restores on Stop/retry/destroy without touching Play viewer',()=>{
 let covered=false,callback,disconnects=0
 class Observer{constructor(fn){callback=fn}observe(node,options){assert.equal(options.childList,true)}disconnect(){disconnects++}}
 const container={querySelector(){return covered?{}:null}},viewer={canvas:{closest(){return container}},renderEnabled:true,setDirty(){}}
 const destroy=holdCoveredEditorRendering(viewer,Observer)
 assert.equal(viewer.renderEnabled,true)
 covered=true;callback();callback();assert.equal(viewer.renderEnabled,false)
 // Engine toggles rendering as it completes Play/Stop; overlay removal is authoritative.
 viewer.renderEnabled=false;covered=false;callback();assert.equal(viewer.renderEnabled,true)
 covered=true;callback();assert.equal(viewer.renderEnabled,false)
 destroy();destroy();assert.equal(disconnects,1);assert.equal(viewer.renderEnabled,true)
 const stopped={...viewer,renderEnabled:false};const stop=holdCoveredEditorRendering(stopped,Observer);covered=false;callback();stop();assert.equal(stopped.renderEnabled,false)
 const play={canvas:{classList:{contains(){return true}},closest(){throw Error('Must not observe runtime')}},renderEnabled:true}
 holdCoveredEditorRendering(play,Observer)();assert.equal(play.renderEnabled,true)
})
