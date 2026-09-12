import {rosterMaterials} from './roster-materials.js'

// All opaque parts share one rigid skin. UV quadrants select the shared finish atlas.
function builder(E,type,detail,materials) {
  const root=new E.Group(),bones=[],parts=[],glows=[],m=materials||rosterMaterials(E)
  root.name=type==='t1000'?'T-1000 liquid infiltrator':type==='hkaerial'?'HK-Aerial gunship':'HK-Tank siege chassis'
  root.userData.unitTemplateType=type
  const joint=(name,parent,p=[0,0,0])=>{const b=new E.Bone();b.name=name;b.position.set(...p);b.userData.unitJoint=true;(parent||root).add(b);bones.push(b);return b}
  const add=(bone,geometry,p,s,tile=0,rotation=[0,0,0],light=false)=>{
    const t=new E.Object3D();t.position.set(...p);t.scale.set(...s);t.rotation.set(...rotation);t.updateMatrix()
    ;(light?glows:parts).push({bone,geometry,matrix:t.matrix,tile})
  }
  const ball=(b,p,s,t=0,light=false)=>add(b,new E.SphereGeometry(1,detail?24:12,detail?16:8),p,s,t,[0,0,0],light)
  const box=(b,p,s,t=0,r=[0,0,0],light=false)=>add(b,bevelBox(E,detail),p,s,t,r,light)
  const cyl=(b,p,s,t=1,r=[0,0,0],light=false)=>add(b,new E.CylinderGeometry(1,1,1,detail?24:12),p,s,t,r,light)
  const ring=(b,p,r,t=1,rot=[0,0,0])=>add(b,new E.TorusGeometry(1,.1,detail?6:4,detail?32:16),p,[r,r,r],t,rot)
  const loft=(b,p,profile,zScale=1,t=0)=>{
    const curve=new E.CatmullRomCurve3(profile.map(([r,y])=>new E.Vector3(r,y,0)),false,'centripetal')
    const small=profile.every(([r])=>r<.02)
    const points=curve.getPoints(small?6:detail?20:12).map(v=>new E.Vector2(Math.max(0,v.x),v.y))
    add(b,new E.LatheGeometry(points,small?8:detail?24:14),p,[1,1,zScale],t)
  }
  function skin(list,material,name){
    const a={position:[],normal:[],uv:[],skinIndex:[],skinWeight:[]},matrix=new E.Matrix4()
    for(const part of list){
      const g=part.geometry.index?part.geometry.toNonIndexed():part.geometry.clone()
      g.applyMatrix4(matrix.multiplyMatrices(part.bone.matrixWorld,part.matrix))
      const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv,id=bones.indexOf(part.bone)
      let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity
      for(let i=0;i<p.count;i++){u0=Math.min(u0,uv.getX(i));u1=Math.max(u1,uv.getX(i));v0=Math.min(v0,uv.getY(i));v1=Math.max(v1,uv.getY(i))}
      for(let i=0;i<p.count;i++){
        a.position.push(p.getX(i),p.getY(i),p.getZ(i));a.normal.push(n.getX(i),n.getY(i),n.getZ(i))
        const u=(uv.getX(i)-u0)/(u1-u0||1),v=(uv.getY(i)-v0)/(v1-v0||1)
        a.uv.push(type==='t1000'?u:part.tile%2*.5+.008+u*.484,type==='t1000'?v:(1-Math.floor(part.tile/2))*.5+.008+v*.484)
        a.skinIndex.push(id,0,0,0);a.skinWeight.push(1,0,0,0)
      }
      g.dispose();part.geometry.dispose()
    }
    const geo=new E.BufferGeometry()
    for(const [key,size]of [['position',3],['normal',3],['uv',2],['skinWeight',4]])geo.setAttribute(key,new E.Float32BufferAttribute(a[key],size))
    geo.setAttribute('skinIndex',new E.Uint16BufferAttribute(a.skinIndex,4));geo.computeBoundingBox()
    const mesh=new E.SkinnedMesh(geo,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true
    mesh.boundingSphere=new E.Sphere(new E.Vector3(0,type==='hkaerial'?.5:1,0),type==='t1000'?2.1:3.7)
    root.add(mesh);mesh.bind(new E.Skeleton(bones));return mesh
  }
  function finish(){
    root.updateMatrixWorld(true)
    const mesh=skin(parts,type==='t1000'?m.chrome:m.armor,'Combined articulated steel')
    if(glows.length){const light=skin(glows,m.light,'Roster running lights');light.castShadow=false}
    root.userData.unitAnatomy={triangles:mesh.geometry.attributes.position.count/3,parts:parts.length,joints:bones.map(b=>b.name)}
    for(const bone of bones)if(bone.userData.rosterBlade)bone.scale.setScalar(.00001)
    root.userData.roster=true
    return root
  }
  return {E,root,bones,joint,add,box,ball,cyl,ring,loft,finish}
}

function bevelBox(E,detail){
  const s=new E.Shape(),c=.09
  s.moveTo(-.5+c,-.5);s.lineTo(.5-c,-.5);s.lineTo(.5,-.5+c);s.lineTo(.5,.5-c)
  s.lineTo(.5-c,.5);s.lineTo(-.5+c,.5);s.lineTo(-.5,.5-c);s.lineTo(-.5,-.5+c);s.closePath()
  const g=new E.ExtrudeGeometry(s,{depth:.88,bevelEnabled:true,bevelThickness:.06,bevelSize:.015,bevelSegments:detail?2:1,steps:1})
  g.translate(0,0,-.44);g.scale(1/1.03,1/1.03,1);return g
}

export function createRosterFigure(E,type,{detail=1,materials}={}) {
  const b=builder(E,type,detail,materials)
  if(type==='t1000')human(b)
  else vehicle(b,type)
  return b.finish()
}

function human(b){
  const {E,root,joint,ball,box,loft,add}=b
  const pelvis=joint('Pelvis',null,[0,.94,0]),spine=joint('Spine',pelvis,[0,.12,0]),chest=joint('Chest',spine,[0,.28,0])
  const neck=joint('Neck',chest,[0,.29,-.025]),head=joint('Head',neck,[0,.12,0]);joint('Jaw',head,[0,-.055,-.012])
  const eyes=new E.Group();eyes.name='Eye Emitters';head.add(eyes)
  loft(pelvis,[0,-.11,.015],[[0,0],[.12,.005],[.225,.055],[.24,.12],[.2,.2],[0,.21]],.36)
  loft(spine,[0,-.095,0],[[.175,0],[.16,.06],[.165,.19],[.205,.40]],.46)
  loft(chest,[0,-.105,.014],[[.19,0],[.235,.07],[.278,.22],[.285,.3],[.23,.355],[.085,.39]],.48)
  loft(neck,[0,-.06,0],[[.078,0],[.067,.08],[.065,.17]],.85)
  // Sculpt a single closed head by deforming a smooth ellipsoid. Nose, brows, cheeks and lips share its surface.
  const face=new E.SphereGeometry(1,48,32),p=face.attributes.position
  for(let i=0;i<p.count;i++){
    let x=p.getX(i)*.135,y=p.getY(i)*.174,z=p.getZ(i)*.119
    if(z>0){
      const front=Math.max(0,p.getZ(i)),gauss=(cx,cy,sx,sy)=>Math.exp(-(((x-cx)/sx)**2+((y-cy)/sy)**2))
      z+=front*(.066*gauss(0,-.015,.026,.065)+.023*gauss(0,-.071,.051,.014)+.016*gauss(0,-.108,.056,.03))
      z+=front*(.014*gauss(-.068,.045,.05,.018)+.014*gauss(.068,.045,.05,.018))
      z-=front*(.022*gauss(-.06,.015,.039,.021)+.022*gauss(.06,.015,.039,.021))
    }
    p.setXYZ(i,x,y+.04,z-.016)
  }
  face.computeVertexNormals();add(head,face,[0,0,0],[1,1,1])
  for(const sign of [-1,1]){
    ball(head,[sign*.131,.017,-.018],[.023,.044,.02])
    box(chest,[sign*.064,.274,.127],[.10,.10,.014],0,[0,0,sign*-.35])
    box(chest,[sign*.14,.155,.148],[.115,.108,.012])
    box(chest,[sign*.14,.207,.152],[.12,.018,.016])
  }
  box(chest,[0,.06,.151],[.014,.27,.012]);box(pelvis,[0,.075,.012],[.444,.038,.161])
  box(pelvis,[0,.075,.101],[.065,.045,.014])
  for(const [side,sign]of [['Left',-1],['Right',1]]){
    const shoulder=joint('Shoulder '+side,chest,[sign*.32,.19,0]),arm=joint('Upper Arm '+side,shoulder,[0,-.034,0])
    ball(shoulder,[0,-.015,0],[.105,.098,.089]);ball(arm,[0,.035,0],[.083,.105,.09])
    loft(arm,[0,-.32,0],[[.064,0],[.069,.06],[.085,.20],[.091,.28],[.067,.34]],1.08)
    const fore=joint('Forearm '+side,arm,[0,-.31,0]),hand=joint('Hand '+side,fore,[0,-.32,0])
    ball(fore,[0,0,0],[.063,.062,.063]);loft(fore,[0,-.32,0],[[.038,0],[.047,.07],[.067,.23],[.065,.33]],1.05)
    // Palm and blade are independent bones, so the hand can continuously become the blade without allocating meshes.
    const palm=joint('Palm '+side,hand),blade=joint('Blade '+side,hand)
    ball(palm,[0,-.047,.011],[.047,.063,.029])
    for(let f=0;f<4;f++)loft(palm,[(f-1.5)*.022,-.153,.015],[[.004,0],[.009,.01],[.01,.072],[.008,.084]],1)
    ball(palm,[sign*.035,-.026,sign<0?.053:.114],[.025,.05,.065])
    const shape=new E.Shape();shape.moveTo(-.042,0);shape.bezierCurveTo(-.092,-.20,-.042,-.53,0,-.75);shape.bezierCurveTo(.03,-.53,.064,-.12,.042,0);shape.closePath()
    const bladeGeo=new E.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelThickness:.009,bevelSize:.005,bevelSegments:2,steps:1,curveSegments:12});bladeGeo.translate(0,0,-.006)
    add(blade,bladeGeo,[0,0,.01],[1,1,1]);blade.userData.rosterBlade=true
    const thigh=joint('Thigh '+side,pelvis,[sign*.14,-.07,0]),shin=joint('Shin '+side,thigh,[0,-.42,0]),foot=joint('Foot '+side,shin,[0,-.37,0])
    ball(thigh,[0,.03,0],[.12,.075,.105])
    loft(thigh,[0,-.425,0],[[.073,0],[.085,.08],[.12,.30],[.12,.425]],.96)
    ball(shin,[0,0,0],[.074,.07,.074]);loft(shin,[0,-.38,.015],[[.062,0],[.074,.10],[.089,.26],[.072,.39]],1.02)
    ball(foot,[0,-.039,.068],[.084,.039,.145])
    box(foot,[0,-.062,.068],[.166,.022,.29])
  }
  root.userData.rosterBody='liquid'
}

function vehicle(b,type){
  const {E,root,joint,box,ball,cyl,ring,add}=b,aerial=type==='hkaerial'
  const pelvis=joint('Pelvis'),spine=joint('Spine',pelvis),chest=joint('Chest',spine),head=joint('Head',chest)
  const eyes=new E.Group();eyes.name='Eye Emitters';head.add(eyes)
  const hull=joint('Hull',null,[0,aerial?.6:1.017,0])
  if(aerial){
    // Broad flattened prow and thin extensions retain the phase-one collision dimensions.
    add(hull,armorShell(E),[0,0,0],[1.45,.50,1.65]);add(hull,armorShell(E),[0,.195,-.05],[1.11,.09,1.35],0)
    box(hull,[0,-.13,.72],[.64,.16,.17],2)
    for(const [side,sign]of [['Left',-1],['Right',1]]){
      const wing=joint('Wing '+side,null,[sign*1.25,.65,0])
      add(wing,armorShell(E),[0,0,0],[1.55,.12,.72]);box(wing,[sign*.13,.042,-.09],[1.15,.026,.35],0)
      box(wing,[sign*.71,.07,-.21],[.11,.055,.09],1,[0,0,0],true)
      const thruster=joint('Thruster '+side,null,[sign*.62,.42,-.45])
      cyl(thruster,[0,0,0],[.24,.43,.24],0);ring(thruster,[0,.2,0],.232,1,[Math.PI/2,0,0]);ring(thruster,[0,-.20,0],.24,1,[Math.PI/2,0,0])
      cyl(thruster,[0,.22,0],[.193,.012,.193],2)
      const intake=joint('Intake '+side,thruster,[0,.228,0])
      for(let i=0;i<10;i++)box(intake,[Math.sin(i*Math.PI/5)*.1,0,Math.cos(i*Math.PI/5)*.1],[.035,.008,.17],1,[0,i*Math.PI/5,.1])
      cyl(thruster,[0,-.205,0],[.17,.018,.17],1,[0,0,0],true)
      for(let i=0;i<8;i++){const a=i*Math.PI/4;box(thruster,[Math.sin(a)*.234,0,Math.cos(a)*.234],[.03,.28,.02],1,[0,a,0])}
      box(hull,[sign*.27,-.12,.79],[.14,.1,.025],1,[0,0,0],true)
      for(let i=0;i<6;i++)box(hull,[sign*.32,.258,-.44+i*.11],[.23,.013,.035],2)
    }
    const turret=joint('Turret',null,[0,.32,0]);ball(turret,[0,0,0],[.34,.34,.34],1)
    cyl(turret,[0,0,.48],[.07,.75,.07],2,[Math.PI/2,0,0]);ring(turret,[0,0,.853],.058,1)
    joint('Muzzle',turret,[0,0,.86]);joint('Searchlight',turret,[0,-.22,.18])
  }else{
    add(hull,slopeHull(E),[0,0,0],[2.938,1.243,3.899]);add(hull,armorShell(E),[0,.51,-.1],[2.55,.20,3.28],0)
    box(hull,[0,-.16,1.82],[1.25,.68,.30],2)
    for(const [side,sign]of [['Left',-1],['Right',1]]){
      const tread=joint('Tread '+side,null,[sign*1.639,.542,0])
      add(tread,trackBelt(E),[0,0,0],[1,1,1],3)
      box(tread,[0,.35,0],[.66,.10,3.23],0)
      for(let i=0;i<7;i++){
        cyl(tread,[sign*.34,-.005,-1.52+i*.507],[.28,.025,.28],2,[0,0,Math.PI/2])
        cyl(tread,[sign*.358,-.005,-1.52+i*.507],[.16,.019,.16],2,[0,0,Math.PI/2])
      }
      box(hull,[sign*.68,.20,1.98],[.30,.16,.025],1,[0,0,0],true)
      for(let i=0;i<8;i++)box(hull,[sign*1.20,.32,-1.45+i*.34],[.25,.12,.22],0,[0,sign*-.18,0])
      box(hull,[sign*1.05,.633,-.47],[.39,.025,1.16],2)
      for(let i=0;i<10;i++)box(hull,[sign*1.05,.657,-.95+i*.107],[.35,.018,.025],1)
    }
    const turret=joint('Turret',null,[0,1.944,0])
    cyl(turret,[0,-.07,0],[1.017,.515,1.017],2);ring(turret,[0,-.235,0],.935,1,[Math.PI/2,0,0])
    add(turret,armorShell(E),[0,.055,0],[1.92,.50,1.92],0)
    box(turret,[0,.23,-.03],[1.43,.18,1.33],0)
    for(const sign of [-1,1]){
      box(turret,[sign*.79,.01,.04],[.29,.44,.94]);
      for(let i=0;i<6;i++)box(turret,[sign*.89,.12,-.45+i*.14],[.07,.17,.045],1);
      box(turret,[sign*.53,.335,.45],[.14,.045,.08],1,[0,0,0],true)
    }
    const cannon=joint('Cannon',turret,[0,.135,0])
    cyl(cannon,[0,0,.24],[.145,.34,.145],2,[Math.PI/2,0,0])
    // Both recoiling barrels fit the existing central Cannon cylinder.
    for(const [side,sign]of [['Left',-1],['Right',1]]){
      const barrel=joint('Cannon '+side,cannon,[sign*.091,0,0])
      cyl(barrel,[0,0,1.3],[.081,2.543,.081],1,[Math.PI/2,0,0])
      for(let i=0;i<7;i++)ring(barrel,[0,0,.25+i*.20],.082,2)
      cyl(barrel,[0,0,2.568],[.061,.008,.061],2,[Math.PI/2,0,0])
      cyl(barrel,[0,0,2.574],[.027,.005,.027],1,[Math.PI/2,0,0],true)
    }
    joint('Muzzle',cannon,[0,0,2.58])
    const core=joint('Core',null,[0,1.187,-2.011]);ball(core,[0,0,0],[.339,.339,.339],1,true)
    for(let i=0;i<3;i++)ring(core,[0,0,0],.30+i*.008,1,[0,i*Math.PI/3,0])
  }
  root.userData.rosterBody=aerial?'aerial':'tank'
}

function armorShell(E){
  const s=new E.Shape(),points=[[-.46,-.36],[-.31,-.48],[.31,-.48],[.46,-.36],[.48,.12],[.31,.43],[.16,.48],[-.16,.48],[-.31,.43],[-.48,.12]]
  points.forEach(([x,y],i)=>i?s.lineTo(x,y):s.moveTo(x,y));s.closePath()
  const g=new E.ExtrudeGeometry(s,{depth:.68,bevelEnabled:true,bevelSize:.02,bevelThickness:.16,bevelSegments:2,steps:1})
  g.translate(0,0,-.34);g.rotateX(Math.PI/2);return g
}
function trackBelt(E){
  const s=new E.Shape(),h=.407,z=1.6835
  s.moveTo(-z,-h);s.lineTo(z,-h);s.absarc(z,0,h,-Math.PI/2,Math.PI/2,false);s.lineTo(-z,h);s.absarc(-z,0,h,Math.PI/2,Math.PI*1.5,false)
  const hole=new E.Path(),r=.27
  hole.moveTo(-z,-r);hole.absarc(-z,0,r,-Math.PI/2,-Math.PI*1.5,true);hole.lineTo(z,r);hole.absarc(z,0,r,Math.PI/2,-Math.PI/2,true);hole.closePath();s.holes.push(hole)
  const g=new E.ExtrudeGeometry(s,{depth:.701,bevelEnabled:false,curveSegments:16,steps:1});g.translate(0,0,-.3505);g.rotateY(Math.PI/2)
  const p=g.attributes.position,uv=g.attributes.uv,total=4*z+2*Math.PI*h
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),along=p.getZ(i)
    const distance=along>z?2*z+Math.atan2(along-z,y)*h:along<-z?4*z+Math.PI*h+(Math.atan2(along+z,y)+Math.PI)*h:y>=0?along+z:2*z+Math.PI*h+z-along
    uv.setXY(i,(x+.3505)/.701,distance/total)
  }
  return g
}

function slopeHull(E){
  const rings=[[-.50,.80],[-.33,1],[.13,1],[.50,.87]],outline=[[-.5,-.39],[-.35,-.5],[.35,-.5],[.5,-.39],[.5,.32],[.31,.5],[-.31,.5],[-.5,.32]],p=[],uv=[]
  const point=(j,i)=>[outline[i%8][0]*rings[j][1],rings[j][0],outline[i%8][1]*rings[j][1]]
  const tri=(a,b,c,coords)=>{
    const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
    if(n.reduce((sum,x,i)=>sum+x*(a[i]+b[i]+c[i]),0)<0){p.push(...a,...c,...b);uv.push(...coords.slice(0,2),...coords.slice(4),...coords.slice(2,4))}
    else{p.push(...a,...b,...c);uv.push(...coords)}
  }
  for(let j=0;j<3;j++)for(let i=0;i<8;i++){
    const a=point(j,i),b=point(j,i+1),c=point(j+1,i+1),d=point(j+1,i)
    tri(a,b,c,[0,0,1,0,1,1]);tri(a,c,d,[0,0,1,1,0,1])
  }
  for(let i=1;i<7;i++){tri(point(3,0),point(3,i+1),point(3,i),[0,0,1,1,0,1]);tri(point(0,0),point(0,i),point(0,i+1),[0,0,0,1,1,1])}
  const g=new E.BufferGeometry();g.setAttribute('position',new E.Float32BufferAttribute(p,3));g.setAttribute('uv',new E.Float32BufferAttribute(uv,2));g.computeVertexNormals();return g
}
