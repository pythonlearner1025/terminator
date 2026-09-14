import {readFile} from 'node:fs/promises'
const p=JSON.parse(await readFile(process.argv[2],'utf8')),nodes=new Map(p.nodes.map(n=>[n.id,n])),counts=new Map()
for(let i=0;i<p.samples.length;i++){const n=nodes.get(p.samples[i]),f=n.callFrame,k=`${f.functionName} ${f.url.replace(/^.*\/files\//,'')} :${f.lineNumber+1}`;counts.set(k,(counts.get(k)||0)+(p.timeDeltas?.[i]||1000))}
console.log([...counts].sort((a,b)=>b[1]-a[1]).slice(0,35).map(([key,t])=>`${(t/1000).toFixed(1)} ms ${key}`).join('\n'))
