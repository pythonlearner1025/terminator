import {InstancedMesh, Object3D, Vector3, Quaternion, Color, DynamicDrawUsage} from 'threepipe'

// Slots and GPU buffers are fixed at construction. Dead slots are written once,
// then idle pools skip uploads and draws entirely.
export class FxPool {
  constructor(parent,name,geometry,material,capacity,{billboard=false,gravity=0,growth=0,fade=false,bounce=false,alignVelocity=false}={}) {
    this.mesh=new InstancedMesh(geometry,material,capacity);this.mesh.name=name
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);this.mesh.frustumCulled=false;this.mesh.raycast=()=>{}
    parent.add(this.mesh);this.mesh.visible=false;this.mesh.count=0
    this.items=Array.from({length:capacity},()=>({life:0,max:0,pos:new Vector3(),vel:new Vector3(),size:new Vector3(),quaternion:new Quaternion(),spin:0,floor:0,bounces:0,color:new Color(1,1,1)}))
    this.next=0;this.active=0;this.temp=new Object3D();this.color=new Color();this.target=new Vector3()
    Object.assign(this,{billboard,gravity,growth,fade,bounce,alignVelocity})
    this.temp.scale.setScalar(0);this.temp.updateMatrix()
    for(let i=0;i<capacity;i++){this.mesh.setMatrixAt(i,this.temp.matrix);this.mesh.setColorAt(i,this.color)}
    this.mesh.instanceColor.setUsage(DynamicDrawUsage)
  }
  emit(pos,vel,size,life,color=0xffffff) {
    const i=this.next++%this.items.length,p=this.items[i]
    p.pos.copy(pos);p.vel.copy(vel);p.size.copy(size);p.life=p.max=life;p.color.set(color)
    p.spin=i*2.399;p.bounces=0;p.quaternion.identity();p.floor=0
    this.active++;this.mesh.visible=true
    return p
  }
  prime(camera) {
    const p=this.items[0]
    p.pos.set(0,0,0);p.vel.set(0,0,0);p.size.set(1,1,1);p.life=p.max=1;p.color.set(0xffffff)
    p.spin=0;p.bounces=0;p.quaternion.identity();p.floor=0
    this.active=1;this.mesh.visible=true;this.update(0,camera)
  }
  reset() {
    this.temp.scale.setScalar(0);this.temp.updateMatrix()
    for(let i=0;i<this.items.length;i++){
      this.items[i].life=0;this.mesh.setMatrixAt(i,this.temp.matrix)
    }
    this.next=0;this.active=0;this.mesh.count=0;this.mesh.visible=false;this.mesh.instanceMatrix.needsUpdate=true
  }
  dispose() {this.mesh.dispose();this.items.length=0;this.active=0}
  update(dt,camera,onBounce) {
    if(!this.mesh.visible)return
    let alive=0
    for(let i=0;i<this.items.length;i++) {
      const p=this.items[i],was=p.life>0
      if(!was)continue
      p.life=Math.max(0,p.life-dt)
      if(p.life>0) {
        const slot=alive++;p.pos.addScaledVector(p.vel,dt);p.vel.y-=this.gravity*dt
        if(this.bounce&&p.pos.y<p.floor+.014&&p.vel.y<0) {
          const energy=-p.vel.y;p.pos.y=p.floor+.014;p.vel.y*= -.34;p.vel.x*=.56;p.vel.z*=.56
          if(p.bounces++===0)onBounce?.(p,energy)
          if(p.bounces>3){p.vel.set(0,0,0);p.spin=0}
        }
        this.temp.position.copy(p.pos)
        if(this.billboard&&camera)this.temp.quaternion.copy(camera.quaternion)
        else if(this.gravity&&!this.alignVelocity){p.spin+=dt*9;this.temp.rotation.set(p.spin,p.spin*.7,p.spin*.4)}
        else if(p.vel.lengthSq()>.001){this.target.copy(p.pos).add(p.vel);this.temp.lookAt(this.target)}
        else this.temp.quaternion.copy(p.quaternion)
        this.temp.scale.copy(p.size).multiplyScalar((1+this.growth*(p.max-p.life))*(this.fade?Math.min(1,p.life/.18):1))
        if(this.fade) {
          this.color.copy(p.color).multiplyScalar(Math.min(1,p.life/(p.max*.55)))
          this.mesh.setColorAt(slot,this.color)
        } else this.mesh.setColorAt(slot,p.color)
        this.temp.updateMatrix();this.mesh.setMatrixAt(slot,this.temp.matrix)
      }
    }
    this.active=alive;this.mesh.count=alive;this.mesh.visible=alive>0;this.mesh.instanceMatrix.needsUpdate=true
    if(this.mesh.instanceColor)this.mesh.instanceColor.needsUpdate=true
  }
}
