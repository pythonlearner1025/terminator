// Geometry recipe input identity. Display labels do not affect world-space output.
// Changes to procedural geometry require rerunning the offline preview builder.
export function bakedMapKey(map) {
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))
    :typeof value==='number'?Number(value.toPrecision(12)):value
  const text=JSON.stringify(canonical({colliders:map.colliders,bounds:map.bounds,doors:map.doors,spawnGates:map.spawnGates,hazardSlots:map.hazardSlots,flankWall:map.flankWall}))
  let a=2166136261,b=5381
  for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i)}
  return `v2-geometry-1:${text.length}:${a>>>0}:${b>>>0}`
}
