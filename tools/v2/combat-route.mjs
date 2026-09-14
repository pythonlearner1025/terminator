// Supplemental repeatable input workload. Uses normal collision, movement,
// weapons, reloads and enemy AI; never teleports during the measured interval.
export function createCombatRoute(world) {
 const p=world.player,goals=[{x:15,y:0,z:-19},{x:15,y:0,z:15},{x:-12,y:0,z:15},{x:-12,y:0,z:-17}]
 const path=[];let from={...p.pos}
 for(const goal of goals){
  const leg=world.findPath(from,goal)
  if(!leg?.length)throw Error('Combat route has no navigable path')
  path.push(...leg);from=goal
 }
 let index=0,distance=0,last={...p.pos},samples=0,wraps=0
 return {
  path,
  sample(){
   distance+=Math.hypot(p.pos.x-last.x,p.pos.z-last.z);last={...p.pos};samples++
   for(let n=0;n<path.length;n++){
    const target=path[index]
    if(Math.hypot(target.x-p.pos.x,target.z-p.pos.z)>.6)break
    index++;if(index===path.length){index=0;wraps++}
   }
   const target=path[index],dx=target.x-p.pos.x,dz=target.z-p.pos.z,length=Math.hypot(dx,dz)||1
   let enemy=null,nearest=Infinity
   for(const unit of world.units){if(!unit.alive)continue;const d=Math.hypot(unit.pos.x-p.pos.x,unit.pos.z-p.pos.z);if(d<nearest){nearest=d;enemy=unit}}
   const yaw=enemy?Math.atan2(enemy.pos.x-p.pos.x,enemy.pos.z-p.pos.z):Math.atan2(dx,dz)
   const pitch=enemy?Math.atan2(enemy.pos.y+1.2-p.pos.y-1.65,nearest):0
   const ammo=p.ammo?.[p.activeWeapon]
   return {move:{x:(-Math.cos(yaw)*dx+Math.sin(yaw)*dz)/length,z:(Math.sin(yaw)*dx+Math.cos(yaw)*dz)/length},
    yaw,pitch,fire:true,reload:ammo?.mag===0}
  },
  summary(){return {distance,index,wraps,samples,pathLength:path.length,feet:{...p.pos}}},
 }
}
