import * as E from 'threepipe'
import {unitMaterials} from '../../generators/unit-materials.js'
import {unitGround} from './units-animation.js'

const forward=new E.Vector3(0,0,1)

// Enemy effects are isolated from player WeaponFx. All pools have hard caps.
export class UnitFx {
  constructor(parent) {
    this.root=new E.Group();this.root.name='Enemy sparks oil and wreckage';parent.add(this.root)
    this.materials=unitMaterials(E);this.temp=new E.Object3D();this.v=new E.Vector3();this.normal=new E.Vector3()
    this.pools={};this.poolList=[];this.bodies=[];this.nextDecal=0;this.nextEmber=0;this.clock=0
    this.stats={sparkBursts:0,oilBursts:0,plasmaShots:0,minigunShots:0,decals:0,severedLimbs:0}
    for(const [name,color,capacity]of [['sparks',0xffc572,192],['oil',0x15120f,96],['plasma',0x90dfff,48],['bullet',0xffa749,64]]){
      const geometry=new E.BoxGeometry(1,1,1)
      // Oil is opaque PBR, using the dark atlas tile. Radiant particles are additive.
      if(name==='oil'){
        const uv=geometry.attributes.uv
        for(let i=0;i<uv.count;i++)uv.setXY(i,.008+uv.getX(i)*.484,.008+uv.getY(i)*.484)
      }
      const material=name==='oil'?this.materials.metal:new E.UnlitMaterial({color,map:this.materials.glowMap,transparent:true,depthWrite:false,blending:E.AdditiveBlending})
      const mesh=new E.InstancedMesh(geometry,material,capacity);mesh.name='Enemy '+name;mesh.frustumCulled=false;mesh.raycast=()=>{};this.root.add(mesh)
      const pool={name,mesh,next:0,live:0,items:Array.from({length:capacity},()=>({life:0,max:1,pos:new E.Vector3(),vel:new E.Vector3(),scale:new E.Vector3(),floor:0}))}
      this.pools[name]=pool;this.poolList.push(pool)
    }
    this.plane=new E.PlaneGeometry(1,1)
    this.decals=Array.from({length:72},()=>{
      const mesh=new E.Mesh2(this.plane,this.materials.impact);mesh.name='Attached impact dent';mesh.visible=false;mesh.raycast=()=>{}
      return{mesh,life:0,owner:null}
    })
    this.embers=Array.from({length:24},()=>{
      const material=this.materials.halo.clone();material.color.setHex(0xff3304)
      const mesh=new E.Mesh2(this.plane,material);mesh.name='Cooling wreck ember';mesh.visible=false;mesh.raycast=()=>{}
      return{mesh,life:0}
    })
    this.update(0)
  }
  particle(name,pos,velocity,scale,life,floor=0){
    const pool=this.pools[name],p=pool.items[pool.next++%pool.items.length]
    if(p.life<=0)pool.live++
    p.pos.copy(pos);p.vel.copy(velocity);p.scale.copy(scale);p.life=p.max=life;p.floor=floor
  }
  hit(pos,seed=0,normal=forward,floor=0){
    this.stats.sparkBursts++;this.stats.oilBursts++
    for(let i=0;i<14;i++){
      const a=i*2.399+seed,b=.9+(i%5)*.55
      this.v.set(Math.cos(a)*b,.5+(i%3)*.9,Math.sin(a)*b).addScaledVector(normal,1.4)
      this.particle('sparks',pos,this.v,new E.Vector3(.01,.01,.075),.2+(i%5)*.045,floor)
    }
    for(let i=0;i<7;i++){
      const a=i*2.399+seed
      this.v.set(Math.cos(a)*.65,.6+i*.1,Math.sin(a)*.65).addScaledVector(normal,.65)
      this.particle('oil',pos,this.v,new E.Vector3(.012,.016,.03),.5+i*.07,floor)
    }
  }
  damage(visual,bone,pos,normal,event,unit){
    this.hit(pos,event.tick||this.clock,normal,unit.pos.y)
    const d=this.decals[this.nextDecal++%this.decals.length]
    d.mesh.removeFromParent();bone.add(d.mesh);d.mesh.position.copy(pos);bone.worldToLocal(d.mesh.position)
    this.v.copy(pos).add(normal);bone.worldToLocal(this.v);this.v.sub(d.mesh.position).normalize()
    d.mesh.quaternion.setFromUnitVectors(forward,this.v);d.mesh.position.addScaledVector(this.v,.004)
    const size=event.weapon==='plasma'?.15:.075
    d.mesh.scale.set(size,size,1);d.mesh.visible=true;d.life=18;d.owner=visual
    this.stats.decals++
    if(event.amount>=65){visual.rig.stagger=1;visual.rig.states.add('stagger')}
    visual.rig.flinches[bone.name]={life:1,strength:Math.min(.5,.1+event.amount/220),side:pos.x<unit.pos.x?-1:1}
    // High energy damage can remove a non-weapon arm. This is presentation only:
    // the unchanged core body and weapon retain their existing combat rules.
    visual.heavyTrauma=(visual.heavyTrauma||0)+(event.amount>=65?event.amount:0)
    if(visual.heavyTrauma>=130&&visual.rig.severed.size===0){
      const limb=bone.name.includes('Arm')&&!bone.name.includes('Right')?bone.name:'Forearm Left'
      this.sever(visual,limb,normal,unit.pos.y)
    }
  }
  sever(visual,name,normal,floor){
    const rig=visual.rig,bone=rig.joints[name],source=rig.mesh
    if(!bone||rig.severed.has(name))return
    if(this.bodies.length>=12)this.removeBody(this.bodies.shift())
    source.skeleton.update()
    const ids=new Set();bone.traverse(b=>{const i=source.skeleton.bones.indexOf(b);if(i>=0)ids.add(i)})
    const origin=bone.getWorldPosition(new E.Vector3()),positions=[],uvs=[],uv=source.geometry.attributes.uv,skin=source.geometry.attributes.skinIndex
    for(let i=0;i<skin.count;i++)if(ids.has(skin.getX(i))){
      source.getVertexPosition(i,this.v);source.localToWorld(this.v);this.v.sub(origin)
      positions.push(this.v.x,this.v.y,this.v.z);uvs.push(uv.getX(i),uv.getY(i))
    }
    if(!positions.length)return
    const geometry=new E.BufferGeometry();geometry.setAttribute('position',new E.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new E.Float32BufferAttribute(uvs,2));geometry.computeVertexNormals();geometry.computeBoundingBox()
    const mesh=new E.Mesh2(geometry,this.materials.metal);mesh.name='Detached '+name;mesh.position.copy(origin);this.root.add(mesh)
    const box=geometry.boundingBox,corners=Array.from({length:8},(_,i)=>new E.Vector3(box[i&1?'max':'min'].x,box[i&2?'max':'min'].y,box[i&4?'max':'min'].z))
    this.bodies.push({mesh,corners,velocity:normal.clone().multiplyScalar(1.8).add(new E.Vector3(0,2.1,0)),spin:new E.Vector3(3,1,2),life:12,floor})
    rig.severed.add(name);bone.scale.setScalar(.00001);this.stats.severedLimbs++
  }
  wreck(visual){
    const e=this.embers[this.nextEmber++%this.embers.length]
    e.mesh.removeFromParent();visual.rig.joints.Chest.add(e.mesh);e.mesh.position.set(0,.04,.18)
    e.mesh.rotation.set(0,0,0);e.mesh.scale.set(.3,.25,1);e.mesh.visible=true;e.life=12
  }
  shot(from,to,type){
    const heavy=type==='heavy',name=heavy?'bullet':'plasma'
    this.stats[heavy?'minigunShots':'plasmaShots']++
    const distance=from.distanceTo(to)
    this.v.subVectors(to,from).normalize().multiplyScalar(heavy?110:62)
    this.particle(name,from,this.v,new E.Vector3(heavy?.02:.045,heavy?.02:.045,heavy?1.3:.9),Math.min(.45,distance/(heavy?110:62)))
    this.v.set(0,0,0);this.particle(name,from,this.v,new E.Vector3(.11,.11,.24),.055)
  }
  release(visual){for(const d of this.decals)if(d.owner===visual){d.mesh.removeFromParent();d.life=0;d.owner=null}}
  update(dt,nav){
    this.clock+=dt
    for(const pool of this.poolList){
      const name=pool.name
      if(pool.live===0){pool.mesh.visible=false;continue}
      let active=0
      for(let i=0;i<pool.items.length;i++){
        const p=pool.items[i];p.life=Math.max(0,p.life-dt)
        if(p.life>0){
          active++;p.pos.addScaledVector(p.vel,dt)
          if(name==='sparks'||name==='oil'){
            p.vel.y-=dt*9.81
            const floor=unitGround(nav,p.pos.x,p.pos.z,p.floor)
            if(p.pos.y<floor+.008){p.pos.y=floor+.008;p.vel.y=Math.abs(p.vel.y)*.2;p.vel.x*=.6;p.vel.z*=.6}
          }
          this.temp.position.copy(p.pos);this.v.copy(p.pos).add(p.vel)
          if(p.vel.lengthSq()>.001)this.temp.lookAt(this.v)
          this.temp.scale.copy(p.scale).multiplyScalar(Math.min(1,p.life/p.max*3))
        }else this.temp.scale.setScalar(0)
        this.temp.updateMatrix();pool.mesh.setMatrixAt(i,this.temp.matrix)
      }
      pool.live=active;pool.mesh.visible=active>0;pool.mesh.instanceMatrix.needsUpdate=true
    }
    for(const d of this.decals){d.life=Math.max(0,d.life-dt);if(d.life===0){d.mesh.visible=false;d.mesh.removeFromParent();d.owner=null}}
    for(const e of this.embers){e.life=Math.max(0,e.life-dt);e.mesh.visible=e.life>0;e.mesh.material.opacity=(e.life/12)*(.2+.06*Math.sin(this.clock*3));if(!e.life)e.mesh.removeFromParent()}
    for(let i=this.bodies.length-1;i>=0;i--){
      const b=this.bodies[i];b.life-=dt
      if(b.life<=0){this.removeBody(b);this.bodies.splice(i,1);continue}
      b.velocity.y-=9.81*dt;b.mesh.position.addScaledVector(b.velocity,dt)
      b.mesh.rotation.x+=b.spin.x*dt;b.mesh.rotation.y+=b.spin.y*dt;b.mesh.rotation.z+=b.spin.z*dt;b.mesh.updateMatrixWorld(true)
      let correction=0
      for(const corner of b.corners){this.v.copy(corner).applyMatrix4(b.mesh.matrixWorld);correction=Math.max(correction,unitGround(nav,this.v.x,this.v.z,b.floor)+.006-this.v.y)}
      if(correction>0){b.mesh.position.y+=correction;b.velocity.y=Math.abs(b.velocity.y)*.15;b.velocity.x*=.65;b.velocity.z*=.65;b.spin.multiplyScalar(.6)}
    }
  }
  removeBody(body){body.mesh.removeFromParent();body.mesh.geometry.dispose()}
  dispose(){
    for(const b of this.bodies)this.removeBody(b)
    for(const p of this.poolList){p.mesh.geometry.dispose();if(p.mesh.material!==this.materials.metal)p.mesh.material.dispose();p.mesh.dispose?.()}
    for(const d of this.decals)d.mesh.removeFromParent()
    for(const e of this.embers){e.mesh.removeFromParent();e.mesh.material.dispose()}
    this.plane.dispose();this.root.removeFromParent();this.bodies=[];this.pools={};this.poolList=[]
  }
}

// Lenses and scattering are instanced across the crowd. A per-instance power
// attribute keeps independent eye flicker without a material/draw for each eye.
export class UnitOptics {
  constructor(parent){
    const shared=unitMaterials(E)
    this.root=new E.Group();this.root.name='Instanced enemy optics';parent.add(this.root)
    this.temp=new E.Object3D();this.color=new E.Color();this.pools={};this.poolList=[]
    for(const [name,capacity,geometry,source]of [['lens',128,new E.SphereGeometry(.012,10,6),shared.eye],['glow',448,new E.PlaneGeometry(1,1),shared.halo]]){
      const material=source.clone()
      material.registerMaterialExtensions([{
        uuid:'unit-optic-power-'+name,computeCacheKey:'unit-optic-power-'+name,
        parsVertexSnippet:'attribute float unitOpticPower; varying float vUnitOpticPower;',
        parsFragmentSnippet:'varying float vUnitOpticPower;',
        shaderExtender(shader){
          shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvUnitOpticPower=unitOpticPower;')
          shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=vUnitOpticPower;')
          shader.fragmentShader=shader.fragmentShader.replace('#include <alphamap_fragment>','#include <alphamap_fragment>\ndiffuseColor.a*=vUnitOpticPower;')
        },
      }])
      const power=new E.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('unitOpticPower',power)
      const mesh=new E.InstancedMesh(geometry,material,capacity);mesh.name='Crowd optical '+name;mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.count=0
      this.root.add(mesh);const pool={mesh,power,next:0};this.pools[name]=pool;this.poolList.push(pool)
    }
  }
  update(visuals){
    for(const p of this.poolList)p.next=0
    for(const v of visuals){
      if(!v.object.visible)continue
      const emitters=v.rig.eyes?.visible?v.rig.eyes.children:[]
      const muzzle=v.rig.muzzleHeat?.userData.batchVisible?v.rig.muzzleHeat:null
      const count=emitters.length+(muzzle?1:0)
      for(let childIndex=0;childIndex<count;childIndex++){
        const c=childIndex<emitters.length?emitters[childIndex]:muzzle
        const lens=c.name==='Eye Left'||c.name==='Eye Right',p=this.pools[lens?'lens':'glow'],i=p.next++
        if(i>=p.power.count){p.next=p.power.count;break}
        c.updateMatrix();c.matrixWorld.multiplyMatrices(c.parent.matrixWorld,c.matrix)
        c.matrixWorld.decompose(this.temp.position,this.temp.quaternion,this.temp.scale)
        if(!lens){this.temp.scale.x*=c.geometry.parameters.width;this.temp.scale.y*=c.geometry.parameters.height}
        this.temp.updateMatrix();p.mesh.setMatrixAt(i,this.temp.matrix)
        p.power.setX(i,lens?c.material.emissiveIntensity/8:c.material.opacity)
        if(lens)this.color.setHex(0xffffff);else this.color.copy(c.material.color)
        p.mesh.setColorAt(i,this.color)
      }
    }
    for(const p of this.poolList){p.mesh.count=p.next;p.mesh.visible=p.next>0;p.mesh.instanceMatrix.needsUpdate=true;if(p.mesh.instanceColor)p.mesh.instanceColor.needsUpdate=true;p.power.needsUpdate=true}
  }
  dispose(){for(const p of this.poolList){p.mesh.geometry.dispose();p.mesh.material.dispose();p.mesh.dispose?.()}this.poolList=[];this.root.removeFromParent()}
}
