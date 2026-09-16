import * as E from 'threepipe'
import {unitMaterials} from './unit-materials.js'
import {unitGround} from './units-animation.js'
import {GoreSystem} from './gore.js'
import {releaseMeshGeometry} from './mesh-release.js'

const forward=new E.Vector3(0,0,1)
const markRange=(attribute,count)=>{
  attribute.clearUpdateRanges();attribute.addUpdateRange(0,count);attribute.needsUpdate=true
}

// Enemy effects are isolated from player WeaponFx. All pools have hard caps.
export class UnitFx {
  constructor(parent,ragdolls) {
    this.root=new E.Group();this.root.name='Enemy sparks oil and wreckage';parent.add(this.root)
    this.materials=unitMaterials(E);this.temp=new E.Object3D();this.v=new E.Vector3();this.normal=new E.Vector3();this.scale=new E.Vector3()
    this.matrix=new E.Matrix4();this.upImpulse=new E.Vector3(0,2.1,0)
    this.pools={};this.poolList=[];this.nextDecal=0;this.nextEmber=0;this.clock=0
    this.ragdolls=ragdolls
    this.stats={sparkBursts:0,oilBursts:0,plasmaShots:0,minigunShots:0,decals:0,severedLimbs:0}
    for(const [name,color,capacity]of [['sparks',0xffc572,192],['oil',0x15120f,96],['plasma',0x90dfff,48],['bullet',0xffa749,64]]){
      const geometry=new E.BoxGeometry(1,1,1)
      // Oil is opaque PBR, using the dark atlas tile. Radiant particles are additive.
      if(name==='oil'){
        const uv=geometry.attributes.uv
        for(let i=0;i<uv.count;i++)uv.setXY(i,.008+uv.getX(i)*.484,.008+uv.getY(i)*.484)
      }
      const material=name==='oil'?this.materials.metal:new E.UnlitMaterial({color,map:this.materials.glowMap,transparent:true,depthWrite:false,blending:E.AdditiveBlending})
      const mesh=new E.InstancedMesh(geometry,material,capacity);mesh.name='Enemy '+name;mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.count=0;this.root.add(mesh)
      const pool={name,mesh,next:0,live:0,items:Array.from({length:capacity},()=>({life:0,max:1,pos:new E.Vector3(),vel:new E.Vector3(),scale:new E.Vector3(),floor:0}))}
      this.pools[name]=pool;this.poolList.push(pool)
    }
    this.plane=new E.PlaneGeometry(1,1)
    this.decalMesh=new E.InstancedMesh(this.plane,this.materials.impact,72);this.decalMesh.name='72 pooled attached impact dents'
    this.decalMesh.instanceMatrix.setUsage(E.DynamicDrawUsage);this.decalMesh.visible=false;this.decalMesh.count=0;this.decalMesh.frustumCulled=false;this.decalMesh.raycast=()=>{};this.root.add(this.decalMesh)
    this.decals=Array.from({length:72},()=>({life:0,owner:null,bone:null,position:new E.Vector3(),quaternion:new E.Quaternion(),scale:new E.Vector3()}))
    const emberMaterial=this.materials.halo.clone();emberMaterial.name='Cooling wreck ember';emberMaterial.color.setHex(0xff3304)
    this.emberMesh=new E.InstancedMesh(this.plane,emberMaterial,24);this.emberMesh.name='24 pooled cooling wreck embers'
    this.emberMesh.instanceMatrix.setUsage(E.DynamicDrawUsage);this.emberMesh.visible=false;this.emberMesh.count=0;this.emberMesh.frustumCulled=false;this.emberMesh.raycast=()=>{};this.root.add(this.emberMesh)
    this.embers=Array.from({length:24},()=>({life:0,bone:null,position:new E.Vector3(),quaternion:new E.Quaternion(),scale:new E.Vector3(.3,.25,1)}))
    this.gore=new GoreSystem(this.root,ragdolls,this,this.materials)
    this.bodies=this.gore.pieces.items
    this.temp.scale.setScalar(0);this.temp.updateMatrix()
    for(let i=0;i<this.decals.length;i++)this.decalMesh.setMatrixAt(i,this.temp.matrix)
    for(let i=0;i<this.embers.length;i++)this.emberMesh.setMatrixAt(i,this.temp.matrix)
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
      this.particle('sparks',pos,this.v,this.scale.set(.01,.01,.075),.2+(i%5)*.045,floor)
    }
    for(let i=0;i<7;i++){
      const a=i*2.399+seed
      this.v.set(Math.cos(a)*.65,.6+i*.1,Math.sin(a)*.65).addScaledVector(normal,.65)
      this.particle('oil',pos,this.v,this.scale.set(.012,.016,.03),.5+i*.07,floor)
    }
  }
  damage(visual,bone,pos,normal,event,unit){
    if(visual.unitType==='t1000'){if(visual.rig.roster)visual.rig.roster.ripple=1;return}
    this.hit(pos,event.tick||this.clock,normal,unit.pos.y)
    if(!bone)return
    const d=this.decals[this.nextDecal++%this.decals.length]
    d.bone=bone;d.position.copy(pos);bone.worldToLocal(d.position)
    this.v.copy(pos).add(normal);bone.worldToLocal(this.v);this.v.sub(d.position).normalize()
    d.quaternion.setFromUnitVectors(forward,this.v);d.position.addScaledVector(this.v,.004)
    const size=event.weapon==='plasma'?.15:.075
    d.scale.set(size,size,1);d.life=18;d.owner=visual;this.decalMesh.visible=true
    this.stats.decals++
    if(event.amount>=65){visual.rig.stagger=1;visual.rig.states.add('stagger')}
    const flinch=visual.rig.flinches[bone.name]
    if(flinch){flinch.life=1;flinch.strength=Math.min(.5,.1+event.amount/220);flinch.side=pos.x<unit.pos.x?-1:1}
    this.gore.event(event,visual,unit,bone,pos,visual.impact?.direction||normal)
  }
  sever(visual,name,normal,floor){return this.gore.detach(visual,name,normal,floor)}
  prepareLimb(visual,name){this.gore.prepareType(visual);return this.gore.definitions.get(visual.unitType)?.get(name)}
  scorch(visual,bone,pos,direction){
    if(!bone)return
    const d=this.decals[this.nextDecal++%this.decals.length]
    d.bone=bone;d.position.copy(pos);bone.worldToLocal(d.position)
    this.v.copy(pos).sub(direction);bone.worldToLocal(this.v);this.v.sub(d.position).normalize()
    d.quaternion.setFromUnitVectors(forward,this.v);d.position.addScaledVector(this.v,.008)
    d.scale.set(.42,.42,1);d.life=180;d.owner=visual
  }
  wreck(visual){
    const e=this.embers[this.nextEmber++%this.embers.length]
    e.bone=visual.rig.joints.Chest;e.position.set(0,.04,.18);e.quaternion.identity();e.scale.set(.3,.25,1);e.life=12;this.emberMesh.visible=true
  }
  reset(){
    this.temp.scale.setScalar(0);this.temp.updateMatrix()
    for(const pool of this.poolList){
      for(let i=0;i<pool.items.length;i++){pool.items[i].life=0;pool.mesh.setMatrixAt(i,this.temp.matrix)}
      pool.next=0;pool.live=0;pool.mesh.count=0;pool.mesh.visible=false;pool.mesh.instanceMatrix.needsUpdate=true
    }
    for(let i=0;i<this.decals.length;i++){
      const d=this.decals[i];d.life=0;d.owner=null;d.bone=null;this.decalMesh.setMatrixAt(i,this.temp.matrix)
    }
    for(let i=0;i<this.embers.length;i++){
      const e=this.embers[i];e.life=0;e.bone=null;this.emberMesh.setMatrixAt(i,this.temp.matrix)
    }
    this.gore.reset()
    this.nextDecal=0;this.nextEmber=0
    for(const key of Object.keys(this.stats))this.stats[key]=0
    this.decalMesh.count=0;this.emberMesh.count=0;this.decalMesh.visible=false;this.emberMesh.visible=false
    this.decalMesh.instanceMatrix.needsUpdate=true;this.emberMesh.instanceMatrix.needsUpdate=true
  }
  shot(from,to,type){
    const heavy=type==='heavy',name=heavy?'bullet':'plasma'
    this.stats[heavy?'minigunShots':'plasmaShots']++
    this.v.set(0,0,0);this.particle(name,from,this.v,this.scale.set(.11,.11,.24),.055)
  }
  release(visual){this.gore.releaseVisual(visual);for(const d of this.decals)if(d.owner===visual){d.life=0;d.owner=null;d.bone=null}}
  update(dt,nav){
    this.clock+=dt
    this.gore.update(dt,nav)
    for(const pool of this.poolList){
      const name=pool.name
      if(pool.live===0){pool.mesh.visible=false;continue}
      let active=0
      for(let i=0;i<pool.items.length;i++){
        const p=pool.items[i];p.life=Math.max(0,p.life-dt)
        if(p.life>0){
          const slot=active++;p.pos.addScaledVector(p.vel,dt)
          if(name==='sparks'||name==='oil'){
            p.vel.y-=dt*9.81
            const floor=unitGround(nav,p.pos.x,p.pos.z,p.floor)
            if(p.pos.y<floor+.008){p.pos.y=floor+.008;p.vel.y=Math.abs(p.vel.y)*.2;p.vel.x*=.6;p.vel.z*=.6}
          }
          this.temp.position.copy(p.pos);this.v.copy(p.pos).add(p.vel)
          if(p.vel.lengthSq()>.001)this.temp.lookAt(this.v)
          this.temp.scale.copy(p.scale).multiplyScalar(Math.min(1,p.life/p.max*3))
          this.temp.updateMatrix();pool.mesh.setMatrixAt(slot,this.temp.matrix)
        }
      }
      pool.live=active;pool.mesh.count=active;pool.mesh.visible=active>0;if(active)markRange(pool.mesh.instanceMatrix,active*16)
    }
    let liveDecals=0,decalsChanged=false
    for(let i=0;i<this.decals.length;i++){
      const d=this.decals[i],was=d.life>0;d.life=Math.max(0,d.life-dt)
      if(d.life>0&&d.bone){
        const slot=liveDecals++;decalsChanged=true;this.temp.position.copy(d.position);this.temp.quaternion.copy(d.quaternion);this.temp.scale.copy(d.scale);this.temp.updateMatrix()
        this.matrix.multiplyMatrices(d.bone.matrixWorld,this.temp.matrix);this.decalMesh.setMatrixAt(slot,this.matrix)
      }else if(was){decalsChanged=true;d.owner=null;d.bone=null}
    }
    this.decalMesh.count=liveDecals;this.decalMesh.visible=liveDecals>0;if(decalsChanged&&liveDecals)markRange(this.decalMesh.instanceMatrix,liveDecals*16)
    let liveEmbers=0,embersChanged=false
    for(let i=0;i<this.embers.length;i++){
      const e=this.embers[i],was=e.life>0;e.life=Math.max(0,e.life-dt)
      if(e.life>0&&e.bone){
        const slot=liveEmbers++;embersChanged=true;this.temp.position.copy(e.position);this.temp.quaternion.copy(e.quaternion);this.temp.scale.copy(e.scale);this.temp.updateMatrix()
        this.matrix.multiplyMatrices(e.bone.matrixWorld,this.temp.matrix);this.emberMesh.setMatrixAt(slot,this.matrix)
      }else if(was){embersChanged=true;e.bone=null}
    }
    this.emberMesh.count=liveEmbers;this.emberMesh.visible=liveEmbers>0;this.emberMesh.material.opacity=liveEmbers?(.2+.06*Math.sin(this.clock*3)):0
    if(embersChanged&&liveEmbers)markRange(this.emberMesh.instanceMatrix,liveEmbers*16)
  }
  removeBody(body){body.release()}
  dispose(){
    this.gore.dispose()
    for(const p of this.poolList){p.mesh.geometry.dispose();if(p.mesh.material!==this.materials.metal)p.mesh.material.dispose();p.mesh.dispose?.();releaseMeshGeometry(p.mesh)}
    this.decalMesh.removeFromParent();this.decalMesh.dispose?.();this.emberMesh.removeFromParent();this.emberMesh.material.dispose();this.emberMesh.dispose?.()
    // Clearing the reference is what removes the geometry's listener on these
    // meshes; disposing the geometry alone leaves both sides reachable.
    releaseMeshGeometry(this.decalMesh);releaseMeshGeometry(this.emberMesh)
    this.plane.dispose();this.root.removeFromParent();this.bodies=[];this.decals=[];this.embers=[];this.pools={};this.poolList=[]
  }
}

// Lenses and scattering are instanced across the crowd. A per-instance power
// attribute keeps independent eye flicker without a material/draw for each eye.
export class UnitOptics {
  constructor(parent){
    const shared=unitMaterials(E)
    this.root=new E.Group();this.root.name='Instanced enemy optics';parent.add(this.root)
    this.temp=new E.Object3D();this.color=new E.Color();this.pools={};this.poolList=[];this.rosterPools={}
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
      for(let i=0;i<capacity;i++)mesh.setColorAt(i,this.color)
      mesh.instanceColor.setUsage(E.DynamicDrawUsage)
      this.root.add(mesh);const pool={mesh,power,next:0};this.pools[name]=pool;this.poolList.push(pool)
    }
  }
  rosterPool(name,source){
    let pool=this.rosterPools[name]
    if(pool)return pool
    const mesh=new E.InstancedMesh(source.geometry.clone(),source.material.clone(),64)
    mesh.name=name==='beam'?'Instanced aerial searchlight beams':'Instanced aerial ground pools'
    mesh.frustumCulled=false;mesh.raycast=()=>{};mesh.count=0;mesh.instanceMatrix.setUsage(E.DynamicDrawUsage)
    this.root.add(mesh);pool={mesh,next:0};this.rosterPools[name]=pool;return pool
  }
  // One pooled emitter slot, written from an already composed world matrix.
  // Instanced commons own no scene node, so they cannot be walked like a rig.
  emit(kind,matrix,power,color){
    const p=this.pools[kind]
    if(!p)return false
    const i=p.next++
    if(i>=p.power.count){p.next=p.power.count;return false}
    p.mesh.setMatrixAt(i,matrix);p.power.setX(i,power);p.mesh.setColorAt(i,color)
    return true
  }
  update(visuals,extra){
    for(const p of this.poolList)p.next=0
    for(const p of Object.values(this.rosterPools))p.next=0
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
        if(!lens){
          let size=c.userData.unitOpticSize
          if(!size){
            const parameters=c.geometry.parameters
            if(parameters?.width!=null&&parameters?.height!=null)size=[parameters.width,parameters.height]
            else{
              c.geometry.computeBoundingBox();const box=c.geometry.boundingBox
              size=[box.max.x-box.min.x,box.max.y-box.min.y]
            }
            c.userData.unitOpticSize=size
          }
          this.temp.scale.x*=size[0];this.temp.scale.y*=size[1]
        }
        this.temp.updateMatrix();p.mesh.setMatrixAt(i,this.temp.matrix)
        p.power.setX(i,lens?c.material.emissiveIntensity/8:c.material.opacity)
        if(lens)this.color.setHex(0xffffff);else this.color.copy(c.material.color)
        p.mesh.setColorAt(i,this.color)
      }
      const roster=v.rig.roster
      if(roster?.type==='hkaerial')for(const [name,source]of [['beam',roster.cone],['spot',roster.spot]])if(source){
        source.visible=false
        if(roster.deathAge>=0)continue
        const p=this.rosterPool(name,source),i=p.next++
        if(i>=p.mesh.instanceMatrix.count){p.next=p.mesh.instanceMatrix.count;continue}
        source.updateWorldMatrix(true,false);p.mesh.setMatrixAt(i,source.matrixWorld)
      }
    }
    extra?.(this)
    for(const p of this.poolList){
      p.mesh.count=p.next;p.mesh.visible=p.next>0
      if(p.next){markRange(p.mesh.instanceMatrix,p.next*16);if(p.mesh.instanceColor)markRange(p.mesh.instanceColor,p.next*3);markRange(p.power,p.next)}
    }
    for(const p of Object.values(this.rosterPools)){
      p.mesh.count=p.next;p.mesh.visible=p.next>0
      if(p.next)markRange(p.mesh.instanceMatrix,p.next*16)
    }
  }
  dispose(){
    for(const p of [...this.poolList,...Object.values(this.rosterPools)]){p.mesh.geometry.dispose();p.mesh.material.dispose();p.mesh.dispose?.();releaseMeshGeometry(p.mesh)}
    this.poolList=[];this.rosterPools={};this.root.removeFromParent()
  }
}
