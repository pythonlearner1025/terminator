// Fixed-capacity atmosphere. Animation consumes world time and map switches only.
export function createMapAtmosphere(api, map, h) {
  const {partGroup,box,mesh,lamp,m,particle}=h
  const root=partGroup('Service atmosphere and practical lights'), sources=[]
  const env=map.environment||{fixtures:[],fog:[],vents:[],sparks:[]}
  const lenses=new Map()
  for(const f of env.fixtures) {
    const p=f.pos,red=f.style==='emergency',key=f.zone+':'+f.style
    if(!lenses.has(key)){const material=(red?m.redGlow:m.whiteGlow).clone();material.name='Expansion '+key+' lens';lenses.set(key,{material,zone:f.zone})}
    const material=lenses.get(key).material
    box('Practical protective housing',[p.x,p.y+.055,p.z],[f.style==='tube'?1.7:.5,.11,.28],m.dark,root)
    if(f.style==='tube') {
      for(const z of [-.065,.065])mesh('Fluorescent tube',new api.CylinderGeometry(.024,.024,1.5,8),[p.x,p.y-.035,p.z+z],material,root,[0,0,Math.PI/2])
      for(const x of [-.78,.78])box('Tube end socket',[p.x+x,p.y-.018,p.z],[.065,.065,.24],m.steel,root)
    } else box('Practical light lens',[p.x,p.y-.009,p.z],[.38,.035,.2],material,root)
    const light=lamp(f.id+' practical source',[p.x,p.y-.2,p.z],f.color,f.power,f.range,root)
    light.userData.mapLightRegion=p.y<0?'service':'surface'
    sources.push({light,spec:f})
  }
  // Several low horizontal sheets share one transparent draw. Noise fades every edge.
  const geometries=[]
  for(const layer of env.fog)for(let i=0;i<3;i++){
    const g=new api.PlaneGeometry(layer.size.x,layer.size.z)
    g.rotateX(-Math.PI/2);g.translate(layer.pos.x,layer.pos.y+i*.16,layer.pos.z)
    geometries.push(g)
  }
  const fogMaterial=new api.ShaderMaterial({name:'Low service mist',transparent:true,depthWrite:false,side:api.DoubleSide,
    uniforms:{time:{value:0},opacity:{value:.11}},
    vertexShader:'varying vec2 uv0; varying vec3 wp; void main(){uv0=uv; wp=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:`varying vec2 uv0; varying vec3 wp; uniform float time; uniform float opacity;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
    void main(){float edge=smoothstep(0.,.22,uv0.x)*smoothstep(0.,.22,1.-uv0.x)*smoothstep(0.,.15,uv0.y)*smoothstep(0.,.15,1.-uv0.y);
    float n=noise(wp.xz*.8+time*vec2(.04,.015))*.7+noise(wp.xz*2.1-time*.02)*.3;
    gl_FragColor=vec4(.24,.34,.37,edge*n*opacity);}`})
  if(geometries.length){const geometry=api.mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());const fog=new api.Mesh(geometry,fogMaterial);fog.name='Layered low ground fog';root.add(fog)}
  function pool(name,count,color,size,opacity,additive=false){
    const geometry=new api.BufferGeometry();geometry.setAttribute('position',new api.Float32BufferAttribute(new Float32Array(count*3),3))
    const mat=new api.PointsMaterial({map:particle,color,size,opacity,transparent:true,depthWrite:false,blending:additive?api.AdditiveBlending:api.NormalBlending})
    const points=new api.Points(geometry,mat);points.name=name;points.frustumCulled=false;root.add(points);return points
  }
  const steam=pool('Expansion vent steam',env.vents.length*16,0xa7bdc2,.65,.15)
  const sparks=pool('Expansion cable sparks',env.sparks.length*12,0xffa349,.055,.8,true)
  const dust=pool('Expansion tunnel and barracks dust',64,0xacc9cd,.027,.4,true)
  const result={root,sources,steam,sparks,dust,sync(t,state,density=1){
    fogMaterial.uniforms.time.value=t
    fogMaterial.uniforms.opacity.value=.13*density
    for(const {material,zone}of lenses.values())material.emissiveIntensity=state?.lights?.[zone]==='off'?0:3
    for(let i=0;i<sources.length;i++){
      const {light,spec}=sources[i],on=state?.lights?.[spec.zone]!=='off'
      const flicker=spec.id==='service-1'?(Math.sin(t*39)>.92?.35:1):1
      light.intensity=on?spec.power*flicker:0
    }
    const s=steam.geometry.attributes.position,sc=Math.round(s.count*density);steam.geometry.setDrawRange(0,sc)
    for(let i=0;i<sc;i++){
      const p=env.vents[i%env.vents.length],a=(t*.18+i*.071)%1
      s.setXYZ(i,p.x+Math.sin(i*17+a)*.25+a*.4,p.y+a*1.4,p.z+Math.cos(i*7+a)*.22)
    }
    s.needsUpdate=true
    const sp=sparks.geometry.attributes.position,pc=Math.round(sp.count*density);sparks.geometry.setDrawRange(0,pc)
    sparks.visible=Math.sin(t*2.7)>.82
    for(let i=0;i<pc;i++){
      const p=env.sparks[i%env.sparks.length],a=(t*1.7+i*.073)%1
      sp.setXYZ(i,p.x+Math.sin(i*11)*a*.7,p.y-a*a*1.4,p.z+Math.cos(i*13)*a*.7)
    }
    sp.needsUpdate=true
    const d=dust.geometry.attributes.position,dc=Math.round(d.count*density);dust.geometry.setDrawRange(0,dc)
    for(let i=0;i<dc;i++){
      const tunnel=i%2===0,a=(t*.037+i*.191)%1
      d.setXYZ(i,(tunnel?-35:36)+Math.sin(i*41)*2,tunnel?-3.2+a*2.7:.3+a*5.8,Math.sin(i*17)*(tunnel?14:8)+(tunnel?0:14))
    }
    d.needsUpdate=true
  }}
  result.sync(0)
  return result
}
