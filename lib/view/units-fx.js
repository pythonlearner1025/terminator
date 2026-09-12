import * as E from 'threepipe'
import {unitMaterials} from '../../generators/unit-materials.js'
import {unitGround} from './units-animation.js'

const forward=new E.Vector3(0,0,1)

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
    this.limbGeometries=new Map();this.limbPlaceholder=new E.BufferGeometry()
    this.bodies=Array.from({length:12},()=>{
      const mesh=new E.Mesh2(this.limbPlaceholder,this.materials.metal),fadeMaterial=this.materials.metal.clone()
      fadeMaterial.name='Pooled fading detached limb metal';fadeMaterial.transparent=true;fadeMaterial.depthWrite=false;fadeMaterial.opacity=1
      mesh.userData.wreckMaterial=fadeMaterial;mesh.name='Pooled detached limb';mesh.visible=false;mesh.raycast=()=>{};this.root.add(mesh)
      return{mesh,fadeMaterial,record:null}
    })
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
    this.hit(pos,event.tick||this.clock,normal,unit.pos.y)
    const d=this.decals[this.nextDecal++%this.decals.length]
    d.bone=bone;d.position.copy(pos);bone.worldToLocal(d.position)
    this.v.copy(pos).add(normal);bone.worldToLocal(this.v);this.v.sub(d.position).normalize()
    d.quaternion.setFromUnitVectors(forward,this.v);d.position.addScaledVector(this.v,.004)
    const size=event.weapon==='plasma'?.15:.075
    d.scale.set(size,size,1);d.life=18;d.owner=visual;this.decalMesh.visible=true
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
    const rig=visual.rig,bone=rig.joints[name]
    if(!bone||rig.severed.has(name))return
    const prepared=this.prepareLimb(visual,name)
    if(!prepared)return
    const body=prepared.bodies[prepared.next++%prepared.bodies.length]
    this.removeBody(body)
    body.mesh.name='Detached '+name;body.mesh.visible=true
    bone.getWorldPosition(body.mesh.position)
    bone.getWorldQuaternion(body.mesh.quaternion)
    bone.getWorldScale(body.mesh.scale)
    this.v.copy(visual.impact?.direction||normal).multiplyScalar(2.2).add(this.upImpulse)
    body.record=this.ragdolls.addDetached(body.mesh,this.v,()=>{body.record=null;body.mesh.visible=false})
    rig.severed.add(name);bone.scale.setScalar(.00001);this.stats.severedLimbs++
  }
  prepareLimb(visual,name){
    const key=`${visual.unitType}:${name}`
    if(this.limbGeometries.has(key))return this.limbGeometries.get(key)
    const rig=visual.rig,bone=rig.joints[name],source=rig.mesh
    if(!bone)return null
    visual.object.updateMatrixWorld(true);source.skeleton.update()
    const ids=new Set();bone.traverse(child=>{const i=source.skeleton.bones.indexOf(child);if(i>=0)ids.add(i)})
    const positions=[],uvs=[],uv=source.geometry.attributes.uv,skin=source.geometry.attributes.skinIndex
    for(let i=0;i<skin.count;i++)if(ids.has(skin.getX(i))){
      source.getVertexPosition(i,this.v);source.localToWorld(this.v);bone.worldToLocal(this.v)
      positions.push(this.v.x,this.v.y,this.v.z);uvs.push(uv.getX(i),uv.getY(i))
    }
    if(!positions.length)return null
    const geometry=new E.BufferGeometry()
    geometry.setAttribute('position',new E.Float32BufferAttribute(positions,3))
    geometry.setAttribute('uv',new E.Float32BufferAttribute(uvs,2))
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere()
    geometry.userData.ragdollCenter=geometry.boundingBox.getCenter(new E.Vector3())
    geometry.userData.ragdollSize=geometry.boundingBox.getSize(new E.Vector3())
    const bodies=[]
    for(let index=0;index<2;index++){
      const body=this.bodies.find(item=>!item.geometryKey)
      if(!body)throw new Error(`Detached limb pool has no slots for ${key}`)
      body.geometryKey=key;body.mesh.geometry=geometry;bodies.push(body)
    }
    const prepared={geometry,bodies,next:0};this.limbGeometries.set(key,prepared);return prepared
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
    for(const body of this.bodies)this.removeBody(body)
    for(const prepared of this.limbGeometries.values())prepared.next=0
    this.nextDecal=0;this.nextEmber=0
    for(const key of Object.keys(this.stats))this.stats[key]=0
    this.decalMesh.count=0;this.emberMesh.count=0;this.decalMesh.visible=false;this.emberMesh.visible=false
    this.decalMesh.instanceMatrix.needsUpdate=true;this.emberMesh.instanceMatrix.needsUpdate=true
  }
  shot(from,to,type){
    const heavy=type==='heavy',name=heavy?'bullet':'plasma'
    this.stats[heavy?'minigunShots':'plasmaShots']++
    const distance=from.distanceTo(to)
    this.v.subVectors(to,from).normalize().multiplyScalar(heavy?110:62)
    this.particle(name,from,this.v,this.scale.set(heavy?.02:.045,heavy?.02:.045,heavy?1.3:.9),Math.min(.45,distance/(heavy?110:62)))
    this.v.set(0,0,0);this.particle(name,from,this.v,this.scale.set(.11,.11,.24),.055)
  }
  release(visual){for(const d of this.decals)if(d.owner===visual){d.life=0;d.owner=null;d.bone=null}}
  update(dt,nav){
    this.clock+=dt
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
      pool.live=active;pool.mesh.count=active;pool.mesh.visible=active>0;pool.mesh.instanceMatrix.needsUpdate=true
    }
    let liveDecals=0,decalsChanged=false
    for(let i=0;i<this.decals.length;i++){
      const d=this.decals[i],was=d.life>0;d.life=Math.max(0,d.life-dt)
      if(d.life>0&&d.bone){
        const slot=liveDecals++;decalsChanged=true;this.temp.position.copy(d.position);this.temp.quaternion.copy(d.quaternion);this.temp.scale.copy(d.scale);this.temp.updateMatrix()
        this.matrix.multiplyMatrices(d.bone.matrixWorld,this.temp.matrix);this.decalMesh.setMatrixAt(slot,this.matrix)
      }else if(was){decalsChanged=true;d.owner=null;d.bone=null}
    }
    this.decalMesh.count=liveDecals;this.decalMesh.visible=liveDecals>0;if(decalsChanged)this.decalMesh.instanceMatrix.needsUpdate=true
    let liveEmbers=0,embersChanged=false
    for(let i=0;i<this.embers.length;i++){
      const e=this.embers[i],was=e.life>0;e.life=Math.max(0,e.life-dt)
      if(e.life>0&&e.bone){
        const slot=liveEmbers++;embersChanged=true;this.temp.position.copy(e.position);this.temp.quaternion.copy(e.quaternion);this.temp.scale.copy(e.scale);this.temp.updateMatrix()
        this.matrix.multiplyMatrices(e.bone.matrixWorld,this.temp.matrix);this.emberMesh.setMatrixAt(slot,this.matrix)
      }else if(was){embersChanged=true;e.bone=null}
    }
    this.emberMesh.count=liveEmbers;this.emberMesh.visible=liveEmbers>0;this.emberMesh.material.opacity=liveEmbers?(.2+.06*Math.sin(this.clock*3)):0
    if(embersChanged)this.emberMesh.instanceMatrix.needsUpdate=true
  }
  removeBody(body){
    const record=body.record
    body.record=null
    if(record&&this.ragdolls?.records.has(record))this.ragdolls.release(record)
    body.mesh.visible=false
  }
  dispose(){
    for(const b of this.bodies){this.removeBody(b);b.mesh.removeFromParent();b.fadeMaterial.dispose()}
    for(const p of this.poolList){p.mesh.geometry.dispose();if(p.mesh.material!==this.materials.metal)p.mesh.material.dispose();p.mesh.dispose?.()}
    for(const prepared of this.limbGeometries.values())prepared.geometry.dispose()
    this.decalMesh.removeFromParent();this.decalMesh.dispose?.();this.emberMesh.removeFromParent();this.emberMesh.material.dispose();this.emberMesh.dispose?.()
    this.limbPlaceholder.dispose();this.plane.dispose();this.root.removeFromParent();this.bodies=[];this.decals=[];this.embers=[];this.pools={};this.poolList=[];this.limbGeometries.clear()
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
      for(let i=0;i<capacity;i++)mesh.setColorAt(i,this.color)
      mesh.instanceColor.setUsage(E.DynamicDrawUsage)
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
