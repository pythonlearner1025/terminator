// Stable bind-geometry correspondence, reused unchanged at every sampled pose.
export const distance=(a,b)=>Math.hypot(...a.map((x,i)=>x-b[i]))
export function blenderWorldPoint(vertex,matrix){
 const p=matrix.slice(0,3).map(row=>row.slice(0,3).reduce((sum,v,i)=>sum+v*vertex[i],row[3]))
 return [p[0],p[2],-p[1]]
}
function normalized(weights){const total=Object.values(weights).reduce((a,b)=>a+b,0);return Object.fromEntries(Object.entries(weights).map(([k,v])=>[k,v/total]))}
function sameWeights(a,b,tolerance){a=normalized(a);b=normalized(b);return [...new Set([...Object.keys(a),...Object.keys(b)])].every(k=>Math.abs((a[k]||0)-(b[k]||0))<=tolerance)}
export function buildCorrespondence(source, exported, bindPositions, {positionTolerance=1e-6,uvTolerance=1e-6,weightTolerance=2e-6,ambiguityTolerance=1e-6}={}){
 const bucket=p=>p.map(x=>Math.floor(x/positionTolerance)),key=p=>p.join(','),grid=new Map()
 bindPositions.forEach((p,i)=>{const k=key(bucket(p));if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i)})
 const mapping=[],candidates=[],unmatched=[],ambiguous=[],covered=new Set()
 let maxBindError=0
 for(let i=0;i<exported.length;i++){
  const v=exported[i],b=bucket(v.position),possible=[]
  for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const j of grid.get(key([b[0]+x,b[1]+y,b[2]+z]))||[]){
   if(distance(v.position,bindPositions[j])>positionTolerance)continue
   const src=source.vertices[j]
   if(!sameWeights(src.weights,v.weights,weightTolerance))continue
   // glTF V points downward. A source vertex may have several UV loop values at seams.
   if(v.uvs.some((uv,layer)=>!(src.uvs[source.uvLayers[layer]]||[]).some(s=>distance(uv,[s[0],1-s[1]])<=uvTolerance)))continue
   possible.push(j)
  }
  possible.sort((a,b)=>a-b)
  candidates.push(possible)
  if(!possible.length){unmatched.push(i);mapping.push(null);continue}
  const chosen=possible.reduce((a,j)=>distance(v.position,bindPositions[j])<distance(v.position,bindPositions[a])?j:a,possible[0])
  mapping.push(chosen);possible.forEach(j=>covered.add(j));maxBindError=Math.max(maxBindError,distance(v.position,bindPositions[chosen]))
  if(possible.length>1){
   let separation=0
   for(const clip of Object.values(source.samples))for(const frame of clip.frames)for(const j of possible)separation=Math.max(separation,distance(frame.worldGltfAxes[chosen],frame.worldGltfAxes[j]))
   ambiguous.push({exportedVertex:i,sourceVertices:possible,maxSourceTrajectorySeparationM:separation,equivalent:separation<=ambiguityTolerance})
  }
 }
 const uncovered=source.vertices.map((_,i)=>i).filter(i=>!covered.has(i))
 return {ok:!unmatched.length&&!uncovered.length&&ambiguous.every(x=>x.equivalent),mapping,candidates,
  unmatched,uncovered,ambiguous,maxBindErrorM:maxBindError,sourceVertices:source.vertices.length,exportedVertices:exported.length,
  chosenSourceVertices:new Set(mapping.filter(x=>x!==null)).size,coveredSourceVertices:covered.size,
  tolerances:{positionTolerance,uvTolerance,weightTolerance,ambiguityTolerance}}
}
export function compareWorldPositions(sourcePoints,exportedPoints,correspondence){
 const perSource=Array(sourcePoints.length).fill(null),exportedErrors=[],worst=[]
 exportedPoints.forEach((p,i)=>{
  const j=correspondence.mapping[i];if(j===null)return
  const error=distance(p,sourcePoints[j]);exportedErrors.push(error)
  for(const src of correspondence.candidates[i])perSource[src]=Math.max(perSource[src]??0,distance(p,sourcePoints[src]))
  worst.push({exportedVertex:i,sourceVertex:j,errorM:error,blenderWorld:sourcePoints[j],gltfWorld:p})
 })
 const values=perSource.filter(x=>x!==null)
 const stats=xs=>({count:xs.length,maxM:Math.max(0,...xs),rmsM:Math.sqrt(xs.reduce((sum,x)=>sum+x*x,0)/xs.length)})
 return {sourceVertexErrors:stats(values),allExportedVertexErrors:stats(exportedErrors),missingSourceVertices:perSource.map((v,i)=>v===null?i:null).filter(i=>i!==null),worst:worst.sort((a,b)=>b.errorM-a.errorM).slice(0,8)}
}
