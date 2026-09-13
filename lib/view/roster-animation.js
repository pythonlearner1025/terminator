import * as E from 'threepipe'
import {animatedRosterMaterial,rosterMaterials} from './roster-materials.js'
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),wrap=x=>Math.atan2(Math.sin(x),Math.cos(x))
const down=new E.Vector3(0,-1,0),target=new E.Vector3(),inverse=new E.Quaternion(),flat=new E.Quaternion().setFromAxisAngle(new E.Vector3(1,0,0),-Math.PI/2)
const VEHICLES=new Set(['hkaerial','hktank'])
export const isRosterType=type=>type==='t1000'||VEHICLES.has(type)

export function bindRosterRig(rig){
  if(!rig.object.userData.roster)return rig
  const type=rig.object.userData.unitTemplateType,animated=animatedRosterMaterial(E,type)
  rig.mesh.material=animated.material
  const lightMesh=rig.object.getObjectByName('Roster running lights'),lights=lightMesh?rosterMaterials(E).light.clone():null
  if(lightMesh)lightMesh.material=lights
  const puddleGeometry=new E.SphereGeometry(1,32,12),puddlePosition=puddleGeometry.attributes.position
  for(let i=0;i<puddlePosition.count;i++){
    const x=puddlePosition.getX(i),z=puddlePosition.getZ(i),a=Math.atan2(z,x),w=1+.10*Math.sin(a*3)+.055*Math.cos(a*5)
    puddlePosition.setXYZ(i,x*w,puddlePosition.getY(i),z*w)
  }
  puddleGeometry.computeVertexNormals()
  const puddle=new E.Mesh2(puddleGeometry,animated.material)
  puddle.name='Mercury puddle';puddle.visible=false;puddle.position.y=.025;puddle.scale.set(.1,.025,.1);rig.object.add(puddle)
  const r=rig.roster={type,...animated,lights,lightMesh,puddle,blade:0,ripple:0,regen:0,hp:NaN,hitY:1.2,coreFlash:0,scroll:0,
    yaw:NaN,turn:0,deathAge:-1,deathPhase:'alive',dustClock:0,exhaustClock:0,bank:0,
    turret:rig.joints.Turret,rotors:[rig.joints['Intake Left'],rig.joints['Intake Right']],
    palms:[rig.joints['Palm Left'],rig.joints['Palm Right']],blades:[rig.joints['Blade Left'],rig.joints['Blade Right']],
    cannons:[rig.joints['Cannon Left'],rig.joints['Cannon Right']],detached:[],pieceRecords:[],release:null}
  if(type==='hkaerial') {
    const geo=new E.ConeGeometry(1,1,24,12,true);geo.translate(0,-.5,0)
    const mat=new E.UnlitMaterial({name:'Sweeping searchlight haze',color:new E.Color(1.4,1.8,2.4),transparent:true,opacity:.24,depthWrite:false,side:E.DoubleSide,blending:E.AdditiveBlending})
    mat.userData.renderToGBuffer=false
    const compile=mat.onBeforeCompile.bind(mat)
    mat.onBeforeCompile=(shader,renderer)=>{
      compile(shader,renderer)
      shader.vertexShader='varying float beamFade;varying vec3 beamNormal,beamView;\n'+shader.vertexShader
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nbeamFade=uv.y;beamNormal=normalMatrix*normal;beamView=-(modelViewMatrix*vec4(position,1.)).xyz;')
      shader.fragmentShader='varying float beamFade;varying vec3 beamNormal,beamView;\n'+shader.fragmentShader
      shader.fragmentShader=shader.fragmentShader.replace('#include <alphamap_fragment>','#include <alphamap_fragment>\ndiffuseColor.a*=pow(beamFade,.6)*smoothstep(.01,.36,abs(dot(normalize(beamNormal),normalize(beamView))));')
    }
    const cone=new E.Mesh(geo,mat);cone.name='Aerial searchlight beam';rig.joints.Searchlight.add(cone);r.cone=cone
    const spotMaterial=new E.UnlitMaterial({name:'Searchlight floor scattering',map:rosterMaterials(E).glowMap,color:0xb0d8ff,transparent:true,opacity:.34,depthWrite:false,blending:E.AdditiveBlending})
    spotMaterial.userData.renderToGBuffer=false
    r.spot=new E.Mesh2(new E.PlaneGeometry(2,2),spotMaterial);r.spot.name='Searchlight ground pool';rig.object.add(r.spot)

  }
  if(lights){
    const base=lights.onBeforeCompile.bind(lights),key=lights.customProgramCacheKey.bind(lights)
    r.coreUniform={value:0}
    lights.onBeforeCompile=(shader,renderer)=>{
      base(shader,renderer);shader.uniforms.coreFlash=r.coreUniform
      shader.vertexShader='varying vec3 lampPosition;\n'+shader.vertexShader
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nlampPosition=position;')
      shader.fragmentShader='varying vec3 lampPosition;\nuniform float coreFlash;\n'+shader.fragmentShader
      const color=type==='hktank'?'lampPosition.z < -1.7 ? vec3(1.,.18,.025)*(1.+coreFlash*3.) : lampPosition.z > 1.6 ? vec3(.7,.85,1.) : vec3(1.,.015,.005)':'lampPosition.z > .55 ? vec3(.7,.85,1.) : lampPosition.y < .3 ? vec3(.25,.48,1.) : vec3(1.,.01,.005)'
      shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>\ntotalEmissiveRadiance=(${color})*4.0;`)
    }
    lights.customProgramCacheKey=()=>key()+':roster-lights-'+type
  }
  resetRosterRig(rig)
  return rig
}
export function resetRosterRig(rig){
  const r=rig.roster;if(!r)return
  r.blade=r.ripple=r.regen=r.coreFlash=r.scroll=r.dustClock=r.exhaustClock=r.bank=0;r.hp=r.yaw=NaN
  r.deathAge=-1;r.deathPhase='alive';r.release=null;r.puddle.visible=false;r.detached.length=0;r.pieceRecords.length=0
  rig.object.scale.setScalar(1);rig.object.rotation.x=rig.object.rotation.z=0;rig.mesh.visible=true
  rig.mesh.material=r.material;r.material.opacity=1;r.material.transparent=false
  if(r.lightMesh)r.lightMesh.visible=true
  if(r.cone)r.cone.visible=true
  if(r.spot)r.spot.visible=true
  if(r.light)r.light.intensity=0
  for(const blade of r.blades)blade?.scale.setScalar(.00001)
  for(const palm of r.palms)palm?.scale.setScalar(1)
}
export function rosterHit(visual,event){
  const r=visual.rig.roster;if(!r)return false
  r.ripple=1;r.hitY=(event.pos?.y??visual.object.position.y+1.2)-visual.object.position.y
  if(event.part==='Core')r.coreFlash=1
  return r.type==='t1000'
}
export function animateRosterUnit(rig,unit,time,dt=1/60){
  const r=rig.roster;if(!r)return false
  const blend=1-Math.exp(-dt*12),speed=Math.hypot(unit.vel?.x||0,unit.vel?.z||0)
  r.ripple=Math.max(0,r.ripple-dt*1.5);r.coreFlash=Math.max(0,r.coreFlash-dt*2)
  const hp=unit.hp??unit.maxHp,regenerating=Boolean(unit.regenerating)||(Number.isFinite(r.hp)&&hp>r.hp+.0001)
  r.hp=hp;r.regen+=(Number(regenerating)-r.regen)*(1-Math.exp(-dt*7))
  r.uniforms.time.value=time;r.uniforms.ripple.value=r.ripple;r.uniforms.regen.value=r.regen;r.uniforms.hitY.value=r.hitY
  if(r.type==='t1000'){
    r.blade+=(Number(Boolean(unit.intent?.melee&&unit.alive))-r.blade)*blend
    for(let i=0;i<2;i++){
      const amount=r.blade*(i===0?.64:1)
      r.blades[i]?.scale.set(1,Math.max(.00001,amount),Math.max(.00001,amount))
      r.palms[i]?.scale.setScalar(Math.max(.00001,1-amount))
    }
    return false
  }
  const aim=unit.intent?.aimAt||unit.intent?.face
  if(r.turret&&aim){
    const angle=wrap(Math.atan2(aim.x-unit.pos.x,aim.z-unit.pos.z)-(unit.yaw||0))
    r.turret.rotation.y+=wrap(angle-r.turret.rotation.y)*blend
    const pitch=-Math.atan2(aim.y-unit.pos.y-(r.type==='hkaerial'?.32:2.079),Math.hypot(aim.x-unit.pos.x,aim.z-unit.pos.z))
    if(r.type==='hkaerial')r.turret.rotation.x=clamp(pitch,-.4,.6)
    else rig.joints.Cannon.rotation.x=clamp(pitch,-.18,.18)
  }
  rig.recoil=Math.max(0,rig.recoil-dt*4)
  if(r.coreUniform)r.coreUniform.value=r.coreFlash
  if(r.type==='hkaerial'){
    const change=Number.isFinite(r.yaw)?wrap(unit.yaw-r.yaw)/Math.max(dt,.001):0;r.yaw=unit.yaw
    const lateral=(unit.vel?.x||0)*Math.cos(unit.yaw)-(unit.vel?.z||0)*Math.sin(unit.yaw)
    r.bank+=(clamp(-lateral*.035-change*.08,-.25,.25)-r.bank)*blend
    rig.object.rotation.z=r.bank;rig.object.position.y=unit.pos.y+Math.sin(time*2.2+(unit.spawnedAt||0)*1.7)*.025
    for(const rotor of r.rotors)if(rotor)rotor.rotation.y+=dt*32
    rig.object.updateMatrixWorld(true)
    if(r.cone){
      const search=rig.joints.Searchlight;search.getWorldPosition(target)
      if(aim)target.set(aim.x,Math.max(0,aim.y-1.65),aim.z)
      else target.set(unit.pos.x+Math.sin(time*.55)*4,unit.pos.y-4,unit.pos.z+Math.cos(time*.55)*4)
      r.spot.position.copy(target);r.spot.position.y+=.015;rig.object.worldToLocal(r.spot.position)
      rig.object.getWorldQuaternion(inverse).invert();r.spot.quaternion.copy(inverse).multiply(flat)
      search.worldToLocal(target);const length=clamp(target.length(),1,14)
      r.cone.quaternion.setFromUnitVectors(down,target.normalize());r.cone.scale.set(length*.16,length,length*.16);r.spot.scale.setScalar(length*.16)
    }
  }else{
    const forward=(unit.vel?.x||0)*Math.sin(unit.yaw)+(unit.vel?.z||0)*Math.cos(unit.yaw)
    r.scroll=(r.scroll+forward*dt*.052)% .484;r.uniforms.scroll.value=r.scroll
    for(let i=0;i<2;i++)r.cannons[i].position.z=-rig.recoil*(i?.075:.11)
    rig.object.rotation.z=Math.sin(time*13)*.004*Math.min(1,speed)
  }
  rig.previous.copy(rig.object.position);rig.object.updateMatrixWorld(true)
  return true
}
export function disposeRosterRig(rig){
  const r=rig.roster;if(!r)return
  r.material.dispose();r.lights?.dispose();r.puddle.geometry.dispose();r.puddle.removeFromParent()
  if(r.cone){r.cone.geometry.dispose();r.cone.material.dispose();r.cone.removeFromParent()}
  if(r.spot){r.spot.geometry.dispose();r.spot.material.dispose();r.spot.removeFromParent()}
}
