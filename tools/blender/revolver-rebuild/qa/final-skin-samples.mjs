// Derive real export durations, avoiding float32 times just beyond Blender NLA ends.
import {readFile,writeFile} from 'node:fs/promises'
import {resolve,dirname} from 'node:path'
import {CLIPS,accessorValues} from './export-contract.mjs'
const file=resolve(process.argv[2]),out=resolve(process.argv[3]),g=JSON.parse(await readFile(file))
const buffers=await Promise.all(g.buffers.map(b=>readFile(resolve(dirname(file),b.uri))))
const samples={},inventory={}
for(const name of CLIPS){
 const clip=g.animations.find(c=>c.name===name)
 if(!clip)throw Error('Missing final clip '+name)
 const duration=Math.max(...clip.samplers.flatMap(s=>accessorValues(g,buffers,s.input).flat()))
 const end=Math.round(duration*60),fractions=name==='Reload'
  ?[0,.025,.05,.08,.10,.13,.17,.20,.24,.27,.30,.32,.34,.37,.41,.45,.48,.52,.55,.60,.64,.67,.70,.73,.77,.80,.84,.86,.90,.94,.96,.985,1]
  :[0,.17,.34,.5,.67,.84,1]
 const frames=fractions.map(f=>Math.round(f*end))
 if(name==='Fire')frames.push(1,2,3,4,5)
 samples[name]=[...new Set(frames)].sort((a,b)=>a-b).map(f=>f/60)
 inventory[name]={exportDuration:duration,sourceEndFrame:end,samples:samples[name].length}
}
await writeFile(out,JSON.stringify(samples,null,2)+'\n')
console.log(JSON.stringify({out,inventory,totalSamples:Object.values(samples).reduce((n,x)=>n+x.length,0)},null,2))
