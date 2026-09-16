import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {CLIPS} from './export-contract.mjs'
const dir=resolve(process.argv[2]||'.kite3d/revolver-imported-gameplay')
const r=JSON.parse(await readFile(`${dir}/proof.json`,'utf8'))
const frame=name=>r.captures.find(c=>c.name===name)
const stopped=r.ownership.filter(o=>o.label.startsWith('stop-'))
const playing=r.ownership.filter(o=>o.label.startsWith('play-'))
const results={completed:r.completed===true}
const skinMotion={}
const baseline=frame('01-hip')?.skin?.[0]?.samples||[]
for(const c of r.captures){
 const current=c.skin?.[0]?.samples||[]
 if(current.length===baseline.length&&current.length)skinMotion[c.name]=Math.max(...current.map((p,i)=>p[0]===baseline[i][0]?Math.hypot(...p.slice(1).map((v,j)=>v-baseline[i][j+1])):NaN))
}
if(r.mode==='check'){
 results.officialEditorCheck=r.check?.mode==='editor'
 for(const name of ['Playable','Editable','Persisted'])results[name]=r.check?.outcomes?.find(o=>o.name===name)?.status||'unavailable'
}else{
 Object.assign(results,{
 nineClips:r.captures.length>0&&r.captures.every(c=>c.clips.length===9&&CLIPS.every(n=>c.clips.includes(n))),
 activeVariant:r.captures.length>0&&r.captures.every(c=>c.activeVariant==='revolver-rebuild'),
 combinedImportedSkin:r.captures.length>0&&r.captures.every(c=>c.skin?.length===1&&c.skin[0].boneCount===49&&!c.skin[0].sourceSkeletonReused&&c.retiredGeometry?.length===0&&JSON.stringify(c.embeddedHandMeshes)===JSON.stringify(c.skin.map(s=>s.name))),
 hip:frame('01-hip')?.clip==='Idle',ads:frame('02-ads')?.clip==='AimIdle'&&frame('02-ads')?.aimAmount===1,
 fire:frame('03-fire')?.clip==='Fire'&&frame('03-fire')?.shots===1,
 sixShots:r.reloadStart?.authoredShots===6&&r.reloadStart?.ammo===0,
 nativeFireDeformation:skinMotion['03-fire']>1e-5,
 nativeReloadDeformation:skinMotion['05-reload-insert']>.01,
 sixCasesEjected:frame('06-reloaded')?.fx.emittedCases===6,
 freshHiddenBefore:frame('01-hip')?.cartridges?.Fresh.every(c=>c.scale.every(v=>v<.01))||false,
 freshPresentedAtInsertion:frame('05-reload-insert')?.cartridges?.Fresh.every(c=>c.scale.every(v=>v>.9))||false,
 reload:r.captures.filter(c=>c.name.startsWith('05-')).length>=5&&r.captures.filter(c=>c.name.startsWith('05-')).every(c=>c.clip==='Reload'&&Math.abs(c.actualReloadFraction-c.requestedReloadFraction)<=c.phaseTolerance),
 reloaded:frame('06-reloaded')?.ammo.mag===6&&frame('06-reloaded')?.reloadTimer===0,
 sprint:frame('07-sprint')?.clip==='Sprint',inspectRendered:frame('08-inspect')?.clip==='Inspect',
 stoppedCleanup:stopped.length===2&&stopped.every(o=>!o.running&&!o.started&&o.cleanup.ok&&o.cleanup.trackedObjectCount===0&&o.hud===0),
 stableRestartOwnership:playing.length===2&&JSON.stringify(playing[0].byOwner)===JSON.stringify(playing[1].byOwner),
 stableStoppedScene:stopped.length===2&&stopped[0].sceneNodes===stopped[1].sceneNodes&&stopped[0].authoredNodes===stopped[1].authoredNodes,
 stableStoppedCamera:stopped.length===2&&JSON.stringify(stopped[0].camera)===JSON.stringify(stopped[1].camera),
 restartedHip:frame('09-restarted-hip')?.clip==='Idle',
 })
}
const summary={sourceRevision:r.sourceRevision,freezeManifestSha256:r.freezeManifestSha256,exportHashes:r.exportHashes,results,skinMotionFromHipM:skinMotion,handFraming:Object.fromEntries(r.captures.map(c=>[c.name,c.bounds?.DJMaesenArms])),ads:frame('02-ads')?.sights,check:r.check?.outcomes||'Not available in this run',errors:r.errors,httpErrors:r.httpErrors,resources:r.resources,failure:r.failure,limitations:r.limitations}
await writeFile(`${dir}/summary.json`,JSON.stringify(summary,null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
