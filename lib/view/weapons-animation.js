import {AnimationMixer,LoopOnce,LoopRepeat} from 'threepipe'

const REQUIRED_CLIPS=['Idle','Draw','Fire','Reload','AimIn','AimOut','AimIdle','Sprint']
const LOOP_CLIPS=new Set(['Idle','AimIdle','Sprint'])
// Tick deltas already include RangeClock's scale and pause. Never multiply twice.
export class AuthoredWeaponClips {
  constructor(rig) {
    this.mixer=new AnimationMixer(rig.root);this.root=rig.root
    this.actions=new Map(rig.clips.map(clip=>[clip.name,this.mixer.clipAction(clip)]))
    this.name=null;this.aim=false;this.reloading=false
    this.mechanism=rig.root.userData.viewModel?.mechanism;this.shots=0;this.cylinder=rig.root.getObjectByName('Cylinder')
    this.cartridges=Array.from({length:6},(_,i)=>{const node=rig.root.getObjectByName('Case'+i),fresh=rig.root.getObjectByName('Fresh'+i),bullet=rig.root.getObjectByName('Bullet'+i);return node?{node,fresh,bullet,position:node.position.clone(),rotation:node.quaternion.clone(),bulletPosition:bullet.position.clone()}:null})
    this.presentation=rig.root.userData.viewModel?.cartridgePresentation
    this.cylinderRest=this.cylinder?.quaternion.clone()
    this.cylinderTracks=new Map(rig.clips.map(clip=>[clip.name,clip.tracks.find(track=>track.name==='Cylinder.quaternion')?.createInterpolant()]))
    this.spent=[]
    this.bullets=Array.from({length:6},(_,i)=>rig.root.getObjectByName('Bullet'+i))
  }
  play(name,restart=false) {
    if(this.name===name&&!restart)return
    const next=this.actions.get(name),previous=this.actions.get(this.name)
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1)
    next.setLoop(LOOP_CLIPS.has(name)?LoopRepeat:LoopOnce,LOOP_CLIPS.has(name)?Infinity:1)
    next.clampWhenFinished=true;next.play()
    if(previous&&previous!==next){
      // A blended hammer strike leaves the chamber between index positions.
      if(this.mechanism==='swingout'&&(name==='Fire'||this.name==='Reload'))previous.stop()
      else previous.crossFadeTo(next,.08,false)
    }
    this.name=name
  }
  sync(dt,{draw,fire,reloading,aim,sprint,reloadProgress,missingRounds}) {
    const changedAim=aim!==this.aim
    if(reloading&&!this.reloading&&this.mechanism==='swingout')this.spent=Array.from({length:Math.max(0,Math.min(6,missingRounds??this.shots))},(_,i)=>5-i)
    if(fire&&this.mechanism==='swingout')this.shots++
    if(!reloading&&this.reloading&&this.mechanism==='swingout')this.shots=0
    const action=this.actions.get(this.name)
    const finished=action&&action.time>=action.getClip().duration-1e-6
    if(draw||!this.name)this.play('Draw',true)
    if(fire)this.play('Fire',true)
    else if(reloading&&!this.reloading)this.play('Reload',true)
    else if(!reloading&&this.reloading)this.play(aim?'AimIdle':'Idle')
    else if(!reloading&&changedAim)this.play(aim?'AimIn':'AimOut',true)
    else if(!reloading&&(finished||LOOP_CLIPS.has(this.name)))this.play(sprint?'Sprint':aim?'AimIdle':'Idle')
    this.aim=aim;this.reloading=reloading
    if(reloading){
      // Progress owns the pose, including seeks, slow motion and cancellation.
      const reload=this.actions.get('Reload')
      for(const other of this.actions.values())if(other!==reload)other.stop()
      reload.enabled=true;reload.setEffectiveWeight(1);reload.paused=true
      reload.time=Math.max(0,Math.min(1,reloadProgress))*reload.getClip().duration
      this.mixer.update(0)
    }else this.mixer.update(dt)
    if(this.mechanism==='swingout'){
      // PropertyMixer may skip unchanged scale tracks. Reset presentation masks
      // explicitly so one reload cannot hide cartridges in the next reload.
      for(const c of this.cartridges){c.node.scale.setScalar(1);c.fresh.scale.setScalar(this.presentation==='separate-replacements'&&(!reloading||reloadProgress<=.55)?.001:1)}
      // The authored clip rotates one chamber. Preserve previous shot indexes.
      if(this.presentation==='separate-replacements'){
        // Rebuild clips omit static cylinder tracks. Evaluate the authored rotation
        // explicitly so adding a shot offset cannot accumulate during an idle loop.
        const curve=this.cylinderTracks.get(this.name)
        if(curve)this.cylinder.quaternion.fromArray(curve.evaluate(this.actions.get(this.name).time)).normalize()
        else this.cylinder.quaternion.copy(this.cylinderRest)
      }
      this.cylinder.rotateZ(-(this.name==='Fire'?Math.max(0,this.shots-1):this.shots)*Math.PI/3)
      if(reloading){
        for(let i=0;i<6;i++){
          if(this.spent.includes(i))continue
          const c=this.cartridges[i];c.node.position.copy(c.position);c.node.quaternion.copy(c.rotation);c.node.scale.setScalar(1)
          c.bullet.position.copy(c.bulletPosition);c.bullet.scale.setScalar(1);c.fresh.scale.setScalar(.001)
        }
      }else{
        const fired=this.shots-(this.name==='Fire'&&this.actions.get('Fire').time<.05?1:0)
        for(let i=0;i<6;i++)this.bullets[i]?.scale.setScalar(i>=6-fired ? .001 : 1)
      }
    }
    this.root.updateMatrixWorld(true)
  }
  sample(name,seconds) {
    this.mixer.stopAllAction();this.name=null;this.play(name)
    const action=this.actions.get(name);action.time=seconds;action.paused=true
    this.mixer.update(0);this.root.updateMatrixWorld(true)
  }
  dispose(){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.root);this.actions.clear()}
}

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
    for(const rig of Object.values(rigs))if(REQUIRED_CLIPS.every(name=>rig.clips?.some(clip=>clip.name===name)))rig.clipPlayer=new AuthoredWeaponClips(rig)
  }
  sync(world) {
    this.clipWorld = world
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
    const draw=this.shown!==id
    if(draw){this.rigs[this.shown].root.visible=false;this.shown=id}
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
    const vm=rig.root.userData.viewModel,hip=vm?.hip||[.17,-.18,-.78]
    rig.root.position.set(hip[0]*(1-aim)+Math.sin(phase)*bob+this.swayX*motion,
      hip[1]*(1-aim)-(rig.sight?.height||0)*aim+Math.cos(phase*2)*bob*.6+breath-lower*.34*(1-aim),
      hip[2]*(1-aim)-(rig.sight?.distance||0)*aim+Math.abs(Math.sin(phase))*bob)
    const hipRotation=vm?.hipRotation||[.035,.16,0]
    rig.root.rotation.set(hipRotation[0]*(1-aim)+this.swayY*motion+lower*.35*(1-aim), hipRotation[1]*(1-aim),hipRotation[2]*(1-aim)+Math.sin(phase)*bob*.5)
    if(this.sprintAmount>.001&&vm?.mechanism!=='swingout') {rig.root.position.y-=.08*this.sprintAmount;rig.root.rotation.x-=.22*this.sprintAmount;rig.root.rotation.y+=.20*this.sprintAmount;rig.root.rotation.z-=.38*this.sprintAmount}
    if(id==='knife'){rig.root.rotation.x=.68;rig.root.position.x=.17;rig.root.rotation.y=-.27;rig.root.rotation.z=.20}
    if(id==='grenade'){rig.root.position.y+=.03;rig.root.rotation.x=.10}
    const interval=spec?.rate?1/spec.rate:1,shotProgress=clamp(this.shotAge/interval)
    const reloading=id===p.activeWeapon&&p.reloadTimer>0&&Boolean(spec?.reloadSeconds)
    const progress=reloading?clamp(1-p.reloadTimer/spec.reloadSeconds):0
    let mode=id===this.shotWeapon&&this.shotAge<interval?'fire':sprint?'sprint':speed>.1?'walk':'idle'
    let inserted=0
    if(rig.clipPlayer){
      if(vm.forwardAxis==='+Z')rig.root.rotation.y+=Math.PI
      rig.root.rotation.x+=(rig.sight?.pitch||0)*aim
      rig.clipPlayer.sync(dt,{draw,fire:fired&&id===this.shotWeapon,reloading,aim:Boolean(aimTarget),sprint,reloadProgress:progress,missingRounds:spec.mag-p.ammo[id].mag})
      mode=rig.clipPlayer.name.toLowerCase()
      if(vm.mechanism==='swingout'&&reloading&&progress>=vm.reload.eject){
        if(!this.reloadEjected){this.fx.revolver?.eject(rig);this.reloadEjected=true;this.stats.ejections+=rig.clipPlayer.spent.length}
        for(const i of rig.clipPlayer.spent)rig.root.getObjectByName('Case'+i).scale.setScalar(.001)
      }
    } else {
    rig.slide.position.set(0,0,0);rig.slide.rotation.set(0,0,0)
    rig.magazine.position.set(0,0,0);rig.magazine.rotation.set(0,0,0);rig.magazine.visible=id!=='shotgun'&&id!=='launcher'
    rig.body.visible=true;rig.pump.position.z=0
    if(rig.breech)rig.breech.rotation.x=0
    for(const h of [rig.left,rig.right]) {h.position.copy(h.userData.restPosition);h.rotation.copy(h.userData.restRotation)}
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
    for(const part of [rig.slide,rig.magazine])if(part.userData.restOffset)part.position.add({x:part.userData.restOffset[0],y:part.userData.restOffset[1],z:part.userData.restOffset[2]})
    poseReloadHand(rig,reloading,progress)
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
    if (this.clipPreview) this.applyClipTime()
  }
  // Optional visual sampler. Its private evaluator uses the same pose code and silent effects.
  // The live animation timers, statistics, events and core player are never rewritten.
  setClipTime(clip, fraction = 0, world = this.clipWorld) {
    if (clip === null) {
      for(const rig of Object.values(this.rigs))if(rig.clipPlayer){rig.clipPlayer.mixer.stopAllAction();rig.clipPlayer.name=null;rig.clipPlayer.reloading=false}
      this.clipPreview = null
      if (world) this.sync(world)
      return null
    }
    if (!['idle', 'fire', 'reload', 'aim', 'switch','Idle','Draw','Fire','Reload','AimIn','AimOut','AimIdle','Sprint','Inspect'].includes(clip) || !world) return null
    const id = world.player.activeWeapon, spec = world.weaponCatalog.weapons[id]
    const authored=this.rigs[id]?.clipPlayer
    const authoredName=({idle:'Idle',fire:'Fire',reload:'Reload',aim:'AimIn',switch:'Draw'})[clip]||clip
    const duration = (/^[A-Z]/.test(clip) ? authored?.actions.get(authoredName)?.getClip().duration : undefined) ?? (clip === 'reload' ? spec.reloadSeconds || 1 : clip === 'fire' ? 1 / (spec.rate || 1)
      : clip === 'aim' ? AIM_VIEW.seconds : clip === 'switch' ? .26 : 2)
    const frames = Math.max(1, Math.round(duration * 60)), frame = Math.round(clamp(Number(fraction) || 0) * frames)
    this.clipPreview = {clip, weapon: id, frame, frames, fraction: frame / frames, seconds: frame / frames * duration, duration}
    this.clipWorld = world; this.applyClipTime()
    return {...this.clipPreview}
  }
  applyClipTime() {
    const preview = this.clipPreview, world = this.clipWorld
    const authored=this.rigs[preview.weapon]?.clipPlayer
    if(authored){
      const name=({idle:'Idle',fire:'Fire',reload:'Reload',aim:'AimIn',switch:'Draw'})[preview.clip]||preview.clip
      if(!authored.actions.has(name))return
      if(/^[A-Z]/.test(preview.clip)){
        const rig=this.rigs[preview.weapon],vm=rig.root.userData.viewModel,hip=vm.hip,rotation=vm.hipRotation
        const aim=name==='AimIdle'?1:name==='AimIn'?smooth(preview.fraction):name==='AimOut'?1-smooth(preview.fraction):0
        rig.root.position.set(hip[0]*(1-aim),hip[1]*(1-aim)-(rig.sight?.height||0)*aim,hip[2]*(1-aim)-(rig.sight?.distance||0)*aim)
        rig.root.rotation.set(rotation[0]*(1-aim)+(rig.sight?.pitch||0)*aim,rotation[1]*(1-aim)+(vm.forwardAxis==='+Z'?Math.PI:0),rotation[2]*(1-aim))
      }
      authored.sample(name,authored.actions.get(name).getClip().duration*preview.fraction)
      return
    }
    const silent = {update() {}, fire() {}, eject() {}}
    this.clipEvaluator ||= new WeaponAnimation(this.rigs, silent)
    const a = this.clipEvaluator, {weapon: id, clip, seconds, fraction, duration} = preview
    Object.assign(a, {active: id, shown: id, previous: id, transient: null, time: seconds,
      lastTick: world.tick, eventIndex: 0, switchAge: clip === 'switch' ? seconds : 1,
      shotAge: clip === 'fire' ? seconds : 10, shotWeapon: id, pendingShell: false,
      actionAge: seconds, actionDuration: duration, aimAmount: 0, aimFrom: 0,
      aimTarget: clip === 'aim' ? 1 : 0, aimAge: clip === 'aim' ? seconds : 1,
      sprintAmount: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0,
      reloadEjected: true, reloadWasActive: false, shellCount: 0})
    if (clip === 'fire' && ['knife', 'grenade'].includes(id)) a.transient = id
    for (const rig of Object.values(this.rigs)) rig.root.visible = rig.id === id
    const spec = world.weaponCatalog.weapons[id]
    const player = {...world.player, vel: {x: 0, y: 0, z: 0}, yaw: 0, pitch: 0,
      aiming: clip === 'aim', reloadTimer: clip === 'reload' && spec.reloadSeconds ? duration * Math.max(1e-8, 1 - fraction) : 0}
    a.sync({...world, player, eventLog: []})
  }
  eject(rig,id) {this.fx.eject(rig,id);this.stats.ejections++}
  dispose(){for(const rig of Object.values(this.rigs))rig.clipPlayer?.dispose()}
}

// The offline contact pose follows the animated cylinder, magazine, cell, or shell.
// Blend only presentation transforms. Authoritative reload timers stay unchanged.
function poseReloadHand(rig,reloading,progress){
  const pose=rig.root.userData.viewModel?.reloadHand
  if(!pose||(!reloading&&!rig.reloadHandActive))return
  rig.reloadHandActive=reloading
  const hand=rig.left,ready=rig.root.userData.viewModel.handPoses
  const binding=rig.reloadBinding ||= {
    point:hand.position.clone(),rotation:hand.quaternion.clone(),parentRotation:hand.quaternion.clone(),
    relativeRotation:hand.quaternion.clone().fromArray(pose.quaternion),
    bones:Object.entries(pose.bones).map(([name,q])=>({bone:hand.getObjectByName(name),
      ready:hand.quaternion.clone().fromArray(ready[name].quaternion),target:hand.quaternion.clone().fromArray(q)})),
  }
  const blend=reloading?smooth(progress/.16)*(1-smooth((progress-.85)/.15)):0
  if(blend>0){
    rig.magazine.updateWorldMatrix(true,false)
    binding.point.fromArray(pose.position);rig.magazine.localToWorld(binding.point);hand.parent.worldToLocal(binding.point)
    rig.magazine.getWorldQuaternion(binding.rotation).multiply(binding.relativeRotation)
    hand.parent.getWorldQuaternion(binding.parentRotation).invert();binding.rotation.premultiply(binding.parentRotation)
    hand.position.lerp(binding.point,blend);hand.quaternion.slerp(binding.rotation,blend)
  }
  for(const {bone,ready,target} of binding.bones){bone.quaternion.copy(ready).slerp(target,blend);bone.updateMatrix()}
}
