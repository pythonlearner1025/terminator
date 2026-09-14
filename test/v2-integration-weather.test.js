import test from 'node:test'
import assert from 'node:assert/strict'
globalThis.ImageData??=class{}
globalThis.window??={location:{href:'http://localhost/'}}
const {mountV2WeatherBalance}=await import('../lib/view/map.js')
test('weather presentation remains repeatable, preserves settings and restores runtime values',()=>{
 const rain={opacity:.19},dust={opacity:.32},uniform={value:.065},settings={rain:.72,rainCount:1300,wind:[1.7,.45],particleDensity:1}
 const snapshot=structuredClone(settings),weather={settings,rain:{material:rain},root:{getObjectByName(){return {material:dust}}},shafts:[{beam:{material:{uniforms:{opacity:uniform}}}}]}
 const handle=mountV2WeatherBalance({weather});handle.sync();const weighted=[rain.opacity,dust.opacity,uniform.value]
 for(let i=0;i<50;i++)handle.sync()
 assert.deepEqual([rain.opacity,dust.opacity,uniform.value],weighted);assert.deepEqual(settings,snapshot)
 assert.ok(rain.opacity>0&&rain.opacity<.19);assert.ok(uniform.value>0&&uniform.value<.065)
 settings.rain=0;handle.sync();assert.equal(rain.opacity,0);settings.rain=.72
 handle.dispose();handle.dispose();handle.sync();assert.deepEqual([rain.opacity,dust.opacity,uniform.value],[.19,.32,.065]);assert.deepEqual(settings,snapshot)
})
