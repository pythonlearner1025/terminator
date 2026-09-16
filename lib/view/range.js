import * as E from 'threepipe'
import {BULLET_STYLE} from './bullets.js'
import {RuntimeObjectOwner} from '@kite3d/engine'
import {rayCollider} from '../core/collision.js'
import {createRangeProps} from './range-props.js'
import {createColliderWireframes} from './map.js'
import {weaponAsset} from './weapons-materials.js'
import {RangeInspect} from './range-inspect.js'

export class RangeView {
  constructor(manager, options = {}) {
    this.manager=manager;this.viewer=manager.ctx.viewer;this.loop='idle';this.lighting='night'
    this.options={trajectories:true,impacts:true,freeze:false,hitboxes:new URLSearchParams(location.search).get('colliders')==='1',ruler:true}
    this.shots=[];this.cursor=manager.world.eventLog.length;this.projectileShots=new Map();this.unitWires=new Map()
    this.from=new E.Vector3();this.direction=new E.Vector3();this.end=new E.Vector3();this.normal=new E.Vector3()
    const source=options.source || this.viewer.scene.modelRoot.getObjectByName('Weapons Range') || this.viewer.scene.modelRoot.getObjectByName('Weapons_Range')
      || this.viewer.scene.modelRoot.getObjectByName('Player Start') || this.viewer.scene.modelRoot.getObjectByName('Player_Start')
    this.owner=new RuntimeObjectOwner('terminator-weapons-range')
    this.root=this.owner.attachRuntimeRoot(new E.Group(),this.viewer.scene,source);this.root.name='Weapons Range Runtime'
    this.props=options.props || createRangeProps(E,this.viewer)
    if(!options.props)this.root.add(this.props)
    this.ready=this.props.ready||Promise.resolve(this.props)
    this.lines=new E.BufferGeometry();this.lineData=new Float32Array(38400)
    this.lines.setAttribute('position',new E.BufferAttribute(this.lineData,3).setUsage(E.DynamicDrawUsage));this.lines.setDrawRange(0,0)
    this.lineMesh=new E.LineSegments(this.lines,new E.LineBasicMaterial({color:0x70e9fc,transparent:true,opacity:.85,depthTest:false}))
    this.lineMesh.name='Range diagnostic shot paths';this.lineMesh.frustumCulled=false;this.root.add(this.lineMesh)
    this.markers=new E.InstancedMesh(new E.OctahedronGeometry(.055),new E.UnlitMaterial({color:0xffb15e,depthTest:false}),180)
    this.markers.frustumCulled=false;this.markers.count=0;this.root.add(this.markers);this.matrix=new E.Object3D()
    this.respawns=new Map()
    this.flashMap=new E.TextureLoader().load(weaponAsset('fx-blast.png'))
    this.flashMaterial=new E.UnlitMaterial({map:this.flashMap,color:0x89eaff,transparent:true,opacity:.45,depthWrite:false,blending:E.AdditiveBlending})
    this.flashGeometry=new E.PlaneGeometry(1,1)
    this.inspect=new RangeInspect(manager)
    this.lightingControl=options.lighting
    this.key=options.lighting?.key || manager.mapView.root.getObjectByName('Map moon shadow key')
    this.tonemap=this.viewer.getPlugin(E.TonemapPlugin)
    this.savedLight={color:this.key.color.clone(),intensity:this.key.intensity,position:this.key.position.clone(),exposure:this.tonemap.exposure}
    this.onRender=()=>{this.inspect.beforeRender();this.freezeFlash()}
    this.viewer.addEventListener('preRender',this.onRender)
  }
  get inspecting(){return this.inspect.active}
  setInspect(active){this.inspect.setActive(active)}
  equip(id) {
    const w=this.manager.playerView.weapons,a=w.animation
    for(const rig of Object.values(w.rigs))rig.root.visible=false
    a.active=id;a.shown=id;a.previous=id;a.switchAge=1;a.transient=null;a.shotAge=10;a.aimAmount=0;a.aimTarget=0
    w.rigs[id].root.visible=true;w.fx.flashLife=0;w.fx.rig=null
  }
  setLighting(id) {
    if (this.lightingControl) {
      if (this.lightingControl.setLighting(id)) this.lighting = id
      return
    }
    const presets={night:null,overcast:{color:0xdbe9ff,intensity:3.2,position:[-14,50,8],exposure:1.5},noon:{color:0xfff2dd,intensity:6.5,position:[8,60,-12],exposure:1.25}}
    if(!Object.hasOwn(presets,id))return
    this.lighting=id;const p=presets[id]
    this.key.color.copy(p?new E.Color(p.color):this.savedLight.color)
    this.key.intensity=p?p.intensity:this.savedLight.intensity
    this.key.position.copy(p?new E.Vector3(...p.position):this.savedLight.position)
    this.tonemap.exposure=p?p.exposure:this.savedLight.exposure
    this.key.updateMatrixWorld(true);this.viewer.renderManager.resetShadows();this.viewer.setDirty()
  }
  freezeFlash() {
    const fx=this.manager.playerView.weapons.fx
    if(!this.options.freeze||!fx.rig)return
    fx.flashLife=fx.flashMax;fx.flash.visible=true;fx.material.opacity=1
    fx.beforeRender(this.manager.playerView.camera,this.manager.playerView.weapons.animation.aimAmount)
  }
  addShot(shot) {
    this.shots.push(shot)
    if(this.shots.length>20) {const old=this.shots.shift();if(old.projectileId)this.projectileShots.delete(old.projectileId)}
  }
  plateHit(origin,direction,maxDistance=100,react=false) {
    let nearest=null
    for(const plate of this.props.plates) {
      if(Math.abs(direction.x)<1e-8)continue
      const distance=(plate.x-origin.x)/direction.x
      if(distance<=0||distance>maxDistance||nearest&&distance>=nearest.distance)continue
      const y=origin.y+direction.y*distance-plate.y,z=origin.z+direction.z*distance-plate.z
      const inHead=y>=-.12&&y<=.14&&Math.abs(z)<.11
      const inBody=y>=-.8&&y<-.12&&Math.abs(z)<.29
      if(!inHead&&!inBody)continue
      nearest={plate,distance,point:{x:plate.x,y:origin.y+direction.y*distance,z:origin.z+direction.z*distance}}
    }
    if(nearest&&react){nearest.plate.lastHit=this.manager.world.tick;nearest.plate.hits++;this.ring(nearest.plate)}
    return nearest
  }
  ring(plate) {
    const Context=window.AudioContext||window.webkitAudioContext
    if(!Context)return
    this.audio??=new Context();if(this.audio.state==='suspended')void this.audio.resume().catch(()=>{})
    const time=this.audio.currentTime,settings=this.manager.ui.screens.settings
    const volume=(settings.master/100)*(settings.effects/100)*.12
    this.voices??=new Set()
    if(this.voices.size>=24)return
    for(const [frequency,gain,duration] of [[1480,1,.65],[2240,.5,.35],[3970,.18,.18]]) {
      const oscillator=this.audio.createOscillator(),envelope=this.audio.createGain()
      oscillator.frequency.value=frequency+Number(plate.id.at(-1))*23
      envelope.gain.setValueAtTime(volume*gain,time);envelope.gain.exponentialRampToValueAtTime(.00001,time+duration)
      oscillator.connect(envelope);envelope.connect(this.audio.destination);oscillator.start();oscillator.stop(time+duration)
      this.voices.add(oscillator);oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();this.voices.delete(oscillator)}
    }
  }
  consume(world) {
    const muzzle=this.manager.playerView.weapons.muzzlePosition
    for(;this.cursor<world.eventLog.length;this.cursor++) {
      const e=world.eventLog[this.cursor]
      if(e.type==='shot'&&e.by===world.player.id&&e.paths) {
        const paths=e.paths.map(path=>{
          const distance=Math.hypot(path.point.x-e.origin.x,path.point.y-e.origin.y,path.point.z-e.origin.z)
          const plate=this.plateHit(e.origin,path.direction,distance,false)
          const bullets=this.manager.playerView.weapons.bullets
          const speed=BULLET_STYLE[e.weapon]?.speed||60
          const due=Math.min(world.tick,(e.tick??world.tick)+1)/60+muzzle.distanceTo(plate?.point||path.point)/speed
          if(plate&&bullets){
            const impact=bullets.impacts.schedule(null,e,'plate',due,plate.point,this.normal.set(-1,0,0),'metal')
            if(impact)impact.plate=plate.plate
          }
          return {points:[muzzle.clone(),new E.Vector3().copy(plate?.point||path.point)],hit:!!plate||path.hit,due}
        })
        this.addShot({tick:world.tick,paths})
      }
      if((e.type==='projectile_fired'&&e.ownerId===world.player.id)||(e.type==='grenade_thrown'&&e.by===world.player.id)) {
        const id=e.id||e.projectileId,shot={tick:world.tick,projectileId:id,paths:[{points:[muzzle.clone(),new E.Vector3().copy(e.pos)],hit:false}]}
        this.projectileShots.set(id,shot);this.addShot(shot)
      }
      if(e.type==='projectile_hit'||e.type==='explosion') {
        const shot=this.projectileShots.get(e.id||e.projectileId)
        if(shot){shot.paths[0].points.push(new E.Vector3().copy(e.pos));shot.paths[0].hit=true;shot.tick=world.tick;this.projectileShots.delete(e.id||e.projectileId)}
      }
      if(e.type==='range_respawn') {
        const mesh=new E.Mesh2(this.flashGeometry,this.flashMaterial);mesh.position.copy(e.pos);mesh.position.y+=1;this.root.add(mesh)
        this.respawns.set(mesh,world.tick)
      }
    }
    for(const p of world.projectiles) {
      const shot=this.projectileShots.get(p.id);if(!shot)continue
      const path=shot.paths[0],previous=path.points.at(-1)
      this.direction.copy(p.pos).sub(previous);const distance=this.direction.length()
      if(distance>.0001) {
        this.direction.divideScalar(distance)
        const plate=this.plateHit(previous,this.direction,distance,true)
        if(plate)path.hit=true
      }
      if(world.tick%2===0&&path.points.length<320)path.points.push(new E.Vector3().copy(p.pos))
      shot.tick=world.tick
    }
    this.shots=this.shots.filter(shot=>world.tick-shot.tick<=180)
    const live=new Set(world.projectiles.map(p=>p.id))
    for(const id of this.projectileShots.keys())if(!live.has(id))this.projectileShots.delete(id)
  }
  draw() {
    let cursor=0,markers=0
    for(const shot of this.shots)for(const path of shot.paths) {
      for(let i=1;i<path.points.length&&cursor+6<=this.lineData.length;i++) {
        for(const p of [path.points[i-1],path.points[i]]){this.lineData[cursor++]=p.x;this.lineData[cursor++]=p.y;this.lineData[cursor++]=p.z}
      }
      if(path.hit&&(path.due===undefined||(this.manager.playerView.weapons.bullets?.lastTime??this.manager.world.tick/60)>=path.due)&&markers<180){this.matrix.position.copy(path.points.at(-1));this.matrix.updateMatrix();this.markers.setMatrixAt(markers++,this.matrix.matrix)}
    }
    this.lines.attributes.position.needsUpdate=true;this.lines.setDrawRange(0,cursor/3)
    this.lineMesh.visible=this.options.trajectories&&!this.inspecting
    this.markers.count=markers;this.markers.instanceMatrix.needsUpdate=true;this.markers.visible=this.options.impacts&&!this.inspecting
  }
  sync(world) {
    this.consume(world);this.draw()
    for(const plate of this.props.plates){const age=(world.tick-plate.lastHit)/60;plate.pivot.rotation.x=Number.isFinite(age)?Math.sin(age*11)*Math.exp(-age*2)*.5:0}
    for(const [mesh,tick] of this.respawns){const age=(world.tick-tick)/60;if(age>.35){mesh.removeFromParent();this.respawns.delete(mesh)}else {mesh.scale.setScalar(.3+age*3);mesh.quaternion.copy(this.manager.playerView.camera.quaternion)}}
    this.syncHitboxes(world);this.ruler(world);this.inspect.pose();this.freezeFlash()
  }
  ruler(world) {
    if(!this.options.ruler)return
    const p=world.player
    this.from.set(p.pos.x,p.pos.y+(p.crouch?1.12:1.65),p.pos.z)
    this.direction.set(Math.sin(p.yaw)*Math.cos(p.pitch),Math.sin(p.pitch),Math.cos(p.yaw)*Math.cos(p.pitch))
    let best=null
    for(const collider of world.activeColliders()){const hit=rayCollider(this.from,this.direction,collider,100);if(hit&&(!best||hit.distance<best.distance))best={...hit,label:'surface'}}
    for(const unit of world.aliveUnits){const hit=world.unitRayHit(this.from,this.direction,unit,best?.distance||100);if(hit&&(!best||hit.distance<best.distance))best={...hit,label:world.unitCatalog.types[unit.type].name}}
    const plate=this.plateHit(this.from,this.direction,best?.distance||100)
    if(plate)best={...plate,label:'steel plate'}
    this.distanceLabel=best?`${best.distance.toFixed(1)} m / ${best.label}`:'No target within 100 m'
  }
  syncHitboxes(world) {
    const ids=new Set()
    if(this.options.hitboxes)for(const unit of world.aliveUnits) {
      ids.add(unit.id)
      let wire=this.unitWires.get(unit.id)
      if(!wire) {
        const collider=world.unitHitCollider(unit);collider.center={x:0,y:0,z:0};collider.yaw=0
        wire=createColliderWireframes({colliders:[collider],doors:[],flankWall:{broken:true}})
        this.root.add(wire);this.unitWires.set(unit.id,wire)
      }
      wire.position.copy(unit.pos);wire.rotation.y=unit.yaw;wire.visible=!this.inspecting
    }
    for(const [id,wire] of this.unitWires)if(!ids.has(id)){disposeWire(wire);this.unitWires.delete(id)}
    if(this.manager.mapView.debugColliders)this.manager.mapView.debugColliders.visible=this.options.hitboxes&&!this.inspecting
  }
  clearShots() {
    this.shots=[];this.projectileShots.clear();this.cursor=this.manager.world.eventLog.length
    this.manager.playerView.weapons.bullets.reset();this.draw()
  }
  dispose() {
    this.props.disposeRangeProps?.()
    this.inspect.dispose();this.viewer.removeEventListener('preRender',this.onRender)
    this.setLighting('night')
    for(const wire of this.unitWires.values())disposeWire(wire)
    this.unitWires.clear();this.projectileShots.clear();this.respawns.clear();this.shots=[]
    for(const voice of this.voices||[])voice.stop()
    if(this.audio)void this.audio.close().catch(()=>{})
    this.flashGeometry.dispose();this.flashMaterial.dispose();this.flashMap.dispose()
    this.owner.cleanup()
  }
}
function disposeWire(wire){wire.traverse(node=>{node.geometry?.dispose();node.material?.dispose()});wire.removeFromParent()}
