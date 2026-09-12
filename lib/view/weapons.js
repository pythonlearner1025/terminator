import {
  Group, Mesh2, BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry,
  BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Euler,
  Vector3, PerspectiveCamera,
} from 'threepipe'
import {weaponMaterial, WEAPON_SURFACES} from './weapons-materials.js'
import {WeaponAnimation} from './weapons-animation.js'
import {WeaponFx} from './fx.js'
import {WeaponWorldFx} from './fx-world.js'
import {WeaponScreenFx} from './fx-screen.js'
import {TracerView} from './tracers.js'
import {ProjectileView} from './projectiles.js'
import {ScopeOverlay} from '../ui/scope.js'

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

// Merge into one draw per articulated group. Every surface uses the PBR atlas.
class Builder {
  constructor(material) {
    this.material=material;this.parts=new Map();this.matrix=new Matrix4()
    this.q=new Quaternion();this.euler=new Euler();this.v=new Vector3();this.scale=new Vector3()
    this.geometries={box:new BoxGeometry(1,1,1),round:roundedBox(),
      ball:new SphereGeometry(1,20,12),blade:knifeBlade(),cylinder:new CylinderGeometry(1,1,1,16),ring:new TorusGeometry(1,.17,6,20)}
  }
  group(name,parent,pos=[0,0,0]) { const g=new Group();g.name=name;g.position.set(...pos);parent.add(g);return g }
  part(parent,kind,size,pos,surface='steel',rotation=[0,0,0]) {
    const geometry=this.geometries[kind],source=geometry.index?geometry.toNonIndexed():geometry.clone()
    this.q.setFromEuler(this.euler.set(...rotation));this.v.set(...pos);this.scale.set(...size)
    this.matrix.compose(this.v,this.q,this.scale);source.applyMatrix4(this.matrix)
    const bucket=this.parts.get(parent)||{p:[],n:[],uv:[],c:[],s:[]};this.parts.set(parent,bucket)
    const tile=WEAPON_SURFACES.indexOf(surface)
    if(tile<0)throw new Error(`Unknown weapon surface: ${surface}`)
    for(let i=0;i<source.attributes.position.count;i++) {
      const p=source.attributes.position,n=source.attributes.normal,uv=source.attributes.uv
      bucket.p.push(p.getX(i),p.getY(i),p.getZ(i));bucket.n.push(n.getX(i),n.getY(i),n.getZ(i))
      const u=Math.max(0,Math.min(1,uv?.getX(i)||0)),v=Math.max(0,Math.min(1,uv?.getY(i)||0))
      bucket.uv.push(((tile%4)+(8+u*496)/512)/4,(3-Math.floor(tile/4)+(8+v*496)/512)/4)
    }
    source.dispose()
  }
  box(p,s,x,m='steel',r) { this.part(p,'round',s,x,m,r) }
  rod(p,radius,length,x,m='steel',rotation=[Math.PI/2,0,0]) {this.part(p,'cylinder',[radius,length,radius],x,m,rotation)}
  ring(p,radius,x,m='edge',rotation) {this.part(p,'ring',[radius,radius,radius],x,m,rotation)}
  finish() {
    const sharedHands=new Map()
    for(const [parent,a] of this.parts) {
      const geometry=new BufferGeometry()
      geometry.setAttribute('position',new Float32BufferAttribute(a.p,3));geometry.setAttribute('normal',new Float32BufferAttribute(a.n,3))
      geometry.setAttribute('uv',new Float32BufferAttribute(a.uv,2));geometry.setAttribute('uv1',new Float32BufferAttribute(a.uv,2));geometry.computeBoundingSphere()
      const hand=parent.name.endsWith('gloved hand')||parent.name.endsWith('sleeve')
      const shared=hand?sharedHands.get(parent.name):null
      if(shared)geometry.dispose()
      else if(hand)sharedHands.set(parent.name,geometry)
      const mesh=new Mesh2(shared||geometry,this.material);mesh.name=parent.name+' surfaces';mesh.renderOrder=900
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
  g.computeVertexNormals();const p=g.attributes.position;g.setAttribute('uv',new Float32BufferAttribute(Array.from({length:p.count*2},(_,i)=>i%2?(p.getZ(i>>1)+.75)/1.25:p.getX(i>>1)+.5),2));return g
}
function roundedBox() {
  // Exact machined bevel: six faces, twelve edges, eight corners, 44 triangles.
  const positions=[],uvs=[],a=new Vector3(),b=new Vector3(),normal=new Vector3(),center=new Vector3()
  const face=points=>{
    a.fromArray(points[1]).sub(b.fromArray(points[0]))
    normal.crossVectors(a,b.fromArray(points[2]).sub(center.fromArray(points[0])))
    center.set(0,0,0);for(const p of points)center.add(b.fromArray(p))
    if(normal.dot(center)<0)points.reverse()
    for(let i=1;i<points.length-1;i++)for(const p of [points[0],points[i],points[i+1]]) {
      positions.push(...p)
      const axis=Math.abs(normal.x)>Math.abs(normal.y)?(Math.abs(normal.x)>Math.abs(normal.z)?0:2):(Math.abs(normal.y)>Math.abs(normal.z)?1:2)
      uvs.push((axis===0?-p[2]:p[0])+.5,(axis===1?p[2]:p[1])+.5)
    }
  }
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
    face([[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b])=>{const p=[0,0,0];p[axis]=sign*.5;p[(axis+1)%3]=a*.47;p[(axis+2)%3]=b*.47;return p}))
  }
  for(let axis=0;axis<3;axis++)for(const s of [-1,1])for(const t of [-1,1]) {
    face([[.5,.47,-.47],[.47,.5,-.47],[.47,.5,.47],[.5,.47,.47]].map(([a,b,c])=>{
      const p=[0,0,0];p[axis]=c;p[(axis+1)%3]=s*a;p[(axis+2)%3]=t*b;return p
    }))
  }
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1])face([
    [x*.5,y*.47,z*.47],[x*.47,y*.5,z*.47],[x*.47,y*.47,z*.5],
  ])
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(positions,3))
  g.setAttribute('uv',new Float32BufferAttribute(uvs,2));g.computeVertexNormals();return g
}
function hand(b,parent,side,pos,rotation) {
  const h=b.group(side+' gloved hand',parent,pos);h.rotation.set(...rotation)
  b.part(h,'ball',[.046,.035,.065],[0,0,0],'glove')
  b.box(h,[.071,.012,.066],[0,.034,.012],'pad')
  for(let i=0;i<4;i++) {
    const x=(i-1.5)*.024,z=-.043+Math.abs(i-1.3)*.005
    b.part(h,'ball',[.014,.024,.035],[x,-.011,z],'glove',[.5,0,0])
    b.part(h,'ball',[.014,.015,.027],[x,-.037,z+.007],'rubber',[1,0,0])
    b.box(h,[.018,.01,.022],[x,.025,z+.017],'pad')
    b.box(h,[.016,.002,.005],[x,.031,.04],'cloth')
    for(let j=0;j<5;j++)b.box(h,[.002,.001,.003],[x-.008+j*.004,.030,z+.027],'cloth')
  }
  const s=side==='Right'? -1:1
  b.part(h,'ball',[.022,.024,.045],[s*.052,-.013,.006],'glove',[0,s*.65,-s*.3])
  const sleeve=b.group(side+' sleeve',h);sleeve.rotation.z=-rotation[2]+(side==='Right'?.16:-.68)
  b.rod(sleeve,.049,.063,[0,-.007,.092],'pad')
  b.part(sleeve,'ball',[.057,.062,.19],[s*-.015,-.095,.235],'cloth',[.52,0,s*.1])
  b.part(sleeve,'ball',[.080,.079,.22],[s*-.028,-.21,.43],'cloth',[.52,0,s*.1])
  for(let j=0;j<4;j++)b.part(sleeve,'ball',[.058+j*.003,.008,.035],[0,-.031-j*.022,.13+j*.026],'cloth',[.52,0,0])
  for(let i=0;i<3;i++)b.ring(sleeve,.050+i*.002,[0,-.01,.12+i*.015],'cloth')
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
    b.box(g,[.050,.011,.028],[0,height,z],'dark')
    for(const s of [-1,1])b.box(g,[.008,.030,.022],[s*.021,height+.016,z],'steel')
  }
  b.box(g,[.008,.031,.020],[0,height+.018,front],'dark')
  b.box(g,[.004,.005,.001],[0,height+.030,front+.0105],'white')
  // The top of the front post and rear notch share the camera's center ray.
  return {height:height+.034,distance:.5}
}
function marking(b,g,pos,surface,size=[.001,.039,.145]) {
  b.box(g,size,pos,surface)
  if(pos[0]>0)b.box(g,size,[-pos[0],pos[1],pos[2]],surface)
}
function screws(b,g,positions) {
  for(const pos of positions) {
    b.rod(g,.01,.007,pos,'edge',[0,0,Math.PI/2])
    b.box(g,[.008,.002,.012],[pos[0]+.004,pos[1],pos[2]],'dark')
  }
}
function makeGun(b,id,parent,includeHands=true) {
  const root=b.group(id+' viewmodel',parent),body=b.group(id+' receiver',root)
  const rig={id,root,body,slide:b.group(id+' action',body),magazine:b.group(id+' magazine',body),pump:b.group(id+' pump',body)}
  let front=-.32
  if(id==='pistol') {
    // Resistance cartridge revolver: long octagonal barrel, exposed cylinder,
    // top strap, hammer and curved grip. It retains the core pistol fire rate.
    front=-.46
    b.box(body,[.08,.025,.205],[0,.103,-.087],'steel')
    b.box(body,[.079,.028,.19],[0,-.026,-.07],'steel')
    b.box(body,[.076,.122,.042],[0,.038,.024],'steel')
    b.rod(body,.021,.285,[0,.068,-.322],'edge')
    b.box(body,[.042,.041,.28],[0,.068,-.32],'steel')
    b.rod(body,.014,.005,[0,.068,front-.002],'dark')
    b.rod(body,.011,.235,[0,.008,-.307],'steel')
    b.box(body,[.034,.015,.185],[0,-.012,-.28],'edge')
    b.rod(rig.magazine,.057,.118,[0,.042,-.085],'steel')
    for(let i=0;i<6;i++) {
      const a=i*Math.PI/3,x=Math.sin(a)*.038,y=.042+Math.cos(a)*.038
      b.rod(rig.magazine,.014,.004,[x,y,-.023],'brass')
      b.rod(rig.magazine,.006,.006,[x,y,-.021],'dark')
      b.rod(rig.magazine,.011,.080,[Math.sin(a)*.052,.042+Math.cos(a)*.052,-.086],'dark')
    }
    b.box(rig.slide,[.024,.061,.022],[0,.109,.027],'edge',[-.4,0,0])
    b.box(rig.slide,[.028,.012,.037],[0,.14,.039],'steel')
    grip(b,body,[0,-.104,.045])
    b.part(body,'ball',[.044,.085,.055],[0,-.131,.075],'rubber',[-.3,0,0])
    b.box(body,[.007,.105,.064],[.039,-.123,.065],'pad',[-.3,0,0])
    rig.sight=sights(b,body,-.431,.004,.108)
    marking(b,body,[.041,.104,-.20],'pistolMark',[.001,.019,.20])
    screws(b,body,[[.043,-.09,.07],[.040,.015,.017]])
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
      b.rod(body,.053,.32,[0,.007,-.34],'rubber')
      for(const side of [-1,1])b.box(body,[.025,.066,.32],[side*.036,.008,-.34],'dark')
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
      for(let i=0;i<9;i++)b.box(body,[.083,.012,.012],[0,.10,.076-i*.025],'dark')
    }
    rig.sight=sights(b,body,front+.09,.055,.093)
    marking(b,body,[.0508,.014,-.035],'rifleMark',[.001,.059,.20])
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
    rig.sight=sights(b,body,-.7,.066,.14)
    marking(b,body,[.0808,.035,-.035],'plasmaMark',[.001,.10,.245])
    screws(b,body,[[.083,.06,.055],[.083,-.025,-.14],[.091,.041,-.76]])
    rig.right=hand(b,root,'Right',[.018,-.125,.105],[-.25,0,.14])
    rig.left=hand(b,root,'Left',[-.058,-.09,-.31],[.2,0,-.7])
  } else if(id==='sniper') {
    front=-1.16
    // M14 EBR silhouette: long barrel, open receiver, box magazine and telescopic stock.
    b.box(body,[.115,.10,.34],[0,.015,-.075],'steel');grip(b,body)
    b.box(body,[.10,.067,.43],[0,-.028,-.37],'dark')
    b.box(body,[.12,.025,.42],[0,.065,-.37],'steel')
    for(let i=0;i<15;i++)b.box(body,[.126,.013,.015],[0,.087,-.16-i*.029],'dark')
    for(const sign of [-1,1]) {
      b.box(body,[.014,.085,.31],[sign*.062,-.02,-.31],'steel')
      for(let i=0;i<8;i++)b.box(body,[.016,.026,.020],[sign*.063,-.012,-.21-i*.037],'dark')
      b.rod(body,.012,.30,[sign*.045,-.024,.245],'edge')
      b.box(body,[.015,.072,.033],[sign*.046,-.033,.38],'steel')
      // Folded bipod legs follow the underside of the long fore-end.
      b.rod(body,.010,.27,[sign*.055,-.083,-.48],'steel')
      b.rod(body,.008,.15,[sign*.055,-.083,-.64],'edge')
    }
    b.box(body,[.10,.044,.17],[0,.041,.28],'rubber')
    b.box(body,[.083,.17,.037],[0,-.035,.415],'pad',[.1,0,0])
    b.rod(body,.018,.72,[0,.035,-.785],'steel')
    b.rod(body,.014,.43,[0,-.009,-.865],'dark')
    b.rod(body,.027,.088,[0,.035,front+.035],'dark')
    for(let i=0;i<5;i++)b.ring(body,.025,[0,.035,front+.013+i*.014],'edge')
    b.rod(body,.014,.004,[0,.035,front-.010],'rubber')
    b.box(rig.slide,[.071,.035,.13],[0,.071,-.028],'edge')
    b.rod(rig.slide,.013,.075,[.074,.04,.024],'edge',[0,0,Math.PI/2])
    b.part(rig.slide,'ball',[.016,.014,.022],[.107,.039,.023],'dark')
    b.box(body,[.014,.036,.17],[.062,.026,-.065],'dark')
    b.box(rig.magazine,[.080,.18,.125],[0,-.127,-.13],'steel',[-.08,0,0])
    b.box(rig.magazine,[.086,.018,.13],[0,-.216,-.123],'edge')
    for(const sign of [-1,1])for(let i=0;i<3;i++)b.box(rig.magazine,[.003,.12,.008],[sign*.041,-.128,-.094-i*.03],'dark')
    // Separate scope rings, ocular bell, objective bell and knurled turrets.
    b.box(body,[.088,.025,.25],[0,.108,-.105],'dark')
    for(const z of [-.21,-.014]) {
      b.box(body,[.075,.062,.035],[0,.132,z],'steel')
      b.ring(body,.040,[0,.18,z],'edge')
    }
    b.rod(body,.033,.34,[0,.18,-.095],'dark')
    for(const [z,r,l] of [[.072,.055,.084],[-.278,.062,.10]]) {
      b.rod(body,r,l,[0,.18,z],'dark')
      b.ring(body,r,[0,.18,z+l*.49],'edge')
      b.rod(body,r*.78,.003,[0,.18,z+(z>0?1:-1)*l*.51],'dark')
    }
    for(let i=0;i<9;i++)b.ring(body,.053,[0,.18,.044+i*.007],'dark')
    b.rod(body,.024,.058,[0,.222,-.102],'steel',[0,0,0])
    b.rod(body,.027,.029,[0,.263,-.102],'dark',[0,0,0])
    b.rod(body,.025,.042,[.045,.18,-.102],'steel',[0,0,Math.PI/2])
    rig.sight={height:.18,distance:.37,scope:true}
    marking(b,body,[.063,-.022,-.36],'rifleMark',[.001,.039,.24])
    screws(b,body,[[.060,.017,.034],[.063,-.037,-.23],[.063,-.037,-.43]])
    rig.right=hand(b,root,'Right',[.022,-.12,.107],[-.25,0,.16])
    rig.left=hand(b,root,'Left',[-.050,-.090,-.37],[.13,0,-.68])
  } else if(id==='launcher') {
    front=-.71
    // Single-shot M79 with a large bore and a hinge that opens the whole barrel.
    b.box(body,[.115,.14,.18],[0,.025,-.035],'steel')
    b.part(body,'ball',[.062,.066,.23],[0,-.016,.24],'olive',[-.17,0,0])
    b.box(body,[.081,.151,.035],[0,-.028,.43],'rubber')
    grip(b,body,[0,-.099,.072])
    rig.breech=b.group(id+' hinged breech',body,[0,-.030,-.13])
    b.rod(rig.breech,.057,.575,[0,.065,-.283],'steel')
    b.rod(rig.breech,.043,.009,[0,.065,-.582],'dark')
    b.ring(rig.breech,.058,[0,.065,-.578],'edge')
    b.rod(rig.breech,.072,.16,[0,.065,-.15],'olive')
    for(let i=0;i<8;i++)b.ring(rig.breech,.072,[0,.065,-.083-i*.018],'dark')
    b.rod(body,.024,.145,[0,-.03,-.13],'edge',[0,0,Math.PI/2])
    // Ladder sight has an open central window and a movable-looking crossbar.
    for(const sign of [-1,1])b.box(rig.breech,[.011,.20,.012],[sign*.041,.19,-.04],'steel')
    for(const y of [.098,.278])b.box(rig.breech,[.09,.012,.012],[0,y,-.04],'steel')
    b.box(rig.breech,[.073,.008,.014],[0,.135,-.04],'edge')
    b.box(rig.breech,[.007,.055,.027],[0,.13,-.53],'dark')
    b.box(rig.slide,[.02,.014,.06],[.025,.108,.025],'edge',[0,.28,0])
    rig.magazine.removeFromParent();rig.breech.add(rig.magazine)
    b.rod(rig.magazine,.040,.12,[0,.065,.055],'brass')
    b.part(rig.magazine,'ball',[.039,.039,.035],[0,.065,-.009],'olive')
    b.ring(rig.magazine,.043,[0,.065,.118],'edge')
    rig.magazine.visible=false
    rig.sight={height:.122,distance:.52}
    marking(b,body,[.058,.038,-.025],'armoryMark',[.001,.060,.13])
    rig.right=hand(b,root,'Right',[.022,-.12,.107],[-.25,0,.16])
    rig.left=hand(b,root,'Left',[-.05,-.032,-.24],[.13,0,-.68])
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
    marking(b,body,[0,.005,.062],'armoryMark',[.070,.065,.002])
    if(includeHands) {
      rig.right=hand(b,root,'Right',[.022,-.044,.036],[.6,0,.3])
      rig.left=hand(b,root,'Left',[-.13,.09,.015],[.15,-.45,-.35])
    }
  }
  if(rig.sight) {
    // Receiver dimensions are authored in a larger inspection space. Convert the
    // assembled action to real firearm size, retaining adult-sized hands.
    body.scale.setScalar(.75);rig.sight.height*=.75
    rig.right.position.set(.025,-.092,.055);rig.right.rotation.set(-.12,0,-1.45)
    rig.right.userData.restPosition.copy(rig.right.position);rig.right.userData.restRotation.copy(rig.right.rotation)
    // Sleeve counter-rotation keeps the forearm directed back to the shoulder.
    rig.right.getObjectByName('Right sleeve').rotation.z=1.61
    if(id!=='shotgun')rig.left.position.multiplyScalar(.75)
    rig.left.userData.restPosition.copy(rig.left.position)
  }
  rig.muzzle=b.group(id+' muzzle',rig.breech||body,rig.breech?[0,.065,-.582]:[0,id==='pistol'?.068:id==='sniper'?.035:id==='plasma'?.04:.046,front])
  root.visible=false;return rig
}

// The in-world projectile uses the exact grenade authored for the first-person
// rig, without building or retaining another pair of hands.
export function createGrenadeModel(material) {
  const holder=new Group(),builder=new Builder(material)
  const rig=makeGun(builder,'grenade',holder,false)
  builder.finish()
  rig.body.removeFromParent();rig.body.visible=true;rig.body.name='M67 frag grenade'
  return rig.body
}

export const WEAPON_IDS=['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher']
export function createWeaponRigs(parent,material) {
  const builder=new Builder(material)
  const rigs=Object.fromEntries(WEAPON_IDS.map(id=>[id,makeGun(builder,id,parent)]))
  builder.finish();return rigs
}

export class WeaponView {
  constructor(parent,viewer) {
    this.viewer=viewer
    this.root=new Group();this.root.name='First Person Weapons';parent.add(this.root)
    this.feel=new Group();this.root.add(this.feel)
    this.camera=new PerspectiveCamera(54,1,.02,8)
    this.baseFov=72
    this.projection=viewmodelProjection(this.camera)
    this.material=weaponMaterial(this.projection)
    this.rigs=createWeaponRigs(this.feel,this.material)
    this.worldFx=new WeaponWorldFx(parent)
    this.screenFx=viewer?new WeaponScreenFx(viewer,this.worldFx):null
    this.fx=new WeaponFx(this.feel,this.projection,this.material,this.worldFx)
    this.worldFx.onSound=(kind,detail)=>viewer?.canvas.dispatchEvent(new CustomEvent('terminator:weapon-sound',{detail:{kind,...detail}}))
    this.animation=new WeaponAnimation(this.rigs,this.fx)
    this.tracers=new TracerView(parent);this.projectiles=new ProjectileView(parent)
    this.worldFx.tracers=this.tracers;this.worldFx.projectiles=this.projectiles
    this.muzzlePosition=new Vector3()
    this.scope=viewer?new ScopeOverlay(viewer):null
  }
  sync(world) {
    this.world=world
    this.worldFx.colliders=world.activeColliders()
    this.worldFx.sync(world,this.viewer?.scene.mainCamera)
    const camera=this.viewer?.scene.mainCamera
    if(camera){this.root.position.copy(camera.position);this.root.quaternion.copy(camera.quaternion)}
    this.animation.sync(world)
    this.root.updateMatrixWorld(true)
    this.rigs[this.animation.shown].muzzle.getWorldPosition(this.muzzlePosition)
    if(camera) {
      // Match the independent weapon projection at the muzzle plane.
      this.muzzlePosition.applyMatrix4(camera.matrixWorldInverse)
      const ratio=Math.tan(camera.fov*Math.PI/360)/Math.tan(this.camera.fov*Math.PI/360)
      this.muzzlePosition.x*=ratio;this.muzzlePosition.y*=ratio
      this.muzzlePosition.applyMatrix4(camera.matrixWorld)
    }
    this.tracers.sync(world,this.muzzlePosition,this.worldFx.colliders)
    this.projectiles.sync(world,camera)
    this.scope?.sync(this.animation.shown,this.animation.aimAmount,world.player.reloadTimer>0)
    this.feel.visible=!this.scope?.visible
    this.screenFx?.sync(world)
  }
  primeWarmup(camera){
    const releaseTracers=this.tracers.primeWarmup()
    const releaseProjectiles=this.projectiles.primeWarmup(camera)
    return()=>{releaseTracers();releaseProjectiles()}
  }
  beforeRender(camera) {
    if(!this.world)return
    // Match world zoom while retaining the existing 54 degree hip projection.
    const zoom=Math.tan(camera.fov*Math.PI/360)/Math.tan(this.baseFov*Math.PI/360)
    const fov=2*Math.atan(Math.tan(54*Math.PI/360)*zoom)*180/Math.PI
    if(this.camera.aspect!==camera.aspect || this.camera.fov!==fov) {
      this.camera.aspect=camera.aspect;this.camera.fov=fov;this.camera.updateProjectionMatrix()
    }
    this.root.position.copy(camera.position);this.root.quaternion.copy(camera.quaternion)
    // GameManager applies CameraFeel after PlayerView.sync. Read its final offset here.
    const hip=1-this.animation.aimAmount
    this.feel.rotation.set(-(camera.rotation.x-this.world.player.pitch)*.8*hip,0,-camera.rotation.z*.65*hip)
    this.root.updateMatrixWorld(true)
    if(this.viewer){
      this.tracers.pool.batch.viewport.set(this.viewer.canvas.width,this.viewer.canvas.height)
      this.projectiles.streaks.viewport.copy(this.tracers.pool.batch.viewport)
    }
    this.fx.beforeRender(camera,this.animation.aimAmount)
    this.screenFx?.layout();this.scope?.layout()
  }
  dispose() { this.fx.dispose();this.worldFx.dispose();this.screenFx?.dispose();this.tracers.dispose();this.projectiles.dispose();this.scope?.dispose();this.world=null }
}
