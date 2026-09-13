#!/usr/bin/env node
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

const args=process.argv.slice(2)
const value=(name,fallback='')=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)??fallback
const phase=value('phase')
const output=value('output',`/Users/minjunes/games/terminator-evidence/docs/evidence/perf3/${phase}.json`)
const files=args.filter(arg=>!arg.startsWith('--'))
if(!phase||!files.length)throw new Error('Usage: summarize-perf3 --phase=before [--output=path] run.json ...')

const round=value=>Number.isFinite(value)?Number(value.toFixed(3)):null
const median=values=>{
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b)
  if(!sorted.length)return null
  const middle=Math.floor(sorted.length/2)
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2
}
const fixtureOf=run=>run.enemyCount===36?'standard36':run.roster==='wave5'?'wave5Boss24':run.weaponBurst?'weaponBurst24':run.gore?.stress?'goreStress24':'standard24'
const fixtureOrder=['standard24','weaponBurst24','goreStress24','wave5Boss24','standard36']
const fixtureNames={standard24:'Standard 24',weaponBurst24:'Weapon burst 24',goreStress24:'Gore stress 24',wave5Boss24:'Wave 5 boss mix 24',standard36:'Standard 36'}
const runs=await Promise.all(files.map(async file=>({file,run:JSON.parse(await readFile(file,'utf8'))})))
const groups=Object.fromEntries(fixtureOrder.map(key=>[key,runs.filter(({run})=>fixtureOf(run)===key)]))
for(const key of fixtureOrder)if(groups[key].length!==3)throw new Error(`${key} has ${groups[key].length} runs; expected 3`)

const statMedians=(items,key)=>{
  const names=new Set(items.flatMap(({run})=>Object.keys(run[key]||{})))
  return Object.fromEntries([...names].map(name=>[name,round(median(items.map(({run})=>run[key]?.[name]?.msPerFrame??0)))])
    .sort((a,b)=>b[1]-a[1]))
}
const summarize=(key,items)=>{
  const cpuP99=median(items.map(({run})=>run.frame.workMs.p99))
  const gpuP99=median(items.map(({run})=>run.gpu.frameMs?.p99))
  const frames=items.flatMap(({file,run},runIndex)=>run.worstFrames.map(frame=>({
    run:runIndex+1,file,frame:frame.frame,cpuMs:frame.workMs,gpuMs:frame.gpuMs,
    frameMs:Math.max(frame.workMs||0,frame.gpuMs||0),cause:frame.cause,
  }))).sort((a,b)=>b.frameMs-a.frameMs)
  const eventFrames=items.flatMap(({run},runIndex)=>run.eventFrames.map(frame=>({
    run:runIndex+1,frame:frame.frame,cpuMs:frame.workMs,gpuMs:frame.gpuMs,
    frameMs:Math.max(frame.workMs||0,frame.gpuMs||0),cause:frame.cause,
  })))
  const killFrames=eventFrames.filter(frame=>/kill|death|limb|explosion|wreck/i.test(frame.cause))
  const texture=items.map(({run})=>run.textureMemory.mebibytes??run.textureMemory.estimatedMiB)
  return {
    name:fixtureNames[key],runs:items.length,
    cpuP99Ms:round(cpuP99),gpuP99Ms:round(gpuP99),maxFrameMs:round(frames[0].frameMs),
    killSpikeMaxMs:round(Math.max(0,...killFrames.map(frame=>frame.frameMs))),
    workloadFpsFloor:round(1000/Math.max(cpuP99,gpuP99)),
    drawCallsP99:round(median(items.map(({run})=>run.renderer.drawCalls.p99))),
    trianglesP99:Math.round(median(items.map(({run})=>run.renderer.triangles.p99))),
    textureMiB:round(median(texture)),worstFrames:frames.slice(0,3),
    systemMsPerFrame:statMedians(items,'systems'),postPassMsPerFrame:statMedians(items,'postPasses'),
    runMetrics:items.map(({file,run})=>({file,capturedAt:run.capturedAt,hostLoad:run.hostLoad,
      cpuP99Ms:run.frame.workMs.p99,gpuP99Ms:run.gpu.frameMs?.p99,maxCpuMs:run.frame.workMs.max,
      maxGpuMs:run.gpu.frameMs?.max,drawCallsP99:run.renderer.drawCalls.p99,
      trianglesP99:run.renderer.triangles.p99,textureMiB:run.textureMemory.mebibytes??run.textureMemory.estimatedMiB,
      ragdolls:run.ragdolls,gore:run.gore,topCosts:run.topCosts,warnings:run.warnings})),
  }
}
const fixtures=Object.fromEntries(fixtureOrder.map(key=>[key,summarize(key,groups[key])]))
const loadSamples=runs.flatMap(({run})=>[run.hostLoad?.before,run.hostLoad?.after]).filter(Boolean)
const loadAverage={
  oneMinute:{min:round(Math.min(...loadSamples.map(v=>v[0]))),median:round(median(loadSamples.map(v=>v[0]))),max:round(Math.max(...loadSamples.map(v=>v[0])))},
  fiveMinute:{min:round(Math.min(...loadSamples.map(v=>v[1]))),median:round(median(loadSamples.map(v=>v[1]))),max:round(Math.max(...loadSamples.map(v=>v[1])))},
  fifteenMinute:{min:round(Math.min(...loadSamples.map(v=>v[2]))),median:round(median(loadSamples.map(v=>v[2]))),max:round(Math.max(...loadSamples.map(v=>v[2])))},
}
const result={phase,protocol:{width:1920,height:1080,quality:'high',warmupSeconds:5,captureSeconds:10,runsPerFixture:3,
  aggregation:'Median run p99; maximum frame and kill-spike frame across all runs.'},loadAverage,fixtures}
await mkdir(dirname(resolve(output)),{recursive:true})
await writeFile(resolve(output),`${JSON.stringify(result,null,2)}\n`)

const tableRows=fixtureOrder.map(key=>{const f=fixtures[key];return `| ${f.name} | ${f.cpuP99Ms.toFixed(3)} | ${f.gpuP99Ms.toFixed(3)} | ${f.maxFrameMs.toFixed(3)} | ${f.killSpikeMaxMs.toFixed(3)} | ${f.workloadFpsFloor.toFixed(3)} | ${f.drawCallsP99} | ${f.trianglesP99.toLocaleString('en-US')} | ${f.textureMiB.toFixed(3)} |`})
const worst=fixtureOrder.flatMap(key=>{
  const f=fixtures[key]
  return [`### ${f.name}`,'','| Run | Frame | CPU ms | GPU ms | Cause |','| ---: | ---: | ---: | ---: | --- |',
    ...f.worstFrames.map(frame=>`| ${frame.run} | ${frame.frame} | ${frame.cpuMs?.toFixed(3)??'n/a'} | ${frame.gpuMs?.toFixed(3)??'n/a'} | ${frame.cause.replaceAll('|','/')} |`),'']
})
const md=[`# Performance pass 3: ${phase}`,'',
  'The runner recorded host load immediately before and after every timed capture.','',
  `Load average ranges were ${loadAverage.oneMinute.min}-${loadAverage.oneMinute.max} at one minute, ${loadAverage.fiveMinute.min}-${loadAverage.fiveMinute.max} at five minutes, and ${loadAverage.fifteenMinute.min}-${loadAverage.fifteenMinute.max} at fifteen minutes.`,'',
  'Each fixture used High quality at 1920 by 1080. Three runs followed five seconds of warmup and captured ten seconds.','',
  '| Fixture | CPU p99 ms | GPU p99 ms | Max frame ms | Kill spike max ms | Floor fps | Draws p99 | Triangles p99 | Texture MiB |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',...tableRows,'',
  'CPU and GPU p99 values are medians. Maxima cover all three runs. The workload floor uses the slower median p99.','',
  '## Worst three frames per fixture','',...worst].join('\n')
await writeFile(resolve(output.replace(/\.json$/,'.md')),`${md.replace(/\n*$/, '')}\n`)
