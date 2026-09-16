import {Vector3,Vector4} from 'threepipe'
import {canvasRect} from './canvas-rect.js'

// Canvas-bounded presentation. No gameplay decisions, DOM listeners or timers.
export class WeaponScreenFx {
  constructor(viewer,worldFx) {
    this.worldFx=worldFx;this.projected=new Vector3()
    this.uniforms={weaponHeat:{value:Array.from({length:4},()=>new Vector4())},weaponFxTime:{value:0},weaponHeatCount:{value:0},weaponAspect:{value:1}}
    this.extension={uuid:'terminator-weapon-refraction',computeCacheKey:'weapon-refraction-v1',extraUniforms:this.uniforms,
      parsFragmentSnippet:`uniform vec4 weaponHeat[4]; uniform float weaponFxTime; uniform int weaponHeatCount; uniform float weaponAspect;
      vec2 refractWeaponHeat(vec2 uv) {
        if(weaponHeatCount==0)return uv;
        vec2 offset=vec2(0.0);
        for(int i=0;i<4;i++){
          if(i>=weaponHeatCount)break;
          vec2 delta=uv-weaponHeat[i].xy;delta.x*=weaponAspect;
          if(dot(delta,delta)>=weaponHeat[i].z*weaponHeat[i].z)continue;
          float weight=max(0.0,1.0-length(delta)/max(0.001,weaponHeat[i].z));
          offset+=vec2(sin(uv.y*420.0+weaponFxTime*38.0),cos(uv.x*310.0-weaponFxTime*27.0))*weight*weight*weaponHeat[i].w;
        }
        return clamp(uv+offset,vec2(0.001),vec2(0.999));
      }`,
      shaderExtender(shader){shader.fragmentShader=shader.fragmentShader.replace('texture2D(tDiffuse, vUv)','texture2D(tDiffuse, refractWeaponHeat(vUv))')}
    }
    viewer.renderManager.screenPass.material.registerMaterialExtensions([this.extension])
    this.viewer=viewer;this.eventIndex=null;this.lastTick=null;this.damage=0;this.angle=0;this.beat=0
    this.savedFilter=viewer.canvas.style.filter;this.lastFilter='';this.bounds=''
    this.root=document.createElement('div');this.root.dataset.testid='weapon-screen-fx'
    this.root.style.cssText='position:fixed;pointer-events:none;overflow:hidden;z-index:30;'
    this.vignette=document.createElement('div');this.direction=document.createElement('div')
    this.vignette.style.cssText='position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 48%,rgba(74,0,0,.7) 100%);opacity:0;'
    this.direction.style.cssText='position:absolute;inset:-25%;background:conic-gradient(from -25deg at 50% 50%,rgba(185,28,10,.6),transparent 50deg,transparent);mask-image:radial-gradient(ellipse at center,transparent 43%,black 67%);opacity:0;'
    this.root.append(this.vignette,this.direction);viewer.container.append(this.root);this.layout()
  }
  sync(world) {
    const dt=this.lastTick===null?0:Math.max(0,(world.tick-this.lastTick)/60);this.lastTick=world.tick
    if(this.eventIndex===null)this.eventIndex=world.eventLog.length
    const player=world.player
    this.damage*=Math.exp(-dt*3.5)
    for(;this.eventIndex<world.eventLog.length;this.eventIndex++) {
      const event=world.eventLog[this.eventIndex]
      if(event.type!=='player_damage'||event.playerId!==player.id)continue
      this.damage=Math.min(1,this.damage+event.amount/35)
      if(event.attackerPos)this.angle=Math.atan2(event.attackerPos.x-player.pos.x,event.attackerPos.z-player.pos.z)-player.yaw
    }
    const low=Math.max(0,Math.min(1,(40-player.hp)/40)),phase=(world.tick/60)*(1.15+low*.65)
    const pulse=Math.exp(-(((phase%1)/.09)**2))+.45*Math.exp(-((((phase+.78)%1)/.07)**2))
    this.vignette.style.opacity=String(Math.min(.85,this.damage*.5+low*(.22+pulse*.32)))
    this.direction.style.opacity=String(this.damage*.8)
    // Positive world yaw lies to screen left under the game's YXZ camera.
    this.direction.style.transform=`rotate(${-this.angle}rad)`
    const filter=low>0?`${this.savedFilter} saturate(${(1-low*.72).toFixed(2)})`:this.savedFilter
    if(filter!==this.lastFilter){this.viewer.canvas.style.filter=filter;this.lastFilter=filter}
    const beat=Math.floor(phase)
    if(low>0&&beat!==this.beat)this.viewer.canvas.dispatchEvent(new CustomEvent('terminator:weapon-sound',{detail:{kind:'heartbeat',strength:low,hp:player.hp}}))
    this.beat=beat
    this.uniforms.weaponFxTime.value=world.tick/60
  }
  layout() {
    const camera=this.viewer.scene.mainCamera
    let index=0
    for(const p of this.worldFx.tracers?.pool.items||[]){
      if(index===4)break
      if(!p.active||!p.style.plasma||p.age>p.distance/p.style.speed)continue
      this.projected.copy(p.from).addScaledVector(p.direction,Math.min(p.distance,p.age*p.style.speed))
      const distance=this.projected.distanceTo(camera.position)
      this.projected.project(camera)
      if(this.projected.z>1||this.projected.z<0)continue
      const radius=Math.min(.08,.5/Math.max(1,distance))
      this.uniforms.weaponHeat.value[index++].set(this.projected.x*.5+.5,this.projected.y*.5+.5,radius,.003)
    }
    this.uniforms.weaponHeatCount.value=index
    this.uniforms.weaponAspect.value=camera.aspect
    while(index<4)this.uniforms.weaponHeat.value[index++].set(0,0,0,0)

    const r=canvasRect(this.viewer.canvas),key=`${r.x},${r.y},${r.width},${r.height}`
    if(key===this.bounds)return
    this.bounds=key;Object.assign(this.root.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`})
  }
  dispose() {this.viewer.canvas.style.filter=this.savedFilter;this.root.remove();this.viewer.renderManager.screenPass.material.unregisterMaterialExtensions([this.extension]);this.viewer=null;this.worldFx=null}
}
