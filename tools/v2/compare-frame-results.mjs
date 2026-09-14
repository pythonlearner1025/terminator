import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const paths=process.argv.slice(2,5),output=process.argv[5]
const raw=await Promise.all(paths.map(path=>readFile(path)))
const runs=raw.map(bytes=>JSON.parse(bytes))
const [baseline,before,after]=runs
for(const run of runs){
 assert.equal(run.views.length,7)
 assert.equal(run.browser,before.browser)
 assert.deepEqual(run.config,before.config)
 assert.deepEqual(run.launch,before.launch)
 assert.deepEqual(run.errors,[])
 for(const [i,view] of run.views.entries()){
  assert.equal(view.renderer,before.views[i].renderer)
  assert.equal(view.visibility,'visible');assert.equal(view.disjoint,false);assert.equal(view.timerExtension,true)
  assert.deepEqual(view.drawingBuffer,[1920,1080]);assert.equal(view.renderScale,before.views[i].renderScale)
  assert.equal(view.timings.gpu.count,i===6?180:i===5?360:150)
 }
}
assert.equal(before.profilerHash,after.profilerHash)
for(let i=0;i<6;i++){
 if(i<5)assert.deepEqual(before.views[i].camera,after.views[i].camera)
 assert.deepEqual(before.views[i].feet,after.views[i].feet)
 if(i<5)assert.deepEqual(before.views[i].draws,after.views[i].draws)
 assert.deepEqual(before.views[i].actors,after.views[i].actors)
 assert.deepEqual(before.views[i].simulationState,after.views[i].simulationState)
 assert.deepEqual(before.views[i].lights,after.views[i].lights)
 assert.deepEqual(before.views[i].plugins,after.views[i].plugins)
}
const changedSources=Object.keys(after.sourceFiles).filter(file=>before.sourceFiles[file]!==after.sourceFiles[file])
assert.deepEqual(changedSources.sort(),['lib/core/collision.js','lib/view/map-batching.js'])
const stats=values=>{const a=[...values].sort((a,b)=>a-b);return {min:a[0],max:a.at(-1),median:a[Math.floor(a.length*.5)]}}
const compact=run=>({git:run.git,override:run.beforeOverride,profilerHash:run.profilerHash,views:run.views.map(v=>({id:v.id,renderer:v.renderer,buffer:v.drawingBuffer,renderScale:v.renderScale,fps:v.fps,timings:Object.fromEntries(Object.entries(v.timings).map(([key,{samples,...s}])=>[key,s])),draws:stats(v.draws.map(d=>d.calls)),triangles:stats(v.draws.map(d=>d.triangles)),passes:stats(v.draws.map(d=>d.passes)),actors:stats(v.actors.map(a=>a.alive)),projectiles:stats(v.actors.map(a=>a.projectiles)),ticks:[v.actors[0].tick,v.actors.at(-1).tick]}))})
const summary={method:before.method,browser:before.browser,launch:before.launch,config:before.config,changedSources,patchHashes:Object.fromEntries(changedSources.map(file=>[file,{before:before.sourceFiles[file],after:after.sourceFiles[file]}])),exactFiveViewDrawAndCameraMatch:true,exactLockstepActorAndSimulationStateMatch:true,runs:{baseline:compact(baseline),before:compact(before),after:compact(after)},artifacts:paths.map((path,i)=>({path,sha256:createHash('sha256').update(raw[i]).digest('hex')}))}
await writeFile(output,JSON.stringify(summary,null,2)+'\n')
for(let i=0;i<7;i++)console.log(runs[0].views[i].id,runs.map(r=>({cpu:r.views[i].timings.cpuFrame.median,p95:r.views[i].timings.cpuFrame.p95,sim:r.views[i].timings.simulation.median,gpu:r.views[i].timings.gpu.median,fps:r.views[i].fps})))
