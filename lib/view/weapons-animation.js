const clamp = x => Math.max(0, Math.min(1, x))
const smooth = x => {const t=clamp(x);return t*t*(3-2*t)}
const pulse = (p,a,b) => Math.sin(clamp((p-a)/(b-a))*Math.PI)
export const WEAPON_KICK = {pistol:.068,m4:.038,shotgun:.145,plasma:.086,sniper:.115,launcher:.15,knife:0,grenade:0}
const RECOVERY={pistol:.074,m4:.056,shotgun:.12,plasma:.13,sniper:.115,launcher:.15}
export function reloadPhase(id,p) {
  if(p<=0)return 'ready'
  if(id==='launcher')return p<.22?'open':p<.38?'eject':p<.74?'insert':p<.91?'close':'settle'
  if(id==='pistol')return p<.22?'open':p<.42?'eject':p<.73?'insert':p<.90?'close':'settle'
  if(id==='shotgun')return p<.13?'open':p<.86?'insert':p<.96?'action':'settle'
  return p<.14?'grasp':p<.35?'remove':p<.49?'reach':p<.75?'seat':p<.94?'action':'settle'
}
export const AIM_VIEW = {seconds:.12,fov:55,motionScale:1/3}

// Presentation consumes the same authoritative timers as projectViewModel. There
// are no wall-clock animation timers: pausing or CameraFeel hit-stop freezes it all.
export class WeaponAnimation {
  constructor(rigs,fx) {
    this.rigs=rigs;this.fx=fx;this.eventIndex=null;this.lastTick=null;this.time=0
    this.active='pistol';this.shown='pistol';this.switchAge=1;this.shotAge=10
    this.shotWeapon='pistol';this.transient=null;this.actionAge=10;this.actionDuration=1
    this.pendingShell=false;this.shellCount=0;this.lastYaw=null;this.swayX=0;this.swayY=0
    this.aimAmount=0;this.aimTarget=0;this.aimFrom=0;this.aimAge=AIM_VIEW.seconds
    this.state={weapon:'pistol',mode:'idle',reloadProgress:0,shotProgress:1,shellsInserted:0}
    this.reloadEjected=false;this.reloadWasActive=false;this.reloadPhase='ready'
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
      if(event.type==='reload'&&(event.playerId||p.id)===p.id) {
        this.stats.reloads++;this.reloadEjected=false;this.shellCount=Math.min(specs[event.weapon].mag,p.ammo[event.weapon].reserve)
      }
      if(event.type==='grenade_thrown'&&event.by===p.id) {
        this.transient='grenade';this.actionDuration=Math.max(1/60,p.grenadeCooldown)
        // The projectile leaves immediately. Begin at release, then recover while
        // the authoritative grenade continues through its fuse in world space.
        this.actionAge=this.actionDuration*.56
        this.stats.grenades++
      }
      if(event.type==='shot'&&event.by===p.id) {
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
    const aimTarget=p.aiming && !p.reloadTimer && rig.sight && !this.transient && this.switchAge>=.26?1:0
    if(aimTarget!==this.aimTarget) {
      this.aimFrom=this.aimAmount;this.aimTarget=aimTarget;this.aimAge=0
    }
    this.aimAge+=dt
    const ease=1-(1-clamp(this.aimAge/AIM_VIEW.seconds))**3
    this.aimAmount=this.aimFrom+(this.aimTarget-this.aimFrom)*ease
    const aim=rig.sight?this.aimAmount:0
    const motion=1-aim*(1-AIM_VIEW.motionScale)
    if(this.shown!==id){this.rigs[this.shown].root.visible=false;this.shown=id}
    rig.root.visible=true
    const speed=Math.hypot(p.vel.x,p.vel.z),sprint=speed>5.3
    this.sprintAmount=(this.sprintAmount||0)+(Number(sprint)-(this.sprintAmount||0))*Math.min(1,dt*9)
    let yawDelta=this.lastYaw===null?0:p.yaw-this.lastYaw
    yawDelta=Math.atan2(Math.sin(yawDelta),Math.cos(yawDelta))
    const pitchDelta=this.lastPitch===undefined?0:p.pitch-this.lastPitch
    this.lastYaw=p.yaw;this.lastPitch=p.pitch
    this.swayX+=(Math.max(-.035,Math.min(.035,yawDelta*.15))-this.swayX)*Math.min(1,dt*12)
    this.swayY+=(Math.max(-.025,Math.min(.025,pitchDelta*.15))-this.swayY)*Math.min(1,dt*12)
    const move=Math.min(1,speed/5),phase=this.time*(sprint?13:9)
    const bob=move*(sprint?.019:.009)*motion,breath=Math.sin(this.time*1.9)*.003*motion
    const lower=this.switchAge<.10?smooth(this.switchAge/.10):1-smooth((this.switchAge-.10)/.16)
    rig.root.position.set(.17*(1-aim)+Math.sin(phase)*bob+this.swayX*motion,
      -.18*(1-aim)-(rig.sight?.height||0)*aim+Math.cos(phase*2)*bob*.6+breath-lower*.34*(1-aim),
      -.78*(1-aim)-(rig.sight?.distance||0)*aim+Math.abs(Math.sin(phase))*bob)
    rig.root.rotation.set(.035*(1-aim)+this.swayY*motion+lower*.35*(1-aim), .16*(1-aim),Math.sin(phase)*bob*.5)
    if(this.sprintAmount>.001) {rig.root.position.y-=.08*this.sprintAmount;rig.root.rotation.x-=.22*this.sprintAmount;rig.root.rotation.y+=.20*this.sprintAmount;rig.root.rotation.z-=.38*this.sprintAmount}
    if(id==='knife'){rig.root.rotation.x=.68;rig.root.position.x=.17;rig.root.rotation.y=-.27;rig.root.rotation.z=.20}
    if(id==='grenade'){rig.root.position.y+=.03;rig.root.rotation.x=.10}
    rig.slide.position.set(0,0,0);rig.slide.rotation.set(0,0,0)
    rig.magazine.position.set(0,0,0);rig.magazine.rotation.set(0,0,0);rig.magazine.visible=id!=='shotgun'&&id!=='launcher'
    rig.body.visible=true;rig.pump.position.z=0
    if(rig.breech)rig.breech.rotation.x=0
    for(const h of [rig.left,rig.right]) {h.position.copy(h.userData.restPosition);h.rotation.copy(h.userData.restRotation)}
    const interval=spec?.rate?1/spec.rate:1,shotProgress=clamp(this.shotAge/interval)
    if(id===this.shotWeapon && this.shotAge<interval) {
      const recoil=Math.exp(-this.shotAge/Math.min(RECOVERY[id]||.095,interval*.44))*Math.cos(this.shotAge*18)
      rig.root.position.z+=WEAPON_KICK[id]*recoil;rig.root.rotation.x+=WEAPON_KICK[id]*1.75*recoil
      if(id==='pistol'){rig.slide.rotation.x=-.45*pulse(shotProgress,0,.8);rig.magazine.rotation.z=smooth(shotProgress/.5)*Math.PI/3}
      else rig.slide.position.z=(id==='sniper'?.05:.025)*pulse(shotProgress,0,.7)
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
      rig.root.position.x-=.04*tilt;rig.root.position.y+=.11*tilt;rig.root.position.z+=.06*tilt
      rig.root.rotation.x+=(id==='sniper'?.78:id==='pistol'?.43:id==='launcher'?.22:.22)*tilt
      if(id==='sniper')rig.root.rotation.z-=.18*tilt
      if(id==='launcher') {
        const open=smooth((progress-.06)/.16)*(1-smooth((progress-.75)/.15))
        rig.breech.rotation.x=-.73*open
        rig.slide.rotation.y=-.5*pulse(progress,.02,.2)
        const seat=smooth((progress-.44)/.28)
        rig.magazine.visible=progress>.4&&progress<.76
        rig.magazine.position.z=.19*(1-seat)-.11*seat
        rig.left.position.set(-.07-.065*(1-seat),-.105-.11*(1-seat),-.11-.12*seat)
        rig.left.rotation.set(.45,-.35,-.48)
        if(progress>=.25&&!this.reloadEjected){this.eject(rig,id);this.reloadEjected=true}
      } else if(id==='pistol') {
        const open=smooth((progress-.08)/.14)*(1-smooth((progress-.74)/.15))
        const withdraw=pulse(progress,.22,.70)
        rig.magazine.position.set(-.09*open,-.025*withdraw,.05*withdraw)
        rig.magazine.rotation.set(0,-.23*open,.5*open)
        rig.slide.rotation.x=-.38*open
        rig.left.position.set(-.095-.045*withdraw,-.025-.15*withdraw,-.075+.08*withdraw)
        rig.left.rotation.set(.3,-.1,-.68)
        if(progress>=.28&&!this.reloadEjected){for(let i=0;i<6;i++)this.eject(rig,id);this.reloadEjected=true}
      } else if(id==='shotgun') {
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
        if(id==='sniper')rig.magazine.rotation.x=-.40*travel*(1-seat)
        rig.magazine.visible=!(progress>.34&&progress<.48)
        rig.left.position.set(-.055-.07*travel,-.14-.17*travel,.02+.04*travel)
        rig.left.rotation.set(.25,-.22,-.35)
        const rack=pulse(progress,.77,.96)
        rig.left.position.x-=.065*rack;rig.left.position.y+=.21*rack;rig.left.position.z-=.08*rack
        rig.left.rotation.z-=.65*rack
        rig.slide.position.z=(id==='sniper'?.065:.038)*pulse(progress,.77,.96)
        if(id==='sniper'){rig.left.position.x+=.15*rack;rig.left.position.y+=.045*rack}
        if(id==='plasma')rig.slide.rotation.y=-.65*(pulse(progress,.02,.2)+pulse(progress,.77,.96))
      }
    }
    if(this.transient==='knife') {
      mode='swing';const t=clamp(this.actionAge/this.actionDuration)
      // Impact is immediate in core. Start at the strike, then follow through.
      rig.root.position.x-=.34*Math.sin(t*Math.PI)
      rig.root.position.z-=.19*(1-smooth(t))
      rig.root.rotation.z=-.72+1.5*smooth(t);rig.root.rotation.y=-.88*(1-smooth(t))
      rig.left.position.x-=.07*Math.sin(t*Math.PI);rig.left.rotation.z+=.24*Math.sin(t*Math.PI)
    }
    if(this.transient==='grenade') {
      const t=clamp(this.actionAge/this.actionDuration);mode=t<.27?'pull':'throw'
      const pull=smooth(t/.27),release=smooth((t-.27)/.33)
      rig.magazine.position.x=-.17*pull;rig.left.position.x-=.14*pull
      rig.root.position.z-=.35*release;rig.root.position.y+=.19*release
      rig.root.rotation.x=-.75*release;rig.body.visible=t<.56
      if(t>=.56) {
        const recover=smooth((t-.56)/.44)
        rig.root.position.set(.17,-.30-.36*recover,-.90+.12*recover)
        rig.root.rotation.set(.22*(1-recover),.08,-.10)
        rig.right.rotation.x=.12
        rig.left.position.set(-.18,-.07,.06);rig.left.rotation.set(.22,-.45,-.35)
      }
    }
    if(!reloading&&this.reloadWasActive)this.reloadEjected=false
    this.reloadWasActive=reloading;this.reloadPhase=reloading?reloadPhase(id,progress):'ready'
    if(!reloading&&!this.transient&&this.switchAge<.26)mode=this.switchAge<.10?'switch-lower':'switch-raise'
    else if(!reloading&&!this.transient&&this.aimAge<AIM_VIEW.seconds)mode='aim'
    this.state.reloadPhase=this.reloadPhase
    const soundPhase=reloading?`${id}:${Math.floor(progress*4)}`:''
    if(soundPhase&&soundPhase!==this.soundPhase)this.fx.worldFx?.onSound?.('reload-mechanism',{weapon:id,phase:Math.floor(progress*4),progress})
    this.soundPhase=soundPhase
    this.state.weapon=id;this.state.mode=fired?'fire':mode;this.state.reloadProgress=progress
    this.state.aiming=Boolean(aimTarget);this.state.aimProgress=this.aimAmount
    this.state.shotProgress=shotProgress;this.state.shellsInserted=inserted
    if(fired&&id===this.shotWeapon) {
      rig.root.updateMatrixWorld(true);this.fx.fire(rig,id,interval)
      if(id==='m4'||id==='sniper')this.eject(rig,id)
      this.fx.update(0)
    }
  }
  eject(rig,id) {this.fx.eject(rig,id);this.stats.ejections++}
}
