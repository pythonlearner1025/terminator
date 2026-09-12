import {Vector3, Quaternion} from 'threepipe'

// Reuses the live weapon rig and its existing animation. No alternate model or animation path.
export class RangeInspect {
  constructor(manager) {
    this.manager=manager;this.active=false;this.theta=1.3;this.phi=.18;this.zoom=2.6
    this.anchor=new Vector3();this.rotation=new Quaternion();this.target=new Vector3();this.offset=new Vector3()
    this.drag=null
    const canvas=manager.ctx.viewer.canvas
    this.down=e=>{if(!this.active)return;e.preventDefault();e.stopImmediatePropagation();this.drag={x:e.clientX,y:e.clientY}}
    this.move=e=>{if(!this.active||!this.drag)return;this.theta-=(e.clientX-this.drag.x)*.007;this.phi=Math.max(-1.2,Math.min(1.2,this.phi+(e.clientY-this.drag.y)*.007));this.drag={x:e.clientX,y:e.clientY};manager.syncViews()}
    this.up=()=>{this.drag=null}
    this.wheel=e=>{if(!this.active)return;e.preventDefault();e.stopImmediatePropagation();this.zoom=Math.max(.5,Math.min(3.8,this.zoom*Math.exp(e.deltaY*.001)));manager.syncViews()}
    canvas.addEventListener('mousedown',this.down,true);canvas.addEventListener('wheel',this.wheel,{capture:true,passive:false})
    window.addEventListener('mousemove',this.move);window.addEventListener('mouseup',this.up)
  }
  setActive(active) {
    if(this.active===active)return
    this.active=active;this.drag=null
    this.manager.hud.root.classList.toggle('is-range-inspecting',active)
    const m=this.manager,p=m.world.player,camera=m.playerView.camera
    if(active) {
      this.anchor.set(p.pos.x,p.pos.y+1.65,p.pos.z)
      this.rotation.copy(camera.quaternion)
      this.target.set(0,-.14,-.75).applyQuaternion(this.rotation).add(this.anchor)
      m.ui.setInput(false)
    } else {
      m.playerView.weapons.camera.fov=54;m.playerView.weapons.camera.updateProjectionMatrix()
      m.ui.setInput(!m.ui.screens.route)
    }
  }
  pose() {
    if(!this.active)return
    const m=this.manager,camera=m.playerView.camera,w=m.playerView.weapons
    this.offset.set(Math.sin(this.theta)*Math.cos(this.phi),Math.sin(this.phi),Math.cos(this.theta)*Math.cos(this.phi))
    this.offset.applyQuaternion(this.rotation).multiplyScalar(this.zoom)
    camera.position.copy(this.target).add(this.offset);camera.fov=42;camera.lookAt(this.target);camera.updateProjectionMatrix();camera.updateMatrixWorld(true)
    w.scope?.sync('',0,false);w.feel.visible=true
  }
  beforeRender() {
    if(!this.active)return
    const m=this.manager,w=m.playerView.weapons,camera=m.playerView.camera
    w.root.position.copy(this.anchor);w.root.quaternion.copy(this.rotation);w.feel.rotation.set(0,0,0)
    w.root.updateMatrixWorld(true)
    // The inspect camera owns the projection, while the material keeps its existing depth ordering.
    w.camera.projectionMatrix.copy(camera.projectionMatrix)
    w.fx.beforeRender(camera,w.animation.aimAmount)
  }
  dispose() {
    if(this.active)this.setActive(false)
    const canvas=this.manager.ctx.viewer.canvas
    canvas.removeEventListener('mousedown',this.down,true);canvas.removeEventListener('wheel',this.wheel,true)
    window.removeEventListener('mousemove',this.move);window.removeEventListener('mouseup',this.up)
  }
}
