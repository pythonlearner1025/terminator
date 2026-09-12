import * as E from 'threepipe'
import {rosterMaterials} from '../../generators/roster-materials.js'
import {WRECK_SECONDS,WRECK_FADE_SECONDS} from './ragdoll.js'

export function rosterDeathPhase(type,age){
  if(age<0)return 'alive'
  if(type==='t1000')return age<.75?'collapse':age<3.5?'pool':age<5?'sink':'complete'
  return age<.18?'rupture':age<WRECK_SECONDS?'burn':age<WRECK_SECONDS+WRECK_FADE_SECONDS?'sink':'complete'
}
const pieceNames={hkaerial:['Hull','Wing Left','Wing Right','Turret','Thruster Left','Thruster Right'],hktank:['Turret']}
const THRUSTERS=['Thruster Left','Thruster Right'],TREADS=['Tread Left','Tread Right']

// Fixed instance buffers cover dust, engine haze, fireballs and smoke. No event creates particles or meshes.
export class RosterFx {
  constructor(parent,ragdolls){
    this.parent=parent;this.ragdolls=ragdolls;this.root=new E.Group();this.root.name='Roster effects';parent.add(this.root)
    this.v=new E.Vector3();this.q=new E.Quaternion();this.scale=new E.Vector3();this.temp=new E.Object3D();this.matrix=new E.Matrix4()
    this.definitions=new Map();this.prepared=new Set();this.deaths=new Set();this.clock=0;this.next=0
    const deferred=Promise.withResolvers()
    const map=new E.TextureLoader().load(new URL('../../assets/textures/weapons/fx-smoke.png',import.meta.url).href,deferred.resolve,undefined,deferred.reject)
    this.map=map;map.name='Roster reused original smoke';this.ready=Promise.all([deferred.promise,rosterMaterials(E).ready])
    const geometry=new E.PlaneGeometry(1,1)
    this.timeUniform={value:0}
    this.material=new E.UnlitMaterial({name:'Roster pooled smoke fire and heat',map,color:0xffffff,transparent:true,depthWrite:false,side:E.DoubleSide})
    this.material.userData.renderToGBuffer=false
    const compile=this.material.onBeforeCompile.bind(this.material)
    this.material.onBeforeCompile=(shader,renderer)=>{
      compile(shader,renderer);shader.uniforms.rosterClock=this.timeUniform
      shader.vertexShader='attribute vec4 effect;varying vec4 vEffect;\n'+shader.vertexShader
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvEffect=effect;')
      shader.fragmentShader='varying vec4 vEffect;uniform float rosterClock;\n'+shader.fragmentShader
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphamap_fragment>',`#include <alphamap_fragment>
        float t=vEffect.x;float fire=step(.5,vEffect.z)*(1.-step(1.5,vEffect.z));
        vec3 tint=mix(vec3(.18,.19,.21),mix(vec3(1.5,.12,.015),vec3(4.,2.1,.35),pow(t,2.)),fire);
        tint=mix(tint,vec3(.38,.46,.54),step(1.5,vEffect.z));
        diffuseColor.rgb=tint;diffuseColor.a*=vEffect.y*smoothstep(0.,.1,t);
        if(vEffect.z>2.5)diffuseColor.a*=.65+.35*sin(vMapUv.y*26.-rosterClock*13.);`)
    }
    this.mesh=new E.InstancedMesh(geometry,this.material,192);this.mesh.name='192 pooled roster particles';this.mesh.frustumCulled=false;this.mesh.count=0;this.root.add(this.mesh)
    this.attributes=new E.InstancedBufferAttribute(new Float32Array(192*4),4);geometry.setAttribute('effect',this.attributes)
    this.items=Array.from({length:192},()=>({life:0,max:0,type:0,alpha:0,size:0,pos:new E.Vector3(),vel:new E.Vector3()}))
  }
  prepare(visual){
    const r=visual.rig.roster;if(!r||this.prepared.has(visual))return
    this.prepared.add(visual)
    let defs=this.definitions.get(r.type)
    if(!defs){
      defs=[]
      for(const name of pieceNames[r.type]||[]){
        const bone=visual.rig.joints[name],geometry=extractPiece(visual.rig,bone)
        defs.push({name,geometry})
      }
      this.definitions.set(r.type,defs)
    }
    r.pieces=defs.map(def=>{
      const material=rosterMaterials(E).armor.clone();material.name='Pooled HK debris'
      const mesh=new E.Mesh2(def.geometry,material);mesh.name=`Detached ${r.type} ${def.name}`;mesh.visible=false;this.root.add(mesh)
      const wreck=material.clone();wreck.transparent=true;wreck.depthWrite=false;mesh.userData.wreckMaterial=wreck;mesh.userData.rosterMaterial=material
      const p={mesh,bone:visual.rig.joints[def.name],record:null,release:null}
      p.release=()=>{mesh.visible=false;p.record=null}
      return p
    })
  }
  particle(position,x,y,z,size,life,type=0,alpha=.5){
    const p=this.items[this.next++%this.items.length]
    p.pos.copy(position);p.vel.set(x,y,z);p.size=size;p.life=p.max=life;p.type=type;p.alpha=alpha
  }
  detach(visual){
    const r=visual.rig.roster;visual.object.updateMatrixWorld(true)
    let i=0
    for(const p of r.pieces){
      p.bone.matrixWorld.decompose(p.mesh.position,p.mesh.quaternion,p.mesh.scale)
      p.mesh.material=p.mesh.userData.rosterMaterial;p.mesh.material.opacity=1;p.mesh.visible=true;p.mesh.updateMatrixWorld(true)
      this.v.set(Math.sin(i*2.4)*2.8,r.type==='hktank'?6:2.5+Math.cos(i)*1.1,Math.cos(i*2.4)*2.8)
      p.record=this.ragdolls.addDetached(p.mesh,this.v,p.release)
      r.detached.push(p.bone);p.bone.scale.setScalar(.00001);i++
    }
  }
  die(visual,unit,release){
    const r=visual.rig.roster;if(!r)return false
    this.prepare(visual);r.deathAge=0;r.release=release;visual.rosterDeath=true
    r.baseY=unit.pos.y;r.baseScale=visual.object.scale.x;this.deaths.add(visual)
    if(r.lightMesh)r.lightMesh.visible=false
    if(r.cone)r.cone.visible=false
    if(r.spot)r.spot.visible=false
    if(r.type!=='t1000'){
      this.detach(visual)
      this.v.copy(visual.object.position);this.v.y+=r.type==='hktank'?1.5:.6
      for(let i=0;i<18;i++)this.particle(this.v,Math.sin(i*2.4)*2,Math.cos(i)*1.5+1,Math.cos(i*2.4)*2,.5+(i%4)*.28,.55+i*.035,1,.85)
    }
    return true
  }
  alive(visual,unit,dt){
    const r=visual.rig.roster;if(!r||r.type==='t1000')return
    if(r.type==='hkaerial'){
      r.exhaustClock+=dt
      if(r.exhaustClock>.09){r.exhaustClock=0
        for(const name of THRUSTERS){
          visual.rig.joints[name].getWorldPosition(this.v);this.v.y-=.24
          this.particle(this.v,0,-.65,0,.4,.42,3,.11)
        }
      }
    }else if(Math.hypot(unit.vel?.x||0,unit.vel?.z||0)>.1){
      r.dustClock+=dt
      if(r.dustClock>.13){r.dustClock=0
        for(const name of TREADS){
          this.v.set(0,-.3,-1.9);visual.rig.joints[name].localToWorld(this.v)
          this.particle(this.v,Math.sin(this.clock*8)*.2,.28,-.3,.65,1.15,2,.25)
        }
      }
    }
  }
  release(visual){
    const r=visual.rig.roster;if(!r)return
    for(const p of r.pieces||[])if(p.record)this.ragdolls.release(p.record)
    this.deaths.delete(visual);visual.rosterDeath=false;r.release=null;r.puddle.visible=false
  }
  update(dt,camera){
    this.clock+=dt;this.timeUniform.value=this.clock
    for(const v of this.deaths){
      const r=v.rig.roster;r.deathAge+=dt;const age=r.deathAge
      r.deathPhase=rosterDeathPhase(r.type,age);r.uniforms.time.value=this.clock
      if(r.type==='t1000'){
        const collapse=Math.min(1,age/.75),spread=.16+Math.min(1,age/2.3)*1.08
        v.object.scale.set(1+collapse*.23,Math.max(.00001,1-collapse),1+collapse*.23)
        // Keep the puddle outside the collapsing object's scale.
        r.puddle.visible=true;if(r.puddle.parent!==this.root)this.root.add(r.puddle)
        r.puddle.position.set(v.object.position.x,r.baseY+.018-Math.max(0,age-3.5)*.1,v.object.position.z)
        r.puddle.scale.set(spread,.035*(1-Math.min(1,Math.max(0,age-3.5)/1.5)),spread*.74)
        r.uniforms.ripple.value=.35
      }else{
        if(r.type==='hktank')v.object.position.y=r.baseY-Math.min(.20,age*.17)
        if(age<WRECK_SECONDS){
          r.exhaustClock+=dt
          if(r.exhaustClock>.13){r.exhaustClock=0
            if(r.type==='hktank')this.v.set(v.object.position.x,v.object.position.y+1.55,v.object.position.z)
            else if(r.pieces[0]?.mesh.visible)this.v.copy(r.pieces[0].mesh.position)
            else this.v.copy(v.object.position)
            this.particle(this.v,Math.sin(this.clock*3)*.12,.7,0,.9,2.6,0,.42)
            this.particle(this.v,.1,1,0,.7,1.1,1,.45)
          }
        }
        const fade=Math.max(0,(age-WRECK_SECONDS)/WRECK_FADE_SECONDS)
        if(fade>0)v.object.position.y=r.baseY-.2-fade*.6
      }
      if(r.deathPhase==='complete'){
        r.puddle.visible=false
        const release=r.release;this.release(v);release?.()
      }
    }
    if(camera)camera.getWorldQuaternion(this.q)
    let count=0
    for(const p of this.items){
      if(p.life<=0)continue;p.life=Math.max(0,p.life-dt);if(p.life<=0)continue
      const t=p.life/p.max;p.pos.addScaledVector(p.vel,dt)
      this.temp.position.copy(p.pos);this.temp.quaternion.copy(this.q);this.temp.scale.setScalar(p.size*(1+(1-t)*1.6));this.temp.updateMatrix()
      this.mesh.setMatrixAt(count,this.temp.matrix);this.attributes.setXYZW(count,t,p.alpha*t,p.type,0);count++
    }
    this.mesh.count=count;this.mesh.visible=count>0;this.mesh.instanceMatrix.needsUpdate=true;this.attributes.needsUpdate=true
  }
  reset(){
    for(const v of this.prepared)this.release(v)
    for(const p of this.items)p.life=0
    this.mesh.count=0;this.mesh.visible=false
  }
  dispose(){
    this.reset()
    for(const v of this.prepared)for(const p of v.rig.roster.pieces||[]){p.mesh.userData.rosterMaterial.dispose();p.mesh.userData.wreckMaterial.dispose()}
    for(const defs of this.definitions.values())for(const def of defs)def.geometry.dispose()
    this.mesh.geometry.dispose();this.material.dispose();this.map.dispose();this.root.removeFromParent();this.prepared.clear()
  }
}

function extractPiece(rig,bone){
  const source=rig.highGeometry||rig.mesh.geometry,p=source.attributes.position,skin=source.attributes.skinIndex
  const ids=new Set(),bones=rig.mesh.skeleton.bones;bone.traverse(b=>{const i=bones.indexOf(b);if(i>=0)ids.add(i)})
  const inverse=new E.Matrix4().copy(rig.mesh.skeleton.boneInverses[bones.indexOf(bone)]),a={position:[],normal:[],uv:[]},v=new E.Vector3(),normal=new E.Matrix3().getNormalMatrix(inverse)
  for(let i=0;i<p.count;i++)if(ids.has(skin.getX(i))){
    v.fromBufferAttribute(p,i).applyMatrix4(inverse);a.position.push(v.x,v.y,v.z)
    v.fromBufferAttribute(source.attributes.normal,i).applyMatrix3(normal).normalize();a.normal.push(v.x,v.y,v.z)
    a.uv.push(source.attributes.uv.getX(i),source.attributes.uv.getY(i))
  }
  const g=new E.BufferGeometry()
  for(const [name,size]of [['position',3],['normal',3],['uv',2]])g.setAttribute(name,new E.Float32BufferAttribute(a[name],size))
  g.computeBoundingBox();g.userData.ragdollCenter=g.boundingBox.getCenter(new E.Vector3());g.userData.ragdollSize=g.boundingBox.getSize(new E.Vector3())
  return g
}
