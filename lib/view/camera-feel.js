import * as sfx from '../ui/sfx.js'

const IMPULSES={pistol:.83,m4:.42,shotgun:1.85,plasma:1.05,sniper:1.55,launcher:1.95,knife:.16}
// Presentation springs never feed their offsets back into core pitch or yaw.
export class CameraFeel {
  constructor(){this.eventIndex=0;this.kick=0;this.velocity=0;this.roll=0;this.rollVelocity=0;this.dip=0;this.dipVelocity=0;this.shake=0;this.freezeUntil=0;this.lastTime=0;this.headshotKills=0;this.shots=0}
  consume(world) {
    const player=world.getPlayer?.(world.localPlayerId||world.hostPlayerId)||world.player
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++){
      const event=world.eventLog[this.eventIndex]
      if(event.type==='shot' && event.by===player.id){
        const impulse=(IMPULSES[event.weapon]||.4)*(player.aiming?.72:1)
        this.velocity=Math.min(3,this.velocity+impulse)
        this.rollVelocity+=Math.sin(++this.shots*2.399)*impulse*.17
        sfx.fireWeapon?.(event.weapon)
      }
      if(event.type==='grenade_thrown')sfx.grenadeThrown?.(event.pos)
      if(event.type==='grenade_bounce')sfx.grenadeBounce?.(event.pos,event.speed)
      if(event.type==='shot' && event.unitType==='heavy' && event.origin && distance(event.origin,player.pos)<18) this.shake=Math.max(this.shake,.009)
      if(event.type==='explosion' && event.pos){
        this.shake=Math.max(this.shake,.09*Math.max(0,1-distance(event.pos,player.pos)/22)**1.4)
        sfx.grenadeExplosion?.(event.pos)
      }
      if(event.type==='land' && event.playerId===player.id){this.dipVelocity-=Math.min(1.2,.42+(event.fallHeight||0)*.15);sfx.playLanding?.(event.fallHeight)}
      if(event.type==='kill' && event.headshot && (event.playerId||player.id)===player.id){this.freezeUntil=performance.now()+40;this.headshotKills++}
    }
  }
  get hitStopped(){return performance.now()<this.freezeUntil}
  apply(camera) {
    const now=performance.now(),dt=Math.min(.05,(now-(this.lastTime||now))/1000)
    this.lastTime=now
    // Small substeps keep the damped spring stable across slow rendering frames.
    const count=Math.max(1,Math.ceil(dt/.008)),h=dt/count
    for(let i=0;i<count;i++){
      this.velocity+=(-210*this.kick-24*this.velocity)*h;this.kick+=this.velocity*h
      this.rollVelocity+=(-150*this.roll-20*this.rollVelocity)*h;this.roll+=this.rollVelocity*h
      this.dipVelocity+=(-180*this.dip-22*this.dipVelocity)*h;this.dip+=this.dipVelocity*h
    }
    this.kick=Math.min(.13,Math.max(-.015,this.kick));this.dip=Math.min(.01,Math.max(-.08,this.dip));this.shake*=Math.exp(-dt*9)
    if(!camera)return
    camera.position.y+=this.dip
    camera.rotation.x+=this.kick+(Math.sin(now*.061)+Math.sin(now*.037)*.35)*this.shake
    camera.rotation.y+=Math.cos(now*.073)*this.shake*.3
    camera.rotation.z+=this.roll+Math.sin(now*.083)*this.shake*.55
    camera.updateMatrixWorld()
  }
  dispose(){this.kick=0;this.velocity=0;this.roll=0;this.rollVelocity=0;this.dip=0;this.dipVelocity=0;this.shake=0;this.freezeUntil=0;this.lastTime=0}
}
function distance(a,b){return Math.hypot(a.x-b.x,(a.y||0)-(b.y||0),a.z-b.z)}
