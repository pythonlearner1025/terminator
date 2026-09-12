import * as E from 'threepipe'
import {unitGround, hitUnitRig} from './units-animation.js'
import {WRECK_SECONDS} from './ragdoll.js'

export const GORE_VERTEX_CAP = 384
export const GORE_DENT_CAP = 8
export const GORE_ACTIVE_PIECES = 24
export const GORE_PIECE_CAP = 96
export const GORE_CRUNCH_SECONDS = .06
export const GORE_PARTS = Object.freeze([
  'Head', 'Upper Arm Left', 'Upper Arm Right', 'Forearm Left', 'Forearm Right',
  'Thigh Left', 'Thigh Right', 'Shin Left', 'Shin Right',
])
export const GORE_SPLIT = 1 << 9
export const GORE_DENT = 1 << 10
const UP = new E.Vector3(0, 1, 0), FORWARD = new E.Vector3(0, 0, 1)
const NO_RAYCAST = () => {}
const aliases = new Map()
for (let i = 0; i < GORE_PARTS.length; i++) aliases.set(GORE_PARTS[i].toLowerCase(), i)
for (const [key, index] of [['head',0],['skull',0],['left arm',1],['arm left',1],['right arm',2],['arm right',2],
  ['shoulder left',1],['shoulder right',2],['hand left',3],['hand right',4],
  ['left leg',5],['leg left',5],['right leg',6],['leg right',6],['foot left',7],['foot right',8]]) aliases.set(key, index)

for(const [key,index]of [...aliases]){
  const title=key.replace(/\b\w/g,c=>c.toUpperCase())
  aliases.set(title,index);aliases.set(title.replaceAll(' ','_'),index);aliases.set(key.replaceAll(' ','_'),index)
}
export function gorePart(part) { return aliases.get(part) ?? -1 }
export function isGoreBlast(weapon) { return weapon === 'grenade' || weapon === 'launcher' || weapon === 'shell' || weapon === 'explosion' }

// A bit mask avoids allocating a decision or list for each pellet. HP comes
// from the unit snapshot, including difficulty and co-op scaling.
export function goreDecision(event, hpMax, fallbackPart) {
  const part = gorePart(event.part || fallbackPart), blast = isGoreBlast(event.weapon)
  if (event.type === 'kill') {
    let mask = event.headshot ? 1 : 0
    if (blast) mask |= GORE_SPLIT | (1 << 1) | (1 << 2) | (1 << 5) | (1 << 6)
    else if (event.weapon === 'shotgun' && part > 0) mask |= 1 << part
    return mask
  }
  if (event.type !== 'unit_damage') return 0
  let mask = event.amount >= 65 || blast ? GORE_DENT : 0
  if (part > 0 && hpMax > 0 && event.amount >= hpMax * .6) mask |= 1 << part
  return mask
}

export function primeGorePaths(gore,visuals,states,point,direction) {
  const heavy=visuals[2],endo=visuals[1],scout=visuals[0]
  gore.detach(heavy,'Forearm Left',direction,0)
  const head=endo.rig.joints.Head
  head.getWorldPosition(point);point.z+=.11
  gore.event({type:'kill',weapon:'m4',headshot:true},endo,states[1],head,point,direction)
  gore.update(GORE_CRUNCH_SECONDS)
  gore.event({type:'kill',weapon:'grenade'},scout,states[0],scout.rig.joints.Chest,point,direction)
  const chest=heavy.rig.joints.Chest
  chest.getWorldPosition(point);point.addScaledVector(direction,.14)
  gore.deform(heavy,chest,point,direction)
}

// Each runtime rig owns writable positions and normals. UVs, weights, and
// template positions remain shared and immutable. Only touched triangles upload.
export class GoreDeformer {
  constructor(source) {
    this.source = source
    this.geometry = new E.BufferGeometry()
    for (const name in source.attributes) this.geometry.setAttribute(name,
      name === 'position' || name === 'normal' ? source.attributes[name].clone() : source.attributes[name])
    this.geometry.index = source.index
    this.geometry.userData = source.userData
    this.geometry.attributes.position.setUsage(E.DynamicDrawUsage)
    this.geometry.attributes.normal?.setUsage(E.DynamicDrawUsage)
    this.slots = Array.from({length:GORE_DENT_CAP + 1}, () => ({count:0,progress:0,
      indices:new Uint32Array(GORE_VERTEX_CAP), delta:new Float32Array(GORE_VERTEX_CAP * 3),
      vector:new E.Vector3(), radius:0,depth:0,point:new E.Vector3()}))
    this.nearest = new Uint32Array(GORE_VERTEX_CAP / 3)
    this.distances = new Float32Array(GORE_VERTEX_CAP / 3)
    this.next = 1; this.changed = false; this.lastVertexCount = 0
    this.positionRange={start:0,count:0};this.normalRange={start:0,count:0}
    this.a = new E.Vector3(); this.b = new E.Vector3(); this.c = new E.Vector3()
    this.byBone = source.userData.goreTriangles
    if (!this.byBone) {
      const lists = [], p = source.attributes.position, skin = source.attributes.skinIndex
      for (let i = 0; i < p.count; i += 3) (lists[skin?.getX(i) || 0] ||= []).push(i)
      this.byBone = lists.map(list => new Uint32Array(list))
      source.userData.goreTriangles = this.byBone
    }
  }
  clearSlot(slot) {
    const p = this.geometry.attributes.position.array
    for (let i = 0; i < slot.count; i++) {
      const at = slot.indices[i] * 3, d = i * 3
      p[at] -= slot.delta[d]; p[at+1] -= slot.delta[d+1]; p[at+2] -= slot.delta[d+2]
    }
    if (slot.count) this.normals(slot)
    slot.count = 0; slot.progress = 0; slot.delta.fill(0)
  }
  begin(point, vector, boneId, radius = .13, depth = .055, crunch = false) {
    const slot = this.slots[crunch ? 0 : this.next]
    if (!crunch) this.next = 1 + this.next % GORE_DENT_CAP
    this.clearSlot(slot)
    const p = this.geometry.attributes.position.array, candidates = this.byBone[boneId]
    if (!candidates) return slot
    // Bounded max-heap of triangle centroids. Work scales with the impacted
    // rigid bone, never all unit geometry, and writes at most 384 vertices.
    let count = 0
    for (let j = 0; j < candidates.length; j++) {
      const at = candidates[j] * 3
      const dx = (p[at]+p[at+3]+p[at+6])/3-point.x
      const dy = (p[at+1]+p[at+4]+p[at+7])/3-point.y
      const dz = (p[at+2]+p[at+5]+p[at+8])/3-point.z
      const distance = dx*dx+dy*dy+dz*dz
      if (distance > radius*radius || count === this.nearest.length && distance >= this.distances[0]) continue
      if (count < this.nearest.length) {
        let child = count++
        while (child > 0) {
          const parent = (child-1) >> 1
          if (this.distances[parent] >= distance) break
          this.distances[child] = this.distances[parent]; this.nearest[child] = this.nearest[parent]; child = parent
        }
        this.distances[child] = distance; this.nearest[child] = candidates[j]
      } else {
        let parent = 0
        while (parent*2+1 < count) {
          let child = parent*2+1
          if (child+1 < count && this.distances[child+1] > this.distances[child]) child++
          if (this.distances[child] <= distance) break
          this.distances[parent] = this.distances[child]; this.nearest[parent] = this.nearest[child]; parent = child
        }
        this.distances[parent] = distance; this.nearest[parent] = candidates[j]
      }
    }
    slot.point.copy(point); slot.vector.copy(vector).normalize(); slot.depth = depth
    slot.radius = Math.min(radius, Math.sqrt(this.distances[0] || radius*radius) + .006)
    for (let i = 0; i < count; i++) for (let v = 0; v < 3; v++) slot.indices[slot.count++] = this.nearest[i]+v
    this.lastVertexCount = slot.count
    if (!crunch) this.apply(slot, 1)
    return slot
  }
  apply(slot, progress) {
    const p = this.geometry.attributes.position.array, base = this.source.attributes.position.array
    const step = progress - slot.progress
    if (step <= 0 || !slot.count) return
    for (let i = 0; i < slot.count; i++) {
      const at = slot.indices[i]*3, d = i*3
      const distance = Math.hypot(base[at]-slot.point.x,base[at+1]-slot.point.y,base[at+2]-slot.point.z)
      const f = Math.max(0, 1-distance/slot.radius), weight = f*f*(3-2*f)*slot.depth*step
      for (let axis = 0; axis < 3; axis++) {
        const delta = (axis===0?slot.vector.x:axis===1?slot.vector.y:slot.vector.z)*weight
        const next = Math.max(base[at+axis]-.16, Math.min(base[at+axis]+.16, p[at+axis]+delta))
        slot.delta[d+axis] += next-p[at+axis]; p[at+axis] = next
      }
    }
    slot.progress = progress; this.changed = true; this.normals(slot)
  }
  normals(slot) {
    const p = this.geometry.attributes.position, n = this.geometry.attributes.normal
    let low=Infinity,high=0
    for (let i = 0; i < slot.count; i += 3) {
      const a = slot.indices[i], b = slot.indices[i+1], c = slot.indices[i+2]
      low=Math.min(low,a*3);high=Math.max(high,(c+1)*3)
      this.a.fromBufferAttribute(p,a);this.b.fromBufferAttribute(p,b);this.c.fromBufferAttribute(p,c)
      this.c.sub(this.b);this.a.sub(this.b);this.c.cross(this.a).normalize()
      if (n) for (let j = 0; j < 3; j++) n.setXYZ(slot.indices[i+j],this.c.x,this.c.y,this.c.z)
    }
    // Buffers already exist. Updating their contents cannot change topology.
    if(Number.isFinite(low)){
      this.dirtyRange(p,this.positionRange,low,high)
      if(n)this.dirtyRange(n,this.normalRange,low,high)
    }
  }
  dirtyRange(attribute,range,low,high){
    if(attribute.updateRanges.length){low=Math.min(low,range.start);high=Math.max(high,range.start+range.count)}
    range.start=low;range.count=high-low
    if(!attribute.updateRanges.length)attribute.updateRanges.push(range)
    attribute.needsUpdate=true
  }
  reset() {
    this.geometry.attributes.position.array.set(this.source.attributes.position.array)
    this.geometry.attributes.normal?.array.set(this.source.attributes.normal.array)
    this.geometry.attributes.position.needsUpdate = true
    if (this.geometry.attributes.normal) this.geometry.attributes.normal.needsUpdate = true
    this.geometry.attributes.position.clearUpdateRanges();this.geometry.attributes.normal?.clearUpdateRanges()
    for (const slot of this.slots) {slot.count=0;slot.progress=0;slot.delta.fill(0)}
    this.next=1;this.changed=false;this.lastVertexCount=0
  }
  dispose() { this.geometry.dispose() }
}

// Retained pieces have a larger fixed pool than active physics. Capacity pressure
// evicts the oldest retained piece. Ordinary expiry uses the 180s wreck rule.
export class GorePiecePool {
  constructor(make, capacity = GORE_PIECE_CAP) {
    this.items = Array.from({length:capacity}, (_,index) => make(index))
    this.next = 0; this.acquired = 0
  }
  take() {
    let item = null
    for (let i=0;i<this.items.length;i++) {
      const candidate=this.items[(this.next+i)%this.items.length]
      if (!candidate.record) {item=candidate;this.next=(this.next+i+1)%this.items.length;break}
      if (!item || candidate.born < item.born) item=candidate
    }
    item.release();this.acquired++;return item
  }
  reset() {for (const item of this.items) item.release();this.next=0}
}

export class GoreSystem {
  constructor(parent, ragdolls, fx, materials) {
    this.ragdolls=ragdolls;this.fx=fx;this.materials=materials
    this.root=new E.Group();this.root.name='Pooled machine gore';parent.add(this.root)
    this.definitions=new Map();this.visuals=new Set();this.clock=0
    this.v=new E.Vector3();this.p=new E.Vector3();this.d=new E.Vector3();this.n=new E.Vector3();this.scale=new E.Vector3()
    this.inverse=new E.Matrix4();this.bind=new E.Matrix4();this.rotation=new E.Matrix3();this.temp=new E.Object3D()
    this.hit={bone:null,point:new E.Vector3(),normal:new E.Vector3()};this.ray=new E.Ray()
    this.obstacles=ragdolls.terrain.map(body=>{
      body.updateAABB()
      return new E.Box3(new E.Vector3().copy(body.aabb.lowerBound),new E.Vector3().copy(body.aabb.upperBound))
    })
    this.stats={crunches:0,limbs:0,splits:0,dents:0,fallbacks:0,stains:0,wreckHits:0,maxVertices:0,frames:0,totalMs:0,maxMs:0}
    this.placeholder=new E.BoxGeometry(.08,.06,.1)
    atlas(this.placeholder,0)
    this.pieces=new GorePiecePool(index=>{
      const mesh=new E.Mesh2(this.placeholder,materials.metal),fade=materials.metal.clone()
      fade.name='Gore piece fade';fade.transparent=true;fade.depthWrite=false
      mesh.userData.wreckMaterial=fade;mesh.visible=false;mesh.frustumCulled=false;mesh.raycast=NO_RAYCAST;this.root.add(mesh)
      const item={mesh,fade,record:null,born:0,trail:0,floor:0,pieceGeometry:null}
      item.onRelease=()=>{item.record=null;mesh.visible=false;item.trail=0}
      item.release=()=>{if(item.record)this.ragdolls.release(item.record);item.onRelease()}
      return item
    })
    this.stumps=Array.from({length:128},()=>({owner:null,bone:null,pos:new E.Vector3(),q:new E.Quaternion(),size:1}))
    this.nextStump=0
    this.stumpMesh=new E.InstancedMesh(fractureGeometry(),materials.metal,this.stumps.length)
    this.stumpMesh.name='Torn hydraulic sockets and copper leads';this.stumpMesh.frustumCulled=false;this.stumpMesh.raycast=NO_RAYCAST
    this.stumpMesh.instanceMatrix.setUsage(E.DynamicDrawUsage);this.stumpMesh.count=0;this.root.add(this.stumpMesh)
    const loader=new E.TextureLoader(),pending=[]
    const load=(name,srgb=false)=>{
      let done,fail;pending.push(new Promise((resolve,reject)=>{done=resolve;fail=reject}))
      const map=loader.load(new URL(`../../assets/textures/gore/fluid-${name}.png`,import.meta.url).href,done,undefined,fail)
      map.colorSpace=srgb?E.SRGBColorSpace:E.NoColorSpace;map.name='Hydraulic '+name;return map
    }
    const albedo=load('albedo',true),normal=load('normal'),orm=load('orm')
    this.fluidMaterial=new E.PhysicalMaterial({name:'Wet black hydraulic fluid',map:albedo,normalMap:normal,roughnessMap:orm,
      metalnessMap:orm,aoMap:orm,metalness:0,roughness:1,transparent:true,alphaTest:.06,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,envMap:materials.environment,envMapIntensity:.8})
    this.fluidMaterial.userData.renderToGBuffer=false
    const dropMaterial=this.fluidMaterial.clone();dropMaterial.name='Opaque hydraulic droplets';dropMaterial.transparent=false;dropMaterial.depthWrite=true;dropMaterial.alphaTest=0
    const hot=materials.metal.clone();hot.name='Glowing torn metal';hot.emissive.setHex(0xff5208);hot.emissiveMap=materials.glowMap;hot.emissiveIntensity=.75
    this.particles=[this.makeParticles('Hydraulic spray',new E.SphereGeometry(1,5,3),dropMaterial,160,true),
      this.makeParticles('Hot steel splinters',atlas(new E.TetrahedronGeometry(1),3),hot,96,false)]
    this.stains=Array.from({length:64},()=>({life:0,pos:new E.Vector3(),size:0,angle:0}))
    this.nextStain=0
    this.stainMesh=new E.InstancedMesh(new E.PlaneGeometry(1,1),this.fluidMaterial,64)
    this.stainMesh.name='64 hydraulic floor stains';this.stainMesh.frustumCulled=false;this.stainMesh.raycast=NO_RAYCAST
    this.stainMesh.instanceMatrix.setUsage(E.DynamicDrawUsage);this.stainMesh.count=0;this.root.add(this.stainMesh)
    this.ready=Promise.all(pending)
  }
  makeParticles(name,geometry,material,capacity,fluid) {
    const mesh=new E.InstancedMesh(geometry,material,capacity);mesh.name=name;mesh.frustumCulled=false;mesh.raycast=NO_RAYCAST
    mesh.instanceMatrix.setUsage(E.DynamicDrawUsage);mesh.count=0;this.root.add(mesh)
    return {mesh,fluid,next:0,items:Array.from({length:capacity},()=>({life:0,max:0,pos:new E.Vector3(),vel:new E.Vector3(),size:0,floor:0,angle:0}))}
  }
  prepareType(visual) {
    if(this.definitions.has(visual.unitType))return
    const rig=visual.rig,source=rig?.mesh,definitions=new Map()
    if(!source?.isSkinnedMesh||source.geometry.index){this.definitions.set(visual.unitType,definitions);return}
    visual.object.updateMatrixWorld(true);source.skeleton.update()
    for(const name of GORE_PARTS) {
      const bone=rig.joints[name];if(!bone)continue
      const ids=new Set();bone.traverse(child=>{const i=source.skeleton.bones.indexOf(child);if(i>=0)ids.add(i)})
      const positions=[],normals=[],uvs=[],original=[],skin=source.geometry.attributes.skinIndex,uv=source.geometry.attributes.uv
      this.inverse.copy(bone.matrixWorld).invert().multiply(source.matrixWorld)
      this.rotation.getNormalMatrix(this.inverse)
      for(let i=0;i<skin.count;i++)if(ids.has(skin.getX(i))) {
        source.getVertexPosition(i,this.v).applyMatrix4(this.inverse)
        positions.push(this.v.x,this.v.y,this.v.z);uvs.push(uv.getX(i),uv.getY(i));original.push(i)
        this.n.fromBufferAttribute(source.geometry.attributes.normal,i).applyMatrix3(this.rotation).normalize()
        normals.push(this.n.x,this.n.y,this.n.z)
      }
      if(!positions.length)continue
      const geometry=new E.BufferGeometry()
      geometry.setAttribute('position',new E.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new E.Float32BufferAttribute(uvs,2))
      geometry.setAttribute('normal',new E.Float32BufferAttribute(normals,3));geometry.computeBoundingBox();geometry.computeBoundingSphere()
      geometry.userData.ragdollCenter=geometry.boundingBox.getCenter(new E.Vector3())
      geometry.userData.ragdollSize=geometry.boundingBox.getSize(new E.Vector3())
      const sections=[]
      for(let i=0;i<original.length;i++){
        const boneId=skin.getX(original[i]),previous=sections[sections.length-1]
        if(previous?.boneId===boneId)previous.end=i+1
        else sections.push({boneId,start:i,end:i+1})
      }
      const definition={geometry,sections,original:new Uint32Array(original)}
      definitions.set(name,definition)
    }
    this.definitions.set(visual.unitType,definitions)
  }
  primePieces() {
    let count=0
    for(const definitions of this.definitions.values())for(const d of definitions.values())count=Math.max(count,d.geometry.attributes.position.count)
    for(const item of this.pieces.items) {
      if(item.pieceGeometry)continue
      const geometry=new E.BufferGeometry()
      for(const [name,size]of [['position',3],['normal',3],['uv',2]])geometry.setAttribute(name,new E.BufferAttribute(new Float32Array(count*size),size).setUsage(E.DynamicDrawUsage))
      geometry.boundingBox=new E.Box3();geometry.boundingSphere=new E.Sphere()
      geometry.userData.ragdollCenter=new E.Vector3();geometry.userData.ragdollSize=new E.Vector3()
      geometry.setDrawRange(0,3);item.pieceGeometry=geometry;item.mesh.geometry=geometry
    }
  }
  prepareVisual(visual) {
    if(visual.gore)return
    const rig=visual.rig
    if(!rig?.mesh?.geometry?.attributes.skinIndex||rig.mesh.geometry.index)return
    const deformer=new GoreDeformer(rig.highGeometry||rig.mesh.geometry)
    rig.highGeometry=deformer.geometry;rig.mesh.geometry=deformer.geometry
    visual.gore={deformer,crunch:null,age:0,headDirection:new E.Vector3(),floor:0,split:false,lastPart:null,
      lastPoint:new E.Vector3(),lastDirection:new E.Vector3(0,0,1)}
    this.visuals.add(visual)
  }
  resetVisual(visual) {
    const g=visual.gore;if(!g)return
    g.deformer.reset();g.crunch=null;g.age=0;g.split=false;g.lastPart=null
    visual.rig.goreSplit=false;visual.rig.crawl=0;visual.rig.eyesDead=false
    for(const stump of this.stumps)if(stump.owner===visual){stump.owner=null;stump.bone=null}
  }
  releaseVisual(visual) {
    const g=visual.gore;if(g){g.crunch=null;for(const stump of this.stumps)if(stump.owner===visual){stump.owner=null;stump.bone=null}}
  }
  deform(visual,bone,pos,direction,crunch=false) {
    const g=visual.gore,mesh=visual.rig.mesh;if(!g||!bone)return null
    const index=mesh.skeleton.bones.indexOf(bone);if(index<0)return null
    this.inverse.copy(bone.matrixWorld).invert();this.bind.copy(mesh.skeleton.boneInverses[index]).invert()
    this.p.copy(pos).applyMatrix4(this.inverse).applyMatrix4(this.bind)
    this.d.copy(direction).transformDirection(this.inverse).transformDirection(this.bind)
    const slot=g.deformer.begin(this.p,this.d,index,crunch?.145:.19,crunch?.13:.065,crunch)
    this.stats.maxVertices=Math.max(this.stats.maxVertices,slot.count)
    if(!crunch&&slot.count)this.stats.dents++
    return slot
  }
  event(event,visual,unit,bone,pos,direction) {
    if(!visual)return
    const g=visual.gore,rig=visual.rig
    if(!g){this.burst(pos,direction,unit?.pos.y||0,1);this.stats.fallbacks++;return}
    const fallback=bone?.name||g?.lastPart
    const decision=goreDecision(event,unit?.maxHp||unit?.hpMax, fallback)
    if(g&&event.type==='unit_damage'){g.lastPart=event.part||fallback;g.lastPoint.copy(pos);g.lastDirection.copy(direction)}
    if(decision&GORE_DENT)this.deform(visual,bone,pos,direction)
    if(event.type==='unit_damage'&&isGoreBlast(event.weapon))this.fx.scorch(visual,bone,pos,direction)
    if(decision&1&&!rig.severed?.has('Head')&&!g?.crunch) {
      const head=rig.joints?.Head
      if(g&&head) {
        rig.eyesDead=true;if(rig.eyes)rig.eyes.visible=false
        g.crunch=this.deform(visual,head,pos,direction,true);g.age=0;g.headDirection.copy(direction);g.floor=unit?.pos.y||0
        this.stats.crunches++
      } else this.burst(pos,direction,unit?.pos.y||0,1)
    }
    for(let i=1;i<GORE_PARTS.length;i++)if(decision&(1<<i))this.detach(visual,GORE_PARTS[i],direction,unit?.pos.y||0)
    if(decision&GORE_SPLIT&&!g?.split) {
      if(g&&rig.joints.Chest&&rig.joints.Pelvis) {
        g.split=true;rig.goreSplit=true;this.stats.splits++
        const chest=rig.joints.Chest,spine=rig.joints.Spine||rig.joints.Pelvis
        this.stump(visual,chest,this.v.set(0,-.08,0),2.2,true)
        this.stump(visual,spine,this.v.set(0,.12,0),1.6)
        chest.getWorldPosition(this.v);this.burst(this.v,direction,unit.pos.y,2)
      } else this.burst(pos,direction,unit?.pos.y||0,2)
    }
    if(decision&&!g){this.stats.fallbacks++}
  }
  detach(visual,name,direction,floor) {
    const rig=visual.rig,bone=rig?.joints?.[name]
    if(bone)for(let p=bone;p&&p!==visual.object;p=p.parent)if(rig.severed?.has(p.name))return null
    const definition=this.definitions.get(visual.unitType)?.get(name)
    if(!bone||!definition){this.burst(visual.object.position,direction,floor,1);this.stats.fallbacks++;return null}
    const item=this.pieces.take(),mesh=item.mesh
    if(item.pieceGeometry) {
      const geometry=item.pieceGeometry,source=definition.geometry
      geometry.attributes.uv.array.set(source.attributes.uv.array)
      const live=visual.gore.deformer.geometry.attributes,p=geometry.attributes.position,n=geometry.attributes.normal
      const positions=live.position.array,normals=live.normal.array,output=p.array,normalOutput=n.array,original=definition.original
      this.inverse.copy(bone.matrixWorld).invert()
      for(const section of definition.sections){
        this.bind.multiplyMatrices(this.inverse,rig.mesh.skeleton.bones[section.boneId].matrixWorld)
          .multiply(rig.mesh.skeleton.boneInverses[section.boneId]).multiply(rig.mesh.bindMatrix)
        this.rotation.getNormalMatrix(this.bind)
        const m=this.bind.elements,r=this.rotation.elements
        for(let i=section.start;i<section.end;i++){
          const at=original[i]*3,to=i*3,x=positions[at],y=positions[at+1],z=positions[at+2]
          output[to]=m[0]*x+m[4]*y+m[8]*z+m[12]
          output[to+1]=m[1]*x+m[5]*y+m[9]*z+m[13]
          output[to+2]=m[2]*x+m[6]*y+m[10]*z+m[14]
          const nx=normals[at],ny=normals[at+1],nz=normals[at+2]
          normalOutput[to]=r[0]*nx+r[3]*ny+r[6]*nz
          normalOutput[to+1]=r[1]*nx+r[4]*ny+r[7]*nz
          normalOutput[to+2]=r[2]*nx+r[5]*ny+r[8]*nz
        }
      }
      p.needsUpdate=true;n.needsUpdate=true;geometry.attributes.uv.needsUpdate=true
      geometry.setDrawRange(0,source.attributes.position.count)
      geometry.boundingBox.copy(source.boundingBox);geometry.boundingSphere.copy(source.boundingSphere)
      geometry.userData.ragdollCenter.copy(source.userData.ragdollCenter);geometry.userData.ragdollSize.copy(source.userData.ragdollSize)
    }else mesh.geometry=definition.geometry
    bone.getWorldPosition(mesh.position);bone.getWorldQuaternion(mesh.quaternion);bone.getWorldScale(mesh.scale)
    mesh.name='Detached '+name;mesh.visible=true
    const impulse=isGoreBlast(visual.impact?.weapon)?5.4:name==='Head'?5:3.2
    this.v.copy(direction).normalize().multiplyScalar(impulse);this.v.y+=name==='Head'?2.8:2.1
    if(isGoreBlast(visual.impact?.weapon)){
      this.v.x+=(mesh.position.x-visual.object.position.x)*3.2
      this.v.z+=(mesh.position.z-visual.object.position.z)*3.2
    }
    item.born=this.clock;item.floor=floor;item.trail=.34
    item.record=this.ragdolls.addDetached(mesh,this.v,item.onRelease,direction)
    this.ragdolls.detachBone(visual.ragdoll,bone)
    const parent=bone.parent
    this.stump(visual,parent,bone.position,name==='Head'?.8:1.2)
    rig.severed.add(name);bone.scale.setScalar(.00001)
    this.burst(mesh.position,direction,floor,1)
    if(name!=='Head')this.stats.limbs++
    this.fx.stats.severedLimbs++
    return item
  }
  stump(owner,bone,pos,size,down=false) {
    const s=this.stumps[this.nextStump++%this.stumps.length]
    s.owner=owner;s.bone=bone;s.pos.copy(pos);s.size=size;s.q.identity()
    if(down)s.q.setFromAxisAngle(FORWARD,Math.PI)
  }
  burst(pos,direction,floor,power=1) {
    this.fx.hit(pos,this.clock*11,direction,floor)
    for(let k=0;k<this.particles.length;k++) {
      const pool=this.particles[k],count=pool.fluid?14:9
      for(let i=0;i<count;i++) {
        const p=pool.items[pool.next++%pool.items.length],angle=pool.next*2.399963
        p.pos.copy(pos);p.vel.set(Math.sin(angle)*(1+i%3),.5+(i%5)*.37,Math.cos(angle)*(1+i%3))
        p.vel.addScaledVector(direction,(pool.fluid?2.6:3.4)*power)
        p.life=p.max=pool.fluid?1.1:1.5;p.size=pool.fluid?.006+(i%3)*.003:.009+(i%4)*.004
        p.floor=floor;p.angle=angle
      }
    }
  }
  stain(pos,floor,size=.28) {
    const s=this.stains[this.nextStain++%this.stains.length]
    s.pos.set(pos.x,floor+.009,pos.z);s.size=size;s.angle=this.nextStain*2.399;s.life=WRECK_SECONDS
    this.stats.stains++
  }
  hitWrecks(event,visuals,player) {
    if(event.unitType||event.hit&&event.unitId||!event.origin||!player)return
    this.ray.origin.copy(event.origin)
    const pitch=player.pitch||0,yaw=player.yaw||0
    this.ray.direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
    let best=null,distance=Infinity
    for(const visual of visuals.values()) {
      if(visual.ragdoll?.settledAt==null||!visual.object.visible)continue
      if(!visual.rig?.pickParts?.length)continue
      const hit=hitUnitRig(visual.rig,this.ray,this.hit)
      if(!hit)continue
      const d=hit.point.distanceToSquared(this.ray.origin)
      if(d<distance){distance=d;best=visual;this.p.copy(hit.point);this.n.copy(hit.normal)}
    }
    if(best){
      for(const box of this.obstacles)if(this.ray.intersectBox(box,this.v)&&this.v.distanceToSquared(this.ray.origin)<distance-.01)return
      this.burst(this.p,this.n,best.object.position.y,.45);this.stats.wreckHits++
    }
  }
  update(dt,nav) {
    const start=performance.now();this.clock+=dt
    for(const visual of this.visuals) {
      const g=visual.gore;if(!g?.crunch)continue
      g.age+=dt;g.deformer.apply(g.crunch,Math.min(1,g.age/GORE_CRUNCH_SECONDS))
      if(g.age>=GORE_CRUNCH_SECONDS){g.crunch=null;this.detach(visual,'Head',g.headDirection,g.floor)}
    }
    for(const item of this.pieces.items)if(item.record&&item.trail>0) {
      item.trail=Math.max(0,item.trail-dt)
      if(dt<=0||item.trail<=0)continue
      this.v.set(.1,.45,.1);this.scale.set(.007,.007,.10)
      this.fx.particle('sparks',item.mesh.position,this.v,this.scale,.16,item.floor)
      const pool=this.particles[0],p=pool.items[pool.next++%pool.items.length]
      p.pos.copy(item.mesh.position);p.vel.copy(this.v);p.life=p.max=.85;p.size=.008;p.floor=item.floor;p.angle=pool.next
    }
    for(const pool of this.particles) {
      let live=0
      for(const p of pool.items) {
        if(p.life<=0)continue
        p.life=Math.max(0,p.life-dt);if(p.life<=0)continue
        p.pos.addScaledVector(p.vel,dt);p.vel.y-=dt*9.81
        const floor=unitGround(nav,p.pos.x,p.pos.z,p.floor)
        if(p.pos.y<floor+.008) {
          if(pool.fluid){this.stain(p.pos,floor,.16+p.size*5);p.life=0;continue}
          p.pos.y=floor+.012;p.vel.y=Math.abs(p.vel.y)*.2;p.vel.x*=.7;p.vel.z*=.7
        }
        this.temp.position.copy(p.pos);this.temp.rotation.set(p.angle+this.clock*5,p.angle,0)
        const fade=Math.min(1,p.life/.2)
        this.temp.scale.set(p.size*fade,p.size*(pool.fluid?1:.35)*fade,p.size*(pool.fluid?2.7:2.1)*fade)
        if(pool.fluid){this.v.copy(p.pos).add(p.vel);this.temp.lookAt(this.v)}
        this.temp.updateMatrix();pool.mesh.setMatrixAt(live++,this.temp.matrix)
      }
      pool.mesh.count=live;pool.mesh.visible=live>0;if(live)pool.mesh.instanceMatrix.needsUpdate=true
    }
    let live=0
    for(const s of this.stumps)if(s.owner&&s.bone) {
      if(s.owner.object.visible===false)continue
      this.temp.position.copy(s.pos);this.temp.quaternion.copy(s.q);this.temp.scale.setScalar(s.size*(s.owner.rig.mesh?.material.opacity??1));this.temp.updateMatrix()
      this.inverse.multiplyMatrices(s.bone.matrixWorld,this.temp.matrix);this.stumpMesh.setMatrixAt(live++,this.inverse)
    }
    this.stumpMesh.count=live;this.stumpMesh.visible=live>0;if(live)this.stumpMesh.instanceMatrix.needsUpdate=true
    live=0
    for(const s of this.stains)if(s.life>0) {
      s.life=Math.max(0,s.life-dt);this.temp.position.copy(s.pos);this.temp.rotation.set(-Math.PI/2,0,s.angle)
      this.temp.scale.setScalar(s.size*Math.min(1,s.life/2));this.temp.updateMatrix();this.stainMesh.setMatrixAt(live++,this.temp.matrix)
    }
    this.stainMesh.count=live;this.stainMesh.visible=live>0;if(live)this.stainMesh.instanceMatrix.needsUpdate=true
    const elapsed=performance.now()-start;this.stats.frames++;this.stats.totalMs+=elapsed;this.stats.maxMs=Math.max(this.stats.maxMs,elapsed)
  }
  reset() {
    this.pieces.reset();for(const v of this.visuals)this.resetVisual(v)
    for(const pool of this.particles){for(const p of pool.items)p.life=0;pool.mesh.count=0;pool.mesh.visible=false;pool.next=0}
    for(const s of this.stains)s.life=0
    for(const s of this.stumps){s.owner=null;s.bone=null}
    this.stainMesh.count=0;this.stumpMesh.count=0;this.clock=0
    for(const key in this.stats)this.stats[key]=0
  }
  dispose() {
    this.pieces.reset()
    for(const item of this.pieces.items){item.pieceGeometry?.dispose();item.fade.dispose()}
    for(const definitions of this.definitions.values())for(const d of definitions.values())d.geometry.dispose()
    for(const v of this.visuals)v.gore?.deformer.dispose()
    for(const pool of this.particles){pool.mesh.geometry.dispose();pool.mesh.material.dispose();pool.mesh.dispose?.()}
    for(const key of ['map','normalMap','roughnessMap'])this.fluidMaterial[key]?.dispose()
    this.fluidMaterial.dispose();this.stainMesh.geometry.dispose();this.stumpMesh.geometry.dispose();this.placeholder.dispose()
    this.root.removeFromParent();this.visuals.clear();this.definitions.clear()
  }
}

function atlas(geometry,tile) {
  const uv=geometry.attributes.uv
  if(uv)for(let i=0;i<uv.count;i++)uv.setXY(i,(tile%2)*.5+.008+uv.getX(i)*.484,(1-Math.floor(tile/2))*.5+.008+uv.getY(i)*.484)
  return geometry
}

function fractureGeometry() {
  const pieces=[],matrix=new E.Object3D()
  const add=(geometry,x,y,z,sx,sy,sz,rx=0,rz=0,tile=2)=>{
    atlas(geometry,tile);matrix.position.set(x,y,z);matrix.scale.set(sx,sy,sz);matrix.rotation.set(rx,0,rz);matrix.updateMatrix()
    const g=geometry.index?geometry.toNonIndexed():geometry.clone();g.applyMatrix4(matrix.matrix);pieces.push(g);geometry.dispose()
  }
  for(let i=0;i<7;i++) {
    const a=i*Math.PI*2/7,r=.027+(i%2)*.012
    // Frayed control leads with exposed ends; cylinders bend in two segments.
    add(new E.CylinderGeometry(1,1,1,5),Math.cos(a)*r,.03,Math.sin(a)*r,.007,.075,.007,.3*Math.sin(a),.35*Math.cos(a))
    add(new E.CylinderGeometry(1,1,1,5),Math.cos(a)*r*1.4,.073,Math.sin(a)*r*1.4,.003,.032,.003,-.6*Math.sin(a),-.7*Math.cos(a),3)
    add(new E.ConeGeometry(1,1,3),Math.cos(a)*.052,.016,Math.sin(a)*.052,.018,.058,.012,.2,Math.cos(a)*.3,0)
  }
  const geometry=new E.BufferGeometry()
  for(const [name,size]of [['position',3],['normal',3],['uv',2]]) {
    const array=new Float32Array(pieces.reduce((n,p)=>n+p.attributes[name].array.length,0));let offset=0
    for(const p of pieces){array.set(p.attributes[name].array,offset);offset+=p.attributes[name].array.length}
    geometry.setAttribute(name,new E.BufferAttribute(array,size))
  }
  for(const piece of pieces)piece.dispose()
  return geometry
}
