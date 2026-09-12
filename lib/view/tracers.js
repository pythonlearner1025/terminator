import {Group, Mesh2, PlaneGeometry, InstancedBufferGeometry, InstancedBufferAttribute,
  UnlitMaterial, AdditiveBlending, DoubleSide, DynamicDrawUsage, Vector3, Vector2} from 'threepipe'
import {rayColliders} from './fx-world.js'

// Linear RGB radiance. Length is visual speed times camera exposure, in metres.
// No luminous material is painted outside the antialiased core. MapPost owns bloom.
const HOT=[1,.96,.82],BODY=[1,.72,.32],TAIL=[1,.13,.018]
export const TRACER_STYLE = Object.freeze({
  pistol: {speed:150,exposure:1/60,width:.022,trail:2.5,minPixels:1.5,color:BODY,head:HOT,tail:TAIL,linger:.14,intensity:12},
  m4: {speed:150,exposure:.024,width:.026,trail:3.6,minPixels:1.5,color:BODY,head:HOT,tail:TAIL,linger:.16,intensity:14},
  shotgun: {speed:150,exposure:.006,width:.020,trail:.9,minPixels:1.5,color:BODY,head:HOT,tail:TAIL,linger:.12,intensity:8,pellets:9},
  plasma: {speed:150,exposure:.026,width:.034,trail:3.9,minPixels:1.5,color:[.08,.40,1],head:[.72,.94,1],tail:[.018,.09,1],linger:.18,intensity:14,plasma:true},
  sniper: {speed:150,exposure:11/300,width:.028,trail:5.5,minPixels:1.5,color:BODY,head:HOT,tail:TAIL,linger:.18,intensity:16},
})

// A line billboard follows the projected velocity. Only its short axis faces the
// camera. Endpoint clipping preserves depth and natural end-on foreshortening.
export class StreakBatch {
  constructor(parent,capacity,name='Exposure streaks') {
    const plane=new PlaneGeometry(1,1),g=new InstancedBufferGeometry()
    g.index=plane.index;g.attributes.position=plane.attributes.position;g.attributes.uv=plane.attributes.uv;g.attributes.normal=plane.attributes.normal
    this.geometry=g;this.capacity=capacity;this.count=0
    this.attributeNames=['start','end','tint','headTint','tailTint','shape','phase']
    this.start=new Float32Array(capacity*3);this.end=new Float32Array(capacity*3)
    this.color=new Float32Array(capacity*3);this.shape=new Float32Array(capacity*4)
    this.head=new Float32Array(capacity*3);this.tail=new Float32Array(capacity*3);this.phase=new Float32Array(capacity*4)
    for(const [key,data,size] of [['start',this.start,3],['end',this.end,3],['tint',this.color,3],
      ['headTint',this.head,3],['tailTint',this.tail,3],['shape',this.shape,4],['phase',this.phase,4]])
      g.setAttribute(key,new InstancedBufferAttribute(data,size).setUsage(DynamicDrawUsage))
    this.material=new UnlitMaterial({name,transparent:true,opacity:1,depthWrite:false,side:DoubleSide,
      blending:AdditiveBlending,color:0xffffff,fog:false})
    this.material.userData.renderToGBuffer=false;this.material.userData.renderToDepth=false
    this.viewport=new Vector2(1920,1080)
    this.material.registerMaterialExtensions([{
      extraUniforms:{streakViewport:{value:this.viewport}},
      uuid:'terminator-streak-line',computeCacheKey:'terminator-streak-line-v3',
      parsVertexSnippet:`uniform vec2 streakViewport; attribute vec3 start; attribute vec3 end;
        attribute vec3 tint; attribute vec3 headTint; attribute vec3 tailTint; attribute vec4 shape; attribute vec4 phase;
        varying vec2 vStreakUv; varying vec3 vTint; varying vec3 vHead; varying vec3 vTail;
        varying vec4 vShape; varying vec4 vPhase; varying float vCore;`,
      parsFragmentSnippet:`varying vec2 vStreakUv; varying vec3 vTint; varying vec3 vHead; varying vec3 vTail;
        varying vec4 vShape; varying vec4 vPhase; varying float vCore;`,
      shaderExtender(shader) {
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
          vec3 a=(viewMatrix*vec4(start,1.)).xyz,b=(viewMatrix*vec4(end,1.)).xyz;
          bool hidden=a.z>=-.03&&b.z>=-.03;
          if(a.z>=-.03&&b.z<-.03)a=mix(a,b,(a.z+.03)/(a.z-b.z));
          if(b.z>=-.03&&a.z<-.03)b=mix(b,a,(b.z+.03)/(b.z-a.z));
          vec4 clipA=projectionMatrix*vec4(a,1.),clipB=projectionMatrix*vec4(b,1.);
          vec2 pixelA=clipA.xy/clipA.w*streakViewport*.5;
          vec2 pixelB=clipB.xy/clipB.w*streakViewport*.5;
          vec2 delta=pixelB-pixelA;
          float span=length(delta);
          vec2 along=span>.01?delta/span:vec2(0.,1.);
          // A subpixel end-on exposure otherwise disappears between samples.
          // Sixteen pixels is a thin directional dash, never a long painted tail.
          if(phase.w==0.)pixelA=pixelB-along*max(span,16.*streakViewport.y/1080.);
          vec2 across=vec2(-along.y,along.x);
          float depth=max(.05,-mix(a.z,b.z,uv.y));
          float width=max(shape.y,shape.x*projectionMatrix[1][1]/depth*streakViewport.y*.5);
          // Two pixels of geometry support antialiasing, not a coloured halo.
          vec2 pixel=mix(pixelA,pixelB,uv.y)+across*position.x*(width+2.);
          vec4 mvPosition=vec4(mix(a,b,uv.y),1.);
          gl_Position=projectionMatrix*mvPosition;
          gl_Position.xy=pixel/streakViewport*2.*gl_Position.w;
          if(hidden)gl_Position=vec4(2.,2.,2.,1.);
          vStreakUv=uv;vTint=tint;vHead=headTint;vTail=tailTint;
          vShape=shape;vPhase=phase;vCore=width/(width+2.);
        `)
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
          float x=abs(vStreakUv.x-.5)*2.,t=vStreakUv.y;
          float aa=max(.001,fwidth(x)*.5);
          float core=1.-smoothstep(vCore-aa,vCore+aa,x);
          float tailFade=smoothstep(0.,.4,t);
          vec3 radiance=mix(vTail,vTint,smoothstep(0.,.65,t));
          radiance=mix(radiance,vHead,smoothstep(.84,1.,t));
          // Plasma stores energy in a compact leading tenth and a softer line.
          float energy=mix(1.,mix(.22,1.,smoothstep(.90,.99,t)),vPhase.x);
          if(vPhase.w>0.) {
            float age=mix(vPhase.y,vPhase.z,t);
            energy=.05*pow(max(0.,1.-age),2.);
            radiance=vTint;
            tailFade=1.;
          }
          outgoingLight=radiance*vShape.w;
          diffuseColor.a*=core*tailFade*energy*vShape.z;
          #include <opaque_fragment>
        `)
      },
    }])
    this.mesh=new Mesh2(g,this.material);this.mesh.name=name;this.mesh.frustumCulled=false
    this.mesh.userData.renderToGBuffer=false;this.mesh.userData.ssaoDisabled=true
    this.mesh.raycast=()=>{};parent.add(this.mesh);g.instanceCount=0;this.mesh.visible=false
  }
  begin(){this.count=0}
  add(a,b,style,opacity=1,ageA=0,ageB=0,residual=false) {
    if(this.count===this.capacity)return false
    const i=this.count++,k=i*3,s=i*4
    this.start[k]=a.x;this.start[k+1]=a.y;this.start[k+2]=a.z
    this.end[k]=b.x;this.end[k+1]=b.y;this.end[k+2]=b.z
    this.color[k]=style.color[0];this.color[k+1]=style.color[1];this.color[k+2]=style.color[2]
    for(let j=0;j<3;j++){this.head[k+j]=style.head[j];this.tail[k+j]=style.tail[j]}
    this.shape[s]=style.width;this.shape[s+1]=style.minPixels;this.shape[s+2]=opacity;this.shape[s+3]=style.intensity
    this.phase[s]=style.plasma?1:0;this.phase[s+1]=ageA;this.phase[s+2]=ageB;this.phase[s+3]=residual?1:0
    return true
  }
  finish() {
    this.geometry.instanceCount=this.count;this.mesh.visible=this.count>0
    if(this.count)for(const key of this.attributeNames){
      const attribute=this.geometry.attributes[key]
      attribute.clearUpdateRanges();attribute.addUpdateRange(0,this.count*attribute.itemSize);attribute.needsUpdate=true
    }
  }
  dispose(){this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose()}
}

export class TracerPool {
  constructor(parent,capacity=256) {
    this.batch=new StreakBatch(parent,capacity*2,'Player exposure streaks and residual light')
    this.items=Array.from({length:capacity},()=>({active:false,from:new Vector3(),direction:new Vector3(),
      distance:0,age:0,style:TRACER_STYLE.m4}))
    this.next=0;this.active=0;this.emitted=0;this.overwritten=0
    this.a=new Vector3();this.b=new Vector3()
  }
  emit(from,to,weapon='m4') {
    const style=TRACER_STYLE[weapon];if(!style)return null
    const p=this.items[this.next++%this.items.length]
    if(p.active)this.overwritten++
    p.from.copy(from);p.direction.subVectors(to,from);p.distance=p.direction.length()
    if(p.distance<.001){p.active=false;return null}
    p.direction.multiplyScalar(1/p.distance);p.age=0;p.style=style;p.active=true;this.emitted++
    return p
  }
  update(dt) {
    this.batch.begin();this.active=0
    for(let i=0;i<this.items.length;i++) {
      const p=this.items[i];if(!p.active)continue
      p.age+=Math.max(0,dt)
      const style=p.style,head=p.age*style.speed,tail=Math.max(0,head-style.trail)
      if(p.age>=p.distance/style.speed+style.linger){p.active=false;continue}
      this.active++
      if(tail<p.distance) {
        this.a.copy(p.from).addScaledVector(p.direction,tail)
        this.b.copy(p.from).addScaledVector(p.direction,Math.min(p.distance,Math.max(.04,head)))
        const fade=head>p.distance?Math.max(0,1-(head-p.distance)/style.trail):1
        this.batch.add(this.a,this.b,style,fade)
      }
      const residualStart=Math.max(0,head-style.speed*style.linger),residualEnd=Math.min(p.distance,tail)
      if(residualEnd>residualStart) {
        this.a.copy(p.from).addScaledVector(p.direction,residualStart)
        this.b.copy(p.from).addScaledVector(p.direction,residualEnd)
        this.batch.add(this.a,this.b,style,1,(p.age-residualStart/style.speed)/style.linger,
          (p.age-residualEnd/style.speed)/style.linger,true)
      }
    }
    this.batch.finish()
  }
  reset(){for(let i=0;i<this.items.length;i++)this.items[i].active=false;this.active=0;this.batch.begin();this.batch.finish()}
  dispose(){this.batch.dispose()}
}

export class TracerView {
  constructor(parent) {
    this.root=new Group();this.root.name='Player travelling trajectories';parent.add(this.root)
    this.pool=new TracerPool(this.root);this.eventIndex=null;this.lastTick=null
    this.from=new Vector3();this.to=new Vector3();this.direction=new Vector3();this.pellet=new Vector3()
    this.right=new Vector3();this.up=new Vector3();this.normal=new Vector3()
    this.hit={distance:0,normal:this.normal,collider:null}
  }
  sync(world,localMuzzle,frameColliders=null) {
    const dt=this.lastTick===null?0:Math.max(0,(world.tick-this.lastTick)/60);this.lastTick=world.tick
    // Advance old flights before appending this tick's events.
    this.pool.update(dt)
    if(this.eventIndex===null||this.eventIndex>world.eventLog.length)this.eventIndex=world.eventLog.length
    let colliders=frameColliders
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const e=world.eventLog[this.eventIndex],style=TRACER_STYLE[e.weapon]
      if(e.type!=='shot'||e.unitType||!style||!e.origin)continue
      const player=world.players?.get(e.playerId||e.by)||world.player
      if(e.by===world.player.id&&localMuzzle)this.from.copy(localMuzzle)
      else {
        this.from.copy(e.origin)
        this.from.x+=Math.sin(player.yaw)*.6-Math.cos(player.yaw)*.17
        this.from.y-=.15;this.from.z+=Math.cos(player.yaw)*.6+Math.sin(player.yaw)*.17
      }
      const yaw=player.yaw||0,pitch=player.pitch||0
      this.direction.set(Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch))
      const unit=world.unitById?.get(e.unitId)
      // Prefer a confirmed impact position when the core provides it.
      const endpoint=e.hitPoint||e.point||e.target
      if(endpoint)this.to.copy(endpoint)
      else if(unit)this.to.set(unit.pos.x,unit.pos.y+world.unitCatalog.types[unit.type].height*(e.headshot?.84:.5),unit.pos.z)
      else {
        this.to.copy(e.origin)
        const hit=rayColliders(this.to,this.direction,(colliders??=world.activeColliders()),this.hit)
        this.to.addScaledVector(this.direction,hit?.distance||70)
      }
      if(style.pellets) {
        this.direction.subVectors(this.to,this.from).normalize()
        this.right.set(this.direction.z,0,-this.direction.x).normalize();this.up.crossVectors(this.direction,this.right)
        const radius=this.from.distanceTo(this.to)*Math.tan((world.weaponCatalog.weapons.shotgun.spreadDeg||7)*Math.PI/180)*.55
        for(let pellet=0;pellet<style.pellets;pellet++) {
          const angle=pellet*2.399963,spread=pellet===0?0:Math.sqrt(pellet/8)*radius
          this.pellet.copy(this.to).addScaledVector(this.right,Math.cos(angle)*spread).addScaledVector(this.up,Math.sin(angle)*spread)
          // The fan is cosmetic. Clip each streak to the first solid surface.
          this.direction.subVectors(this.pellet,this.from).normalize()
          const hit=rayColliders(this.from,this.direction,(colliders??=world.activeColliders()),this.hit)
          if(hit&&hit.distance<this.from.distanceTo(this.pellet))this.pellet.copy(this.from).addScaledVector(this.direction,hit.distance)
          this.pool.emit(this.from,this.pellet,e.weapon)
        }
      } else this.pool.emit(this.from,this.to,e.weapon)
    }
    this.pool.update(0)
  }
  primeWarmup(){
    this.from.set(0,1,0)
    let index=0
    for(const weapon of Object.keys(TRACER_STYLE)){
      this.to.set((index++-2)*.2,1,12)
      this.pool.emit(this.from,this.to,weapon)
    }
    this.pool.update(1/30)
    return()=>this.pool.reset()
  }
  dispose(){this.pool.dispose();this.root.removeFromParent()}
}
