import {World, Body, Box, Vec3, ConeTwistConstraint, SAPBroadphase, ConvexPolyhedron} from 'cannon-es'
import {Vector3, Quaternion, Box3, Matrix4, Sphere} from 'threepipe'
import {updateUnitActuators} from './units-animation.js'

export const RAGDOLL_STEP = 1 / 60
export const WRECK_SECONDS = 180
export const WRECK_FADE_SECONDS = 2
const TERRAIN = 1, DEBRIS = 2
const JOINTS = [
  ['Pelvis', null], ['Chest', 'Pelvis', .45, .25], ['Head', 'Chest', .75, .65],
  ...['Left', 'Right'].flatMap(side => [
    ['Shoulder '+side, 'Chest', 1.6, .75], ['Forearm '+side, 'Shoulder '+side, 1.45, .08],
    ['Thigh '+side, 'Pelvis', 1.25, .45], ['Shin '+side, 'Thigh '+side, 1.3, .06],
  ]),
]
const masses = [14, 22, 5, 4, 3, 9, 6, 4, 3, 9, 6]

// The private world has no gameplay objects or callbacks. Only authored map
// surfaces can contact debris. Sleeping/frozen wrecks leave the solver entirely.
export class RagdollSystem {
  constructor(map) {
    this.world = new World({gravity: new Vec3(0, -9.81, 0), allowSleep: true})
    this.world.broadphase = new SAPBroadphase(this.world)
    this.world.solver.iterations = 6
    this.world.solver.tolerance = .001
    Object.assign(this.world.defaultContactMaterial, {
      friction: .72, restitution: .03, contactEquationStiffness: 1e8,
      contactEquationRelaxation: 4, frictionEquationRelaxation: 4,
    })
    this.terrain = buildRagdollTerrain(map)
    for (const body of this.terrain) this.world.addBody(body)
    this.records = new Set(); this.active = []; this.freeBodies = []; this.freeConstraints = []
    this.freeUnitRecords = []; this.freeLimbRecords = []
    this.clock = 0; this.accumulator = 0
    this.p = new Vector3(); this.q = new Quaternion(); this.bodyQuaternion = new Quaternion(); this.scale = new Vector3()
    this.center = new Vector3(); this.size = new Vector3(); this.bounds = new Box3()
    this.inverse = new Matrix4(); this.c = new Vec3(); this.impulse = new Vec3(); this.pivot = new Vec3(); this.axis = new Vec3(0,1,0)
    this.drivers = new Map(); this.boxes = new Map(JOINTS.map(([name]) => [name, new Box3()])); this.byName = new Map()
    this.stats = {frames: 0, steps: 0, totalMs: 0, lastMs: 0, maxMs: 0, active: 0, settled: 0, recycled: 0}
  }
  makeBody(mass=1){
    const body=new Body({mass,collisionFilterGroup:DEBRIS,collisionFilterMask:TERRAIN,linearDamping:.15,angularDamping:.3,
      sleepSpeedLimit:.16,sleepTimeLimit:.6})
    body.addShape(new Box(new Vec3(.05,.05,.05)));body.sleep();return body
  }
  primePools(){
    while(this.freeBodies.length<112)this.freeBodies.push(this.makeBody())
    while(this.freeConstraints.length<80)this.freeConstraints.push(new ConeTwistConstraint(this.freeBodies[0],this.freeBodies[1]))
    while(this.freeLimbRecords.length<96)this.freeLimbRecords.push({parts:[{body:null,offset:new Vector3()}],constraints:[],kind:'limb'})
  }
  body(box, position, quaternion, mass) {
    const b=this.freeBodies.pop()||this.makeBody(mass)
    b.mass = mass; b.type = Body.DYNAMIC
    const half = b.shapes[0].halfExtents
    half.set(Math.max(.025, box.x/2), Math.max(.025, box.y/2), Math.max(.025, box.z/2))
    // Resize the resident box hull. Box's rebuild helper allocates a new hull,
    // face arrays, and vectors for every shot. Axis directions stay unchanged.
    const shape=b.shapes[0],hull=shape.convexPolyhedronRepresentation
    for(let i=0;i<8;i++)hull.vertices[i].set(i===1||i===2||i===5||i===6?half.x:-half.x,
      i===2||i===3||i===6||i===7?half.y:-half.y,i>=4?half.z:-half.z)
    hull.worldVerticesNeedsUpdate=true;hull.worldFaceNormalsNeedsUpdate=true;hull.updateBoundingSphereRadius()
    shape.updateBoundingSphereRadius()
    b.updateBoundingRadius(); b.updateMassProperties()
    b.position.copy(position); b.previousPosition.copy(position); b.interpolatedPosition.copy(position)
    b.quaternion.copy(quaternion); b.previousQuaternion.copy(quaternion); b.interpolatedQuaternion.copy(quaternion)
    b.velocity.setZero(); b.angularVelocity.setZero(); b.force.setZero(); b.torque.setZero()
    b.aabbNeedsUpdate = true; b.wakeUp(); this.world.addBody(b)
    return b
  }
  add(visual, unit, impact, release) {
    if(this.activeCount('unit')>=8)this.freeze(this.firstActive('unit'))
    const {rig, object} = visual
    object.updateMatrixWorld(true)
    const record = this.freeUnitRecords.pop() || {parts: [], constraints: [], byBone: new Map(), nodes: [], kind: 'unit'}
    Object.assign(record,{visual,object,release,born:this.clock,settledAt:null,quiet:0,sinkY:object.position.y,
      fadeMesh:null,fadeOriginal:null,fadeMaterial:null,fadeOwned:false})
    record.constraints.length=0;record.byBone.clear();record.nodes.length=0
    this.drivers.clear();this.byName.clear()
    for(const [name] of JOINTS){this.drivers.set(rig.joints[name],name);this.boxes.get(name).makeEmpty()}
    for (const contact of rig.contacts) {
      let bone = contact.bone, hidden = false
      for (let p=bone; p && p!==object; p=p.parent) if (rig.severed.has(p.name)) hidden = true
      if (hidden) continue
      while (bone && !this.drivers.has(bone)) bone = bone.parent
      if (!bone) continue
      this.inverse.copy(bone.matrixWorld).invert()
      for (const corner of contact.corners) {
        this.p.copy(corner).applyMatrix4(contact.bone.matrixWorld).applyMatrix4(this.inverse)
        this.boxes.get(this.drivers.get(bone)).expandByPoint(this.p)
      }
    }
    let partIndex=0
    for (const [index, [name, parentName, angle, twistAngle]] of JOINTS.entries()) {
      const bone = rig.joints[name], box = this.boxes.get(name)
      if (!bone || box.isEmpty()) continue
      box.getCenter(this.center)
      bone.matrixWorld.decompose(this.p, this.q, this.scale)
      box.getSize(this.size).multiply(this.scale).addScalar(.012)
      const part=record.parts[partIndex]||{bone:null,body:null,offset:new Vector3()}
      part.bone=bone;part.offset.copy(this.center).multiply(this.scale)
      if(partIndex===record.parts.length)record.parts.push(part)
      partIndex++
      bone.localToWorld(this.p.copy(this.center))
      const mass = masses[index] * (unit.type==='heavy' ? 1.65 : unit.type==='scout' ? .7 : 1)
      const body = this.body(this.size, this.p, this.q, mass)
      part.body=body
      body.velocity.set(unit.vel?.x||0, unit.vel?.y||0, unit.vel?.z||0)
      // A small off-centre lean also collapses an idle unit without a hit event.
      body.angularVelocity.set(-.2, 0, (index%2 ? -.1 : .1))
      this.byName.set(name,part)
      const parent = this.byName.get(parentName)
      if (!parent || name==='Chest' && rig.goreSplit) continue
      bone.getWorldPosition(this.p)
      this.pivot.set(this.p.x,this.p.y,this.p.z)
      const joint = this.freeConstraints.pop() || new ConeTwistConstraint(parent.body, body)
      joint.bodyA = parent.body; joint.bodyB = body
      for (const equation of joint.equations) { equation.bi = parent.body; equation.bj = body }
      parent.body.pointToLocalFrame(this.pivot, joint.pivotA); body.pointToLocalFrame(this.pivot, joint.pivotB)
      // Limits are relative to the captured gait, so death never snaps to a T pose.
      body.vectorToWorldFrame(this.axis, this.c)
      parent.body.vectorToLocalFrame(this.c, joint.axisA); joint.axisB.set(0,1,0)
      joint.angle = angle; joint.twistAngle = twistAngle; joint.collideConnected = false
      record.constraints.push(joint); this.world.addConstraint(joint)
    }
    record.parts.length=partIndex
    for(const part of record.parts)record.byBone.set(part.bone,part)
    object.traverse(node => record.nodes.push(node))
    rig.ragdoll = true; rig.death = .001; rig.states.add('ragdoll')
    if (rig.muzzleHeat) rig.muzzleHeat.userData.batchVisible = false
    // Physics may throw the bones outside the original animated bounding sphere.
    rig.mesh.frustumCulled = false
    this.records.add(record); this.active.push(record); visual.ragdoll = record
    this.kick(record, impact)
    return record
  }
  kick(record, impact) {
    if (!impact?.weapon) return
    const {direction, point, weapon, headshot} = impact
    const blast=weapon==='grenade'||weapon==='launcher'||weapon==='shell'||weapon==='explosion'
    const strength = weapon==='shotgun' ? 4.8 : blast ? 6 : weapon==='plasma' ? 3.2 : 1.25
    for (const {body} of record.parts) {
      this.impulse.set(direction.x*strength*body.mass, (direction.y*strength+(strength>3?2.3:.25))*body.mass, direction.z*strength*body.mass)
      body.applyImpulse(this.impulse)
    }
    if(strength>3) for(const {body,bone} of record.parts) {
      // A blast loads the torso first. Independent limb inertia breaks the
      // marching silhouette immediately, before the first floor contact.
      if(bone.name==='Pelvis')body.angularVelocity.set(-direction.z*2.8,0,direction.x*2.8)
      if(bone.name.startsWith('Shoulder'))body.angularVelocity.set(-direction.z*1.5,0,bone.name.endsWith('Left')?-2.4:2.4)
      if(bone.name.startsWith('Shin'))body.angularVelocity.set(2.2,0,0)
      if(blast&&record.visual.rig.goreSplit){
        if(bone.name==='Chest'){body.velocity.y+=3;body.angularVelocity.set(-direction.z*5,1,direction.x*5)}
        if(bone.name==='Pelvis'){body.velocity.x-=direction.x*2;body.velocity.z-=direction.z*2;body.velocity.y-=1}
      }
    }
    const target = record.parts.find(p => p.bone.name===(headshot?'Head':'Chest')) || record.parts[0]
    if (target && point) {
      const {body} = target
      this.c.set(point.x-body.position.x, point.y-body.position.y, point.z-body.position.z)
      this.impulse.set(direction.x*body.mass*2, direction.y*body.mass*2, direction.z*body.mass*2)
      body.applyImpulse(this.impulse, this.c)
      if (headshot) {
        const spin=record.visual.gore?.crunch?1.5:9
        body.angularVelocity.set(-direction.z*spin,1.5,direction.x*spin)
      }
      else if(strength>3) body.angularVelocity.set(-direction.z*4, .4, direction.x*4)
    }
  }
  addDetached(mesh, velocity, release, direction) {
    if(this.activeCount('limb')>=24)this.freeze(this.firstActive('limb'))
    const geometry=mesh.geometry
    if(!geometry.boundingBox)geometry.computeBoundingBox()
    const center=geometry.userData.ragdollCenter||geometry.boundingBox.getCenter(this.center)
    const size=geometry.userData.ragdollSize||geometry.boundingBox.getSize(this.size)
    mesh.updateMatrixWorld(true); mesh.matrixWorld.decompose(this.p, this.q, this.scale)
    mesh.localToWorld(this.p.copy(center))
    this.size.copy(size).multiply(this.scale).addScalar(.012)
    const body = this.body(this.size, this.p, this.q, 3)
    body.velocity.copy(velocity); body.angularVelocity.set(3,1,2)
    if(direction)body.angularVelocity.set(-direction.z*9,1.7,direction.x*9)
    const record=this.freeLimbRecords.pop()||{parts:[{body:null,offset:new Vector3()}],constraints:[],kind:'limb'}
    record.parts[0].body=body;record.parts[0].offset.copy(center).multiply(this.scale)
    Object.assign(record,{object:mesh,release,born:this.clock,settledAt:null,quiet:0,sinkY:mesh.position.y,
      fadeMesh:null,fadeOriginal:null,fadeMaterial:null,fadeOwned:false})
    this.records.add(record); this.active.push(record)
    return record
  }
  detachBone(record,bone) {
    if(!record||record.settledAt!==null)return
    for(let i=record.parts.length-1;i>=0;i--) {
      const part=record.parts[i];let under=false
      for(let node=part.bone;node;node=node.parent)if(node===bone){under=true;break}
      if(!under)continue
      for(let j=record.constraints.length-1;j>=0;j--) {
        const joint=record.constraints[j]
        if(joint.bodyA!==part.body&&joint.bodyB!==part.body)continue
        this.world.removeConstraint(joint);this.freeConstraints.push(joint);record.constraints.splice(j,1)
      }
      this.world.removeBody(part.body);part.body.sleep();this.freeBodies.push(part.body)
      record.byBone.delete(part.bone);part.body=null;record.parts.splice(i,1)
    }
  }
  activeCount(kind){let count=0;for(const record of this.active)if(record.kind===kind)count++;return count}
  firstActive(kind){for(const record of this.active)if(record.kind===kind)return record;return null}
  syncPose(record) {
    if (record.kind==='limb') {
      const {body, offset} = record.parts[0]
      record.object.quaternion.copy(body.quaternion)
      record.object.position.copy(body.position).sub(this.p.copy(offset).applyQuaternion(record.object.quaternion))
      record.object.updateMatrixWorld(true)
      return
    }
    // One top-down pass keeps parent matrices current before solving child locals.
    for (const node of record.nodes) {
      const part = record.byBone.get(node)
      if (part) {
        this.q.copy(part.body.quaternion)
        this.p.copy(part.offset).applyQuaternion(this.q).negate().add(part.body.position)
        this.inverse.copy(node.parent.matrixWorld).invert()
        node.position.copy(this.p).applyMatrix4(this.inverse)
        this.bodyQuaternion.copy(part.body.quaternion)
        this.q.setFromRotationMatrix(this.inverse.extractRotation(this.inverse)).multiply(this.bodyQuaternion)
        node.quaternion.copy(this.q)
      }
      node.updateMatrix()
      if (node.parent) node.matrixWorld.multiplyMatrices(node.parent.matrixWorld, node.matrix)
      else node.matrixWorld.copy(node.matrix)
    }
    updateUnitActuators(record.visual.rig)
    for(const a of record.visual.rig.actuators) a.bone.updateMatrixWorld(true)
  }
  freeze(record) {
    if(!record||record.settledAt!==null)return
    this.syncPose(record)
    record.settledAt = this.clock; record.sinkY = record.object.position.y
    if(record.visual) {
      const {rig}=record.visual,bounds=this.bounds.makeEmpty()
      this.inverse.copy(rig.mesh.matrixWorld).invert()
      for(const contact of rig.contacts)for(const corner of contact.corners) {
        this.p.copy(corner).applyMatrix4(contact.bone.matrixWorld).applyMatrix4(this.inverse);bounds.expandByPoint(this.p)
      }
      rig.ragdollBounds||=new Sphere()
      rig.mesh.boundingSphere=bounds.getBoundingSphere(rig.ragdollBounds);rig.mesh.frustumCulled=true
    }
    for (const joint of record.constraints) { this.world.removeConstraint(joint); this.freeConstraints.push(joint) }
    record.constraints.length=0
    for (const part of record.parts) {
      const {body}=part
      this.world.removeBody(body);body.sleep();this.freeBodies.push(body);part.body=null
    }
    record.byBone?.clear();if(record.nodes)record.nodes.length=0
    this.active.splice(this.active.indexOf(record), 1)
    this.stats.settled++
  }
  update(dt) {
    const start = performance.now()
    this.accumulator += Math.max(0, Math.min(.1, dt))
    let steps = 0
    while (this.accumulator + 1e-9 >= RAGDOLL_STEP) {
      this.accumulator -= RAGDOLL_STEP; this.clock += RAGDOLL_STEP; steps++
      if (this.active.length) this.world.step(RAGDOLL_STEP)
      for (let i=this.active.length-1; i>=0; i--) {
        const record = this.active[i]
        const quiet = record.parts.every(({body}) => body.sleepState===Body.SLEEPING ||
          body.velocity.lengthSquared()<.012 && body.angularVelocity.lengthSquared()<.06)
        record.quiet = quiet ? record.quiet+RAGDOLL_STEP : 0
        if (record.quiet>.65 || this.clock-record.born>14) this.freeze(record)
      }
    }
    if (steps) for (const record of this.active) this.syncPose(record)
    for (const record of this.records) {
      if (record.visual) {
        record.visual.rig.death = this.clock-record.born+.001
        if (record.visual.rig.eyes) record.visual.rig.eyes.visible = false
      }
      if (record.settledAt===null) continue
      const fade = Math.max(0, (this.clock-record.settledAt-WRECK_SECONDS)/WRECK_FADE_SECONDS)
      if (fade>=1) { this.release(record); continue }
      if (fade<=0) continue
      if(!record.fadeMaterial) {
        const mesh = record.visual?.rig.mesh || record.object
        const original=mesh.material
        const prepared=record.visual?.rig.wreckMaterial||record.object.userData.wreckMaterial
        const material=prepared||original.clone()
        material.transparent = true; material.depthWrite = false
        mesh.material=material
        record.fadeMesh=mesh;record.fadeOriginal=original;record.fadeMaterial=material;record.fadeOwned=!prepared
      }
      record.object.position.y = record.sinkY - fade*.65
      record.fadeMaterial.opacity=1-fade
      record.object.updateMatrixWorld(true)
    }
    const ms = performance.now()-start
    Object.assign(this.stats, {frames: this.stats.frames+1, steps: this.stats.steps+steps,
      lastMs: ms, totalMs: this.stats.totalMs+ms, maxMs: Math.max(this.stats.maxMs,ms), active: this.activeCount('unit')})
  }
  release(record) {
    if(!this.records.has(record))return
    if (record.settledAt===null) this.freeze(record)
    if(record.fadeMaterial){
      record.fadeMesh.material=record.fadeOriginal;record.fadeMaterial.opacity=1
      if(record.fadeOwned)record.fadeMaterial.dispose()
    }
    this.records.delete(record);record.release?.();this.stats.recycled++
    if(record.kind==='limb')this.freeLimbRecords.push(record);else this.freeUnitRecords.push(record)
  }
  reset(){
    for(const record of [...this.records])this.release(record)
    this.active.length=0;this.clock=0;this.accumulator=0
    Object.assign(this.stats,{frames:0,steps:0,totalMs:0,lastMs:0,maxMs:0,active:0,settled:0,recycled:0})
  }
  dispose() {
    for(const record of [...this.records])this.release(record)
    for (const body of this.terrain) this.world.removeBody(body)
    this.terrain=[];this.freeBodies=[];this.freeConstraints=[];this.freeUnitRecords=[];this.freeLimbRecords=[]
  }
}

// Match the rendered stair treads, cut the floor slab around movement holes,
// and reproduce the ramp's segmented top instead of colliding with its AABB.
export function buildRagdollTerrain(map) {
  const bodies=[]
  const add=(id, shape, position)=>{
    const b=new Body({mass:0, shape, position:new Vec3(position.x,position.y,position.z),
      collisionFilterGroup:TERRAIN, collisionFilterMask:DEBRIS})
    b.mapColliderId=id; bodies.push(b)
  }
  const box=(id,x0,x1,y0,y1,z0,z1)=>{
    if (x1<=x0 || y1<=y0 || z1<=z0) return
    add(id,new Box(new Vec3((x1-x0)/2,(y1-y0)/2,(z1-z0)/2)),{x:(x0+x1)/2,y:(y0+y1)/2,z:(z0+z1)/2})
  }
  for (const collider of map.colliders) {
    const {id,center:p,size:s}=collider, x0=p.x-s.x/2,x1=p.x+s.x/2,z0=p.z-s.z/2,z1=p.z+s.z/2
    const y0=p.y-s.y/2
    const surface=map.walkable?.surfaces?.find(item=>item.collider===id)
    const y1=surface?.height==='stairTread' ? p.y+map.walkable.heightRules.stairTreadOffset : p.y+s.y/2
    if (surface?.height==='ramp') {
      const axis=surface.axis, start=axis==='x'?x0:z0, length=axis==='x'?s.x:s.z
      const height=t=>Math.max(y0+.001,Math.min(y1,surface.low+Math.max(0,Math.min(1,(t-surface.from)/(surface.to-surface.from)))*(surface.high-surface.low)))
      for(let i=0;i<8;i++) {
        const a=start+length*i/8,b=start+length*(i+1)/8
        const points=axis==='x' ? [[a,y0,z0],[b,y0,z0],[b,y0,z1],[a,y0,z1],[a,height(a),z0],[b,height(b),z0],[b,height(b),z1],[a,height(a),z1]]
          : [[x0,y0,a],[x1,y0,a],[x1,y0,b],[x0,y0,b],[x0,height(a),a],[x1,height(a),a],[x1,height(b),b],[x0,height(b),b]]
        const center={x:axis==='x'?(a+b)/2:p.x,y:(y0+(height(a)+height(b))/2)/2,z:axis==='z'?(a+b)/2:p.z}
        const shape=new ConvexPolyhedron({vertices:points.map(v=>new Vec3(v[0]-center.x,v[1]-center.y,v[2]-center.z)),faces:[[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]})
        add(id,shape,center)
      }
      continue
    }
    let rects=[{x0,x1,z0,z1}]
    for(const h of map.walkable?.movementHoles||[]) if(h.collider===id) {
      rects=rects.flatMap(r=>{
        const a=Math.max(r.x0,h.minX),b=Math.min(r.x1,h.maxX),c=Math.max(r.z0,h.minZ),d=Math.min(r.z1,h.maxZ)
        if(a>=b||c>=d)return[r]
        return[{...r,x1:a},{...r,x0:b},{x0:a,x1:b,z0:r.z0,z1:c},{x0:a,x1:b,z0:d,z1:r.z1}]
      })
    }
    for(const r of rects) box(id,r.x0,r.x1,y0,y1,r.z0,r.z1)
  }
  return bodies
}
