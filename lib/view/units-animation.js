import {Skeleton, Vector3, Box3, Matrix4, Matrix3, Ray, Quaternion} from 'threepipe'
import {animateRosterUnit,bindRosterRig,disposeRosterRig} from './roster-animation.js'

const up=new Vector3(0,1,0), temp=new Vector3(), target=new Vector3(), local=new Vector3()
const SIDES=[['Left',-1],['Right',1]]
const downAxis=new Vector3(0,-1,0), direction=new Vector3(), bendAxis=new Vector3(), knee=new Vector3()
const parentRotation=new Quaternion(), soleRotation=new Quaternion(), inverseRotation=new Quaternion()
const actuatorInverse=new Matrix4()
const groundPoint={x:0,z:0}, groundOptions={maxAbove:.6,maxBelow:3}
const TAU=Math.PI*2
const LIMBS=SIDES.map(([side,sign])=>({side,sign,thigh:'Thigh '+side,shin:'Shin '+side,foot:'Foot '+side,
  shoulder:'Shoulder '+side,arm:'Upper Arm '+side,fore:'Forearm '+side,hand:'Hand '+side}))
function contactState() {
  return {anchor:new Vector3(),start:new Vector3(),end:new Vector3(),target:new Vector3(),desired:new Vector3(),
    stance:null,initialized:false,groundCached:false,ground:0,slope:0,groundX:0,groundZ:0}
}
function scoutContact(j,limb,front) {
  return {...contactState(),front,sign:limb.sign,phase:(front?.5:0)+(limb.sign>0?.12:0),
    upper:j[front?limb.arm:limb.thigh],lower:j[front?limb.fore:limb.shin],tip:j[front?limb.hand:limb.foot],
    pad:new Vector3(0,front?-.135:-.07,front?.025:.03),sole:new Quaternion(),
    length1:front?.37:.42,length2:front?.38:.37,weight:1}
}
const mix=(a,b,t)=>a+(b-a)*t
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v))
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a))

export function bindUnitRig(object) {
  const joints={}
  object.traverse(child=>{if(child.isBone||child.userData.unitJoint)joints[child.name.replaceAll('_',' ')]=child})
  if(!joints.Pelvis)throw new Error('Missing Pelvis in unit template')
  object.traverse(child=>{
    if(!child.isSkinnedMesh)return
    const s=child.skeleton
    child.skeleton=new Skeleton(s.bones.map(b=>joints[b.name.replaceAll('_',' ')]),s.boneInverses.map(m=>m.clone()))
  })
  const mesh=object.getObjectByName('Combined articulated steel')
  // Bind-space boxes enclose each rigidly weighted piece. Eight transformed
  // corners per bone give a conservative ground constraint for a limp corpse.
  if(!mesh.geometry.userData.unitBounds) {
    const boxes=mesh.skeleton.bones.map(()=>new Box3()),triangles=boxes.map(()=>[])
    const p=mesh.geometry.attributes.position,ids=mesh.geometry.attributes.skinIndex
    for(let i=0;i<p.count;i++) {
      const id=ids.getX(i)
      temp.fromBufferAttribute(p,i).applyMatrix4(mesh.skeleton.boneInverses[id]);boxes[id].expandByPoint(temp);triangles[id].push(temp.x,temp.y,temp.z)
    }
    mesh.geometry.userData.unitBounds=boxes.map((box,i)=>({name:mesh.skeleton.bones[i].name,min:box.min.toArray(),max:box.max.toArray(),triangles:new Float32Array(triangles[i])})).filter(b=>Number.isFinite(b.min[0]))
  }
  const contacts=mesh.geometry.userData.unitBounds.map(b=>({bone:joints[b.name],corners:Array.from({length:8},(_,i)=>new Vector3(b[i&1?'max':'min'][0],b[i&2?'max':'min'][1],b[i&4?'max':'min'][2]))}))
  const pickParts=mesh.geometry.userData.unitBounds.map(b=>({bone:joints[b.name],bounds:new Box3(new Vector3(...b.min),new Vector3(...b.max)),triangles:b.triangles}))
  const actuators=Object.values(joints).filter(b=>b.userData.actuator).map(b=>({bone:b,...b.userData.actuator,targetBone:joints[b.userData.actuator.target]}))
  const targets={}
  const poseNames=['Pelvis','Spine','Chest','Neck','Head','Jaw','Weapon',...LIMBS.flatMap(l=>[l.thigh,l.shin,l.foot,l.shoulder,l.arm,l.fore,l.hand])]
  for(const name of poseNames)if(joints[name])targets[name]={x:0,y:0,z:0}
  const pose=(name,x=0,y=0,z=0)=>{const t=targets[name];if(t){t.x=x;t.y=y;t.z=z}}
  const scout=object.userData.unitTemplateType==='scout'
  const scoutContacts=scout?LIMBS.flatMap(limb=>[scoutContact(joints,limb,false),scoutContact(joints,limb,true)]):null
  const flinches={};for(const name in joints)flinches[name]={life:0,strength:0,side:0}
  return bindRosterRig({object,mesh,joints,contacts,pickParts,actuators,targets,pose,scoutContacts,rise:0,groundPitch:0,phase:0,move:0,aim:0,spin:0,recoil:0,hit:0,headshot:0,death:0,
    stagger:0,heat:0,fallVelocity:0,fallAngle:0,fallSpin:0,crawl:0,eyesDead:false,feet:{Left:contactState(),Right:contactState()},flinches,severed:new Set(),states:new Set(),
    baseY:joints.Pelvis.position.y,previous:object.position.clone(),muzzleHeat:object.getObjectByName('Muzzle Heat'),eyes:object.getObjectByName('Eye Emitters')})
}

// Pure presentation: nav is queried for support, never changed.
export function unitGround(nav,x,z,y) {
  if(!nav)return y
  groundPoint.x=x;groundPoint.z=z
  // Read the same authored surfaces and core height evaluator without building
  // supportAt's sorted arrays for every paw on every animation tick.
  if(nav.surfaceSpecs) {
    let best=-Infinity
    for(let i=0;i<nav.surfaceSpecs.length;i++) {
      const surface=nav.surfaceSpecs[i],c=surface.source
      if(Math.abs(x-c.center.x)>c.size.x/2||Math.abs(z-c.center.z)>c.size.z/2)continue
      // Same rule as nav.supportAt: a surface gives no support inside its own movement hole.
      if(nav.isMovementHole(surface.collider,groundPoint,0))continue
      const height=nav.surfaceHeight(surface,groundPoint)
      if(height<=y+.600001&&height>=y-3.000001)best=Math.max(best,height)
    }
    return best===-Infinity?y:best
  }
  return nav.supportAt(groundPoint,y,groundOptions)?.y??y
}

export function animateUnit(rig,unit,dt,time,nav) {
  if(animateRosterUnit(rig,unit,time,dt))return
  const j=rig.joints,scout=unit.type==='scout',heavy=unit.type==='heavy',liquid=unit.type==='t1000'
  const speed=Math.hypot(unit.vel?.x||0,unit.vel?.z||0),moving=unit.alive&&speed>.08
  const aimPoint=unit.intent?.aimAt||unit.intent?.face||unit.intent?.moveTo
  const aiming=unit.alive&&!scout&&!(liquid&&unit.intent?.melee)&&Boolean(unit.intent?.aimAt||unit.intent?.fire)
  const blend=1-Math.exp(-dt/.075)
  rig.move=mix(rig.move,moving?1:0,blend);rig.aim=mix(rig.aim,aiming?1:0,blend)
  rig.spin=mix(rig.spin,unit.alive?clamp(unit.spinUp||0):0,1-Math.exp(-dt/.22))
  const travelled=Math.hypot(rig.object.position.x-rig.previous.x,rig.object.position.z-rig.previous.z)
  rig.previous.copy(rig.object.position)
  rig.phase+=(nav?Math.min(travelled,.8):speed*dt)*TAU/(scout?2.05:heavy?1.1:1.3)
  rig.recoil=Math.max(0,rig.recoil-dt*9);rig.hit=Math.max(0,rig.hit-dt*5)
  rig.headshot=Math.max(0,rig.headshot-dt*4);rig.stagger=Math.max(0,rig.stagger-dt*1.5)
  rig.heat=mix(rig.heat,unit.alive&&unit.intent?.fire?rig.spin:0,1-Math.exp(-dt/(unit.alive?1.4:4)))
  if(!unit.alive) {
    if(rig.death===0){rig.fallVelocity=-.3;rig.fallSpin=-.35;rig.fallAngle=j.Pelvis.rotation.x}
    rig.death+=dt
  } else {rig.death=0;rig.fallVelocity=0}
  const melee=(scout||liquid)&&unit.alive&&Boolean(unit.intent?.melee)&&!moving
  rig.rise=mix(rig.rise,melee?1:0,blend)
  const gait=Math.sin(rig.phase)*rig.move,crouch=scout?1-rig.rise:0
  const pose=rig.pose
  const pitch=aimPoint?clamp(Math.atan2(aimPoint.y-unit.pos.y-1.55,Math.hypot(aimPoint.x-unit.pos.x,aimPoint.z-unit.pos.z)),-.65,.65):0
  const turn=aimPoint?clamp(wrap(Math.atan2(aimPoint.x-unit.pos.x,aimPoint.z-unit.pos.z)-unit.yaw),-.7,.7):0
  const flinch=Math.sin(rig.hit*Math.PI)*.12,stagger=Math.sin(rig.stagger*Math.PI)*.22
  let pelvisY=rig.baseY-crouch*.16-Math.abs(gait)*.024-stagger*.15
  pose('Pelvis',crouch*1.1+stagger,0,gait*.018)
  pose('Spine',.025+crouch*.15-flinch,gait*.025)
  pose('Chest',.03-pitch*rig.aim*.25,-gait*.04,flinch*.4)
  pose('Neck',-crouch*.55-.03,turn*.25)
  pose('Head',-crouch*.69-pitch*.7+rig.headshot*.15,turn*.75)
  if(scout) {
    // The old forward fold is independent of speed: only an attack lifts the
    // Scout out of its four-point stance. The spine gathers then extends.
    const flex=Math.sin(rig.phase*2)*.11*rig.move*crouch
    pelvisY=mix(.62,.73,rig.rise)+Math.cos(rig.phase*2)*.025*rig.move*crouch-stagger*.15
    pose('Pelvis',mix(1.28,.32,rig.rise)+stagger-rig.groundPitch,0,gait*.025)
    pose('Spine',.04+crouch*.18+flex-flinch,gait*.045)
    pose('Chest',.04-flex*.4,-gait*.075,flinch*.4)
    pose('Neck',-crouch*.6-.035,turn*.25)
    pose('Head',-crouch*.79-flex*.6-pitch*.15+rig.headshot*.15,turn*.75)
  }
  pose('Jaw',.015+rig.hit*.1)
  for(const limb of LIMBS) {
    const {side,sign}=limb
    const step=Math.sin(rig.phase+(sign<0?0:Math.PI)),armed=side==='Right'&&!scout
    pose(limb.thigh,-step*.4*rig.move-crouch*.5,0,sign*(.015+crouch*.15))
    pose(limb.shin,Math.max(0,step)*.8*rig.move+crouch*.4)
    pose(limb.foot,step*.35*rig.move-Math.max(0,step)*.6*rig.move)
    pose(limb.shoulder,0,0,sign*-.025)
    pose(limb.arm,armed?(liquid?-.02:-.12)+rig.aim*(liquid?.02:.12)+rig.recoil*.07:-step*.25*rig.move-crouch*1.3,armed?-turn*.2:0,sign*(.05+crouch*.14))
    pose(limb.fore,armed?(liquid?-.08:-.2)-rig.aim*(liquid?1.24:1.12)-pitch*rig.aim:-.14-crouch*.25)
    pose(limb.hand,crouch*.25)
  }
  if(j.Weapon)pose('Weapon',.3+rig.aim*1.2+rig.recoil*.04)
  if(j.Barrels)j.Barrels.rotation.z+=dt*(rig.spin*75+rig.recoil*18)
  if(rig.muzzleHeat){rig.muzzleHeat.userData.batchVisible=rig.heat>.02;rig.muzzleHeat.visible=false;rig.muzzleHeat.material.opacity=rig.heat*.55;rig.muzzleHeat.material.color.setHex(0xff4408)}
  for(const name in rig.flinches) {
    const f=rig.flinches[name]
    f.life=Math.max(0,f.life-dt*4)
    const t=rig.targets[name]
    if(t){const a=Math.sin(f.life*Math.PI)*f.strength;t.x+=a;t.z+=a*f.side*.55}
  }
  if(rig.recoil>0)rig.states.add('firing')
  if(rig.hit>0)rig.states.add('hit')
  if(rig.spin>.01)rig.states.add('spin-up')
  if(rig.stagger>0)rig.states.add('stagger')
  rig.states.add(moving?(scout?'quadruped sprint':'servo walk'):'idle')
  if(aiming)rig.states.add('aiming')
  if(scout&&rig.rise>0){pose('Upper Arm Right',mix(-1.3,-1.1+Math.sin(time*7)*.6,rig.rise));pose('Forearm Right',-.6);if(melee)rig.states.add('melee')}
  if(liquid&&rig.rise>0) {
    const strike=Math.sin(time*9),amount=rig.rise
    pose('Chest',-.12*amount,.15*strike*amount)
    pose('Upper Arm Right',(-1.2+strike*.55)*amount,0,-.24*amount)
    pose('Forearm Right',(-1+strike*.25)*amount)
    pose('Hand Right',.35*amount)
    pose('Upper Arm Left',(-.55-strike*.2)*amount,0,.18*amount)
    pose('Forearm Left',-.75*amount)
    if(melee)rig.states.add('melee')
  }
  if(rig.death>0) {
    rig.states.add('dying')
    // Gravity drives the centre of mass and a damped angular fall. Joint limp
    // targets arrive at different rates; contact removes downward momentum.
    const t=rig.death
    rig.fallSpin+=(-6*Math.max(.18,Math.cos(rig.fallAngle))-rig.fallSpin*2)*dt
    rig.fallAngle=Math.max(-1.55,rig.fallAngle+rig.fallSpin*dt)
    rig.fallVelocity-=9.81*dt
    pelvisY=j.Pelvis.position.y+rig.fallVelocity*dt
    pose('Pelvis',rig.fallAngle,0,.06*Math.sin(t*3)*Math.exp(-t*2))
    pose('Spine',.05);pose('Chest',.025)
    pose('Head',.15+Math.exp(-t*3)*Math.sin(t*13)*.3,0,.13)
    pose('Neck',.025);pose('Jaw',.19)
    for(const limb of LIMBS) {
      const {sign}=limb
      pose(limb.arm,.04,0,sign*.23)
      pose(limb.fore,-.12);pose(limb.hand,.4)
      pose(limb.thigh,-.08,0,sign*.06)
      pose(limb.shin,.16);pose(limb.foot,-.04)
    }
    if(j.Weapon)pose('Weapon',.2)
  }
  const crawling=unit.alive&&(rig.severed.has('Thigh Left')||rig.severed.has('Thigh Right')||rig.severed.has('Shin Left')||rig.severed.has('Shin Right'))
  rig.crawl=mix(rig.crawl||0,crawling?1:0,1-Math.exp(-dt*9))
  if(crawling) {
    rig.states.add('crawl')
    const c=rig.crawl,drag=Math.sin(time*5)*.18
    pelvisY=mix(pelvisY,.25,c)
    pose('Pelvis',1.43*c,0,drag*.18);pose('Spine',-.04);pose('Chest',-.1)
    pose('Neck',-.65*c);pose('Head',-.72*c,turn*.4)
    for(const limb of LIMBS){pose(limb.arm,-1.1+drag*limb.sign,0,limb.sign*.27);pose(limb.fore,-.8-drag*limb.sign);pose(limb.thigh,-.15);pose(limb.shin,.3)}
  }
  j.Pelvis.position.y=rig.death>0?pelvisY:mix(j.Pelvis.position.y,pelvisY,blend)
  for(const name in rig.targets) {
    const t=rig.targets[name]
    const r=j[name].rotation
    r.x=mix(r.x,t.x,blend);r.y=mix(r.y,t.y,blend);r.z=mix(r.z,t.z,blend)
  }
  rig.object.updateMatrixWorld(true)
  if(unit.alive&&!crawling&&(scout||nav)){
    if(scout)plantScout(rig,unit,nav,moving,dt,nav?0:Math.max(0,speed*dt-travelled))
    else plantFeet(rig,unit,nav,moving,dt)
    rig.object.updateMatrixWorld(true)
  }
  updateUnitActuators(rig)
  for(const name of rig.severed)j[name].scale.setScalar(.00001)
  // Anatomy is already settled above. Only actuator transforms and severed
  // scales changed since that pass; refresh their descendants without walking
  // the entire skeleton (and skinned meshes) for a third time.
  for(const actuator of rig.actuators)actuator.bone.updateMatrixWorld(true)
  for(const name of rig.severed)j[name].updateMatrixWorld(true)
  if(rig.death>0)groundCorpse(rig,unit,nav)
  const power=rig.eyesDead?0:rig.death?Math.max(0,1-rig.death/.85)*(Math.sin(time*73)>-.2?1:.08):1
  if(rig.eyes){
    rig.eyes.visible=power>.001
    const flicker=.97+.03*Math.sin(time*17)
    for(const eye of rig.eyes.children){
      if(eye.name==='Tracking Glint'){
        eye.position.x=(eye.position.x<0?-1:1)*.069+turn*.008
        eye.position.y=.011+pitch*.006;eye.material.opacity=power*.9;eye.material.color.setHex(0xffb4a0)
      }else if(eye.name==='Eye Bloom'||eye.name==='Eye Flare') {
        eye.material.opacity=power*flicker*(eye.name==='Eye Flare'?.22:.58)
      }else eye.material.emissiveIntensity=power*(8+rig.headshot*12)*flicker
    }
  }
}

function plantScout(rig,unit,nav,moving,dt,previewTravel) {
  const scale=rig.object.scale.x,j=rig.joints,contacts=rig.scoutContacts
  rig.object.getWorldPosition(temp)
  const ox=temp.x,oy=temp.y,oz=temp.z,fx=Math.sin(unit.yaw),fz=Math.cos(unit.yaw)
  let frontGround=0,rearGround=0
  for(let i=0;i<contacts.length;i++) {
    const f=contacts[i],duty=f.front?.34:.38
    const cycle=((rig.phase/TAU+f.phase)%1+1)%1
    const stride=2.05*duty*rig.move*(1-rig.rise)
    const z=(f.front?.59:mix(-.12,0,rig.rise))*scale
    const x=f.sign*(f.front?.28:.18)*scale
    const lead=z+stride*.5
    f.desired.set(ox+fz*x+fx*lead,0,oz-fx*x+fz*lead)
    const stance=!moving||cycle<duty
    // In-place previews move the support plane beneath the figure. Live units
    // already travel through world-space anchors and need no compensation.
    if(previewTravel&&f.initialized){
      temp.set(-fx*previewTravel,0,-fz*previewTravel)
      f.anchor.add(temp);f.start.add(temp);f.end.add(temp)
    }
    if(!f.initialized){f.anchor.copy(f.desired);f.start.copy(f.desired);f.end.copy(f.desired);f.initialized=true}
    if(stance&&f.stance===false)f.anchor.copy(f.end)
    if(!stance&&f.stance!==false)f.start.copy(f.anchor)
    if(!stance)f.end.copy(f.desired)
    if(!moving)f.anchor.lerp(f.desired,1-Math.exp(-dt*12))
    f.stance=stance
    const q=clamp((cycle-duty)/(1-duty))
    f.target.copy(stance?f.anchor:f.start)
    if(!stance)f.target.lerp(f.end,q*q*(3-2*q))
    // A teleport or abrupt turn releases a stale contact instead of dragging it.
    if(Math.hypot(f.target.x-f.desired.x,f.target.z-f.desired.z)>1.05*scale){f.target.copy(f.desired);f.anchor.copy(f.desired)}
    f.ground=unitGround(nav,f.target.x,f.target.z,oy)
    const heel=unitGround(nav,f.target.x-fx*.045*scale,f.target.z-fz*.045*scale,f.ground)
    const toe=unitGround(nav,f.target.x+fx*.045*scale,f.target.z+fz*.045*scale,f.ground)
    // A tread edge is a step, not an almost vertical sole orientation.
    f.slope=Math.abs(toe-heel)<.08*scale?clamp(Math.atan2(toe-heel,.09*scale),-.55,.55):0
    f.target.y=f.ground+.008*scale+(stance?0:Math.sin(q*Math.PI)*.23*scale*(1-rig.rise))
    if(f.front)frontGround+=f.ground;else rearGround+=f.ground
    soleRotation.setFromAxisAngle(up,unit.yaw)
    inverseRotation.setFromAxisAngle(temp.set(1,0,0),(f.front?-1.1:0)-f.slope)
    f.sole.copy(soleRotation).multiply(inverseRotation)
    // Solve the wrist/ankle, with the actual palm/toe support point on terrain.
    temp.copy(f.pad).applyQuaternion(f.sole).multiplyScalar(scale)
    f.target.sub(temp)
    f.weight=f.front?1-rig.rise:1
  }
  const slope=clamp(Math.atan2((frontGround-rearGround)*.5,.71*scale),-.65,.65)*(1-rig.rise)
  const oldPitch=rig.groundPitch
  rig.groundPitch=mix(oldPitch,slope,1-Math.exp(-dt*14))
  j.Pelvis.rotation.x-=rig.groundPitch-oldPitch
  j.Pelvis.updateMatrixWorld(true)
  let correction=0
  for(let i=0;i<contacts.length;i++) {
    const f=contacts[i]
    if(f.weight<.5||rig.severed.has(f.upper.name)||rig.severed.has(f.lower.name))continue
    f.upper.getWorldPosition(temp)
    const reach=(f.length1+f.length2-.012)*scale
    const horizontal=(temp.x-f.target.x)**2+(temp.z-f.target.z)**2
    const ceiling=f.target.y+Math.sqrt(Math.max(.01,reach*reach-horizontal))
    correction=Math.min(correction,ceiling-temp.y)
  }
  j.Pelvis.position.y+=correction/scale
  j.Pelvis.updateMatrixWorld(true)
  for(let i=0;i<contacts.length;i++)solveScoutLimb(rig,contacts[i],unit.yaw)
}

function solveScoutLimb(rig,f,yaw) {
  if(f.weight<.001||rig.severed.has(f.upper.name)||rig.severed.has(f.lower.name))return
  const upper=f.upper,lower=f.lower,tip=f.tip
  // Solve in the parent's frame, including the pitched pelvis and flexed spine.
  local.copy(f.target);upper.parent.worldToLocal(local);local.sub(upper.position)
  const distance=clamp(local.length(),.04,f.length1+f.length2-.001)
  direction.copy(local).normalize()
  upper.parent.getWorldQuaternion(parentRotation);inverseRotation.copy(parentRotation).invert()
  bendAxis.set(Math.sin(yaw),0,Math.cos(yaw)).multiplyScalar(f.front?-1:1).applyQuaternion(inverseRotation)
  bendAxis.addScaledVector(direction,-bendAxis.dot(direction)).normalize()
  const along=(f.length1*f.length1+distance*distance-f.length2*f.length2)/(2*distance)
  knee.copy(direction).multiplyScalar(along).addScaledVector(bendAxis,Math.sqrt(Math.max(0,f.length1*f.length1-along*along)))
  soleRotation.setFromUnitVectors(downAxis,knee.normalize())
  upper.quaternion.slerp(soleRotation,f.weight)
  upper.updateWorldMatrix(false,false)
  local.copy(f.target);upper.worldToLocal(local);local.sub(lower.position).normalize()
  soleRotation.setFromUnitVectors(downAxis,local)
  lower.quaternion.slerp(soleRotation,f.weight)
  lower.updateWorldMatrix(false,false)
  lower.getWorldQuaternion(parentRotation)
  soleRotation.copy(parentRotation).invert().multiply(f.sole)
  tip.quaternion.slerp(soleRotation,f.weight)
}

function plantFeet(rig,unit,nav,moving,dt) {
  const j=rig.joints,scale=rig.object.scale.x
  const forwardX=Math.sin(unit.yaw),forwardZ=Math.cos(unit.yaw)
  let pelvisLimit=rig.baseY
  for(const limb of LIMBS) {
    const {side,sign}=limb
    const cycle=((rig.phase/(Math.PI*2)+(sign>0?.5:0))%1+1)%1,stance=cycle<.62||!moving
    const f=rig.feet[side]
    const stride=(unit.type==='heavy'?.45:.54)*scale*rig.move
    const sideX=Math.cos(unit.yaw)*sign*.14*scale,sideZ=-Math.sin(unit.yaw)*sign*.14*scale
    f.desired.set(unit.pos.x+sideX+forwardX*stride*.5,0,unit.pos.z+sideZ+forwardZ*stride*.5)
    if(!f.initialized){f.anchor.copy(f.desired);f.initialized=true}
    if(stance&&f.stance===false)f.anchor.copy(f.end)
    if(!stance&&f.stance!==false){f.start.copy(f.anchor);f.end.copy(f.desired)}
    f.stance=stance
    if(!moving)f.anchor.lerp(f.desired,1-Math.exp(-dt*7))
    const q=clamp((cycle-.62)/.38)
    f.target.copy(stance?f.anchor:f.start)
    if(!stance)f.target.lerp(f.end,q*q*(3-2*q))
    if(Math.hypot(f.target.x-unit.pos.x,f.target.z-unit.pos.z)>.67*scale){f.target.copy(f.desired);f.anchor.copy(f.desired)}
    const groundChanged=moving||!f.groundCached||Math.hypot(f.target.x-f.groundX,f.target.z-f.groundZ)>.02
    if(groundChanged){
      f.ground=unitGround(nav,f.target.x,f.target.z,unit.pos.y)
      const heel=unitGround(nav,f.target.x-forwardX*.055,f.target.z-forwardZ*.055,f.ground)
      const toe=unitGround(nav,f.target.x+forwardX*.14,f.target.z+forwardZ*.14,f.ground)
      f.slope=clamp(Math.atan2(toe-heel,.195*scale),-.55,.55)
      f.groundX=f.target.x;f.groundZ=f.target.z;f.groundCached=true
    }
    f.target.y=f.ground+.075*scale+(stance?0:Math.sin(q*Math.PI)*.23*scale)
    // Lower the hips while the trailing foot remains on the previous tread.
    // This absorbs the core's discrete step in height without lengthening a leg.
    const reachZ=((f.target.x-unit.pos.x)*forwardX+(f.target.z-unit.pos.z)*forwardZ)/scale
    const reachY=Math.sqrt(Math.max(.2,.778*.778-reachZ*reachZ))
    pelvisLimit=Math.min(pelvisLimit,(f.target.y-rig.object.position.y)/scale+.07+reachY)
  }
  j.Pelvis.position.y=Math.min(j.Pelvis.position.y,pelvisLimit)
  j.Pelvis.updateMatrixWorld(true)
  for(const limb of LIMBS) {
    const {side}=limb
    if(rig.severed.has(limb.thigh)||rig.severed.has(limb.shin))continue
    const thigh=j[limb.thigh],shin=j[limb.shin],foot=j[limb.foot],f=rig.feet[side]
    local.copy(f.target);thigh.parent.worldToLocal(local);local.sub(thigh.position)
    // Rotate the sagittal plane toward a lateral target before solving lengths.
    thigh.rotation.z=Math.atan(local.x/(-local.y||.00001))
    const down=-Math.sign(local.y)*Math.hypot(local.x,local.y),l1=.42,l2=.37,d=clamp(Math.hypot(down,local.z),.08,l1+l2-.001)
    const a=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1))
    thigh.rotation.x=Math.atan2(-local.z,down)-a
    shin.rotation.x=Math.PI-Math.acos(clamp((l1*l1+l2*l2-d*d)/(2*l1*l2),-1,1))
    foot.rotation.x=-thigh.rotation.x-shin.rotation.x-j.Pelvis.rotation.x-f.slope
    foot.rotation.z=-thigh.rotation.z-j.Pelvis.rotation.z
  }
}

export function updateUnitActuators(rig) {
  for(const a of rig.actuators){
    target.set(a.point[0],a.point[1],a.point[2]).applyMatrix4(a.targetBone.matrixWorld)
    target.applyMatrix4(actuatorInverse.copy(a.bone.parent.matrixWorld).invert()).sub(a.bone.position)
    const length=target.length()
    a.bone.quaternion.setFromUnitVectors(up,target.normalize())
    a.bone.scale.y=a.shaft?Math.max(.12,(length-.12)/a.restLength):1
  }
}

function groundCorpse(rig,unit,nav) {
  let correction=0
  const base=nav?unit.pos.y:rig.object.getWorldPosition(temp).y
  for(const contact of rig.contacts){
    if(rig.severed.has(contact.bone.name))continue
    for(const corner of contact.corners){
      temp.copy(corner).applyMatrix4(contact.bone.matrixWorld)
      const floor=unitGround(nav,temp.x,temp.z,base)
      correction=Math.max(correction,floor+.006-temp.y)
    }
  }
  if(correction>0){rig.joints.Pelvis.position.y+=correction/rig.object.scale.y;rig.fallVelocity=0;rig.object.updateMatrixWorld(true)}
  rig.groundCorrection=correction
}

export function disposeUnitRig(rig,object) {
  disposeRosterRig(rig)
  object.traverse(child=>{if(child.isSkinnedMesh)child.skeleton.dispose()})
  for(const material of rig.eyeMaterials||[])material.dispose()
}

const pickRay=new Ray(),pickInverse=new Matrix4(),pickNormal=new Matrix3(),pa=new Vector3(),pb=new Vector3(),pc=new Vector3(),pickPoint=new Vector3(),pickEdgeB=new Vector3()
// Rigid skinning lets us intersect bone-local triangles directly. Broad-phase
// boxes exclude the rest of the character, avoiding full CPU skinning per hit.
export function hitUnitRig(rig,ray,result=null) {
  let nearest=Infinity,found=false
  result ||= {bone:null,point:new Vector3(),normal:new Vector3()}
  for(const part of rig.pickParts){
    pickInverse.copy(part.bone.matrixWorld).invert();pickRay.copy(ray).applyMatrix4(pickInverse)
    if(!pickRay.intersectBox(part.bounds,pickPoint))continue
    const t=part.triangles
    for(let i=0;i<t.length;i+=9){
      pa.fromArray(t,i);pb.fromArray(t,i+3);pc.fromArray(t,i+6)
      if(!pickRay.intersectTriangle(pa,pb,pc,true,pickPoint))continue
      pickPoint.applyMatrix4(part.bone.matrixWorld)
      const distance=pickPoint.distanceToSquared(ray.origin)
      if(distance<nearest){
        nearest=distance;found=true;result.bone=part.bone;result.point.copy(pickPoint)
        result.normal.subVectors(pb,pa).cross(pickEdgeB.subVectors(pc,pa)).applyMatrix3(pickNormal.getNormalMatrix(part.bone.matrixWorld)).normalize()
      }
    }
  }
  return found?result:null
}
