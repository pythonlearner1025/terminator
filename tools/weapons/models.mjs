import {T,Parts,group,bolt,rail,trigger,sights} from './geometry.mjs'
export const IDS=['pistol','m4','shotgun','plasma','knife','grenade','sniper','launcher']
export function buildWeapon(id) {
  const root=group(`${id} Asset`),body=group('Body',root),b=new Parts()
  const action=group(id==='pistol'?'Hammer':id==='grenade'?'Lever':'Bolt',body)
  const magazine=group(id==='pistol'?'Cylinder':id==='grenade'?'Pin':'Magazine',body)
  const pump=group('Pump',body)
  let muzzle=[0,0,-.3],sight,grip={position:[0,-.071,.027],radius:[.024,.055,.029]},support={position:[0,-.026,-.30],radius:[.029,.025,.075]},hip=[.15,-.17,-.46],fov=54
  if(id==='pistol') {
    const frame=group('Frame',body),barrel=group('OctagonalBarrel',body),lever=group('LoadingLever',body),wood=group('Grip',body)
    // An actual open cylinder frame with a continuous top strap.
    b.profile(frame,[[.033,-.025],[.023,.052],[-.083,.052],[-.094,.045],[-.085,.039],[-.080,.045],[.007,.045],[.012,-.019]],.032,[0,0,0],'steel',.0018)
    b.profile(frame,[[-.09,-.034],[.019,-.034],[.032,-.019],[.017,-.008],[.010,-.022],[-.083,-.022]],.032,[0,0,0],'steel')
    b.profile(frame,[[.018,.029],[.034,.017],[.038,-.018],[.006,-.031],[.002,.030]],.027,[0,0,0],'steel')
    b.rod(frame,.031,.005,[0,.013,-.018],'steel',undefined,40)
    // 203 mm octagonal barrel. Eight broad flats and two chamfered end rings.
    b.tube(barrel,.0178,.0056,.203,[0,.027,-.1935],'steel',8)
    b.tube(barrel,.0157,.0056,.002,[0,.027,-.296],'edge',8)
    b.box(lever,[.010,.012,.126],[0,-.011,-.174],'steel',[0,0,0],.002)
    b.profile(lever,[[-.249,-.004],[-.238,-.019],[-.119,-.021],[-.098,-.036],[-.081,-.028],[-.107,-.006]],.012,[0,0,0],'steel',.001)
    b.rod(lever,.007,.038,[0,-.016,-.104],'edge',[0,0,Math.PI/2],16)
    b.box(lever,[.009,.008,.017],[0,-.004,-.254],'edge')
    // Flutes are modelled as a shallow radial depression, with open chamber mouths.
    const r=.030,L=.053,n=96,positions=[],uv=[],indices=[]
    for(let j=0;j<=6;j++)for(let i=0;i<=n;i++){
      const a=i/n*Math.PI*2,flute=Math.max(0,Math.cos(a*6))**6*.0038*Math.sin(j/6*Math.PI),rr=r-flute
      positions.push(Math.sin(a)*rr,.013+Math.cos(a)*rr,-.052+(j/6-.5)*L);uv.push(i/n,j/6)
      if(i<n&&j<6){const q=j*(n+1)+i;indices.push(q,q+n+1,q+1,q+1,q+n+1,q+n+2)}
    }
    const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();b.add(magazine,geo,'steel')
    for(const z of [-.025,-.079]) {
      b.rod(magazine,.010,.004,[0,.013,z],'steel')
      for(let i=0;i<6;i++){
        const a=i/6*Math.PI*2,x=Math.sin(a)*.020,y=.013+Math.cos(a)*.020
        b.tube(magazine,.010,.0062,.006,[x,y,z],z>-.05?'brass':'steel',16)
        b.rod(magazine,.0061,.001,[x,y,z+(z>-.05?-.004:.004)],'dark',undefined,12)
      }
      b.ring(magazine,.029,.0014,[0,.013,z],'edge')
    }
    b.profile(action,[[.021,.034],[.035,.047],[.036,.058],[.055,.067],[.058,.060],[.047,.054],[.048,.041]],.010,[0,0,0],'edge',.001)
    for(let i=0;i<4;i++)b.box(action,[.014,.001,.0016],[0,.062,.049+i*.002],'dark')
    // Curved walnut panels with a flared heel and a narrow frame web.
    b.profile(wood,[[.014,-.032],[.035,-.031],[.049,-.051],[.061,-.087],[.071,-.122],[.017,-.126],[.010,-.106],[.023,-.064]],.031,[0,0,0],'wood',.006)
    b.profile(frame,[[.025,-.026],[.040,-.034],[.059,-.084],[.073,-.122],[.067,-.128],[.058,-.090],[.034,-.046],[.020,-.037]],.031,[0,0,0],'steel',.001)
    for(const x of [-.020,.020])bolt(b,wood,x,-.084,.039,.0037)
    trigger(b,body,-.009,-.036,true)
    const sightParts=group('Sights',body)
    b.box(sightParts,[.0028,.008,.009],[0,.049,-.282],'edge',undefined,.0004)
    for(const x of [-.0035,.0035])b.box(sightParts,[.003,.005,.012],[x,.0505,.014],'steel',undefined,.0003)
    sight={height:.053,distance:.33,front:-.282,rear:.014}
    for(const x of [-.019,.019]){bolt(b,frame,x,-.015,.024);bolt(b,frame,x,.026,.026,.0027)}
    b.box(barrel,[.00025,.010,.105],[.0169,.025,-.171],'mark',[0,0,0],.00001)
    grip={position:[0,-.079,.040],radius:[.021,.046,.027]};support={position:[0,-.118,.041],radius:[.025,.011,.026]}
    muzzle=[0,.027,-.297];hip=[.125,-.072,-.56];fov=52
  } else if(['m4','shotgun','sniper','plasma'].includes(id)) {
    const shotgun=id==='shotgun',sniper=id==='sniper',plasma=id==='plasma'
    const receiver=group('Receiver',body),barrel=group('Barrel',body),stock=group('Stock',body),guard=group('Handguard',body),handle=group('Grip',body)
    const rear=.07,front=sniper?-.23:plasma?-.22:-.15
    if(id==='m4'){
      b.profile(receiver,[[.062,.010],[-.128,.010],[-.145,-.018],[-.126,-.045],[-.060,-.042],[-.044,-.022],[.052,-.018]],.038,[0,0,0],'steel',.002)
      b.rod(receiver,.020,.208,[0,.028,-.039],'steel',undefined,32)
      b.box(receiver,[.032,.009,.203],[0,.045,-.037],'steel',undefined,.002)
    }else{
      b.profile(receiver,[[rear,-.017],[rear,.026],[.037,shotgun?.033:.049],[front+.025,shotgun?.033:.049],[front,.026],[front,-.023],[-.080,-.030],[-.065,-.019]],plasma?.071:.050,[0,0,0],'steel',.003)
      if(shotgun)b.rod(receiver,.026,.203,[0,.022,-.039],'steel',undefined,32)
    }
    b.profile(handle,[[.009,-.022],[.040,-.025],[.071,-.135],[.027,-.146],[-.005,-.058]],.034,[0,0,0],'polymer',.004)
    for(let i=0;i<5;i++)b.box(handle,[.038,.003,.023],[0,-.070-i*.012,.026+i*.004],'rubber',[-.24,0,0],.0005)
    trigger(b,body,-.017,-.039)
    const faceX=plasma?.037:id==='m4'?.021:.027
    b.box(receiver,[.001,.027,.069],[faceX,.018,-.035],'dark')
    b.box(action,[.002,.019,.048],[faceX+.001,.018,-.026],'edge')
    b.box(receiver,[.002,.004,.075],[faceX+.002,.001,-.035],'steel')
    b.box(receiver,[.002,.009,.071],[faceX+.006,-.006,-.035],'dark',[0,0,-.5])
    for(const x of [-faceX,faceX]){bolt(b,receiver,x,-.009,.037);bolt(b,receiver,x,-.018,-.078);bolt(b,receiver,x,.029,front+.020)}
    b.box(receiver,[.0003,.018,.095],[-faceX-.0003,.022,-.031],'mark',[0,0,0],.00001)
    if(shotgun) {
      b.tube(barrel,.013,.009,.47,[0,.030,-.370],'steel')
      b.rod(barrel,.013,.44,[0,-.010,-.355],'steel')
      b.rod(barrel,.015,.022,[0,-.010,-.571],'edge')
      b.box(barrel,[.030,.033,.015],[0,.010,-.571],'steel')
      b.rod(pump,.027,.168,[0,-.012,-.294],'polymer',undefined,32)
      for(let i=0;i<12;i++)b.ring(pump,.027,.0018,[0,-.012,-.373+i*.014],'rubber')
      b.box(pump,[.046,.020,.146],[0,-.029,-.294],'polymer')
      b.rod(action,.005,.037,[.039,.020,-.021],'edge',[0,0,Math.PI/2],16)
      b.rod(magazine,.009,.042,[0,-.090,-.087],'red');b.rod(magazine,.010,.009,[0,-.090,-.062],'brass')
      rail(b,receiver,-.13,.05,.057)
      b.rod(stock,.013,.16,[0,.003,.145],'steel')
      b.profile(stock,[[.11,-.012],[.13,.027],[.215,.026],[.229,-.072],[.181,-.068],[.155,-.025]],.036,[0,0,0],'polymer',.004)
      b.box(stock,[.047,.103,.019],[0,-.021,.235],'rubber',[.08,0,0],.004)
      sight=sights(b,body,-.573,.04,.072);muzzle=[0,.030,-.606];support={position:[0,-.012,-.296],radius:[.027,.027,.070]};fov=55
    } else if(sniper) {
      b.box(guard,[.073,.036,.27],[0,-.018,-.285],'steel',undefined,.004)
      for(const x of [-.037,.037])for(let i=0;i<9;i++){
        b.box(guard,[.002,.013,.012],[x,-.007,-.18-i*.027],'dark')
        b.box(guard,[.004,.003,.013],[x,-.015,-.18-i*.027],'edge')
      }
      rail(b,guard,-.437,-.12,.052,.048)
      b.tube(barrel,.010,.0038,.49,[0,.024,-.615],'steel')
      b.rod(barrel,.009,.28,[0,-.008,-.660],'dark')
      b.tube(barrel,.015,.005,.063,[0,.024,-.857],'dark')
      for(let i=0;i<4;i++)for(const x of [-.014,.014])b.box(barrel,[.002,.003,.027],[x,.024,-.856+i*.001],'edge')
      const bipod=group('Bipod',body)
      for(const x of [-.032,.032]){b.rod(bipod,.005,.18,[x,-.050,-.383],'steel');b.rod(bipod,.007,.025,[x,-.050,-.475],'rubber');bolt(b,bipod,x,-.045,-.30,.007)}
      b.box(magazine,[.040,.108,.087],[0,-.075,-.114],'steel',[-.08,0,0],.002)
      b.box(magazine,[.044,.010,.090],[0,-.128,-.110],'dark')
      for(const x of [-.021,.021])for(const z of [-.085,-.12,-.14])b.box(magazine,[.0015,.077,.003],[x,-.077,z],'edge')
      for(const x of [-.022,.022])b.rod(stock,.006,.20,[x,-.006,.165],'edge')
      b.box(stock,[.047,.025,.108],[0,.016,.180],'polymer',undefined,.005)
      b.box(stock,[.046,.10,.025],[0,-.025,.265],'rubber',undefined,.006)
      const optic=group('Scope',body)
      b.rod(optic,.018,.22,[0,.109,-.068],'dark',undefined,32)
      for(const z of [-.159,-.008]){b.box(optic,[.036,.025,.019],[0,.075,z],'steel');b.ring(optic,.020,.004,[0,.109,z],'steel')}
      for(const [z,r,l] of [[.064,.030,.05],[-.201,.036,.07]]){
        b.tube(optic,r,r*.82,l,[0,.109,z],'dark');b.rod(optic,r*.80,.001,[0,.109,z+(z>0?.02:-.032)],'glass',undefined,32)
        b.ring(optic,r-.001,.0014,[0,.109,z+(z>0?.025:-.036)],'edge')
      }
      for(const z of [.047,.057,.067,.077])b.ring(optic,.029,.0012,[0,.109,z],'polymer')
      b.rod(optic,.014,.036,[0,.132,-.080],'dark',[0,0,0]);b.rod(optic,.016,.012,[0,.155,-.080],'steel',[0,0,0])
      b.rod(optic,.013,.028,[.026,.109,-.08],'dark',[0,0,Math.PI/2])
      for(let i=0;i<12;i++){const a=i*Math.PI/6;b.box(optic,[.0017,.010,.0017],[Math.cos(a)*.016,.155,-.08+Math.sin(a)*.016],'edge')}
      sight={height:.109,distance:.28,scope:true};muzzle=[0,.024,-.89];support={position:[0,-.018,-.301],radius:[.036,.018,.08]};fov=52;hip=[.17,-.175,-.49]
    } else if(plasma) {
      b.box(guard,[.095,.079,.35],[0,.017,-.363],'dark',undefined,.007)
      const coils=group('Coils',body)
      for(const x of [-.052,.052]){
        b.rod(coils,.015,.29,[x,.028,-.361],'dark')
        for(let i=0;i<14;i++)b.ring(coils,.0165,.0023,[x,.028,-.22-i*.020],'brass')
        for(const z of [-.211,-.504])b.box(guard,[.025,.055,.019],[x,.026,z],'steel')
        for(let i=0;i<7;i++)b.box(guard,[.014,.047,.015],[x*.68,.058,-.235-i*.043],'steel')
      }
      rail(b,guard,-.5,-.13,.080,.040)
      b.box(barrel,[.111,.096,.053],[0,.023,-.566],'steel',undefined,.006)
      b.tube(barrel,.025,.018,.025,[0,.023,-.600],'edge')
      b.rod(barrel,.017,.002,[0,.023,-.598],'cell')
      b.box(magazine,[.058,.115,.079],[0,-.080,-.126],'dark',undefined,.006)
      b.box(magazine,[.062,.016,.084],[0,-.142,-.126],'edge')
      for(const x of [-.030,.030])for(let i=0;i<3;i++)b.box(magazine,[.002,.074,.010],[x,-.080,-.105-i*.021],'cell')
      const power=group('ChargingCell',body)
      b.rod(power,.011,.14,[0,.067,-.041],'cell',undefined,16)
      for(const z of [-.111,.029])b.ring(power,.014,.002,[0,.067,z],'steel')
      for(const z of [-.092,-.054,-.016,.014])b.box(power,[.036,.005,.005],[0,.080,z],'dark')
      b.box(stock,[.063,.051,.155],[0,.008,.142],'dark',undefined,.007);b.box(stock,[.067,.102,.026],[0,-.010,.235],'polymer',undefined,.006)
      sight=sights(b,body,-.56,.033,.108);muzzle=[0,.023,-.614];support={position:[0,-.039,-.322],radius:[.047,.012,.07]};hip=[.18,-.19,-.48];fov=57
    } else {
      // A tapered AR handguard, an open magazine well, and a curved stamped magazine.
      b.rod(guard,.026,.222,[0,.014,-.271],'polymer',undefined,32)
      for(const x of [-.026,.026])for(let i=0;i<9;i++)b.box(guard,[.0015,.011,.013],[x,.018,-.179-i*.023],'dark')
      rail(b,guard,-.391,-.145,.046,.042);rail(b,receiver,-.142,.059,.055,.036)
      b.tube(barrel,.009,.003,.25,[0,.023,-.494],'steel')
      b.tube(barrel,.0125,.005,.035,[0,.023,-.628],'dark')
      for(const x of [-.013,.013])for(let i=0;i<3;i++)b.box(barrel,[.001,.009,.003],[x,.023,-.616-i*.008],'edge')
      b.rod(barrel,.004,.18,[0,.043,-.444],'steel')
      b.box(barrel,[.025,.052,.022],[0,.040,-.535],'dark')
      b.profile(magazine,[[-.122,-.035],[-.066,-.034],[-.047,-.159],[-.052,-.201],[-.113,-.193],[-.120,-.164]],.025,[0,0,0],'steel',.002)
      for(const x of [-.014,.014])for(let i=0;i<3;i++)b.path(magazine,[[x,-.052,-.080-i*.014],[x,-.137,-.066-i*.014],[x,-.177,-.068-i*.014]],.0014,'dark',10)
      for(let i=0;i<5;i++)b.rod(magazine,.0018,.001,[.015,-.070-i*.021,-.094+i*.003],'dark',[0,0,Math.PI/2],8)
      b.box(magazine,[.031,.006,.066],[0,-.194,-.082],'dark',[-.14,0,0])
      b.rod(stock,.013,.183,[0,.004,.157],'steel')
      b.profile(stock,[[.117,-.009],[.129,.029],[.217,.024],[.239,-.081],[.212,-.093],[.181,-.028]],.031,[0,0,0],'polymer',.003)
      b.box(stock,[.042,.112,.020],[0,-.029,.237],'rubber',[.10,0,0],.005)
      b.box(receiver,[.068,.009,.015],[0,.048,.070],'dark')
      b.rod(receiver,.009,.032,[.030,.016,.049],'steel',[.3,0,.60])
      b.box(receiver,[.003,.009,.026],[-.030,-.005,.014],'edge',[.3,0,0])
      sight=sights(b,body,-.535,.051,.088);muzzle=[0,.023,-.647];support={position:[0,.014,-.281],radius:[.027,.027,.075]}
    }
    grip={position:[0,-.080,.036],radius:[.022,.060,.027]}
  } else if(id==='launcher') {
    const receiver=group('Receiver',body),wood=group('Grip',body),stock=group('Stock',body),breech=group('Breech',body,[0,-.019,-.065])
    b.profile(receiver,[[.039,-.028],[.043,.024],[-.065,.024],[-.084,.021],[-.075,-.023]],.043,[0,0,0],'steel',.004)
    b.rod(receiver,.026,.105,[0,.016,-.018],'steel',undefined,32)
    b.profile(wood,[[.035,.024],[.080,.011],[.130,-.017],[.147,-.052],[.102,-.065],[.049,-.031]],.033,[0,0,0],'wood',.005)
    b.profile(stock,[[.092,.006],[.151,.015],[.283,.035],[.294,-.080],[.267,-.088],[.134,-.051]],.042,[0,0,0],'wood',.007)
    b.box(stock,[.052,.115,.018],[0,-.026,.296],'rubber',undefined,.005)
    const barrel=group('Barrel',breech),guard=group('Handguard',breech)
    b.tube(barrel,.026,.020,.305,[0,.038,-.148],'steel');b.tube(barrel,.027,.020,.006,[0,.038,-.302],'edge')
    b.profile(guard,[[-.047,.008],[-.065,-.019],[-.183,-.020],[-.204,-.005],[-.192,.012]],.039,[0,0,0],'wood',.005)
    b.rod(receiver,.009,.061,[0,-.019,-.065],'edge',[0,0,Math.PI/2])
    const leaf=group('LeafSight',breech)
    for(const x of [-.018,.018])b.box(leaf,[.005,.118,.004],[x,.104,-.024],'steel')
    for(const y of [.049,.161])b.box(leaf,[.040,.005,.005],[0,y,-.024],'steel')
    b.box(leaf,[.033,.004,.006],[0,.085,-.024],'edge')
    for(let i=0;i<6;i++)b.box(leaf,[.006,.001,.001],[.014,.060+i*.016,-.021],'white')
    b.box(barrel,[.0035,.028,.014],[0,.071,-.288],'edge')
    b.box(action,[.016,.008,.035],[.010,.049,.022],'edge')
    trigger(b,body,.025,-.046)
    magazine.removeFromParent();breech.add(magazine)
    b.rod(magazine,.019,.057,[0,.038,.039],'brass');b.sphere(magazine,[.018,.018,.014],[0,.038,.003],'olive')
    b.ring(magazine,.020,.001,[0,.038,.068],'edge')
    sight={height:.085-.019,distance:.35,front:-.353,rear:-.089};muzzle=[0,.038,-.306]
    grip={position:[0,-.023,.089],radius:[.023,.033,.033]};support={position:[0,-.025,-.200],radius:[.024,.015,.055]};hip=[.16,-.17,-.44];fov=55
  } else if(id==='knife') {
    const blade=group('Blade',body),handle=group('Grip',body),guard=group('Guard',body)
    b.rod(handle,.016,.111,[0,0,.008],'polymer')
    for(let i=0;i<9;i++)b.ring(handle,.016,.0014,[0,0,-.038+i*.011],'rubber')
    b.rod(handle,.018,.006,[0,0,.067],'edge')
    b.box(guard,[.072,.010,.010],[0,0,-.055],'steel')
    const points=[[-.015,-.060],[-.015,-.181],[-.006,-.235],[.016,-.187],[.016,-.060]]
    const shape=new T.Shape();shape.moveTo(...points[0]);points.slice(1).forEach(p=>shape.lineTo(...p));shape.closePath()
    const geo=new T.ExtrudeGeometry(shape,{depth:.002,bevelEnabled:true,bevelSize:.002,bevelThickness:.001,bevelSegments:1,steps:1});geo.rotateX(Math.PI/2)
    b.add(blade,geo,'edge');b.box(blade,[.004,.0025,.096],[-.011,0,-.119],'steel')
    for(let i=0;i<5;i++)b.box(blade,[.004,.002,.003],[-.015,0,-.079-i*.011],'dark',[0,.25,0])
    grip={position:[0,0,.010],radius:[.018,.018,.051]};support=null;hip=[.16,-.16,-.39];fov=58;muzzle=[0,0,-.227]
  } else {
    const shell=group('Shell',body),fuze=group('Fuze',body)
    b.sphere(shell,[.036,.043,.036],[0,0,0],'olive')
    b.ring(shell,.0358,.0006,[0,0,0],'dark',[Math.PI/2,0,0])
    b.rod(fuze,.014,.022,[0,.047,0],'steel',[0,0,0])
    b.rod(fuze,.017,.005,[0,.039,0],'dark',[0,0,0])
    b.profile(action,[[-.014,.061],[.023,.061],[.038,.038],[.045,-.019],[.039,-.025],[.032,.032],[.018,.054],[-.013,.054]],.013,[0,0,0],'edge',.001)
    b.ring(magazine,.014,.0016,[-.028,.054,0],'edge',[0,Math.PI/2,0]);b.rod(magazine,.0015,.041,[-.007,.054,0],'edge',[0,0,Math.PI/2],12)
    const band=group('Identification',body)
    b.add(band,new T.SphereGeometry(1,32,2,0,Math.PI*2,.69,.10),'white',[0,0,0],[0,0,0],[.0364,.0434,.0364])
    b.box(shell,[.0003,.018,.022],[.0358,0,0],'mark',undefined,.00001)
    grip={position:[0,-.009,.006],radius:[.036,.035,.033]};support=null;hip=[.17,-.18,-.38];fov=58;muzzle=[0,.044,-.035]
  }
  const muzzleParent=body.getObjectByName('Breech')||body
  group('Muzzle',muzzleParent,muzzle)
  group('Ejection',body,[.042,.018,-.031])
  if(sight){group('SightFront',body,[0,sight.height,sight.front??-.28]);group('SightRear',body,[0,sight.height,sight.rear??.025])}
  const material=new T.MeshStandardMaterial({name:id+' 2K PBR',metalness:1,roughness:1})
  b.finish(material)
  if(id==='pistol'){
    for(const [part,position] of [[magazine,[0,.013,-.052]],[action,[0,.034,.029]]]){
      const pivot=new T.Vector3(...position)
      for(const child of part.children)child.position.sub(pivot)
      part.position.copy(pivot);part.userData.restOffset=position
    }
  }
  root.userData={weaponAsset:id,viewModel:{id,sight,hip,fov,grip,support},gltfUUID:`weapon-${id}-root`}
  root.traverse(n=>{n.userData.gltfUUID ||= `weapon-${id}-${n.name.replaceAll(' ','-')}`})
  return root
}
