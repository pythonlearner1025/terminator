import assert from 'node:assert/strict'
import {test} from 'node:test'
import {defaultMap} from '../lib/core/map.js'
globalThis.ImageData ??= class {}
const {wallMorphology}=await import('../lib/view/v2/architecture-morphology.js')
const random=text=>{let s=2166136261;for(let i=0;i<text.length;i++)s=Math.imul(s^text.charCodeAt(i),16777619);return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
test('all actual wall seeds retain closed, contained and consistently wound shells',()=>{
const rows=[]
for(const c of defaultMap.colliders.filter(c=>['wall','building_wall','tunnel_wall','column'].includes(c.kind))){
 const L=Math.max(c.size.x,c.size.z),T=Math.min(c.size.x,c.size.z),H=c.size.y
 const service=c.id.includes('service'),partition=c.id.includes('partition'),parapet=c.id.includes('parapet')
 const topOpen=!service&&!/sill|header|head_|lintel/.test(c.id)&&(!c.id.includes('barracks')||partition||parapet),detail=partition||service||c.id.includes('sill')
 const {triangles,cavities,edgeContours}=wallMorphology({length:L,height:H,thickness:T,random:random(c.id),topOpen,detail})
 // A closed edge count alone cannot detect a contour crossing itself.
 const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
 for(const ring of edgeContours)for(let i=0;i<ring.length;i++)for(let j=i+2;j<ring.length;j++){
  if(i===0&&j===ring.length-1)continue
  const a=ring[i],b=ring[(i+1)%ring.length],d=ring[j],e=ring[(j+1)%ring.length]
  assert.ok(!(orient(a,b,d)*orient(a,b,e)<-1e-14&&orient(d,e,a)*orient(d,e,b)<-1e-14),`${c.id}: return stratum cannot self-intersect`)
 }
 const edges=new Map();let degenerate=0,volume=0,outside=0
 for(const t of triangles){const p=[t.a,t.b,t.c],a=p[0],b=p[1],d=p[2];const u=b.map((v,i)=>v-a[i]),v=d.map((v,i)=>v-a[i]);const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
  if(Math.hypot(...cross)<1e-12)degenerate++
  if(t.region==='edge-bed'||t.region==='pocket-bed')assert.ok(cross[2]*a[2]>0,`${c.id}: bed projection never folds or reverses at an undercut`)
  volume+=(a[0]*(b[1]*d[2]-b[2]*d[1])+a[1]*(b[2]*d[0]-b[0]*d[2])+a[2]*(b[0]*d[1]-b[1]*d[0]))/6
  for(const x of p)for(let i=0;i<3;i++)if(!Number.isFinite(x[i])||Math.abs(x[i])>[L,H,T][i]/2+1e-10)outside++
  for(let i=0;i<3;i++){const a=p[i].map(v=>v.toPrecision(14)).join(','),b=p[(i+1)%3].map(v=>v.toPrecision(14)).join(','),key=[a,b].sort().join('|');const e=edges.get(key)||{count:0,orientation:0};e.count++;e.orientation+=a<b?1:-1;edges.set(key,e)}
 }
 const boundary=[...edges.values()].filter(e=>e.count===1).length,nonmanifold=[...edges.values()].filter(e=>e.count>2||e.count===2&&e.orientation!==0).length
 const expectedStoneBases=cavities.length*(detail?7:3)*5
 rows.push({id:c.id,triangles:triangles.length,cavities:cavities.length,volume,boxVolume:L*H*T,boundary,expectedStoneBases,degenerate,outside,nonmanifold,unexpectedEdges:boundary===expectedStoneBases?[]:[...edges].filter(([k,e])=>e.count===1&&k.split('|').every(p=>Math.abs(Math.abs(Number(p.split(',')[2]))-(T/2-.002))<1e-10)).map(([k,e])=>k)})
}
const bad=rows.filter(r=>r.outside||r.degenerate||r.nonmanifold||r.boundary!==r.expectedStoneBases||r.volume<=0||r.volume>=r.boxVolume)

assert.equal(bad.length,0,'Every actual wall has finite contained consistently wound nondegenerate shell; only embedded aggregate bases can be open')

})
