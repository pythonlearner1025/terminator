import {Skeleton, Vector3, Box3, Matrix4, Matrix3, Ray} from 'threepipe'

const up=new Vector3(0,1,0), temp=new Vector3(), target=new Vector3(), local=new Vector3()
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
  return {object,mesh,joints,contacts,pickParts,actuators,targets:{},phase:0,move:0,aim:0,spin:0,recoil:0,hit:0,headshot:0,death:0,
    stagger:0,heat:0,fallVelocity:0,fallAngle:0,fallSpin:0,feet:{},flinches:{},severed:new Set(),states:new Set(),
    baseY:joints.Pelvis.position.y,previous:object.position.clone(),muzzleHeat:object.getObjectByName('Muzzle Heat'),eyes:object.getObjectByName('Eye Emitters')}
}

// Pure presentation: nav is queried for support, never changed.
export function unitGround(nav,x,z,y) {
  return nav?.supportAt({x,z},y,{maxAbove:.6,maxBelow:3})?.y ?? y
}

export function animateUnit(rig,unit,dt,time,nav) {
  const j=rig.joints,scout=unit.type==='scout',heavy=unit.type==='heavy'
  const speed=Math.hypot(unit.vel?.x||0,unit.vel?.z||0),moving=unit.alive&&speed>.08
  const aimPoint=unit.intent?.aimAt||unit.intent?.face||unit.intent?.moveTo
  const aiming=unit.alive&&!scout&&Boolean(unit.intent?.aimAt||unit.intent?.fire)
  const blend=1-Math.exp(-dt/.075)
  rig.move=mix(rig.move,moving?1:0,blend);rig.aim=mix(rig.aim,aiming?1:0,blend)
  rig.spin=mix(rig.spin,unit.alive?clamp(unit.spinUp||0):0,1-Math.exp(-dt/.22))
  const travelled=Math.hypot(rig.object.position.x-rig.previous.x,rig.object.position.z-rig.previous.z)
  rig.previous.copy(rig.object.position)
  rig.phase+=(nav?Math.min(travelled,.8):speed*dt)*Math.PI*2/(scout?1.65:heavy?1.1:1.3)
  rig.recoil=Math.max(0,rig.recoil-dt*9);rig.hit=Math.max(0,rig.hit-dt*5)
  rig.headshot=Math.max(0,rig.headshot-dt*4);rig.stagger=Math.max(0,rig.stagger-dt*1.5)
  rig.heat=mix(rig.heat,unit.alive&&unit.intent?.fire?rig.spin:0,1-Math.exp(-dt/(unit.alive?1.4:4)))
  if(!unit.alive) {
    if(rig.death===0){rig.fallVelocity=-.3;rig.fallSpin=-.35;rig.fallAngle=j.Pelvis.rotation.x}
    rig.death+=dt
  } else {rig.death=0;rig.fallVelocity=0}
  const gait=Math.sin(rig.phase)*rig.move,crouch=scout?rig.move:0
  const pose=(name,x=0,y=0,z=0)=>{
    if(!j[name])return
    const t=rig.targets[name]||=( {x:0,y:0,z:0} );t.x=x;t.y=y;t.z=z
  }
  const pitch=aimPoint?clamp(Math.atan2(aimPoint.y-unit.pos.y-1.55,Math.hypot(aimPoint.x-unit.pos.x,aimPoint.z-unit.pos.z)),-.65,.65):0
  const turn=aimPoint?clamp(wrap(Math.atan2(aimPoint.x-unit.pos.x,aimPoint.z-unit.pos.z)-unit.yaw),-.7,.7):0
  const flinch=Math.sin(rig.hit*Math.PI)*.12,stagger=Math.sin(rig.stagger*Math.PI)*.22
  let pelvisY=rig.baseY-crouch*.16-Math.abs(gait)*.024-stagger*.15
  pose('Pelvis',crouch*1.1+stagger,0,gait*.018)
  pose('Spine',.025+crouch*.15-flinch,gait*.025)
  pose('Chest',.03-pitch*rig.aim*.25,-gait*.04,flinch*.4)
  pose('Neck',-crouch*.55-.03,turn*.25)
  pose('Head',-crouch*.69-pitch*.7+rig.headshot*.15,turn*.75)
  pose('Jaw',.015+rig.hit*.1)
  for(const [side,sign]of [['Left',-1],['Right',1]]) {
    const step=Math.sin(rig.phase+(sign<0?0:Math.PI)),armed=side==='Right'&&!scout
    pose('Thigh '+side,-step*.4*rig.move-crouch*.5,0,sign*(.015+crouch*.15))
    pose('Shin '+side,Math.max(0,step)*.8*rig.move+crouch*.4)
    pose('Foot '+side,step*.35*rig.move-Math.max(0,step)*.6*rig.move)
    pose('Shoulder '+side,0,0,sign*-.025)
    pose('Upper Arm '+side,armed?-.12+rig.aim*.12+rig.recoil*.07:-step*.25*rig.move-crouch*1.3,armed?-turn*.2:0,sign*(.05+crouch*.14))
    pose('Forearm '+side,armed?-.2-rig.aim*1.12-pitch*rig.aim:-.14-crouch*.25)
    pose('Hand '+side,crouch*.25)
  }
  if(j.Weapon)pose('Weapon',.3+rig.aim*1.2+rig.recoil*.04)
  if(j.Barrels)j.Barrels.rotation.z+=dt*(rig.spin*75+rig.recoil*18)
  if(rig.muzzleHeat){rig.muzzleHeat.userData.batchVisible=rig.heat>.02;rig.muzzleHeat.visible=false;rig.muzzleHeat.material.opacity=rig.heat*.55;rig.muzzleHeat.material.color.setHex(0xff4408)}
  for(const [name,f]of Object.entries(rig.flinches)) {
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
  if(scout&&unit.intent?.melee&&!moving){pose('Upper Arm Right',-1.1+Math.sin(time*7)*.6);pose('Forearm Right',-.6);rig.states.add('melee')}
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
    for(const [side,sign]of [['Left',-1],['Right',1]]) {
      pose('Upper Arm '+side,.04,0,sign*.23)
      pose('Forearm '+side,-.12);pose('Hand '+side,.4)
      pose('Thigh '+side,-.08,0,sign*.06)
      pose('Shin '+side,.16);pose('Foot '+side,-.04)
    }
    if(j.Weapon)pose('Weapon',.2)
  }
  j.Pelvis.position.y=rig.death>0?pelvisY:mix(j.Pelvis.position.y,pelvisY,blend)
  for(const [name,t]of Object.entries(rig.targets)) {
    const r=j[name].rotation
    r.x=mix(r.x,t.x,blend);r.y=mix(r.y,t.y,blend);r.z=mix(r.z,t.z,blend)
  }
  rig.object.updateMatrixWorld(true)
  if(unit.alive&&nav)plantFeet(rig,unit,nav,moving,dt)
  updateActuators(rig)
  if(rig.death>0)groundCorpse(rig,unit,nav)
  for(const name of rig.severed)j[name].scale.setScalar(.00001)
  const power=rig.death?Math.max(0,1-rig.death/.85)*(Math.sin(time*73)>-.2?1:.08):1
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

function plantFeet(rig,unit,nav,moving,dt) {
  const j=rig.joints,scale=rig.object.scale.x
  const forwardX=Math.sin(unit.yaw),forwardZ=Math.cos(unit.yaw)
  let pelvisLimit=rig.baseY
  for(const [side,sign]of [['Left',-1],['Right',1]]) {
    const cycle=((rig.phase/(Math.PI*2)+(sign>0?.5:0))%1+1)%1,stance=cycle<.62||!moving
    const f=rig.feet[side]||={anchor:new Vector3(),start:new Vector3(),end:new Vector3(),target:new Vector3(),desired:new Vector3(),stance:null,initialized:false}
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
    f.ground=unitGround(nav,f.target.x,f.target.z,unit.pos.y)
    f.target.y=f.ground+.075*scale+(stance?0:Math.sin(q*Math.PI)*.23*scale)
    const heel=unitGround(nav,f.target.x-forwardX*.055,f.target.z-forwardZ*.055,f.ground)
    const toe=unitGround(nav,f.target.x+forwardX*.14,f.target.z+forwardZ*.14,f.ground)
    f.slope=clamp(Math.atan2(toe-heel,.195*scale),-.55,.55)
    // Lower the hips while the trailing foot remains on the previous tread.
    // This absorbs the core's discrete step in height without lengthening a leg.
    const reachZ=((f.target.x-unit.pos.x)*forwardX+(f.target.z-unit.pos.z)*forwardZ)/scale
    const reachY=Math.sqrt(Math.max(.2,.778*.778-reachZ*reachZ))
    pelvisLimit=Math.min(pelvisLimit,(f.target.y-rig.object.position.y)/scale+.07+reachY)
  }
  j.Pelvis.position.y=Math.min(j.Pelvis.position.y,pelvisLimit)
  j.Pelvis.updateMatrixWorld(true)
  for(const side of ['Left','Right']) {
    if(rig.severed.has('Thigh '+side)||rig.severed.has('Shin '+side))continue
    const thigh=j['Thigh '+side],shin=j['Shin '+side],foot=j['Foot '+side],f=rig.feet[side]
    local.copy(f.target);thigh.parent.worldToLocal(local);local.sub(thigh.position)
    // Rotate the sagittal plane toward a lateral target before solving lengths.
    thigh.rotation.z=Math.atan(local.x/(-local.y||.00001))
    const down=-Math.sign(local.y)*Math.hypot(local.x,local.y),l1=.42,l2=.37,d=clamp(Math.hypot(down,local.z),.08,l1+l2-.001)
    const a=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1))
    thigh.rotation.x=Math.atan2(-local.z,down)-a
    shin.rotation.x=Math.PI-Math.acos(clamp((l1*l1+l2*l2-d*d)/(2*l1*l2),-1,1))
    foot.rotation.x=-thigh.rotation.x-shin.rotation.x-j.Pelvis.rotation.x-f.slope
    foot.rotation.z=-thigh.rotation.z-j.Pelvis.rotation.z
    thigh.updateMatrixWorld(true)
  }
}

function updateActuators(rig) {
  for(const a of rig.actuators){
    target.set(...a.point);a.targetBone.localToWorld(target);a.bone.parent.worldToLocal(target);target.sub(a.bone.position)
    const length=target.length()
    a.bone.quaternion.setFromUnitVectors(up,target.normalize())
    a.bone.scale.y=a.shaft?Math.max(.12,(length-.12)/a.restLength):1
    a.bone.updateMatrixWorld(true)
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
  object.traverse(child=>{if(child.isSkinnedMesh)child.skeleton.dispose()})
  for(const material of rig.eyeMaterials||[])material.dispose()
}

const pickRay=new Ray(),pickInverse=new Matrix4(),pickNormal=new Matrix3(),pa=new Vector3(),pb=new Vector3(),pc=new Vector3(),pickPoint=new Vector3()
// Rigid skinning lets us intersect bone-local triangles directly. Broad-phase
// boxes exclude the rest of the character, avoiding full CPU skinning per hit.
export function hitUnitRig(rig,ray) {
  let nearest=Infinity,result=null
  for(const part of rig.pickParts){
    pickInverse.copy(part.bone.matrixWorld).invert();pickRay.copy(ray).applyMatrix4(pickInverse)
    if(!pickRay.intersectBox(part.bounds,pickPoint))continue
    const t=part.triangles
    for(let i=0;i<t.length;i+=9){
      pa.fromArray(t,i);pb.fromArray(t,i+3);pc.fromArray(t,i+6)
      if(!pickRay.intersectTriangle(pa,pb,pc,true,pickPoint))continue
      pickPoint.applyMatrix4(part.bone.matrixWorld)
      const distance=pickPoint.distanceToSquared(ray.origin)
      if(distance<nearest){nearest=distance;result={bone:part.bone,point:pickPoint.clone(),normal:new Vector3().subVectors(pb,pa).cross(new Vector3().subVectors(pc,pa)).applyMatrix3(pickNormal.getNormalMatrix(part.bone.matrixWorld)).normalize()}}
    }
  }
  return result
}
