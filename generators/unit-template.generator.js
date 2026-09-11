import {unitMaterials} from './unit-materials.js'

export default function generate({params, engine}) {
  return createUnitFigure(engine, ['scout', 'endo', 'heavy'].includes(params.type) ? params.type : 'endo')
}

// Rigid skinning combines every metal component into one draw call per unit.
// Bone names are the animation contract. All dimensions are in metres, facing +Z.
export function createUnitFigure(E, type = 'endo') {
  const materials = unitMaterials(E)
  const root = new E.Group()
  root.name = `${type} Endoskeleton`
  root.userData.unitTemplateType = type
  const bones = [], parts = []
  const heavy = type === 'heavy', scout = type === 'scout'
  const bulk = heavy ? 1.32 : scout ? .75 : 1
  const steel = [0x818990, 1.0], chrome = [0xc5cbd0, .32], dark = [0x23282d, 1.5], edge = [0xa9b1b7, .65]
  const joint = (name, parent, p) => {
    const b = new E.Bone(); b.name = name; b.position.set(...p)
    b.userData.unitJoint = true; (parent || root).add(b); bones.push(b); return b
  }
  const pelvis = joint('Pelvis', null, [0, .94, 0])
  const spine = joint('Spine', pelvis, [0, .12, 0])
  const chest = joint('Chest', spine, [0, .28, 0])
  const neck = joint('Neck', chest, [0, .29, -.025])
  const head = joint('Head', neck, [0, .12, 0])
  const jaw = joint('Jaw', head, [0, -.055, -.012])
  const boxGeo = new E.BoxGeometry(1, 1, 1)
  const sphereGeo = new E.SphereGeometry(1, 20, 12)
  const cylGeo = new E.CylinderGeometry(1, 1, 1, 10)
  const ringGeo = new E.TorusGeometry(1, .2, 5, 16)
  const shape = new E.Shape()
  shape.moveTo(-.5, -.32); shape.lineTo(-.32, -.5); shape.lineTo(.32, -.5)
  shape.lineTo(.5, -.32); shape.lineTo(.5, .32); shape.lineTo(.32, .5)
  shape.lineTo(-.32, .5); shape.lineTo(-.5, .32); shape.closePath()
  const plateGeo = new E.ExtrudeGeometry(shape, {depth: .7, bevelEnabled: true, bevelThickness: .15, bevelSize: .035, bevelSegments: 1, steps: 1})
  plateGeo.translate(0, 0, -.35)
  const add = (bone, name, geo, surface, p, scale, rot = [0, 0, 0]) => {
    const transform = new E.Object3D(); transform.position.set(...p); transform.scale.set(...scale); transform.rotation.set(...rot); transform.updateMatrix()
    parts.push({bone, name, geo, surface, matrix: transform.matrix.clone()})
  }
  const box = (b,n,s,p,m=steel,r) => add(b,n,boxGeo,m,p,s,r)
  const plate = (b,n,s,p,m=steel,r) => add(b,n,plateGeo,m,p,s,r)
  const ball = (b,n,s,p,m=chrome) => add(b,n,sphereGeo,m,p,s)
  const ring = (b,n,r,p,m=edge,rot) => add(b,n,ringGeo,m,p,[r,r,r],rot)
  const rod = (b,n,a,z,r,m=chrome) => {
    const from = new E.Vector3(...a), to = new E.Vector3(...z)
    const obj = new E.Object3D(); obj.position.copy(from).add(to).multiplyScalar(.5)
    obj.quaternion.setFromUnitVectors(new E.Vector3(0,1,0), to.clone().sub(from).normalize())
    obj.scale.set(r, from.distanceTo(to), r); obj.updateMatrix()
    parts.push({bone:b,name:n,geo:cylGeo,surface:m,matrix:obj.matrix.clone()})
  }
  const cable = (b,n,points,r=.012) => {
    const curve = new E.CatmullRomCurve3(points.map(p=>new E.Vector3(...p)))
    const geo = new E.TubeGeometry(curve, 12, r, 5, false)
    parts.push({bone:b,name:n,geo,surface:dark,matrix:new E.Matrix4(),unique:true})
  }
  // Dome and facial architecture, sockets sit in front of the recessed cranium.
  ball(head,'Polished cranium',[.145,.175,.126],[0,.064,-.025])
  plate(head,'Frontal brow bridge',[.054,.055,.063],[0,.033,.104],chrome)
  for (const sign of [-1,1]) {
    ball(head,'Deep orbital recess',[.061,.036,.02],[sign*.069,.003,.119],dark)
    add(head,'Angular orbital rim',ringGeo,steel,[sign*.069,.004,.125],[.051,.037,.04],[0,0,sign*.12])
    plate(head,'Angled brow',[.108,.026,.039],[sign*.068,.036,.137],chrome,[0,0,sign*.17])
    plate(head,'Sharp cheekbone',[.047,.075,.037],[sign*.107,-.05,.103],chrome,[0,sign*.4,sign*-.28])
    rod(head,'Jaw hinge pin',[sign*.14,-.052,.003],[sign*.114,-.052,.003],.027,edge)
    plate(jaw,'Mandible ramus',[.037,.091,.056],[sign*.101,-.042,.044],steel,[.25,0,sign*-.18])
    box(jaw,'Mandible rail',[.033,.026,.122],[sign*.078,-.09,.066],chrome)
  }
  plate(head,'Nasal blade',[.028,.057,.038],[0,-.026,.135],steel)
  box(head,'Nasal cavity',[.032,.024,.011],[0,-.045,.16],dark)
  plate(head,'Upper maxilla',[.16,.028,.051],[0,-.073,.103],steel)
  plate(jaw,'Chin',[.163,.039,.062],[0,-.099,.126],chrome)
  box(head,'Mouth recess',[.169,.048,.018],[0,-.097,.114],dark)
  for (let i=0;i<10;i++) {
    const x=(i-4.5)*.0157, z=.142-Math.abs(x)*.18
    box(head,'Upper exposed tooth',[.0127,.018,.02],[x,-.085,z],chrome)
    box(jaw,'Lower exposed tooth',[.0127,.015,.021],[x,-.061,z],chrome)
  }
  const eyes = new E.Group(); eyes.name='Eye Emitters'; head.add(eyes)
  for (const sign of [-1,1]) {
    const eye=new E.Mesh2(new E.SphereGeometry(.014,10,6),materials.eye)
    eye.name=sign<0?'Eye Left':'Eye Right'; eye.position.set(sign*.069,.003,.148); eye.scale.set(1,.7,.6); eyes.add(eye)
    const halo=new E.Mesh2(new E.PlaneGeometry(.11,.11),materials.halo)
    halo.name='Eye Bloom'; halo.position.copy(eye.position); halo.position.z+=.013; eyes.add(halo)
  }
  rod(neck,'Cervical column',[0,0,0],[0,.14,0],.027,steel)
  for(let i=0;i<3;i++) ring(neck,'Cervical ring',.038,[0,.025+i*.035,0],edge,[Math.PI/2,0,0])
  for(const sign of [-1,1]) {
    rod(neck,'Neck actuator',[sign*.054,0,.023],[sign*.04,.105,.034],.019,chrome)
    cable(chest,'Skull shoulder cable',[[sign*.065,.4,-.04],[sign*.13,.28,-.09],[sign*.28,.26,-.07],[sign*.37,.18,-.02]])
    cable(chest,'Collar hose',[[sign*.1,.25,.04],[sign*.23,.29,.06],[sign*.29,.15,.13],[sign*.13,.08,.13]])
    rod(chest,'Collar rail',[sign*.035,.205,.095],[sign*.315,.19,.025],.024,chrome)
    rod(chest,'Lower crossbar',[sign*.035,.145,.11],[sign*.27,.12,.10],.017,steel)
    // Exposed oblique rib pistons and dark gaps between rib plates.
    for(let i=0;i<4;i++) {
      const y=.115-i*.057
      rod(chest,'Rib hydraulic',[sign*.12,y,.02],[sign*(.265-i*.018),y+.029,.025],.025*bulk,steel)
      rod(chest,'Rib piston rod',[sign*.12,y,.025],[sign*.05,y-.035,.085],.012,chrome)
    }
    if(!scout) {
      plate(chest,'Pectoral angular armor',[.255*bulk,.125,.056*bulk],[sign*.158,.106,.135],steel,[0,sign*.2,sign*.12])
      plate(chest,'Lower chest armor',[.205*bulk,.073,.044],[sign*.145,-.002,.128],edge,[0,sign*.15,sign*-.13])
      if(heavy) plate(chest,'Overlapping heavy breastplate',[.26,.16,.06],[sign*.17,.10,.192],steel,[0,sign*.18,sign*.1])
    }
  }
  for(let i=0;i<6;i++) box(chest,'Ribbed sternum',[.066,.018,.044],[0,.18-i*.035,.152],edge)
  if(!scout) {
    // Open rectangular plate assembled around four real empty rectangular slots.
    box(chest,'Chest plate upper',[.30,.019,.028],[0,.196,.172],steel)
    box(chest,'Chest plate lower',[.30,.019,.028],[0,.151,.172],steel)
    for(let i=0;i<5;i++) box(chest,'Chest plate slot divider',[.023,.047,.03],[-.138+i*.069,.174,.174],chrome)
  }
  rod(spine,'Lumbar spinal core',[0,-.08,-.025],[0,.3,-.025],.031,dark)
  for(let i=0;i<7;i++) ring(spine,'Lumbar vertebra',.052,[0,-.07+i*.047,-.024],chrome,[Math.PI/2,0,0])
  for(const sign of [-1,1]) {
    rod(spine,'Waist piston sleeve',[sign*.087,-.02,.027],[sign*.14,.17,.027],.026*bulk,steel)
    rod(spine,'Waist piston shaft',[sign*.07,-.105,.027],[sign*.087,.07,.027],.013,chrome)
    plate(pelvis,'Flared iliac plate',[.20*bulk,.17,.081],[sign*.132,.005,0],steel,[0,0,sign*-.25])
    plate(pelvis,'Pelvis bright edge',[.19*bulk,.034,.083],[sign*.136,.069,.004],edge,[0,0,sign*-.25])
  }
  plate(pelvis,'Sacrum',[.11,.145,.09],[0,-.045,.04],dark)
  // Limb segments retain the empty spaces characteristic of an endoskeleton.
  const segment=(b,n,length,radius)=>{
    rod(b,n+' core',[0,-.03,0],[0,-length+.02,0],radius*.42,dark)
    for(const sign of [-1,1]) {
      rod(b,n+' piston sleeve',[sign*radius*.78,-.035,.015],[sign*radius*.78,-length*.63,.015],radius*.35,steel)
      rod(b,n+' exposed shaft',[sign*radius*.78,-length*.40,.015],[sign*radius*.78,-length+.023,.015],radius*.17,chrome)
      ring(b,n+' hydraulic seal',radius*.36,[sign*radius*.78,-length*.59,.015],dark,[Math.PI/2,0,0])
    }
    box(b,n+' brace',[radius*2,.025,radius*.72],[0,-length*.22,-.005],edge)
  }
  for(const [side,sign] of [['Left',-1],['Right',1]]) {
    const shoulder=joint('Shoulder '+side,chest,[sign*(heavy?.37:scout?.28:.32),.19,0])
    ball(shoulder,'Spherical shoulder',[.092*bulk,.092*bulk,.09*bulk],[0,0,0],chrome)
    rod(shoulder,'Shoulder disc',[sign*.063,0,0],[sign*.12*bulk,0,0],.087*bulk,steel)
    ring(shoulder,'Shoulder disc rim',.077*bulk,[sign*.123*bulk,0,0],chrome,[0,Math.PI/2,0])
    if(heavy) {
      plate(shoulder,'Heavy shoulder armor',[.23,.095,.26],[0,.085,0],steel)
      plate(shoulder,'Doubled shoulder armor',[.26,.065,.29],[0,.137,0],edge)
    }
    const arm=joint('Upper Arm '+side,shoulder,[0,-.034,0])
    const al=scout?.37:.31, fl=scout?.38:.32
    segment(arm,'Humerus',al,.066*bulk)
    const fore=joint('Forearm '+side,arm,[0,-al,0])
    rod(fore,'Elbow axle',[-.076*bulk,0,0],[.076*bulk,0,0],.053,steel)
    ring(fore,'Elbow disc',.047,[sign*.077*bulk,0,0],chrome,[0,Math.PI/2,0])
    segment(fore,'Radius ulna',fl,.061*bulk)
    const hand=joint('Hand '+side,fore,[0,-fl,0])
    ball(hand,'Wrist ball',[.035,.036,.035],[0,0,0],chrome)
    box(hand,'Metacarpal plate',[.091,.081,.034],[0,-.047,.007],steel)
    for(let f=0;f<4;f++) {
      const x=(f-1.5)*.024
      for(let k=0;k<3;k++) {
        const y=-.098-k*.032,z=.011+k*k*.007
        ball(hand,'Finger knuckle',[.012,.013,.012],[x,y,z],chrome)
        rod(hand,'Finger phalanx',[x,y,z],[x,y-.026,z+.009],.009,steel)
      }
    }
    rod(hand,'Thumb proximal',[sign*.05,-.03,.01],[sign*.067,-.077,.034],.013,steel)
    ball(hand,'Thumb knuckle',[.017,.017,.017],[sign*.067,-.077,.034])
    rod(hand,'Thumb distal',[sign*.067,-.077,.034],[sign*.041,-.108,.054],.011,chrome)
    const thigh=joint('Thigh '+side,pelvis,[sign*.14,-.07,0])
    ball(thigh,'Hip bearing',[.075*bulk,.075,.074],[0,0,0],chrome)
    segment(thigh,'Femur',.42,.081*bulk)
    const shin=joint('Shin '+side,thigh,[0,-.42,0])
    rod(shin,'Knee axle',[-.075,0,0],[.075,0,0],.064,steel)
    plate(shin,'Patella',[.094,.10,.043],[0,-.017,.058],chrome)
    segment(shin,'Tibia',.37,.069*bulk)
    const foot=joint('Foot '+side,shin,[0,-.37,0])
    ball(foot,'Ankle bearing',[.041,.038,.04],[0,0,0])
    plate(foot,'Heel',[.11,.061,.11],[0,-.04,-.016],steel)
    box(foot,'Foot bridge',[.10,.035,.16],[0,-.035,.077],dark)
    for(let i=0;i<4;i++) plate(foot,'Articulated toe',[.026,.03,.105],[(i-1.5)*.031,-.045,.16],chrome)
    if(side==='Right'&&!scout) {
      const gun=joint('Weapon',heavy?fore:hand,[0,heavy?-.23:-.11,heavy?.12:.055])
      // Rifle rests pointing forward along +Z; animation raises the forearm and counter-rotates it.
      if(heavy) {
        box(gun,'Minigun motor',[.19,.18,.25],[0,0,0],dark)
        rod(gun,'Minigun housing',[0,0,.05],[0,0,.23],.12,steel)
        const barrels=joint('Barrels',gun,[0,0,.13])
        for(let i=0;i<6;i++) {
          const a=i*Math.PI/3,x=Math.cos(a)*.072,y=Math.sin(a)*.072
          rod(barrels,'Rotary barrel',[x,y,0],[x,y,.57],.022,steel)
          ring(barrels,'Barrel bore',.015,[x,y,.579],dark)
        }
        ring(barrels,'Barrel front collar',.099,[0,0,.48],edge)
        ring(barrels,'Barrel rear collar',.098,[0,0,.11],steel)
        const muzzle=joint('Muzzle',gun,[0,0,.74]); muzzle.userData.unitMuzzle=true
        const heat=new E.Mesh2(new E.PlaneGeometry(.25,.25),materials.halo)
        heat.name='Muzzle Heat'; heat.visible=false; muzzle.add(heat)
      } else {
        box(gun,'Plasma grip',[.061,.14,.074],[0,.055,-.035],dark,[.2,0,0])
        plate(gun,'Plasma receiver',[.13,.16,.30],[0,.14,.038],dark)
        box(gun,'Receiver bright seam',[.135,.015,.29],[0,.20,.038],steel)
        box(gun,'Plasma shroud',[.116,.105,.36],[0,.16,.35],steel)
        box(gun,'Plasma barrel recess',[.081,.067,.372],[0,.16,.36],dark)
        for(let i=0;i<8;i++) box(gun,'Heat sink fin',[.14,.014,.027],[0,.224,.2+i*.042],edge)
        for(const s of [-1,1]) for(let i=0;i<5;i++) box(gun,'Shroud vent',[.006,.048,.027],[s*.061,.158,.24+i*.05],dark)
        box(gun,'Squared muzzle',[.148,.132,.061],[0,.16,.559],dark)
        ring(gun,'Plasma aperture',.031,[0,.16,.594],steel)
        const muzzle=joint('Muzzle',gun,[0,.16,.603]); muzzle.userData.unitMuzzle=true
      }
    }
  }
  root.updateMatrixWorld(true)
  const positions=[],normals=[],uvs=[],colors=[],roughness=[],indices=[],weights=[]
  for(const part of parts) {
    const source=part.geo.index?part.geo.toNonIndexed():part.geo.clone()
    source.applyMatrix4(new E.Matrix4().multiplyMatrices(part.bone.matrixWorld,part.matrix))
    const p=source.attributes.position,n=source.attributes.normal,uv=source.attributes.uv
    const color=new E.Color(part.surface[0]), id=bones.indexOf(part.bone)
    for(let i=0;i<p.count;i++) {
      positions.push(p.getX(i),p.getY(i),p.getZ(i)); normals.push(n.getX(i),n.getY(i),n.getZ(i)); uvs.push(uv?.getX(i)||0,uv?.getY(i)||0)
      colors.push(color.r,color.g,color.b); roughness.push(part.surface[1]); indices.push(id,0,0,0); weights.push(1,0,0,0)
    }
    source.dispose(); if(part.unique) part.geo.dispose()
  }
  for(const geo of [boxGeo,sphereGeo,cylGeo,ringGeo,plateGeo]) geo.dispose()
  const geometry=new E.BufferGeometry()
  for(const [name,array,size] of [['position',positions,3],['normal',normals,3],['uv',uvs,2],['color',colors,3],['unitRoughness',roughness,1],['skinWeight',weights,4]]) geometry.setAttribute(name,new E.Float32BufferAttribute(array,size))
  geometry.setAttribute('skinIndex',new E.Uint16BufferAttribute(indices,4))
  const mesh=new E.SkinnedMesh(geometry,materials.metal)
  mesh.name='Combined articulated steel'; mesh.frustumCulled=false
  root.add(mesh); mesh.bind(new E.Skeleton(bones))
  root.scale.setScalar(scout?.93:heavy?1.13:1)
  root.userData.unitAnatomy={parts:parts.length,triangles:positions.length/9,joints:bones.map(b=>b.name),textureBytes:materials.textureBytes}
  return root
}
