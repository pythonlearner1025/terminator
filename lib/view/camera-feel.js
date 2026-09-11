import * as sfx from '../ui/sfx.js'

// Presentation only. Core aim and damage never use these transient offsets.
export class CameraFeel {
  constructor(){this.eventIndex=0;this.kick=0;this.shake=0;this.freezeUntil=0;this.lastTime=0;this.headshotKills=0}
  consume(world) {
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++){
      const event=world.eventLog[this.eventIndex]
      if(event.type==='shot' && event.by==='player'){
        this.kick=Math.min(.06,this.kick+({pistol:.013,m4:.009,shotgun:.035,plasma:.023,knife:.004}[event.weapon] || .01))
        sfx.fireWeapon(event.weapon)
      }
      if(event.type==='shot' && event.unitType==='heavy' && event.origin && distance(event.origin,world.player.pos)<18) this.shake=Math.max(this.shake,.012)
      if(event.type==='explosion' && event.pos) this.shake=Math.max(this.shake,.045*Math.max(0,1-distance(event.pos,world.player.pos)/22))
      if(event.type==='kill' && event.headshot){this.freezeUntil=performance.now()+40;this.headshotKills++}
    }
  }
  get hitStopped(){return performance.now()<this.freezeUntil}
  apply(camera) {
    const now=performance.now(),dt=Math.min(.1,(now-(this.lastTime || now))/1000)
    this.lastTime=now
    this.kick*=Math.exp(-dt*18);this.shake*=Math.exp(-dt*14)
    if(!camera)return
    camera.rotation.x+=this.kick+Math.sin(now*.061)*this.shake
    camera.rotation.z+=Math.sin(now*.083)*this.shake*.65
    camera.updateMatrixWorld()
  }
  dispose(){this.kick=0;this.shake=0;this.freezeUntil=0}
}
function distance(a,b){return Math.hypot(a.x-b.x,(a.y || 0)-(b.y || 0),a.z-b.z)}
