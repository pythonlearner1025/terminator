import * as engine from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {bindUnitRig, animateUnit, disposeUnitRig, hitUnitRig} from './units-animation.js'
import {UnitFx, UnitOptics} from './units-fx.js'
import {unitMaterials} from '../../generators/unit-materials.js'
import {createUnitFigure} from '../../generators/unit-template.generator.js'
import {getQualityPreset} from './performance-quality.js'

const TEMPLATE_NAMES = {scout:'Unit Template Scout',endo:'Unit Template Endo',heavy:'Unit Template Heavy'}
const {Group, Vector3, Raycaster, HemisphereLight, DirectionalLight, Mesh2, PlaneGeometry, PhysicalMaterial, Color} = engine

export class UnitView {
  constructor(viewer) {
    this.viewer=viewer; this.owner=null; this.root=null; this.templates={}; this.visuals=new Map()
    this.eventIndex=0; this.lastTick=0; this.v1=new Vector3(); this.v2=new Vector3(); this.v3=new Vector3(); this.v4=new Vector3(); this.ray=new Raycaster()
    this.activeIds=new Set();this.quality=getQualityPreset('high')
  }
  start(world) {
    this.stop()
    for(const [type,name] of Object.entries(TEMPLATE_NAMES)) {
      const source=this.viewer.scene.modelRoot.getObjectByName(name)||this.viewer.scene.modelRoot.getObjectByName(name.replaceAll(' ','_'))
      if(!source) throw new Error(`${name} authored node not found`)
      this.templates[type]=source
    }
    this.owner=new RuntimeObjectOwner('terminator-unit-view')
    this.root=this.owner.attachRuntimeRoot(new Group(),this.viewer.scene,this.templates.endo)
    this.root.name='Units Runtime'
    this.fx=new UnitFx(this.root)
    this.optics=new UnitOptics(this.root)
    this.runtimeTemplates={}
    this.runtimeFarTemplates={}
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
    let runtimeTemplate=this.runtimeTemplates[unit.type]
    if(!runtimeTemplate) {
      runtimeTemplate=createUnitFigure(engine,unit.type);runtimeTemplate.visible=false
      this.root.add(runtimeTemplate);this.runtimeTemplates[unit.type]=runtimeTemplate
      const far=createUnitFigure(engine,unit.type,{detail:0});far.visible=false;this.root.add(far);this.runtimeFarTemplates[unit.type]=far
    }
    const object=runtimeTemplate.clone(true)
    object.visible=true
    object.name=`${unit.id} Runtime`
    object.position.set(unit.pos.x,unit.pos.y,unit.pos.z); object.rotation.y=unit.yaw
    const eyeMaterials=new Set()
    object.traverse(child=>{
      for(const key of ['EntityComponentPlugin','kite3dGenerated','kite3dAuthoring','kite3dRuntime','excludeFromExport']) delete child.userData[key]
      if(child.name==='Combined articulated steel') child.material=this.materials.metal
      if(child.name==='Eye Left'||child.name==='Eye Right') {
        child.material=this.materials.eye.clone(); eyeMaterials.add(child.material)
      }
      if(['Eye Bloom','Eye Flare','Tracking Glint','Muzzle Heat'].includes(child.name)) {
        child.material=this.materials.halo.clone(); eyeMaterials.add(child.material)
      }
    })
    this.owner.trackEffect(object,source)
    parent.add(object)
    const rig=bindUnitRig(object)
    rig.highGeometry=rig.mesh.geometry;rig.lowGeometry=this.runtimeFarTemplates[unit.type].getObjectByName('Combined articulated steel').geometry
    rig.eyeMaterials=eyeMaterials
    for(const child of rig.eyes.children)child.visible=false
    return {object,rig}
  }
  sync(world) {
    if(!this.owner) return
    const dt=Math.min(.1,Math.max(0,(world.tick-this.lastTick)/60))
    this.lastTick=world.tick
    const ids=this.activeIds;ids.clear()
    for(const unit of world.units) {
      ids.add(unit.id)
      let visual=this.visuals.get(unit.id)
      if(!visual) {
        // A completed corpse should not be rebuilt if a snapshot retains dead units.
        if(!unit.alive && world.tick-(unit.diedAtTick??world.tick)>780) continue
        visual=this.cloneTemplateFigure(unit); this.visuals.set(unit.id,visual)
        // Seed the Scout clock once so its first 30 Hz interval can elapse.
        if(unit.type==='scout')visual.lastAnimationTick=world.tick-1
      }
      visual.object.position.set(unit.pos.x,unit.pos.y,unit.pos.z)
      visual.object.rotation.y=unit.yaw
      const player=world.getPlayer?.(world.localPlayerId)||world.player
      const distance=Math.hypot(unit.pos.x-player.pos.x,unit.pos.z-player.pos.z)
      const geometry=distance>this.quality.lodDistance?visual.rig.lowGeometry:visual.rig.highGeometry
      if(visual.rig.mesh.geometry!==geometry)visual.rig.mesh.geometry=geometry
      if(!unit.alive&&visual.rig.death===0)this.fx.wreck(visual)
      const animationHz=distance>this.quality.animationLodDistance?this.quality.farAnimationHz:this.quality.animationHz
      const interval=Math.max(1,Math.round(60/animationHz))
      const elapsed=world.tick-(visual.lastAnimationTick??(world.tick-1))
      if(elapsed>=interval){animateUnit(visual.rig,unit,Math.min(.1,elapsed/60),world.tick/60,world.nav);visual.lastAnimationTick=world.tick}
      else visual.object.updateMatrixWorld(true)
      visual.object.visible=!this.showcase && visual.rig.death<12
    }
    for(const [id,visual] of this.visuals) if(!ids.has(id)) {
      this.fx.release(visual); visual.object.removeFromParent(); disposeUnitRig(visual.rig,visual.object); this.visuals.delete(id)
    }
    this.processEvents(world)
    this.fx.update(dt,world.nav)
    if(this.showcase) this.updateShowcase()
    this.optics.update(this.showcase?this.showcase.units:this.visuals.values())
  }
  processEvents(world) {
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const event=world.eventLog[this.eventIndex]
      const visual=this.visuals.get(event.unitId||event.by)
      if(!visual) continue
      if(event.type==='unit_damage') {
        visual.rig.hit=1
        if(event.headshot) visual.rig.headshot=1
        visual.object.updateMatrixWorld(true)
        let target=visual.rig.joints[event.headshot?'Head':'Chest']
        target.getWorldPosition(this.v1)
        const p=world.players?.get(event.playerId)||world.player,pitch=p.pitch||0,yaw=p.yaw||0
        this.v2.set(p.pos.x,p.pos.y+(p.crouch?1.12:1.65),p.pos.z)
        const outward=this.v3.copy(this.v2).sub(this.v1).normalize()
        if(event.point)this.v1.set(event.point.x,event.point.y,event.point.z)
        else if(!['grenade','knife','unknown'].includes(event.weapon)) {
          this.v4.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
          this.ray.set(this.v2,this.v4)
          const hit=hitUnitRig(visual.rig,this.ray.ray)
          if(hit){
            this.v1.copy(hit.point);outward.copy(hit.normal)
            const candidate=hit.bone
            // Hydraulic bones inherit the flinch from the nearest main joint.
            target=candidate.userData.actuator?candidate.parent:candidate
          }else this.v1.addScaledVector(outward,event.headshot?.09:.16)
        }
        const unit=world.unitById.get(event.unitId)
        this.fx.damage(visual,target,this.v1,outward,event,unit)

      }
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
    for(const v of this.visuals.values()) disposeUnitRig(v.rig,v.object)
    for(const template of [...Object.values(this.runtimeTemplates||{}),...Object.values(this.runtimeFarTemplates||{})])template.traverse(child=>{if(child.isSkinnedMesh)child.skeleton.dispose()})
    this.optics?.dispose();this.optics=null
    this.fx?.dispose();this.fx=null
    this.owner?.cleanup();this.owner=null;this.root=null;this.templates={};this.runtimeTemplates={};this.runtimeFarTemplates={};this.materials=null;this.visuals.clear();this.activeIds.clear();this.eventIndex=0
  }
}
