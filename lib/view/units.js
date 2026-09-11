import {Group, Vector3, Raycaster, HemisphereLight, DirectionalLight, Mesh2, PlaneGeometry, PhysicalMaterial, Color} from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {bindUnitRig, animateUnit, disposeUnitRig} from './units-animation.js'
import {UnitFx} from './fx.js'

const TEMPLATE_NAMES = {scout:'Unit Template Scout',endo:'Unit Template Endo',heavy:'Unit Template Heavy'}

export class UnitView {
  constructor(viewer) {
    this.viewer=viewer; this.owner=null; this.root=null; this.templates={}; this.visuals=new Map()
    this.eventIndex=0; this.lastTick=0; this.v1=new Vector3(); this.v2=new Vector3(); this.ray=new Raycaster()
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
    this.eventIndex=world.eventLog.length; this.lastTick=world.tick
    this.onKey=e=>{ if(e.code==='F8') { e.preventDefault(); this.toggleShowcase() }
      if(e.code==='F9'&&this.showcase) { e.preventDefault();const states=['idle','moving','aiming','firing','hit','spin-up','dying'];this.showcase.state=states[(states.indexOf(this.showcase.state)+1)%states.length];this.showcase.time=0 } }
    window.addEventListener('keydown',this.onKey)
    this.onRender=()=>this.renderShowcase()
    this.viewer.addEventListener('preRender',this.onRender)
  }
  cloneTemplateFigure(unit, parent=this.root) {
    const source=this.templates[unit.type]
    const preview=source.children.find(child=>child.userData?.kite3dGenerated)
    if(!preview) throw new Error(`Generated preview is missing for ${source.name}`)
    // Clone the generated figure, without the Generator component on its authored
    // parent, so runtime attachment cannot rerun and replace the cloned skeleton.
    const object=preview.clone(true)
    object.name=`${unit.id} Runtime`
    object.position.set(unit.pos.x,unit.pos.y,unit.pos.z); object.rotation.y=unit.yaw
    const eyeMaterials=new Set()
    object.traverse(child=>{
      for(const key of ['EntityComponentPlugin','kite3dGenerated','kite3dAuthoring','kite3dRuntime','excludeFromExport']) delete child.userData[key]
      if(child.name==='Eye Left'||child.name==='Eye Right'||child.name==='Eye Bloom'||child.name==='Muzzle Heat') {
        child.material=child.material.clone(); eyeMaterials.add(child.material)
      }
    })
    this.owner.trackEffect(object,source)
    parent.add(object)
    const rig=bindUnitRig(object)
    rig.eyeMaterials=eyeMaterials
    return {object,rig}
  }
  sync(world) {
    if(!this.owner) return
    const dt=Math.min(.1,Math.max(0,(world.tick-this.lastTick)/60))
    this.lastTick=world.tick
    const ids=new Set()
    for(const unit of world.units) {
      ids.add(unit.id)
      let visual=this.visuals.get(unit.id)
      if(!visual) {
        // A completed corpse should not be rebuilt if a snapshot retains dead units.
        if(!unit.alive && world.tick-(unit.diedAtTick??world.tick)>180) continue
        visual=this.cloneTemplateFigure(unit); this.visuals.set(unit.id,visual)
      }
      visual.object.position.set(unit.pos.x,unit.pos.y,unit.pos.z)
      visual.object.rotation.y=unit.yaw
      animateUnit(visual.rig,unit,dt,world.tick/60)
      visual.object.visible=!this.showcase && visual.rig.death<2.5
    }
    for(const [id,visual] of this.visuals) if(!ids.has(id)) {
      visual.object.removeFromParent(); disposeUnitRig(visual.rig,visual.object); this.visuals.delete(id)
    }
    this.processEvents(world)
    this.fx.update(dt)
    if(this.showcase) this.updateShowcase()
  }
  processEvents(world) {
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const event=world.eventLog[this.eventIndex]
      const visual=this.visuals.get(event.unitId||event.by)
      if(!visual) continue
      if(event.type==='unit_damage') {
        visual.rig.hit=1
        if(event.headshot) visual.rig.headshot=1
        // Current core damage events omit point. Use the visual ray intersection
        // for player shots; fall back to the relevant joint for radial/melee hits.
        visual.object.updateMatrixWorld(true)
        const target=visual.rig.joints[event.headshot?'Head':'Chest']
        target.getWorldPosition(this.v1); this.v1.z+=.12
        if(event.point) this.v1.set(event.point.x,event.point.y,event.point.z)
        else if(!['grenade','knife','unknown'].includes(event.weapon)) {
          const p=world.player,pitch=p.pitch||0,yaw=p.yaw||0
          this.ray.set(new Vector3(p.pos.x,p.pos.y+(p.crouch?1.12:1.65),p.pos.z),new Vector3(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)))
          const hit=this.ray.intersectObject(visual.object,true)[0]
          if(hit) this.v1.copy(hit.point)
        }
        this.fx.hit(this.v1,world.tick)
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
    const stage=new Group(); stage.name='F8 Unit Showcase'; this.root.add(stage)
    stage.position.set(0,80,0)
    const fill=new HemisphereLight(0xb6d9ff,0x282018,1.5); stage.add(fill)
    const key=new DirectionalLight(0xe1efff,3.5); key.position.set(-3,5,4); stage.add(key); stage.add(key.target); key.target.position.set(0,1,0)
    const rim=new DirectionalLight(0xffad6c,2); rim.position.set(3,2,-3); stage.add(rim); stage.add(rim.target); rim.target.position.set(0,1,0)
    const backdrop=new Mesh2(new PlaneGeometry(30,30),new PhysicalMaterial({color:new Color(0x070e18),roughness:.85}))
    backdrop.name='Showcase floor'; backdrop.rotation.x=-Math.PI/2; stage.add(backdrop)
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
    this.fx?.dispose();this.fx=null
    this.owner?.cleanup();this.owner=null;this.root=null;this.templates={};this.visuals.clear();this.eventIndex=0
  }
}
