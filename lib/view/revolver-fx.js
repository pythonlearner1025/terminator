import {WebAudioEngine} from '../audio/engine.js'
import {Group,Mesh2,BufferGeometry,Float32BufferAttribute,UnlitMaterial,PhysicalMaterial,InstancedMesh,PlaneGeometry,TextureLoader,AdditiveBlending,DoubleSide,DynamicDrawUsage,Vector3,Quaternion,Object3D,Color,Raycaster} from 'threepipe'
import {weaponAsset} from './weapons-materials.js'

export function revolverCaseGeometry(){
  const vertices=[],colors=[],indices=[],n=16
  const rings=[[.0055,0],[.0055,.035],[.0046,.035],[.0046,.002],[.0061,-.0005],[.0061,.0005],[.0021,-.0007],[.00065,-.00072]]
  for(const [r,z] of rings)for(let i=0;i<n;i++){
    const a=i*2*Math.PI/n;vertices.push(Math.sin(a)*r,Math.cos(a)*r,z)
    const c=r===.0046?[.025,.019,.008]:r===.00065?[.008,.008,.008]:r===.0021?[.42,.44,.47]:[.61,.37,.09];colors.push(...c)
  }
  for(const [a,b]of [[0,1],[1,2],[2,3],[0,5],[5,4],[4,6],[6,7]])for(let i=0;i<n;i++){
    const j=(i+1)%n,triangles=[a*n+i,a*n+j,b*n+j,a*n+i,b*n+j,b*n+i]
    if(a<3&&b<4)for(let k=0;k<6;k+=3)[triangles[k+1],triangles[k+2]]=[triangles[k+2],triangles[k+1]]
    indices.push(...triangles)
  }
  // Recessed dark mouth bottom and primer dent. The mouth stays open.
  for(let i=1;i<n-1;i++)indices.push(3*n,3*n+i+1,3*n+i,7*n,7*n+i,7*n+i+1)
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g
}
function flameGeometry(){
  const v=[],indices=[],n=12
  for(let ring=0;ring<5;ring++)for(let i=0;i<n;i++){
    const a=i*2*Math.PI/n,r=[.004,.013,.022,.013,.0004][ring]*(i%2?.65:1),z=[0,.015,.04,.070,.115][ring]
    v.push(Math.cos(a)*r,Math.sin(a)*r,z+(ring===4?0:.003*Math.sin(a*3)))
  }
  for(let ring=0;ring<4;ring++)for(let i=0;i<n;i++){const a=ring*n+i,b=ring*n+(i+1)%n;indices.push(a,b,b+n,a,b+n,a+n)}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(v,3));g.setIndex(indices);g.computeVertexNormals();return g
}
const V=new Vector3(),Q=new Quaternion(),ONE=new Vector3(1,1,1),DOWN=new Vector3(0,-1,0)
// Created only for the selected modern revolver. Fixed buffers, no extra render pass.
export class RevolverFx {
  constructor(fx){
    this.fx=fx;this.world=fx.worldFx;this.root=new Group();this.root.name='Swingout muzzle and cylinder gas';fx.root.add(this.root)
    this.material=new UnlitMaterial({color:0xffffff,transparent:true,opacity:1,blending:AdditiveBlending,depthWrite:false,side:DoubleSide,fog:false})
    this.material.registerMaterialExtensions([fx.projection]);this.material.color.setRGB(18,10,3)
    this.geometry=flameGeometry();this.flames=Array.from({length:3},(_,i)=>{const m=new Mesh2(this.geometry,this.material);m.frustumCulled=false;m.renderOrder=951;m.visible=false;m.raycast=()=>{};this.root.add(m);return m})
    const map=new TextureLoader().load(weaponAsset('fx-smoke.png'));this.smokeMaterial=new UnlitMaterial({map,color:0x87929d,transparent:true,depthWrite:false,side:DoubleSide})
    this.smokeMaterial.registerMaterialExtensions([{
      uuid:'swingout-smoke-opacity',computeCacheKey:'swingout-smoke-opacity-v1',shaderExtender(shader){shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n#ifdef USE_INSTANCING_COLOR\ndiffuseColor.a *= vColor.r;\n#endif')},
    }])
    this.smoke=new InstancedMesh(new PlaneGeometry(1,1),this.smokeMaterial,24);this.smoke.frustumCulled=false;this.smoke.visible=false;this.smoke.count=0;this.smoke.name='24 drifting revolver smoke puffs';this.world.root.add(this.smoke)
    this.brassMaterial=new PhysicalMaterial({color:0xffffff,vertexColors:true,metalness:.85,roughness:.27});this.brass=new InstancedMesh(revolverCaseGeometry(),this.brassMaterial,24);this.brass.name='24 hollow struck revolver cases';this.brass.frustumCulled=false;this.brass.visible=false;this.brass.count=0;this.world.root.add(this.brass)
    this.smoke.instanceMatrix.setUsage(DynamicDrawUsage);this.brass.instanceMatrix.setUsage(DynamicDrawUsage)
    this.puffs=Array.from({length:24},()=>({pos:new Vector3(),vel:new Vector3(),age:10,life:0,seed:0}));this.cases=Array.from({length:24},()=>({pos:new Vector3(),vel:new Vector3(),spin:new Vector3(),q:new Quaternion(),age:10,life:0,settled:false,floor:0,bounces:0}))
    this.audio=new WebAudioEngine({camera:fx.worldFx.camera,catalog:{brass:{bus:'effects',gain:.12,voices:8,variants:[0,1,2,3,4,5].map(i=>({duration:.35,drive:1,noise:[{color:'high',gain:.22,decay:.008}],tones:[{freq:2800+i*173,gain:.3,decay:.075,end:.35},{freq:4610+i*211,gain:.12,decay:.13,end:.35}]}))}}}).start({ambient:false})
    this.temp=new Object3D();this.color=new Color();this.cursor=0;this.caseCursor=0;this.age=10;this.stats={shots:0,emittedCases:0,bounces:0};this.pending=null
    this.floorRay=new Raycaster();this.groundMeshes=[]
    this.world.visualFloorRoot?.traverseVisible(n=>{if(n.isMesh&&!n.isSkinnedMesh)this.groundMeshes.push(n)})
  }
  worldPoint(point){
    const camera=this.world.camera
    this.audio.updateListener(camera);if(!camera)return point
    // Match the independent weapon projection before releasing world-space particles.
    const projection=this.fx.projection.extraUniforms.weaponProjection.value
    const ratio=projection.elements[5]/camera.projectionMatrix.elements[5]
    point.applyMatrix4(camera.matrixWorldInverse);point.x*=ratio;point.y*=ratio;point.applyMatrix4(camera.matrixWorld)
    return point
  }
  fire(rig){this.pending={rig,delay:Math.max(0,(rig.root.userData.viewModel?.fire?.discharge??.05)-(rig.clipPlayer?.actions.get('Fire').time||0))}}
  strike(rig){
    this.rig=rig;this.age=0;this.stats.shots++;this.fx.stats.flashes++
    rig.muzzle.getWorldPosition(V);this.worldPoint(V);this.world.flash(V,false,12,.018)
    for(let i=0;i<6;i++){
      const p=this.puffs[this.cursor++%24],marker=i<4?rig.muzzle:rig.root.getObjectByName(i===4?'CylinderGapLeft':'CylinderGapRight')
      marker.getWorldPosition(p.pos);this.worldPoint(p.pos);marker.getWorldQuaternion(Q)
      p.vel.set((i-2.5)*.055,.07+(i%3)*.04,i<4?.65+i*.17:.12).applyQuaternion(Q);p.vel.y+=.13
      p.age=0;p.life=2.6+(i%3)*.25;p.seed=this.stats.shots*2.399+i
    }
  }
  eject(rig){
    const spent=rig.clipPlayer?.spent??[0,1,2,3,4,5]
    rig.root.updateWorldMatrix(true,true)
    for(const i of spent){
      const p=this.cases[this.caseCursor++%24],node=rig.root.getObjectByName('Case'+i)
      node.getWorldPosition(p.pos);this.worldPoint(p.pos);node.getWorldQuaternion(p.q);p.vel.set(.12*Math.sin(i*2.399),.03*Math.cos(i*1.71),-.6-i*.065).applyQuaternion(p.q)
      p.spin.set(7+i*1.3,4+i*.7,2+i*.9);p.life=Infinity;p.age=0;p.floor=this.world.floorAt(p.pos)
      // Thin authored mats are visible surfaces even when gameplay needs no collider.
      // Trace the predicted landing point once per case, never during frame updates.
      const fall=Math.sqrt(2*Math.max(0,p.pos.y-p.floor)/9.81)
      this.floorRay.set(V.copy(p.pos).addScaledVector(p.vel,fall),DOWN)
      this.floorRay.ray.origin.y=p.pos.y;this.floorRay.far=Math.max(.1,p.pos.y-p.floor+.25)
      const hit=this.floorRay.intersectObjects(this.groundMeshes,false).find(h=>h.face&&V.copy(h.face.normal).transformDirection(h.object.matrixWorld).y>.6)
      if(hit)p.floor=Math.max(p.floor,hit.point.y)
      p.settled=false;p.bounces=0;this.stats.emittedCases++
    }
    this.fx.stats.cases+=spent.length
  }
  update(dt){
    if(this.pending){this.pending.delay-=dt;if(this.pending.delay<=1e-6){this.strike(this.pending.rig);this.pending=null}}
    this.age+=dt
    const camera=this.world.camera
    this.audio.updateListener(camera)
    let n=0
    for(const p of this.puffs){
      if(p.age>=p.life)continue
      p.age+=dt;if(p.age>=p.life)continue
      p.pos.addScaledVector(p.vel,dt);p.vel.multiplyScalar(Math.exp(-dt*1.4));p.vel.y+=.04*dt
      p.pos.x+=Math.sin(p.age*2.1+p.seed)*.025*dt;p.pos.z+=Math.cos(p.age*1.7+p.seed)*.018*dt
      this.temp.position.copy(p.pos);if(camera)this.temp.quaternion.copy(camera.quaternion)
      this.temp.scale.setScalar(.026+p.age*.16);this.temp.updateMatrix();this.smoke.setMatrixAt(n,this.temp.matrix)
      this.color.setScalar(.85*Math.max(0,1-p.age/p.life)**1.7);this.smoke.setColorAt(n++,this.color)
    }
    this.smoke.count=n;this.smoke.visible=n>0;if(n){this.smoke.instanceMatrix.needsUpdate=true;this.smoke.instanceColor.needsUpdate=true}
    n=0
    for(const p of this.cases){
      if(p.age>=p.life)continue;p.age+=dt
      if(!p.settled){
        p.pos.addScaledVector(p.vel,dt);p.vel.y-=9.81*dt
        Q.setFromAxisAngle(V.copy(p.spin).normalize(),p.spin.length()*dt);p.q.premultiply(Q)
        const axis=V.set(0,0,1).applyQuaternion(p.q)
        const low=p.pos.y+.0175*axis.y-.0175*Math.abs(axis.y)-.0055
        if(low<p.floor&&p.vel.y<0){
          const energy=-p.vel.y;p.pos.y+=p.floor-low;p.vel.y*=-.30;p.vel.x*=.57;p.vel.z*=.57;p.spin.multiplyScalar(.53)
          this.stats.bounces++;p.bounces++
          if(energy>.18)this.audio.play('brass',{position:p.pos,gain:Math.min(1,energy/3),variant:(this.caseCursor+p.bounces)%6})
          if(energy>.18)this.world.onSound?.('shell-bounce',{position:{x:p.pos.x,y:p.pos.y,z:p.pos.z},energy,weapon:'pistol'})
          if(energy<.3||p.bounces>=5){p.vel.set(0,0,0);p.spin.set(0,0,0);p.settled=true;const direction=V.set(0,0,1).applyQuaternion(p.q);direction.y=0;direction.normalize();p.q.setFromUnitVectors(new Vector3(0,0,1),direction);p.pos.y=p.floor+.0055}
        }
      }
      this.temp.position.copy(p.pos);this.temp.quaternion.copy(p.q);this.temp.scale.copy(ONE);this.temp.updateMatrix();this.brass.setMatrixAt(n++,this.temp.matrix)
    }
    this.brass.count=n;this.brass.visible=n>0;if(n)this.brass.instanceMatrix.needsUpdate=true
  }
  beforeRender(){
    if(this.fx.metal.envMap&&this.brassMaterial.envMap!==this.fx.metal.envMap){this.brassMaterial.envMap=this.fx.metal.envMap;this.brassMaterial.envMapIntensity=.8;this.brassMaterial.needsUpdate=true}
    const bright=this.age<.018&&this.rig
    for(let i=0;i<3;i++){
      const m=this.flames[i];m.visible=Boolean(bright);if(!bright)continue
      const marker=i===0?this.rig.muzzle:this.rig.root.getObjectByName(i===1?'CylinderGapLeft':'CylinderGapRight')
      marker.getWorldPosition(V);this.root.worldToLocal(V);m.position.copy(V);marker.getWorldQuaternion(Q);this.root.getWorldQuaternion(m.quaternion).invert();m.quaternion.multiply(Q)
      if(i)m.rotateY(i===1?Math.PI/2:-Math.PI/2)
      m.rotateZ(this.stats.shots*2.399);m.scale.set(i?.13:1,i?.12:1,i?.22:1)
    }
    if(bright){const uniforms=this.fx.metal.userData.weaponFlash;this.rig.muzzle.getWorldPosition(V);uniforms.position.value.copy(V).applyMatrix4(this.world.camera.matrixWorldInverse);uniforms.power.value=6;uniforms.color.value.setRGB(1,.62,.22)}
  }
  dispose(){void this.audio.stop();for(const m of this.flames)m.removeFromParent();this.root.removeFromParent();this.geometry.dispose();this.material.dispose();for(const m of [this.smoke,this.brass]){m.removeFromParent();m.geometry.dispose();m.material.map?.dispose();m.material.dispose();m.dispose()}this.pending=null;this.rig=null}
}
