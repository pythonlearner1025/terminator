import {Group, Mesh2, PlaneGeometry, InstancedBufferGeometry, InstancedBufferAttribute,
  UnlitMaterial, AdditiveBlending, DoubleSide, DynamicDrawUsage, Vector3, Vector2} from 'threepipe'
import {rayColliders} from './fx-world.js'

// Width is the hot core diameter. Glow is the full ribbon diameter, in metres.
export const TRACER_STYLE = Object.freeze({
  pistol: {speed:150,width:.025,glow:.24,trail:1.6,pixels:18,color:[3.8,2.4,1.1]},
  m4: {speed:150,width:.038,glow:.34,trail:2.4,pixels:28,color:[4.2,1.55,.35]},
  shotgun: {speed:150,width:.027,glow:.25,trail:.85,pixels:16,color:[3.8,1.8,.55],pellets:9},
  plasma: {speed:150,width:.12,glow:.62,trail:2.8,pixels:30,color:[.35,2.1,4.8]},
  sniper: {speed:150,width:.03,glow:.30,trail:5.5,pixels:42,color:[4.8,4.5,3.7]},
})

// One camera-facing, instanced ribbon draws the core and its smooth halo together.
// The two endpoints permit bounded travel and avoid drawing through the impact.
export class StreakBatch {
  constructor(parent,capacity,name='Travelling light ribbons') {
    const plane=new PlaneGeometry(1,1),g=new InstancedBufferGeometry()
    g.index=plane.index;g.attributes.position=plane.attributes.position;g.attributes.uv=plane.attributes.uv;g.attributes.normal=plane.attributes.normal
    this.geometry=g;this.capacity=capacity;this.count=0
    this.attributeNames=['start','end','tint','shape']
    this.start=new Float32Array(capacity*3);this.end=new Float32Array(capacity*3)
    this.color=new Float32Array(capacity*3);this.shape=new Float32Array(capacity*4)
    for(const [key,data,size] of [['start',this.start,3],['end',this.end,3],['tint',this.color,3],['shape',this.shape,4]])
      g.setAttribute(key,new InstancedBufferAttribute(data,size).setUsage(DynamicDrawUsage))
    this.material=new UnlitMaterial({name,transparent:true,opacity:.98,depthWrite:false,side:DoubleSide,
      blending:AdditiveBlending,color:0xffffff,fog:false})
    this.material.userData.renderToGBuffer=false;this.material.userData.renderToDepth=false
    this.viewport=new Vector2(1920,1080)
    this.material.registerMaterialExtensions([{
      extraUniforms:{streakViewport:{value:this.viewport}},
      uuid:'terminator-streak-ribbon',computeCacheKey:'terminator-streak-ribbon-v1',
      parsVertexSnippet:'uniform vec2 streakViewport; attribute vec3 start; attribute vec3 end; attribute vec3 tint; attribute vec4 shape; varying vec2 vStreakUv; varying vec3 vTint; varying vec4 vShape;',
      parsFragmentSnippet:'varying vec2 vStreakUv; varying vec3 vTint; varying vec4 vShape;',
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
          // Preserve the head position. Keep a readable minimum tail for end-on fire.
          pixelA=pixelB-along*max(span,shape.w);
          vec2 across=vec2(-along.y,along.x);
          float width=clamp(shape.y*projectionMatrix[1][1]/max(.05,-b.z)*streakViewport.y*.5,3.,120.);
          vec2 pixel=mix(pixelA,pixelB,uv.y)+across*position.x*width;
          vec4 mvPosition=vec4(mix(a,b,uv.y),1.);
          gl_Position=projectionMatrix*mvPosition;
          gl_Position.xy=pixel/streakViewport*2.*gl_Position.w;
          if(hidden)gl_Position=vec4(2.,2.,2.,1.);
          vStreakUv=uv;vTint=tint;vShape=shape;
        `)
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
          float ribbonX=abs(vStreakUv.x-.5)*2.;
          float coreWidth=max(vShape.x/vShape.y,fwidth(ribbonX)*.8);
          float core=1.-smoothstep(coreWidth*.5,coreWidth*1.4,ribbonX);
          float halo=exp(-ribbonX*ribbonX*7.)*.24*(1.-smoothstep(.75,1.,ribbonX));
          float tail=pow(smoothstep(0.,.86,vStreakUv.y),.65);
          float head=1.-smoothstep(.93,1.,vStreakUv.y);
          outgoingLight=vTint*(core+halo)+vec3(core*.7);
          diffuseColor.a*=tail*head*vShape.z;
          #include <opaque_fragment>
        `)
      },
    }])
    this.mesh=new Mesh2(g,this.material);this.mesh.name=name;this.mesh.frustumCulled=false
    this.mesh.userData.renderToGBuffer=false;this.mesh.userData.ssaoDisabled=true
    this.mesh.raycast=()=>{};parent.add(this.mesh);g.instanceCount=0;this.mesh.visible=false
  }
  begin(){this.count=0}
  add(a,b,style,opacity=1) {
    if(this.count===this.capacity)return false
    const i=this.count++,k=i*3,s=i*4
    this.start[k]=a.x;this.start[k+1]=a.y;this.start[k+2]=a.z
    this.end[k]=b.x;this.end[k+1]=b.y;this.end[k+2]=b.z
    this.color[k]=style.color[0];this.color[k+1]=style.color[1];this.color[k+2]=style.color[2]
    this.shape[s]=style.width;this.shape[s+1]=style.glow;this.shape[s+2]=opacity;this.shape[s+3]=style.pixels||22
    return true
  }
  finish() {
    this.geometry.instanceCount=this.count;this.mesh.visible=this.count>0
    if(this.count)for(const key of this.attributeNames)this.geometry.attributes[key].needsUpdate=true
  }
  dispose(){this.mesh.removeFromParent();this.geometry.dispose();this.material.dispose()}
}

export class TracerPool {
  constructor(parent,capacity=256) {
    this.batch=new StreakBatch(parent,capacity,'Player tracer cores and soft trails')
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
      const head=p.age*p.style.speed,tail=Math.max(0,head-p.style.trail)
      if(tail>=p.distance){p.active=false;continue}
      this.active++
      this.a.copy(p.from).addScaledVector(p.direction,tail)
      this.b.copy(p.from).addScaledVector(p.direction,Math.min(p.distance,Math.max(.04,head)))
      const fade=head>p.distance?Math.max(0,1-(head-p.distance)/p.style.trail):1
      this.batch.add(this.a,this.b,p.style,fade)
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
  dispose(){this.pool.dispose();this.root.removeFromParent()}
}
