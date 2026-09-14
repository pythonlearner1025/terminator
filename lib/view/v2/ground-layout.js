// Placement transferred from architecture prototype 4f02096, refined after pilot03.
// No simulation mutation; larger low native subsets stay in the same protected regions.
const TAU=Math.PI*2
export function groundLayout(map, variantCount=25) {
  const floors=map.colliders.filter(c=>c.kind==='floor')
  function support(x,z,nearY) {
    let best=-Infinity
    for(const c of floors) {
      const cs=Math.cos(c.yaw||0),sn=Math.sin(c.yaw||0),dx=x-c.center.x,dz=z-c.center.z
      const lx=dx*cs-dz*sn,lz=dx*sn+dz*cs
      for(const part of c.shapes?.length ? c.shapes : [{size:c.size}]) {
        if(!part.size)continue
        const o=part.offset||{x:0,y:0,z:0},s=part.size,top=c.center.y+o.y+s.y/2
        if(Math.abs(lx-o.x)<s.x/2-.12&&Math.abs(lz-o.z)<s.z/2-.12&&top<=nearY+.12&&top>nearY-.35)best=Math.max(best,top)
      }
    }
    return best
  }
  const fineRecords=[],protectedFine=map.colliders.filter(c=>!['floor','rubble'].includes(c.kind))
  for(const c of [...map.doors||[],...map.spawnGates||[],...map.hazardSlots||[],map.flankWall,map.trader].filter(Boolean))protectedFine.push({center:c.center||c.pos,size:c.size||{x:2,y:3,z:2},yaw:c.yaw||0})
  for(const c of floors){
    if(!['ground','exp_west_yard','exp_east_yard','exp_service_floor','exp_barracks_roof','exp_colonnade_canopy','dock_floor'].includes(c.id))continue
    const rand=random(c.id+':aggregate-field'),y=c.center.y+c.size.y/2
    const amount=c.id==='ground'?6500:c.id==='exp_service_floor'?900:c.id==='exp_barracks_roof'?900:c.id==='exp_colonnade_canopy'?600:1000
    const edges=map.colliders.filter(b=>!['floor','stair','ramp'].includes(b.kind)&&Math.abs(b.center.y-y)<b.size.y/2+.1&&Math.abs(b.center.x-c.center.x)<c.size.x/2+2&&Math.abs(b.center.z-c.center.z)<c.size.z/2+2)
    let anchorX=0,anchorZ=0,accepted=0
    for(let i=0;i<amount*5&&accepted<amount;i++){
      if(i%18===0){
        anchorX=c.center.x+(rand()-.5)*c.size.x;anchorZ=c.center.z+(rand()-.5)*c.size.z
        // Most deposits start beside existing wall/cover; irregular tails reach
        // quieter floor patches. The complete footprint is validated below.
        if(edges.length&&rand()<.62){
          const b=edges[Math.floor(rand()*edges.length)],side=rand()<.5?-1:1,alongX=b.size.x>=b.size.z
          const u=alongX?(rand()-.5)*b.size.x:side*(b.size.x/2+.6+rand()),v=alongX?side*(b.size.z/2+.6+rand()):(rand()-.5)*b.size.z
          const cs=Math.cos(b.yaw||0),sn=Math.sin(b.yaw||0);anchorX=b.center.x+u*cs+v*sn;anchorZ=b.center.z-u*sn+v*cs
        }
      }
      const x=anchorX+(rand()+rand()-1)*2.8,z=anchorZ+(rand()+rand()-1)*2.8
      const width=.16+rand()*.64,depth=width*(.65+rand()*.35),radius=Math.hypot(width,depth)/2,yaw=rand()*TAU
      const circulation=(Math.abs(x+4)<.45+radius&&Math.abs(z)<23)||(Math.abs(z+12)<.45+radius&&Math.abs(x)<27)||(x>35.6-radius&&x<36.4+radius&&z>3&&z<25)||(Math.abs(x+35.9)<.35+radius&&y<0)
      if(circulation)continue
      if(protectedFine.some(b=>{if(Math.abs(b.center.y-y)>b.size.y/2+.12)return false;const cs=Math.cos(b.yaw||0),sn=Math.sin(b.yaw||0),dx=x-b.center.x,dz=z-b.center.z
        return Math.abs(dx*cs-dz*sn)<b.size.x/2+radius+.06&&Math.abs(dx*sn+dz*cs)<b.size.z/2+radius+.06}))continue
      const cs=Math.cos(yaw),sn=Math.sin(yaw)
      if([[0,0],[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]].some(([u,v])=>Math.abs(support(x+u*width*cs+v*depth*sn,z-u*width*sn+v*depth*cs,y)-y)>.025))continue
      const height=.016+rand()*.05
      if(fineRecords.length>=12500)break
      fineRecords.push({source:c.id,x,y,z,width,depth,height,yaw,variant:Math.floor(rand()*variantCount)});accepted++
    }
  }
  return fineRecords
}
function random(text) {
  let seed=2166136261
  for(let i=0;i<text.length;i++)seed=Math.imul(seed^text.charCodeAt(i),16777619)
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
}
