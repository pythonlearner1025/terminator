const clamp = x => Math.max(0, Math.min(1, x))
const smooth = x => {const t=clamp(x);return t*t*(3-2*t)}
const pulse = (p,a,b) => Math.sin(clamp((p-a)/(b-a))*Math.PI)
const kick = {pistol:.042,m4:.025,shotgun:.105,plasma:.057,knife:0,grenade:0}

// Presentation consumes the same authoritative timers as projectViewModel. There
// are no wall-clock animation timers: pausing or CameraFeel hit-stop freezes it all.
export class WeaponAnimation {
  constructor(rigs,fx) {
    this.rigs=rigs;this.fx=fx;this.eventIndex=null;this.lastTick=null;this.time=0
    this.active='pistol';this.shown='pistol';this.switchAge=1;this.shotAge=10
    this.shotWeapon='pistol';this.transient=null;this.actionAge=10;this.actionDuration=1
    this.pendingShell=false;this.shellCount=0;this.lastYaw=null;this.swayX=0;this.swayY=0
    this.state={weapon:'pistol',mode:'idle',reloadProgress:0,shotProgress:1,shellsInserted:0}
    this.stats={shots:0,reloads:0,ejections:0,switches:0,knifeSwings:0,grenades:0}
  }
  sync(world) {
    const p=world.player,specs=world.weaponCatalog.weapons
    const dt=this.lastTick===null?0:Math.max(0,(world.tick-this.lastTick)/60)
    this.lastTick=world.tick;this.time+=dt;this.shotAge+=dt;this.switchAge+=dt;this.actionAge+=dt
    this.fx.update(dt)
    if(this.eventIndex===null)this.eventIndex=world.eventLog.length
    if(p.activeWeapon!==this.active) {
      this.previous=this.shown;this.active=p.activeWeapon;this.switchAge=0;this.stats.switches++
      this.pendingShell=false
    }
    let fired=false
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const event=world.eventLog[this.eventIndex]
      if(event.type==='reload') {
        this.stats.reloads++;this.shellCount=Math.min(specs[event.weapon].mag,p.ammo[event.weapon].reserve)
      }
      if(event.type==='explosion'&&event.by==='player') {
        this.transient='grenade';this.actionAge=0;this.actionDuration=Math.max(1/60,p.grenadeCooldown)
        this.stats.grenades++
      }
      if(event.type==='shot'&&event.by==='player') {
        if(event.weapon==='knife') {
          this.transient='knife';this.actionAge=0;this.actionDuration=1/specs.knife.rate;this.stats.knifeSwings++
        } else if(this.rigs[event.weapon]) {
          this.transient=null;this.shotWeapon=event.weapon;this.shotAge=0;this.switchAge=1
          this.pendingShell=event.weapon==='shotgun';this.stats.shots++;fired=true
        }
      }
    }
    if(this.transient&&this.actionAge>=this.actionDuration) {this.transient=null;this.switchAge=.10}
    const id=this.transient || (this.switchAge<.10?this.previous:this.active) || 'pistol'
    const rig=this.rigs[id]||this.rigs.pistol,spec=specs[id]
    if(this.shown!==id){this.rigs[this.shown].root.visible=false;this.shown=id}
    rig.root.visible=true
    const speed=Math.hypot(p.vel.x,p.vel.z),sprint=speed>5.3
    let yawDelta=this.lastYaw===null?0:p.yaw-this.lastYaw
    yawDelta=Math.atan2(Math.sin(yawDelta),Math.cos(yawDelta))
    const pitchDelta=this.lastPitch===undefined?0:p.pitch-this.lastPitch
    this.lastYaw=p.yaw;this.lastPitch=p.pitch
    this.swayX+=(Math.max(-.035,Math.min(.035,-yawDelta*.15))-this.swayX)*Math.min(1,dt*12)
    this.swayY+=(Math.max(-.025,Math.min(.025,pitchDelta*.15))-this.swayY)*Math.min(1,dt*12)
    const move=Math.min(1,speed/5),phase=this.time*(sprint?13:9)
    const bob=move*(sprint?.019:.009),breath=Math.sin(this.time*1.9)*.003
    const lower=this.switchAge<.10?smooth(this.switchAge/.10):1-smooth((this.switchAge-.10)/.16)
    rig.root.position.set(.17+Math.sin(phase)*bob+this.swayX,-.18+Math.cos(phase*2)*bob*.6+breath-lower*.34,-.78+Math.abs(Math.sin(phase))*bob)
    rig.root.rotation.set(.035+this.swayY+lower*.35, .16,Math.sin(phase)*bob*.5)
    if(sprint) {rig.root.position.y-=.06;rig.root.rotation.set(-.1,.16,-.20)}
    if(id==='knife'){rig.root.rotation.x=.68;rig.root.position.x=.17;rig.root.rotation.y=-.27;rig.root.rotation.z=.20}
    if(id==='grenade'){rig.root.position.y+=.03;rig.root.rotation.x=.10}
    rig.slide.position.set(0,0,0);rig.slide.rotation.set(0,0,0)
    rig.magazine.position.set(0,0,0);rig.magazine.rotation.set(0,0,0);rig.magazine.visible=id!=='shotgun'
    rig.body.visible=true;rig.pump.position.z=0
    for(const h of [rig.left,rig.right]) {h.position.copy(h.userData.restPosition);h.rotation.copy(h.userData.restRotation)}
    const interval=spec?.rate?1/spec.rate:1,shotProgress=clamp(this.shotAge/interval)
    if(id===this.shotWeapon && this.shotAge<interval) {
      const recoil=Math.exp(-this.shotAge/Math.min(.07,interval*.28))
      rig.root.position.z+=kick[id]*recoil;rig.root.rotation.x+=kick[id]*1.3*recoil
      rig.slide.position.z=(id==='pistol'?.043:.025)*pulse(shotProgress,0,.7)
      if(id==='shotgun') {
        rig.pump.position.z=.115*pulse(shotProgress,.18,.85)
        if(this.pendingShell&&shotProgress>=.32) {this.eject(rig,id);this.pendingShell=false}
      }
    }
    const reloading=id===p.activeWeapon&&p.reloadTimer>0&&Boolean(spec?.reloadSeconds)
    const progress=reloading?clamp(1-p.reloadTimer/spec.reloadSeconds):0
    let mode=id===this.shotWeapon&&this.shotAge<interval?'fire':sprint?'sprint':speed>.1?'walk':'idle'
    let inserted=0
    if(reloading) {
      mode='reload'
      const tilt=smooth(progress/.15)*(1-smooth((progress-.84)/.16))
      rig.root.rotation.z-=.48*tilt;rig.root.rotation.y+=.30*tilt
      rig.root.position.set(.13,.015,-.78)
      if(id==='shotgun') {
        const count=this.shellCount||Math.min(spec.mag,p.ammo[id].reserve)
        const cycle=clamp((progress-.13)/.73)*count
        inserted=Math.min(count,Math.floor(cycle))
        const phase=cycle%1,insert=smooth(phase)
        rig.magazine.visible=progress>.13&&progress<.86
        rig.magazine.position.set(-.095*(1-insert),-.13*(1-insert),.04*insert)
        rig.left.position.set(-.09,-.16-.12*(1-insert),-.13)
        rig.left.rotation.set(.3,0,-.6)
        rig.pump.position.z=.105*pulse(progress,.86,1)
      } else {
        // Drop old magazine/cell, reach pouch, seat replacement and work action.
        const drop=smooth((progress-.13)/.18),seat=smooth((progress-.49)/.23)
        const travel=drop*(1-seat)
        rig.magazine.position.set(-.085*travel,-.18*travel,.07*travel)
        rig.magazine.rotation.z=-.24*travel
        rig.magazine.visible=!(progress>.34&&progress<.48)
        rig.left.position.set(-.055-.07*travel,-.14-.17*travel,.02+.04*travel)
        rig.left.rotation.set(.25,-.22,-.35)
        rig.slide.position.z=(id==='pistol'?.042:.03)*pulse(progress,.77,.96)
      }
    }
    if(this.transient==='knife') {
      mode='swing';const t=clamp(this.actionAge/this.actionDuration)
      // Impact is immediate in core. Start at the strike, then follow through.
      rig.root.position.x-=.34*Math.sin(t*Math.PI)
      rig.root.position.z-=.19*(1-smooth(t))
      rig.root.rotation.z=-.55+1.25*smooth(t);rig.root.rotation.y=-.75*(1-smooth(t))
    }
    if(this.transient==='grenade') {
      const t=clamp(this.actionAge/this.actionDuration);mode=t<.27?'pull':'throw'
      const pull=smooth(t/.27),release=smooth((t-.27)/.33)
      rig.magazine.position.x=-.17*pull;rig.left.position.x-=.14*pull
      rig.root.position.z-=.35*release;rig.root.position.y+=.19*release
      rig.root.rotation.x=-.75*release;rig.body.visible=t<.56
      if(t>.56)rig.right.rotation.x=-.6
    }
    this.state.weapon=id;this.state.mode=fired?'fire':mode;this.state.reloadProgress=progress
    this.state.shotProgress=shotProgress;this.state.shellsInserted=inserted
    if(fired&&id===this.shotWeapon) {
      rig.root.updateMatrixWorld(true);this.fx.fire(rig,id,interval)
      if(id==='pistol'||id==='m4')this.eject(rig,id)
      this.fx.update(0)
    }
  }
  eject(rig,id) {this.fx.eject(rig,id);this.stats.ejections++}
}
