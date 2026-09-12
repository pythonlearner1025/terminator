import defaults from './weather.json' with {type: 'json'}

export const WEATHER_DEFAULTS = Object.freeze({...defaults, wind: Object.freeze([...defaults.wind])})

// All animation is derived from view time. No core RNG, simulation writes, timers or global listeners.
export function createWeather(api, parent, map, {particle, runtime = false} = {}) {
  const settings = {...defaults, particleDensity: 1}, root = new api.Group()
  root.name = 'Bunker weather and floodlight shafts'; root.userData.mapEffect = true
  parent.add(root)
  const count = settings.rainCount, values = new Float32Array(count * 6), seeds = new Float32Array(count * 4)
  const fract = x => x - Math.floor(x)
  const geometry = new api.BufferGeometry()
  geometry.setAttribute('position', new api.BufferAttribute(values, 3))
  for (let i=0;i<count;i++) {
    seeds[i*4] = (fract(Math.sin(i*12.9898+4)*43758.5453)-.5)*58
    seeds[i*4+1] = (fract(Math.sin(i*7.139+8)*13548.434)-.5)*58
    seeds[i*4+2] = fract(Math.sin(i*3.7+12)*34567.81)*17
    const x=seeds[i*4], z=seeds[i*4+1]
    seeds[i*4+3] = Math.max(0,...map.colliders.filter(c => Math.abs(c.center.x-x)<c.size.x/2+.12 && Math.abs(c.center.z-z)<c.size.z/2+.12).map(c => c.center.y+c.size.y/2))
  }
  const rain = new api.LineSegments(geometry, new api.LineBasicMaterial({color:0x8fa7b7, transparent:true, opacity:.21,
    depthWrite:false, blending:api.AdditiveBlending}))
  rain.name = 'Wind driven rain'; rain.frustumCulled = false; root.add(rain)
  const lightning = new api.HemisphereLight(0xc7ddff,0x7990bb,0)
  lightning.name = 'Lightning compound flash'; root.add(lightning)
  let flashCycle = 0
  const shafts = []
  const beamMaterial = new api.ShaderMaterial({transparent:true, depthWrite:false, side:api.DoubleSide,
    blending:api.AdditiveBlending, uniforms:{opacity:{value:settings.shaftOpacity}, tint:{value:new api.Color(0xa6ccf0)}},
    vertexShader:`varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main(){vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.);vView=-mv.xyz;vNormal=normalMatrix*normal;gl_Position=projectionMatrix*mv;}`,
    fragmentShader:`uniform float opacity;uniform vec3 tint;varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      void main(){float edge=pow(abs(dot(normalize(vNormal),normalize(vView))),1.5);
      float fade=smoothstep(0.,.16,vUv.y)*(1.-smoothstep(.78,1.,vUv.y));
      gl_FragColor=vec4(tint,opacity*edge*fade);}`})
  for (const [zone, pos, target, radius, power] of [
    ['courtyard',[-7.75,5.43,16.65],[-8,.06,6.5],2.6,160],
    ['courtyard',[7.75,5.43,16.65],[8,.06,6.5],2.6,160],
    ['building',[-4,5.65,16.7],[-4,3.17,15.45],.7,26],
    ['building',[4,5.65,16.7],[4,3.17,15.45],.7,26],
    ['dock',[29.02,2.7,-5],[23,.73,-5],1.7,65],
  ]) {
    const top = new api.Vector3(...pos), bottom = new api.Vector3(...target), distance=top.distanceTo(bottom)
    const light = new api.SpotLight(0xa7ccef,power,distance+5,Math.atan(radius/distance)*1.5,.65,2)
    light.name = `${zone} aimed flood`;light.position.copy(top);light.target.position.copy(bottom)
    const directLight = zone === 'courtyard'
    light.visible = directLight
    root.add(light,light.target)
    const mat=beamMaterial.clone()
    const beam = new api.Mesh(new api.CylinderGeometry(.035,radius,distance,20,1,true),mat)
    beam.name = `${zone} atmospheric light shaft`;beam.position.copy(top).add(bottom).multiplyScalar(.5)
    beam.quaternion.setFromUnitVectors(new api.Vector3(0,1,0),top.clone().sub(bottom).normalize())
    root.add(beam);shafts.push({zone,beam,light,power,directLight})
  }
  beamMaterial.dispose()
  const dustGeometry = new api.BufferGeometry(), dustValues = new Float32Array(100*3)
  dustGeometry.setAttribute('position',new api.BufferAttribute(dustValues,3))
  const dust = new api.Points(dustGeometry,new api.PointsMaterial({
    ...(particle ? {map: particle} : {}), color:0xc9d9db,size:.033,transparent:true,opacity:.32,depthWrite:false,
  }))
  dust.name = 'Dust caught in floodlight cones';dust.frustumCulled=false;root.add(dust)
  const weather = {
    root, settings, rain, lightning, shafts,
    sync(t, state) {
      rain.visible = settings.rain>0
      rain.material.opacity=.27*settings.rain
      const rainCount = Math.round(count * Math.min(1, Math.max(0, settings.rain)) * settings.particleDensity)
      geometry.setDrawRange(0, rainCount * 2)
      for(let i=0;i<rainCount;i++) {
        const floor=seeds[i*4+3], h=17-floor, age=fract((seeds[i*4+2]-t*settings.rainSpeed)/h)
        // Bounded sway retains the precomputed roof mask, preventing indoor rainfall.
        const x=seeds[i*4]+Math.sin(t*.7+i)*.06, z=seeds[i*4+1]+Math.cos(t*.4+i)*.06, y=floor+age*h
        const k=i*6
        values[k]=x;values[k+1]=y;values[k+2]=z
        values[k+3]=x-settings.wind[0]*.035;values[k+4]=Math.max(floor,y-.55);values[k+5]=z-settings.wind[1]*.035
      }
      geometry.attributes.position.needsUpdate=true
      const cycle=Math.floor(t/Math.max(1,settings.lightningIntervalSeconds))
      lightning.intensity=runtime && cycle>flashCycle ? settings.lightningIntensity : 0
      flashCycle=cycle
      for(const shaft of shafts) {
        const on=state?.lights?.[shaft.zone]!=='off'
        shaft.light.visible=shaft.directLight
        shaft.light.intensity=on&&shaft.directLight?shaft.power:0
        shaft.beam.visible=on
        shaft.beam.material.uniforms.opacity.value=settings.shaftOpacity*(.95+Math.sin(t*.7)*.05)
      }
      const dustCount = Math.round(100 * settings.particleDensity)
      dustGeometry.setDrawRange(0, dustCount)
      for(let i=0;i<dustCount;i++) {
        const source=shafts[i%shafts.length], a=fract(i*.139+t*.045)
        dustValues[i*3]=source.light.position.x+(fract(i*.754)-.5)*1.7+Math.sin(t*.2+i)*.2
        dustValues[i*3+1]=source.light.position.y-a*2
        dustValues[i*3+2]=source.light.position.z-a*2.2
      }
      dustGeometry.attributes.position.needsUpdate=true
    },
  }
  weather.sync(0)
  return weather
}
