import * as engine from 'threepipe'
import {bindUnitRig, animateUnit, disposeUnitRig, hitUnitRig} from './units-animation.js'
import {UnitFx, UnitOptics} from './units-fx.js'
import {unitMaterials} from './unit-materials.js'
import {resetRosterRig,rosterHit} from './roster-animation.js'
import {RosterFx} from './roster-fx.js'
import {clonePlacedUnitFigure, cloneSkinnedFigure} from './unit-assets.js'
import {getQualityPreset} from './performance-quality.js'
import {RagdollSystem, WRECK_SECONDS, WRECK_FADE_SECONDS} from './ragdoll.js'
import {gorePart, GORE_PARTS, primeGorePaths} from './gore.js'
import {retainResourcesDuring} from './retained-reparent.js'
import {holdStill} from './hidden-subtrees.js'

export const TEMPLATE_NAMES = {scout:'Unit T-600 Scout',endo:'Unit T-800 Endo',heavy:'Unit T-800 Heavy',t1000:'Unit T-1000',hkaerial:'Unit HK-Aerial',hktank:'Unit HK-Tank'}
const {Group, Vector3, Raycaster, HemisphereLight, DirectionalLight, Mesh2, PlaneGeometry, PhysicalMaterial, Color, Matrix4, Frustum, Sphere} = engine

export function setUnitCullBounds(mesh,type,bounds=new Sphere()) {
  bounds.center.set(0,type==='hktank'?1.5:2,0)
  bounds.radius=type==='hktank'?6:type==='hkaerial'?4:2.5
  mesh.boundingSphere=bounds
  mesh.frustumCulled=true
  return bounds
}

function resetContact(contact){
  contact.stance=null;contact.initialized=false;contact.groundCached=false
  contact.ground=0;contact.slope=0;contact.groundX=0;contact.groundZ=0
}

function resetRig(rig,object){
  for(const key of ['rise','groundPitch','phase','move','aim','spin','recoil','hit','headshot','death','stagger','heat','fallVelocity','fallAngle','fallSpin'])rig[key]=0
  for(const target of Object.values(rig.targets))target.x=target.y=target.z=0
  for(const key in rig.flinches)rig.flinches[key].life=0
  rig.severed.clear();rig.states.clear();rig.ragdoll=false;rig.previous.copy(object.position)
  resetContact(rig.feet.Left);resetContact(rig.feet.Right)
  for(const contact of rig.scoutContacts||[])resetContact(contact)
  if(rig.muzzleHeat)rig.muzzleHeat.userData.batchVisible=false
  resetRosterRig(rig)
}

export class UnitView {
  constructor(viewer) {
    this.viewer=viewer; this.root=null; this.templates={}; this.visuals=new Map()
    this.eventIndex=0; this.lastTick=0; this.v1=new Vector3(); this.v2=new Vector3(); this.v3=new Vector3(); this.v4=new Vector3(); this.ray=new Raycaster()
    this.viewProjection=new Matrix4();this.frustum=new Frustum();this.cullSphere=new Sphere()
    this.hit={bone:null,point:new Vector3(),normal:new Vector3()}
    this.activeIds=new Set();this.quality=getQualityPreset('high')
  }
  start(world) {
    this.stop()
    for(const [type,name] of Object.entries(TEMPLATE_NAMES)) {
      const source=this.viewer.scene.modelRoot.getObjectByName(name)||this.viewer.scene.modelRoot.getObjectByName(name.replaceAll(' ','_'))
      if(!source) throw new Error(`${name} authored node not found`)
      this.templates[type]=source
    }
    this.root=new Group()
    this.viewer.scene.add(this.root)
    this.root.name='Units Runtime'
    // A runtime root is an empty container at the origin. Saying so keeps three
    // from marking every node under it dirty on every render pass.
    holdStill([this.root])
    // Keep prewarmed allocations owned, but outside scene/render traversal while
    // dormant. This identity parent preserves their local transforms for reuse.
    this.dormantRoot=new Group();this.dormantRoot.name='Dormant unit allocations'
    this.ragdolls=new RagdollSystem(world.map,this.viewer.object3dManager)
    this.fx=new UnitFx(this.root,this.ragdolls)
    this.rosterFx=new RosterFx(this.root,this.ragdolls)
    this.optics=new UnitOptics(this.root)
    this.runtimeTemplates={}
    this.runtimeFarTemplates={}
    this.visualPool=Object.fromEntries(Object.keys(TEMPLATE_NAMES).map(type=>[type,[]]))
    for(const type of Object.keys(TEMPLATE_NAMES))this.ensureRuntimeTemplate(type)
    this.eventIndex=world.eventLog.length; this.lastTick=world.tick
    this.onKey=e=>{ if(e.code==='F8') { e.preventDefault(); this.toggleShowcase() }
      if(e.code==='F9'&&this.showcase) { e.preventDefault();const states=['idle','moving','aiming','firing','hit','spin-up','dying'];this.showcase.state=states[(states.indexOf(this.showcase.state)+1)%states.length];this.showcase.time=0 } }
    window.addEventListener('keydown',this.onKey)
    this.onRender=()=>this.renderShowcase()
    this.viewer.addEventListener('preRender',this.onRender)
  }
  cloneTemplateFigure(unit, parent=this.root) {
    const source=this.templates[unit.type]
    if(!source) throw new Error(`Authored template is missing for ${unit.type}`)
    this.materials ||= unitMaterials(engine)
    const recycled=parent===this.root?this.visualPool[unit.type].pop():null
    if(recycled) {
      const {object,rig:oldRig,restPose}=recycled
      for(const {node,position,quaternion,scale} of restPose){node.position.copy(position);node.quaternion.copy(quaternion);node.scale.copy(scale)}
      object.position.set(unit.pos.x,unit.pos.y,unit.pos.z);object.rotation.y=unit.yaw;object.visible=true
      // A recycled rig may come back from a settled wreck, which sleeps.
      object.matrixWorldAutoUpdate=true
      object.name=`${unit.id} Runtime`;if(object.parent!==parent)parent.add(object)
      const rig=oldRig;resetRig(rig,object)
      rig.wreckMaterial=oldRig.wreckMaterial;rig.wreckMaterial.opacity=1
      if(rig.mesh.geometry!==rig.highGeometry)rig.mesh.geometry=rig.highGeometry
      if(!rig.roster&&rig.mesh.material!==this.materials.metal)rig.mesh.material=this.materials.metal
      rig.ragdollBounds=oldRig.ragdollBounds;rig.ragdollBounds.center.set(0,.9,0);rig.ragdollBounds.radius=1.65
      rig.cullBounds=setUnitCullBounds(rig.mesh,unit.type,oldRig.cullBounds);rig.eyes.visible=!rig.roster
      this.fx.gore.resetVisual(recycled)
      recycled.unitId=unit.id;recycled.unitType=unit.type;recycled.wreckSpawned=false;recycled.ragdoll=null;recycled.lastAnimationTick=undefined
      recycled.impact.tick=-1;recycled.impact.weapon=null;recycled.impact.headshot=false
      recycled.impact.direction.set(0,0,0);recycled.impact.point.set(0,0,0)
      return recycled
    }
    const runtimeTemplate=this.ensureRuntimeTemplate(unit.type)
    const object=cloneSkinnedFigure(runtimeTemplate)
    object.visible=true
    object.name=`${unit.id} Runtime`
    object.position.set(unit.pos.x,unit.pos.y,unit.pos.z); object.rotation.y=unit.yaw
    const eyeMaterials=new Set()
    object.traverse(child=>{
      for(const key of ['EntityComponentPlugin','kite3dGenerated','kite3dAuthoring','excludeFromExport']) delete child.userData[key]
      if(!object.userData.roster&&child.name==='Combined articulated steel') child.material=this.materials.metal
      if(child.name==='Eye Left'||child.name==='Eye Right') {
        child.material=this.materials.eye.clone(); eyeMaterials.add(child.material)
      }
      if(['Eye Bloom','Eye Flare','Tracking Glint','Muzzle Heat'].includes(child.name)) {
        child.material=this.materials.halo.clone(); eyeMaterials.add(child.material)
      }
    })
    parent.add(object)
    const rig=bindUnitRig(object)
    rig.highGeometry=rig.mesh.geometry;rig.lowGeometry=this.runtimeFarTemplates[unit.type].getObjectByName('Combined articulated steel').geometry
    rig.eyeMaterials=eyeMaterials
    // SkinnedMesh.clone copies the source's cached bounds. Placed authoring sources
    // have world-offset centers, so replace them with one conservative local bound.
    rig.cullBounds=setUnitCullBounds(rig.mesh,unit.type)
    rig.ragdollBounds=new engine.Sphere(new Vector3(0,.9,0),1.65)
    rig.wreckMaterial=this.materials.metal.clone();rig.wreckMaterial.name='Pooled fading wreck metal'
    rig.wreckMaterial.transparent=true;rig.wreckMaterial.depthWrite=false;rig.wreckMaterial.opacity=1
    rig.eyeMaterials.add(rig.wreckMaterial)
    for(const child of rig.eyes.children)child.visible=false
    const restPose=[]
    object.traverse(node=>{if(node.isBone)restPose.push({node,position:node.position.clone(),quaternion:node.quaternion.clone(),scale:node.scale.clone()})})
    const visual={object,rig,restPose,unitId:unit.id,unitType:unit.type,wreckSpawned:false,ragdoll:null,
      impact:{direction:new Vector3(),point:new Vector3(),weapon:null,headshot:false,tick:-1}}
    visual.recycle=()=>this.recycleVisual(visual.unitId,visual,visual.unitType)
    if(parent===this.root){this.fx.gore.prepareVisual(visual);this.rosterFx.prepare(visual)}
    return visual
  }
  primeWarmup(){
    this.fx.gore.primePieces()
    const states=Object.keys(TEMPLATE_NAMES).map((type,index)=>({
      id:`warmup-${type}`,type,pos:{x:index-1,y:0,z:0},yaw:0,vel:{x:0,z:0},alive:true,
      intent:{aimAt:{x:0,y:1.5,z:4},fire:type!=='scout'},spinUp:1,maxHp:300,
    }))
    const visuals=states.map(state=>this.cloneTemplateFigure(state,this.root))
    for(let i=0;i<visuals.length;i++)animateUnit(visuals[i].rig,states[i],1/30,i/30)
    // Create the live aerial's instanced beam/ground pools before the death
    // exercise hides those emitters. They must upload and compile with both
    // light states here, rather than allocate on the first HK-Aerial spawn.
    this.optics.update(visuals)
    const heavy=visuals[2],bone=heavy.rig.joints.Chest
    this.ragdolls.primePools()
    bone.getWorldPosition(this.v1);this.v2.set(0,0,1)
    heavy.impact={direction:this.v2.clone(),point:this.v1.clone(),weapon:'m4',headshot:false,tick:1}
    this.fx.damage(heavy,bone,this.v1,this.v2,{weapon:'m4',amount:140,tick:1},states[2])
    primeGorePaths(this.fx.gore,visuals,states,this.v1,this.v2)
    this.fx.wreck(heavy)
    const death=this.ragdolls.add(heavy,states[2],heavy.impact)
    this.warmupReport={
      ragdolls:[...this.ragdolls.records].filter(record=>record.kind==='unit').length,
      detachedLimbs:[...this.ragdolls.records].filter(record=>record.kind==='limb').length,
      fixedLimbMeshes:this.fx.bodies.length,
      skullCrunch:this.fx.gore.stats.crunches,limb:this.fx.gore.stats.limbs,torsoSplit:this.fx.gore.stats.splits,
      dent:this.fx.gore.stats.dents,vertexCap:this.fx.gore.stats.maxVertices,
    }
    this.ragdolls.update(1/60)
    // Compile liquid, smoke, and detached vehicle paths before the first combat death.
    for(let i=3;i<6;i++)this.rosterFx.die(visuals[i],states[i],null)
    this.rosterFx.update(.2,this.viewer.scene.mainCamera)
    this.warmupReport.rosterDeaths=this.rosterFx.deaths.size
    // Mount the real pooled fade materials before resource collection. Gore's
    // transition also switches its batched piece to an individual draw. Keep
    // the other gore pieces opaque so both paths render with both light states.
    const goreFade=this.fx.gore.pieces.items.find(item=>item.record)?.record
    const fades=[death,goreFade,...visuals.flatMap(v=>(v.rig.roster?.pieces||[]).map(p=>p.record))].filter(Boolean)
    for(const record of fades){
      this.ragdolls.freeze(record)
      record.settledAt=this.ragdolls.clock-WRECK_SECONDS-WRECK_FADE_SECONDS/2
    }
    this.ragdolls.update(0)
    this.warmupReport.fades={skinned:1,gore:goreFade?1:0,vehiclePieces:fades.length-1-(goreFade?1:0)}
    this.fx.shot(this.v1,this.v3.copy(this.v1).addScaledVector(this.v2,8),'heavy')
    this.fx.shot(this.v1,this.v3.copy(this.v1).addScaledVector(this.v2,8),'endo')
    this.fx.update(0)
    this.optics.update(visuals)
    // Preallocate a mixed 24-unit crowd plus replacement rigs before combat.
    for(let i=0;i<states.length;i++)for(let n=1;n<(i<3?12:i===5?2:8);n++)visuals.push(this.cloneTemplateFigure(states[i],this.root))
    this.warmupReport.pooledRigs=visuals.length
    this.warmupReport.aerialOptics=Object.keys(this.optics.rosterPools)
    return()=>{
      this.rosterFx.reset();this.fx.reset();this.ragdolls.reset();this.optics.update([])
      retainResourcesDuring(this.viewer.object3dManager,()=>{
        for(const visual of visuals){visual.object.visible=false;this.dormantRoot.add(visual.object);this.visualPool[visual.unitType].push(visual)}
        // Leave these attached through compile/upload/render warmup. Parking only
        // after that gate must never defer geometry or texture uploads to first use.
        for(const template of [...Object.values(this.runtimeTemplates),...Object.values(this.runtimeFarTemplates)])this.dormantRoot.add(template)
      })
    }
  }
  ensureRuntimeTemplate(type) {
    if(this.runtimeTemplates[type])return this.runtimeTemplates[type]
    const source=this.templates[type]
    const runtimeTemplate=clonePlacedUnitFigure(source,type);runtimeTemplate.visible=false
    this.root.add(runtimeTemplate);this.runtimeTemplates[type]=runtimeTemplate
    const far=clonePlacedUnitFigure(source,type,'far');far.visible=false;this.root.add(far);this.runtimeFarTemplates[type]=far
    if(runtimeTemplate.userData.roster)return runtimeTemplate
    const rig=bindUnitRig(runtimeTemplate),visual={object:runtimeTemplate,rig,unitType:type}
    this.fx.prepareLimb(visual,'Upper Arm Left');this.fx.prepareLimb(visual,'Forearm Left')
    return runtimeTemplate
  }
  sync(world) {
    if(!this.root) return
    const dt=Math.min(.1,Math.max(0,(world.tick-this.lastTick)/60))
    this.lastTick=world.tick
    const ids=this.activeIds;ids.clear()
    let opticsDirty=Boolean(this.showcase)
    const player=world.getPlayer?.(world.localPlayerId)||world.player,camera=this.viewer.scene.mainCamera
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))
    for(const unit of world.units) {
      ids.add(unit.id)
      let visual=this.visuals.get(unit.id)
      if(!visual) {
        // A completed corpse should not be rebuilt if a snapshot retains dead units.
        if(!unit.alive&&world.tick-(unit.diedAtTick??world.tick)>120)continue
        visual=this.cloneTemplateFigure(unit); this.visuals.set(unit.id,visual);opticsDirty=true
        // Every reused rig needs a first interval, including a newly severed leg.
        visual.lastAnimationTick=world.tick-1
      }
      if(unit.alive&&visual.rosterDeath){
        this.recycleVisual(unit.id,visual,unit.type);visual=this.cloneTemplateFigure(unit);this.visuals.set(unit.id,visual);opticsDirty=true
      }
      if(unit.alive&&visual.ragdoll){
        this.ragdolls.release(visual.ragdoll)
        visual=this.cloneTemplateFigure(unit);this.visuals.set(unit.id,visual);opticsDirty=true
        visual.lastAnimationTick=world.tick-1
      }
      if(visual.ragdoll||visual.rosterDeath){visual.object.visible=!this.showcase;continue}
      const moved=visual.object.position.x!==unit.pos.x||visual.object.position.y!==unit.pos.y||visual.object.position.z!==unit.pos.z||visual.object.rotation.y!==unit.yaw
      if(moved){visual.object.position.set(unit.pos.x,unit.pos.y,unit.pos.z);visual.object.rotation.y=unit.yaw;opticsDirty=true}
      const distance=Math.hypot(unit.pos.x-player.pos.x,unit.pos.z-player.pos.z)
      // Use the same conservative shape for LOD selection and renderer culling.
      const bounds=visual.rig.cullBounds||=setUnitCullBounds(visual.rig.mesh,unit.type)
      this.cullSphere.center.set(unit.pos.x,unit.pos.y+bounds.center.y,unit.pos.z)
      this.cullSphere.radius=bounds.radius
      const inView=this.frustum.intersectsSphere(this.cullSphere)
      const geometry=(!inView||distance>this.quality.lodDistance)&&!visual.gore?.deformer.changed?visual.rig.lowGeometry:visual.rig.highGeometry
      if(visual.rig.mesh.geometry!==geometry)visual.rig.mesh.geometry=geometry
      const animationHz=!inView?Math.min(12,this.quality.farAnimationHz):distance<=this.quality.animationLodDistance?this.quality.animationHz:this.quality.farAnimationHz
      const interval=Math.max(1,Math.round(60/animationHz))
      const elapsed=world.tick-(visual.lastAnimationTick??(world.tick-1))
      if(unit.alive&&elapsed>=interval){animateUnit(visual.rig,unit,Math.min(.1,elapsed/60),world.tick/60,world.nav);visual.lastAnimationTick=world.tick;opticsDirty=true}
      else if(moved)visual.object.updateMatrixWorld(true)
      visual.object.visible=!this.showcase
      if(unit.alive)this.rosterFx?.alive(visual,unit,dt)
    }
    const eventIndex=this.eventIndex;this.processEvents(world);opticsDirty||=this.eventIndex!==eventIndex
    for(const unit of world.units) {
      const visual=this.visuals.get(unit.id)
      if(!unit.alive&&visual&&!visual.wreckSpawned) {
        visual.wreckSpawned=true;opticsDirty=true
        if(this.rosterFx?.die(visual,unit,visual.recycle))continue
        this.fx.wreck(visual)
        this.ragdolls.add(visual,unit,visual.impact,()=>{
          this.recycleVisual(unit.id,visual,unit.type)
        })
      }
    }
    for(const [id,visual] of this.visuals) if(!ids.has(id)&&!visual.ragdoll&&!visual.rosterDeath) {
      this.recycleVisual(id,visual,visual.object.userData.unitTemplateType);opticsDirty=true
    }
    this.ragdolls?.update(dt)
    this.fx.update(dt,world.nav)
    this.rosterFx?.update(dt,this.viewer.scene.mainCamera)
    if(this.showcase) this.updateShowcase()
    if(opticsDirty)this.optics.update(this.showcase?this.showcase.units:this.visuals.values())
  }
  recycleVisual(id,visual,type) {
    this.rosterFx?.release(visual);this.fx.release(visual);visual.object.visible=false
    retainResourcesDuring(this.viewer.object3dManager,()=>this.dormantRoot.add(visual.object))
    if(this.visuals.get(id)===visual)this.visuals.delete(id)
    visual.ragdoll=null
    // Retain the high-water allocation for reuse; the runtime owner also holds
    // these roots until Stop. Geometry and PBR maps stay shared with templates.
    this.visualPool[type].push(visual)
  }
  processEvents(world) {
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const event=world.eventLog[this.eventIndex]
      if(event.type==='shot'&&!event.unitType&&!this.bullets?.handles(event))this.fx.gore.hitWrecks(event,this.visuals,world.players?.get(event.playerId)||world.player)
      const visual=this.visuals.get(event.unitId||event.by||event.ownerId)
      if(!visual) continue
      if(event.type==='projectile_fired')visual.rig.recoil=1
      if(event.type==='kill') {
        if(visual.rig.roster)continue
        const unit=world.unitById.get(event.unitId),g=visual.gore
        const bone=visual.rig.joints[event.part]||visual.rig.joints[event.headshot?'Head':g?.lastPart||'Chest']||visual.rig.joints.Chest
        if(event.pos)this.v1.copy(event.pos)
        else if(g?.lastPart)this.v1.copy(g.lastPoint)
        else if(bone)bone.getWorldPosition(this.v1)
        else this.v1.copy(visual.object.position)
        this.v2.copy(event.direction||g?.lastDirection||this.v3.set(0,0,1))
        visual.impact.point.copy(this.v1);visual.impact.direction.copy(this.v2)
        visual.impact.weapon=event.weapon;visual.impact.headshot=event.headshot;visual.impact.tick=event.tick
        if(!this.bullets?.handles(event))this.fx.gore.event(event,visual,unit,bone,this.v1,this.v2)
      }
      if(event.type==='unit_damage'&&!this.bullets?.handles(event))this.damageEvent(world,event)
      if(event.type==='shot'&&event.by!=='player'&&event.origin) {
        visual.rig.recoil=1
        visual.object.updateMatrixWorld(true)
        const muzzle=visual.rig.joints.Muzzle
        if(muzzle) muzzle.getWorldPosition(this.v1)
        else this.v1.set(event.origin.x,event.origin.y,event.origin.z)
        const to=event.target||{x:event.origin.x,y:event.origin.y,z:event.origin.z+5}
        this.v2.set(to.x,to.y,to.z)
        this.fx.shot(this.v1,this.v2,event.unitType)
      }
    }
  }
  killEffect(world,event,position) {
    const visual=this.visuals.get(event.unitId),unit=world.unitById.get(event.unitId)
    if(!visual||!unit||visual.rig.roster)return
    const bone=visual.rig.joints[event.part]||visual.rig.joints[event.headshot?'Head':'Chest']
    this.v2.copy(event.direction||visual.impact.direction)
    this.fx.gore.event(event,visual,unit,bone,position,this.v2)
  }
  damageEvent(world,event) {
    const visual=this.visuals.get(event.unitId)
    if(!visual)return
    if(rosterHit(visual,event))return
    visual.rig.hit=1
    if(event.headshot) visual.rig.headshot=1
    visual.object.updateMatrixWorld(true)
    let target=visual.rig.joints[event.part]||visual.rig.joints[GORE_PARTS[gorePart(event.part)]]||visual.rig.joints[event.headshot?'Head':'Chest']
    if(!target){this.fx.gore.event(event,visual,world.unitById.get(event.unitId),null,event.pos||visual.object.position,event.direction||this.v2.set(0,0,1));return}
    target.getWorldPosition(this.v1)
    const p=world.players?.get(event.playerId)||world.player,pitch=p.pitch||0,yaw=p.yaw||0
    this.v2.set(p.pos.x,p.pos.y+(p.crouch?1.12:1.65),p.pos.z)
    const outward=this.v3.copy(this.v2).sub(this.v1).normalize()
    if(event.pos||event.point)this.v1.copy(event.pos||event.point)
    else if(!['grenade','knife','unknown'].includes(event.weapon)) {
      this.v4.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
      this.ray.set(this.v2,this.v4)
      const hit=hitUnitRig(visual.rig,this.ray.ray,this.hit)
      if(hit){
        this.v1.copy(hit.point);outward.copy(hit.normal)
        const candidate=hit.bone
        // Hydraulic bones inherit the flinch from the nearest main joint.
        target=candidate.userData.actuator?candidate.parent:candidate
      }else this.v1.addScaledVector(outward,event.headshot?.09:.16)
    }
    const unit=world.unitById.get(event.unitId)
    if(!unit)return
    const direction=this.v4.subVectors(this.v1,this.v2).normalize()
    if(event.normal)outward.copy(event.normal)
    if(event.direction)direction.copy(event.direction)
    const previous=visual.impact
    if(!previous||previous.tick!==event.tick||event.headshot||previous.weapon!=='shotgun') {
      visual.impact||={direction:new Vector3(),point:new Vector3()}
      visual.impact.direction.copy(direction);visual.impact.point.copy(this.v1)
      Object.assign(visual.impact,{weapon:event.weapon,headshot:event.headshot,tick:event.tick})
    }
    this.fx.damage(visual,target,this.v1,outward,event,unit)

  }
  setQuality(quality){this.quality=quality}
  toggleShowcase(force) {
    const enable=force??!this.showcase
    if(!enable) {
      if(this.showcase) {
        for(const visual of this.showcase.units) { disposeUnitRig(visual.rig,visual.object); visual.object.removeFromParent() }
        this.showcase.stage.removeFromParent()
        if(this.showcase.hud) this.showcase.hud.style.visibility=this.showcase.hudVisibility
        this.showcase.backdrop.geometry.dispose(); this.showcase.backdrop.material.dispose()
      }
      this.showcase=null
      return
    }
    if(this.showcase) return
    this.materials ||= unitMaterials(engine)
    const stage=new Group(); stage.name='F8 Unit Showcase'; this.root.add(stage)
    stage.position.set(0,80,0)
    const fill=new HemisphereLight(0xb6d9ff,0x282018,1.5); stage.add(fill)
    const key=new DirectionalLight(0xe1efff,3.5); key.position.set(-3,5,4); stage.add(key); stage.add(key.target); key.target.position.set(0,1,0)
    const rim=new DirectionalLight(0xffad6c,2); rim.position.set(3,2,-3); stage.add(rim); stage.add(rim.target); rim.target.position.set(0,1,0)
    const backdrop=new Mesh2(new PlaneGeometry(30,30),this.materials.metal.clone())
    backdrop.material.color.setHex(0x202932);backdrop.material.roughness=1;backdrop.material.metalness=.25;backdrop.name='Showcase floor';
    const floorUV=backdrop.geometry.attributes.uv;for(let i=0;i<floorUV.count;i++)floorUV.setXY(i,.008+floorUV.getX(i)*.484,.008+floorUV.getY(i)*.484); backdrop.rotation.x=-Math.PI/2; stage.add(backdrop)
    const units=Object.keys(TEMPLATE_NAMES).map((type,i)=>{
      const state={id:`showcase-${type}`,type,pos:{x:(i-1)*1.8,y:0,z:0},yaw:0,vel:{x:0,z:0},alive:true,intent:{},spinUp:0}
      const visual=this.cloneTemplateFigure(state,stage); visual.state=state; return visual
    })
    const hud=document.querySelector('[data-testid="terminator-hud"]'),hudVisibility=hud?.style.visibility||''
    if(hud) hud.style.visibility='hidden'
    this.showcase={hud,hudVisibility,stage,backdrop,units,time:0,last:performance.now(),state:'idle',focus:null,angle:0,cameraDistance:6}
  }
  updateShowcase() {
    const show=this.showcase,now=performance.now(),dt=Math.min(.05,(now-show.last)/1000)
    show.last=now; show.time+=dt
    const mode=show.state==='cycle'?['idle','moving','aiming','firing','hit','spin-up','dying'][Math.floor(show.time/3)%7]:show.state
    for(const [i,v] of show.units.entries()) {
      const unit=v.state
      unit.vel.z=mode==='moving'?(unit.type==='scout'?7:unit.type==='heavy'?2:3.5):0
      unit.alive=mode!=='dying'
      unit.intent.aimAt=['aiming','firing','spin-up'].includes(mode)?{x:unit.pos.x,y:1.6,z:8}:null
      unit.intent.fire=mode==='firing'
      unit.spinUp=['spin-up','firing'].includes(mode)?Math.min(1,show.time%3):0
      if(mode==='hit'&&show.time%1<.05) { v.rig.hit=1;v.rig.headshot=1 }
      if(mode==='firing'&&show.time%(unit.type==='heavy'?.083:.33)<dt) {
        v.rig.recoil=1
        if(v.rig.joints.Muzzle) {
          v.object.updateMatrixWorld(true);v.rig.joints.Muzzle.getWorldPosition(this.v1)
          this.v2.copy(this.v1);this.v2.z+=6;this.fx.shot(this.v1,this.v2,unit.type)
        }
      }
      animateUnit(v.rig,unit,dt,show.time+i*.3)
      v.object.visible=show.focus===null||show.focus===unit.type
    }
  }
  renderShowcase() {
    const show=this.showcase
    if(!show) return
    const camera=this.viewer.scene.mainCamera
    const focus=show.units.find(v=>v.state.type===show.focus)
    const x=focus?.state.pos.x||0, targetY=show.targetY??1.15,d=show.cameraDistance
    camera.position.set(x+Math.sin(show.angle)*d,80+targetY+(show.elevation??.1),Math.cos(show.angle)*d)
    camera.lookAt(x,80+targetY,0);camera.updateMatrixWorld(true)
  }
  stop() {
    window.removeEventListener('keydown',this.onKey)
    this.viewer.removeEventListener('preRender',this.onRender)
    this.toggleShowcase(false)
    // Return every parked allocation before detaching the runtime root.
    if(this.dormantRoot&&this.root)this.root.add(this.dormantRoot)
    this.rosterFx?.dispose();this.rosterFx=null
    this.ragdolls?.dispose();this.ragdolls=null
    for(const v of this.visuals.values()) disposeUnitRig(v.rig,v.object)
    for(const pool of Object.values(this.visualPool||{}))for(const v of pool)disposeUnitRig(v.rig,v.object)
    for(const template of [...Object.values(this.runtimeTemplates||{}),...Object.values(this.runtimeFarTemplates||{})])template.traverse(child=>{if(child.isSkinnedMesh)child.skeleton.dispose()})
    this.optics?.dispose();this.optics=null
    this.fx?.dispose();this.fx=null
    this.root?.removeFromParent();this.root=null;this.dormantRoot=null;this.templates={};this.runtimeTemplates={};this.runtimeFarTemplates={};this.materials=null;this.visuals.clear();this.activeIds.clear();this.eventIndex=0;this.visualPool={}
  }
}
