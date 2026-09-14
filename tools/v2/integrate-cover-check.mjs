import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {dirname} from 'node:path'
import rules from '../../lib/core/data/map.json' with {type:'json'}
import registry from '../../lib/core/data/map-piece-registry.json' with {type:'json'}
import placements from '../../lib/core/data/map-piece-placements.json' with {type:'json'}
import config from '../../docs/scene-targets/views.json' with {type:'json'}
import {buildMapFromPlacements} from '../../lib/core/map.js'
import {buildV2PlayableMap} from '../../lib/core/v2-map.js'
import {World} from '../../lib/core/world.js'
import {colliderPrimitives,colliderSurfacesAt} from '../../lib/core/collision.js'

const output=process.argv[2]||'docs/evidence/v2-cover17-checks/collision.json'
await readFile(output).then(()=>{throw Error('Refusing to overwrite cover evidence')},e=>{if(e.code!=='ENOENT')throw e})
const baseline=buildMapFromPlacements(rules,registry,placements.pieces)
const candidate=buildV2PlayableMap(rules,registry,placements.pieces)
const covers=candidate.colliders.filter(c=>c.v2ArchitectureCover)
assert.equal(covers.length,7);assert.equal(covers.reduce((n,c)=>n+c.shapes.length,0),595)
assert.deepEqual({...candidate,colliders:candidate.colliders.filter(c=>!c.v2ArchitectureCover)},baseline)
const timedWorld=map=>{const t=performance.now();const world=new World({map,seed:2029});return {world,constructionMs:performance.now()-t}}
const before=timedWorld(baseline),after=timedWorld(candidate)
const report={git:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),covers,originalCollidersUnchanged:true,constructionMs:{before:before.constructionMs,after:after.constructionMs},supports:[],walks:[],routes:[],navDelta:[],sight:[],timings:{},limitations:['Single serial Node construction timings include JIT variation. Query/empty-world timings are not full-wave FPS. Compound boxes conservatively fill native scan undercuts.']}
for(const v of config.views){
 const p={x:v.feet[0],y:v.feet[1],z:v.feet[2]}
 const a=after.world.playerSupportAt(p,p.y,{radius:.38}),b=before.world.playerSupportAt(p,p.y,{radius:.38})
 assert(a);assert.deepEqual(a,b);assert(after.world.playerHasHeadClearance(p,1.8,a));assert.equal(after.world.positionBlocked(p,.38,1.8),false)
 report.supports.push({id:v.id,unchanged:true})
}
for(let i=0;i<before.world.nav.nodes.length;i++)if(!before.world.nav.blocked[i]&&after.world.nav.blocked[i]){
 const p=before.world.nav.nodePoint(before.world.nav.nodes[i]);assert(covers.some(c=>colliderSurfacesAt(p,c,baseline.navGrid.agentRadius).length));report.navDelta.push(p)
}
assert(report.navDelta.length>0)
const routes=[[[36,0,5.5],[36,0,15]],[[28,0,12],[36,0,12]],[[36,0,15],[32,6.4,6]],[[-36,0,-23],[-35.9,-3.5,12]],[[-35.9,-3.5,-12.5],[-36,0,23]]]
for(const [a,b] of routes){const point=p=>({x:p[0],y:p[1],z:p[2]});assert(before.world.nav.findPath(point(a),point(b)));assert(after.world.nav.findPath(point(a),point(b)));report.routes.push({from:a,to:b,pass:true})}
// Evaluate actual World sight queries against only the declared cover, so an
// original wall behind a pile cannot hide a failed new collision contract.
const coverOnly=new World({map:{...baseline,colliders:covers,trader:null},seed:2029})
for(const c of covers){
 const part=colliderPrimitives(c).sort((a,b)=>b.size.y-a.size.y)[0]
 const from={x:part.center.x-2,y:part.center.y,z:part.center.z},to={...from,x:part.center.x+2}
 assert.equal(coverOnly.lineOfSight(from,to),false)
 const high=c.v2Pile.y+c.size.y+.05
 assert.equal(coverOnly.lineOfSight({...from,y:high},{...to,y:high}),true)
 assert(after.world.positionBlocked({x:part.center.x,y:c.v2Pile.y,z:part.center.z},.05,1.8))
 report.sight.push({id:c.id,lowBlocked:true,aboveClear:true})
}
const stats=a=>{a.sort((x,y)=>x-y);return {samples:a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]}}
for(const [name,{world}] of [['before',before],['after',after]]){
 const ticks=[],queries=[]
 for(const v of config.views.filter(v=>['03-barracks','04-service'].includes(v.id))){
  const p=world.player;p.pos={x:v.feet[0],y:v.feet[1],z:v.feet[2]};p.vel={x:0,y:0,z:0};p.grounded=true
  const yaw=Math.atan2(v.lookAt[0]-p.pos.x,v.lookAt[2]-p.pos.z)
  for(let i=0;i<90;i++){const t=performance.now();world.step({move:{x:0,z:1},yaw});ticks.push(performance.now()-t)}
  const distance=Math.hypot(p.pos.x-v.feet[0],p.pos.z-v.feet[2]);assert(distance>5,`${name} walk ${v.id} blocked`)
  report.walks.push({map:name,id:v.id,distance,end:{...p.pos}})
 }
 // Fixed repeated low/high rays through all seven cover regions.
 for(let i=0;i<420;i++){
  const c=covers[i%covers.length],y=c.v2Pile.y+(i%2?.5:1.65),a={x:c.center.x-2,y,z:c.center.z},b={...a,x:c.center.x+2}
  const t=performance.now();world.lineOfSight(a,b);if(i>=70)queries.push(performance.now()-t)
 }
 report.timings[name]={worldStepEmpty:stats(ticks.slice(30)),lineOfSight:stats(queries)}
}
report.pass=true
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({pass:true,coverRecords:covers.length,compoundBoxes:595,newBlockedNavNodes:report.navDelta.length,walks:report.walks,timings:report.timings}))
