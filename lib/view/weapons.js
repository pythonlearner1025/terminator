import {
  Group, Mesh2, BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry,
  BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Euler,
  Vector3, Color, PhysicalMaterial, CanvasTexture, CubeTexture, SRGBColorSpace,
  RepeatWrapping, PerspectiveCamera,
} from 'threepipe'
import {WeaponAnimation} from './weapons-animation.js'
import {WeaponFx} from './fx.js'

const SURFACES = {
  steel: [0x424e58, .86, .48], edge: [0x8b969d, .92, .32], dark: [0x171e26, .75, .57],
  rubber: [0x171b1f, .05, .94], glove: [0x343932, .04, .88], pad: [0x101719, .1, .8],
  cloth: [0x454c43, .02, .97], brass: [0xad8545, .78, .32], red: [0x8c3024, .2, .58],
  olive: [0x3b4935, .25, .8], white: [0xc4c8b6, .1, .66], blue: [0x7cc2d3, .5, .24],
}

// A separate projection without another render pass. Depth is compressed into the
// near foreground so the gun keeps its own depth ordering and cannot enter walls.
export function viewmodelProjection(camera) {
  return {
    uuid: 'terminator-viewmodel-projection', computeCacheKey: 'terminator-viewmodel-projection-v1',
    extraUniforms: {weaponProjection: {value: camera.projectionMatrix}},
    parsVertexSnippet: 'uniform mat4 weaponProjection;',
    shaderExtender(shader) {
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\ngl_Position = weaponProjection * mvPosition;\ngl_Position.z = gl_Position.z * 0.0002 - gl_Position.w * 0.999;')
    },
  }
}

function makeMaterial(projection) {
  const canvas = (size, paint) => {
    const c = document.createElement('canvas'); c.width = c.height = size
    paint(c.getContext('2d'), size); return c
  }
  const roughnessMap = new CanvasTexture(canvas(128, (ctx, n) => {
    const data = ctx.createImageData(n, n); let seed = 2029
    for (let i = 0; i < n*n; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const v = 188 + (seed >>> 27) + 20 * Math.sin(i % n * 3.7)
      data.data.set([v,v,v,255], i*4)
    }
    ctx.putImageData(data,0,0)
  }))
  roughnessMap.wrapS = roughnessMap.wrapT = RepeatWrapping
  const envMap = new CubeTexture(Array.from({length: 6}, (_, face) => canvas(64, (ctx,n) => {
    const g = ctx.createLinearGradient(0,0,n,n)
    g.addColorStop(0,'#10151d'); g.addColorStop(.3,'#334759')
    g.addColorStop(.42,face===2?'#dceaff':'#b4c9dc'); g.addColorStop(.49,'#1a2027')
    g.addColorStop(.78,'#07090d'); g.addColorStop(1,'#706254')
    ctx.fillStyle=g;ctx.fillRect(0,0,n,n);ctx.fillStyle='#e1e6e9';ctx.fillRect(face%2?42:10,6,3,48)
  })))
  envMap.colorSpace=SRGBColorSpace;envMap.needsUpdate=true
  const material = new PhysicalMaterial({name:'Resistance worn gunmetal, leather and canvas',
    vertexColors:true,metalness:1,roughness:1,roughnessMap,envMap,envMapIntensity:1.1,fog:false})
  material.userData.ssaoDisabled=true
  material.userData.ssaoCastDisabled=true
  material.userData.renderToGBuffer=false
  material.registerMaterialExtensions([projection, {
    uuid:'terminator-weapon-surfaces',computeCacheKey:'terminator-weapon-surfaces-v1',
    parsVertexSnippet:'attribute vec2 weaponSurface; varying vec2 vWeaponSurface;',
    parsFragmentSnippet:'varying vec2 vWeaponSurface;',
    shaderExtender(shader) {
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWeaponSurface = weaponSurface;')
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= vWeaponSurface.y;')
      shader.fragmentShader=shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= vWeaponSurface.x;')
      // Camera-facing fill keeps tactile detail readable when the map lights go out.
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight += diffuseColor.rgb * (0.22 + 0.7 * max(dot(normal, normalize(vec3(-0.4, 0.8, 0.6))), 0.0)) * (1.0 - metalnessFactor * 0.65);\n#include <opaque_fragment>')
    },
  }])
  return material
}

// Bake details into one draw per articulated group, with per-vertex PBR surfaces.
class Builder {
  constructor(material) {
    this.material=material;this.parts=new Map();this.matrix=new Matrix4()
    this.q=new Quaternion();this.euler=new Euler();this.v=new Vector3();this.scale=new Vector3()
    this.geometries={box:new BoxGeometry(1,1,1),round:roundedBox(),
      ball:new SphereGeometry(1,12,8),blade:knifeBlade(),cylinder:new CylinderGeometry(1,1,1,16),ring:new TorusGeometry(1,.17,6,20)}
  }
  group(name,parent,pos=[0,0,0]) { const g=new Group();g.name=name;g.position.set(...pos);parent.add(g);return g }
  part(parent,kind,size,pos,surface='steel',rotation=[0,0,0]) {
    const geometry=this.geometries[kind],source=geometry.index?geometry.toNonIndexed():geometry.clone()
    const originalNormals=source.attributes.normal.array.slice()
    this.q.setFromEuler(this.euler.set(...rotation));this.v.set(...pos);this.scale.set(...size)
    this.matrix.compose(this.v,this.q,this.scale);source.applyMatrix4(this.matrix)
    const bucket=this.parts.get(parent)||{p:[],n:[],uv:[],c:[],s:[]};this.parts.set(parent,bucket)
    const base=SURFACES[surface],color=new Color(base[0]),edge=new Color(0x9aa6ac)
    for(let i=0;i<source.attributes.position.count;i++) {
      const p=source.attributes.position,n=source.attributes.normal,uv=source.attributes.uv
      bucket.p.push(p.getX(i),p.getY(i),p.getZ(i));bucket.n.push(n.getX(i),n.getY(i),n.getZ(i))
      bucket.uv.push(uv?.getX(i)||0,uv?.getY(i)||0)
      // Highlight the bevels, then break them with deterministic small chips.
      const diagonal=kind==='round' && Math.max(Math.abs(originalNormals[i*3]),Math.abs(originalNormals[i*3+1]),Math.abs(originalNormals[i*3+2]))<.98
      const wear=diagonal&&base[1]>.5? .23 + (i%7)*.035:0
      bucket.c.push(color.r*(1-wear)+edge.r*wear,color.g*(1-wear)+edge.g*wear,color.b*(1-wear)+edge.b*wear)
      bucket.s.push(base[1],base[2]*(1-wear*.45))
    }
    source.dispose()
  }
  box(p,s,x,m='steel',r) { this.part(p,'round',s,x,m,r) }
  rod(p,radius,length,x,m='steel',rotation=[Math.PI/2,0,0]) {this.part(p,'cylinder',[radius,length,radius],x,m,rotation)}
  ring(p,radius,x,m='edge',rotation) {this.part(p,'ring',[radius,radius,radius],x,m,rotation)}
  finish() {
    for(const [parent,a] of this.parts) {
      const geometry=new BufferGeometry()
      geometry.setAttribute('position',new Float32BufferAttribute(a.p,3));geometry.setAttribute('normal',new Float32BufferAttribute(a.n,3))
      geometry.setAttribute('uv',new Float32BufferAttribute(a.uv,2));geometry.setAttribute('color',new Float32BufferAttribute(a.c,3))
      geometry.setAttribute('weaponSurface',new Float32BufferAttribute(a.s,2));geometry.computeBoundingSphere()
      const mesh=new Mesh2(geometry,this.material);mesh.name=parent.name+' surfaces';mesh.renderOrder=900
      mesh.frustumCulled=false;mesh.raycast=()=>{};parent.add(mesh)
    }
    for(const geo of Object.values(this.geometries))geo.dispose()
  }
}
function knifeBlade() {
  const g=new BufferGeometry()
  g.setAttribute('position',new Float32BufferAttribute([
    -.5,0,.5, .5,0,.5, 0,.13,.5, 0,-.13,.5,
    -.48,0,-.38, .48,0,-.38, 0,.13,-.38, 0,-.13,-.38, 0,0,-.75,
  ],3))
  g.setIndex([0,4,6,0,6,2,2,6,5,2,5,1,0,3,7,0,7,4,3,1,5,3,5,7,
    4,8,6,6,8,5,4,7,8,7,5,8,0,2,1,0,1,3])
  g.computeVertexNormals();return g
}
function roundedBox() {
  const g=new BoxGeometry(1,1,1,4,4,4),p=g.attributes.position,v=new Vector3(),inner=new Vector3()
  for(let i=0;i<p.count;i++) {
    v.fromBufferAttribute(p,i);inner.copy(v).clampScalar(-.41,.41)
    v.sub(inner).normalize().multiplyScalar(.09).add(inner);p.setXYZ(i,v.x,v.y,v.z)
  }
  g.computeVertexNormals();return g
}
function hand(b,parent,side,pos,rotation) {
  const h=b.group(side+' gloved hand',parent,pos);h.rotation.set(...rotation)
  b.part(h,'ball',[.053,.042,.075],[0,0,0],'glove')
  b.box(h,[.082,.018,.084],[0,.034,.012],'pad')
  for(let i=0;i<4;i++) {
    const x=(i-1.5)*.024,z=-.043+Math.abs(i-1.3)*.005
    b.part(h,'ball',[.014,.024,.035],[x,-.011,z],'glove',[.5,0,0])
    b.part(h,'ball',[.014,.015,.027],[x,-.037,z+.007],'rubber',[1,0,0])
    b.box(h,[.018,.01,.022],[x,.025,z+.017],'pad')
    b.box(h,[.016,.002,.005],[x,.031,.04],'cloth')
  }
  const s=side==='Right'? -1:1
  b.part(h,'ball',[.022,.024,.045],[s*.052,-.013,.006],'glove',[0,s*.65,-s*.3])
  b.rod(h,.052,.08,[0,-.007,.10],'pad')
  b.part(h,'cylinder',[.061,.50,.065],[s*-.023,-.15,.31],'cloth',[Math.PI/2+.65,0,s*.1])
  for(let i=0;i<3;i++)b.ring(h,.053+i*.002,[0,-.01,.12+i*.015],'cloth')
  h.userData.restPosition=h.position.clone();h.userData.restRotation=h.rotation.clone();return h
}
function grip(b,g,pos=[0,-.105,.04]) {
  b.box(g,[.073,.17,.085],pos,'rubber',[-.22,0,0])
  for(let i=0;i<6;i++) b.box(g,[.076,.009,.06],[pos[0],pos[1]-.06+i*.022,pos[2]+.014],'dark',[-.22,0,0])
  b.box(g,[.084,.018,.075],[0,-.02,-.056],'steel')
  b.box(g,[.07,.013,.09],[0,-.084,-.055],'dark')
  b.box(g,[.013,.067,.016],[.03,-.056,-.098],'dark')
  b.box(g,[.01,.047,.018],[0,-.035,-.038],'edge',[-.3,0,0])
}
function sights(b,g,front,rear,height) {
  for(const z of [front,rear]) {
    b.box(g,[.065,.018,.033],[0,height,z],'dark')
    for(const s of [-1,1])b.box(g,[.013,.034,.025],[s*.026,height+.016,z],'steel')
  }
  b.box(g,[.012,.028,.022],[0,height+.02,front],'white')
}
function screws(b,g,positions) {
  for(const pos of positions) {
    b.rod(g,.01,.007,pos,'edge',[0,0,Math.PI/2])
    b.box(g,[.008,.002,.012],[pos[0]+.004,pos[1],pos[2]],'dark')
  }
}
function makeGun(b,id,parent) {
  const root=b.group(id+' viewmodel',parent),body=b.group(id+' receiver',root)
  const rig={id,root,body,slide:b.group(id+' action',body),magazine:b.group(id+' magazine',body),pump:b.group(id+' pump',body)}
  let front=-.32
  if(id==='pistol') {
    b.box(body,[.082,.065,.29],[0,-.014,-.105],'dark');grip(b,body)
    b.box(rig.slide,[.084,.071,.31],[0,.044,-.115],'steel')
    b.box(rig.slide,[.075,.013,.28],[0,.08,-.12],'dark')
    b.box(rig.slide,[.014,.028,.076],[.043,.043,-.087],'dark')
    b.rod(body,.019,.30,[0,.046,-.157],'edge');front=-.312
    b.rod(body,.015,.004,[0,.046,front],'rubber')
    for(let i=0;i<9;i++)for(const s of [-1,1])b.box(rig.slide,[.003,.043,.005],[s*.043,.045,.013-i*.009],'dark')
    sights(b,rig.slide,-.244,.016,.085)
    b.box(rig.magazine,[.052,.155,.057],[0,-.125,.05],'dark',[-.22,0,0])
    b.box(rig.magazine,[.086,.021,.085],[0,-.205,.064],'steel')
    screws(b,body,[[.043,-.01,.02],[.043,-.11,.07]])
    rig.right=hand(b,root,'Right',[.018,-.12,.095],[-.25,0,.15])
    rig.left=hand(b,root,'Left',[-.072,-.10,.031],[.3,-.45,-.3])
  } else if(id==='m4'||id==='shotgun') {
    const shotgun=id==='shotgun';front=shotgun?-.91:-.88
    b.box(body,[.10,.11,.28],[0,.005,-.035],'steel');grip(b,body)
    b.box(body,[.091,.035,.27],[0,.074,-.03],'dark')
    b.box(body,[.112,.04,.114],[.004,-.056,-.12],'dark')
    b.rod(body,.027,.31,[0,.029,.24],'dark')
    b.box(body,[.061,.105,.14],[0,-.004,.225],'rubber',[.16,0,0])
    b.box(body,[.073,.12,.019],[0,-.008,.287],'pad',[.16,0,0])
    b.box(body,[.004,.058,.107],[.052,.021,-.014],'dark')
    b.box(rig.slide,[.007,.036,.10],[.056,.022,-.017],'edge')
    b.box(rig.slide,[.04,.012,.019],[.062,.027,-.01],'dark')
    b.rod(body,shotgun?.027:.015,shotgun?.73:.72,[0,.042,-.49],'dark')
    b.rod(body,shotgun?.033:.024,.08,[0,.042,front+.038],'steel')
    b.rod(body,shotgun?.023:.017,.004,[0,.042,front-.004],'rubber')
    if(shotgun) {
      b.rod(body,.028,.62,[0,-.029,-.40],'steel')
      b.box(rig.pump,[.107,.085,.23],[0,-.024,-.42],'rubber')
      for(let i=0;i<11;i++)b.box(rig.pump,[.111,.077,.008],[0,-.026,-.32-i*.02],'steel')
      b.box(body,[.022,.09,.19],[-.061,.005,-.012],'dark')
      for(let i=0;i<4;i++) {
        b.rod(body,.015,.074,[-.081,.005,.05-i*.047],'red',[0,0,0])
        b.rod(body,.016,.013,[-.081,.047,.05-i*.047],'brass',[0,0,0])
      }
      b.rod(rig.magazine,.018,.071,[0,-.18,-.12],'red');b.rod(rig.magazine,.019,.015,[0,-.18,-.08],'brass')
      rig.magazine.visible=false
    } else {
      b.box(body,[.103,.103,.32],[0,.007,-.34],'rubber')
      for(let i=0;i<12;i++) {
        b.box(body,[.113,.018,.012],[0,.068,-.19-i*.027],'steel')
        for(const s of [-1,1])b.box(body,[.008,.036,.017],[s*.052,.01,-.21-i*.025],'dark')
      }
      b.rod(body,.019,.22,[0,.071,-.68],'steel')
      b.box(body,[.048,.083,.045],[0,.073,-.71],'dark')
      b.box(rig.magazine,[.071,.185,.102],[0,-.152,-.113],'steel',[-.16,0,0])
      b.box(rig.magazine,[.076,.018,.105],[0,-.242,-.10],'dark')
      for(let s of [-1,1])for(let i=0;i<3;i++)b.box(rig.magazine,[.004,.137,.006],[s*.037,-.146,-.08-i*.027],'dark',[-.16,0,0])
      b.box(body,[.008,.055,.13],[-.052,.01,-.014],'dark')
      b.box(body,[.009,.012,.047],[-.058,-.014,.065],'edge',[0,0,-.4])
      b.box(body,[.012,.034,.026],[-.059,.004,-.086],'steel')
      for(let i=0;i<4;i++)b.box(body,[.002,.006,.007],[-.058,.039,.009+i*.014],'white')
      for(let i=0;i<9;i++)b.box(body,[.083,.012,.012],[0,.10,.076-i*.025],'edge')
    }
    sights(b,body,front+.09,.055,.093)
    screws(b,body,[[.052,.006,.067],[.052,-.032,-.08],[.052,.04,-.15]])
    rig.right=hand(b,root,'Right',[.024,-.117,.107],[-.25,0,.16])
    rig.left=hand(b,shotgun?rig.pump:root,'Left',[-.047,-.072,-.34],[.13,0,-.68])
  } else if(id==='plasma') {
    // Recovered Endo rifle: squared receiver, bright seam, fins and recessed shroud.
    front=-.78
    b.box(body,[.16,.18,.30],[0,.034,-.03],'dark');grip(b,body)
    b.box(body,[.167,.018,.30],[0,.109,-.03],'edge')
    b.box(body,[.138,.12,.43],[0,.043,-.38],'steel')
    b.box(body,[.099,.077,.48],[0,.04,-.42],'dark')
    for(let i=0;i<9;i++)b.box(body,[.17,.015,.028],[0,.116,-.2-i*.055],'edge')
    for(const s of [-1,1])for(let i=0;i<7;i++)b.box(body,[.009,.059,.029],[s*.072,.043,-.22-i*.059],'dark')
    b.box(body,[.183,.16,.075],[0,.041,front+.039],'dark')
    b.ring(body,.039,[0,.04,front],'edge');b.rod(body,.032,.01,[0,.04,front+.003],'rubber')
    b.box(body,[.095,.13,.21],[0,.016,.22],'rubber')
    b.box(body,[.12,.15,.035],[0,.018,.33],'steel')
    b.box(rig.magazine,[.089,.17,.136],[0,-.12,-.09],'dark')
    b.box(rig.magazine,[.101,.034,.15],[0,-.20,-.09],'edge')
    for(let i=0;i<3;i++)b.box(rig.magazine,[.007,.095,.018],[.046,-.112,-.044-i*.044],'blue')
    b.box(rig.slide,[.035,.028,.044],[.095,.066,.022],'edge')
    sights(b,body,-.7,.066,.14)
    screws(b,body,[[.083,.06,.055],[.083,-.025,-.14],[.091,.041,-.76]])
    rig.right=hand(b,root,'Right',[.018,-.125,.105],[-.25,0,.14])
    rig.left=hand(b,root,'Left',[-.058,-.09,-.31],[.2,0,-.7])
  } else if(id==='knife') {
    b.box(body,[.044,.049,.18],[0,0,.025],'rubber')
    for(let i=0;i<8;i++)b.ring(body,.027,[0,0,-.049+i*.019],'dark')
    b.box(body,[.137,.022,.025],[0,0,-.08],'steel')
    // Flattened diamond cross section, clipped point and bright ground cutting edge.
    b.part(body,'blade',[.087,.055,.245],[0,0,-.208],'edge')
    b.box(body,[.057,.009,.18],[0,.003,-.18],'steel')
    b.box(body,[.014,.003,.16],[.007,.009,-.18],'dark')
    for(let i=0;i<7;i++)b.box(body,[.013,.011,.012],[-.032,0,-.12-i*.019],'dark',[0,.3,0])
    b.ring(body,.015,[0,0,.117],'edge')
    rig.right=hand(b,root,'Right',[.013,-.027,.049],[0,0,.3])
    rig.left=hand(b,root,'Left',[-.29,.006,-.09],[.1,-.6,-.4])
  } else {
    b.part(body,'ball',[.068,.09,.063],[0,0,0],'olive')
    for(let row=0;row<4;row++)for(let i=0;i<10;i++) {
      const a=i*Math.PI/5,r=.061*Math.sin((row+1)/5*Math.PI)
      b.box(body,[.028,.026,.015],[Math.sin(a)*r,-.067+row*.039,Math.cos(a)*r],'olive',[0,a,0])
    }
    b.rod(body,.03,.035,[0,.089,0],'steel',[0,0,0])
    b.box(body,[.026,.013,.075],[0,.111,.023],'edge')
    b.box(rig.slide,[.027,.126,.012],[0,.052,.061],'steel',[.24,0,0])
    b.ring(rig.magazine,.035,[-.063,.1,0],'edge',[0,Math.PI/2,0])
    b.rod(rig.magazine,.004,.073,[-.025,.104,0],'edge',[0,0,Math.PI/2])
    b.box(body,[.028,.006,.003],[.025,.013,.058],'white')
    rig.right=hand(b,root,'Right',[.022,-.044,.036],[.6,0,.3])
    rig.left=hand(b,root,'Left',[-.13,.09,.015],[.15,-.45,-.35])
  }
  rig.muzzle=b.group(id+' muzzle',body,[0,id==='plasma'?.04:.046,front])
  root.visible=false;return rig
}

export class WeaponView {
  constructor(parent) {
    this.root=new Group();this.root.name='First Person Weapons';parent.add(this.root)
    this.feel=new Group();this.root.add(this.feel)
    this.camera=new PerspectiveCamera(54,1,.02,8)
    this.projection=viewmodelProjection(this.camera)
    this.material=makeMaterial(this.projection)
    const b=new Builder(this.material)
    this.rigs=Object.fromEntries(['pistol','m4','shotgun','plasma','knife','grenade'].map(id=>[id,makeGun(b,id,this.feel)]))
    b.finish()
    this.fx=new WeaponFx(this.feel,this.projection,this.material)
    this.animation=new WeaponAnimation(this.rigs,this.fx)
  }
  sync(world) { this.world=world;this.animation.sync(world) }
  beforeRender(camera) {
    if(!this.world)return
    if(this.camera.aspect!==camera.aspect) {this.camera.aspect=camera.aspect;this.camera.updateProjectionMatrix()}
    this.root.position.copy(camera.position);this.root.quaternion.copy(camera.quaternion)
    // GameManager applies CameraFeel after PlayerView.sync. Read its final offset here.
    this.feel.rotation.set(-(camera.rotation.x-this.world.player.pitch)*.8,0,-camera.rotation.z*.65)
    this.root.updateMatrixWorld(true)
  }
  dispose() { this.fx.dispose();this.world=null }
}
