import {bevelMapBox} from './map.batching.js'
// The expansion reads collider dimensions. Decorative parts stay inside each solid.
export function addExpansionSolid(api, c, node, h) {
  const {box, mesh, decal, m} = h
  const p=c.center,s=c.size, at=[p.x,p.y,p.z], size=[s.x,s.y,s.z]
  const local=(name,offset,extent,mat)=>box(name,[p.x+offset[0],p.y+offset[1],p.z+offset[2]],extent,mat,node)
  if(c.kind==='bunk') {
    local('Field bed steel frame',[0,-.08,0],[s.x,.12,s.z],m.dark)
    mesh('Worn canvas mattress',bevelMapBox(api,[s.x-.06,.24,s.z-.06]),[p.x,p.y+.12,p.z],m.canvas,node)
    for(const x of [-s.x/2+.04,s.x/2-.04])for(const z of [-s.z/2+.04,s.z/2-.04])local('Bunk frame foot',[x,-.16,z],[.08,.38,.08],m.steel)
    mesh('Folded field blanket',bevelMapBox(api,[s.x-.1,.12,.5]),[p.x,p.y+.29,p.z-.72],m.truck,node)
    return true
  }
  if(c.kind==='supply') {
    for(const side of [-1,1]) {
      const x=side*.66
      local('Sealed ammunition chest',[x,0,0],[1.27,s.y-.04,s.z-.04],m.truck)
      for(const dx of [-.46,.46])local('Steel transit strap',[x+dx,0,0],[.07,s.y,s.z],m.steel)
      local('Recessed cargo handle',[x,.07,-s.z/2+.005],[.35,.12,.01],m.dark)
      local('Cargo latch',[x,.36,-s.z/2+.02],[.09,.2,.04],m.yellow)
    }
    decal('Chest classification',[p.x-.65,p.y,p.z-s.z/2],[.85,.6],10,[0,Math.PI,0],node)
    return true
  }
  if(c.kind==='sandbags') {
    for(let row=0;row<4;row++)for(let i=0;i<4;i++){
      const x=-1.2+i*.8,y=-.4875+row*.325
      local('Stitched sandbag',[x,y,0],[.8,.325,1.2],m.canvas)
      local('Sandbag sewn fold',[x,y+.07,.593],[.71,.022,.014],m.rubber)
    }
    return true
  }
  if(c.kind==='generator') {
    local('Generator skid',[0,-.71,0],[s.x,.18,s.z],m.dark)
    local('Diesel generator enclosure',[0,.02,0],[s.x-.1,1.34,s.z-.18],m.truck)
    local('Generator top hood',[0,.72,0],[s.x,.16,s.z-.06],m.steel)
    for(const side of [-1,1])for(let i=0;i<12;i++)local('Cooling grille',[side*(s.x/2-.035),-.29+i*.07,0],[.05,.027,1.6],m.dark)
    local('Recessed control panel',[0,.23,-s.z/2+.075],[.7,.44,.015],m.dark)
    for(const x of [-.22,0,.22])local('Generator instrument',[x,.27,-s.z/2+.06],[.12,.1,.025],m.glass)
    decal('Generator caution',[p.x,p.y-.28,p.z-s.z/2+.06],[.8,.3],11,[0,Math.PI,0],node)
    return true
  }
  if(c.kind==='spool') {
    for(const part of c.shapes)mesh('Cable spool '+part.id,new api.CylinderGeometry(part.radius,part.radius,part.height,20),[p.x,p.y+part.offset.y,p.z],part.id==='core'?m.rubber:m.rust,node)
    for(let i=0;i<12;i++)mesh('Wound power cable',new api.TorusGeometry(.397,.018,4,20),[p.x,p.y-.48+i*.087,p.z],m.rubber,node,[Math.PI/2,0,0])
    return true
  }
  if(c.kind==='column') {
    mesh('Colonnade reinforced pier',bevelMapBox(api,size),at,m.concrete,node)
    for(const y of [-s.y/2+.2,s.y/2-.16])local('Pier steel collar',[0,y,0],[s.x,.23,s.z],m.dark)
    for(const side of [-1,1])decal('Chipped pier caution',[p.x,p.y-.8,p.z+side*(s.z/2+.001)],[s.x-.04,.7],10,[0,side>0?0:Math.PI,0],node)
    return true
  }
  if(c.kind==='building_wall'||c.kind==='wall') {
    box(c.id,at,size,c.center.y<0?m.serviceWall:m.concrete,node)
    if(c.id.includes('barracks')&&s.y>2&&Math.max(s.x,s.z)>1){
      const along=s.x>s.z
      const base=p.y-s.y/2+.47
      for(const side of [-1,1])box('Barracks worn painted dado',[p.x+(along?0:side*(s.x/2+.001)),base,p.z+(along?side*(s.z/2+.001):0)],along?[s.x,.86,.004]:[.004,.86,s.z],m.housePaint,node)
    }
    // Narrow sill and lintel pieces never grow decorative beams beyond their actual bounds.
    if(s.y>2&&Math.max(s.x,s.z)>2) {
      const along=s.x>s.z, length=along?s.x:s.z, depth=(along?s.z:s.x)/2
      for(const side of [-1,1]){
        const rotation=[0,along?(side>0?0:Math.PI):side*Math.PI/2,0]
        const position=[p.x+(along?0:side*(depth+.001)),p.y,p.z+(along?side*(depth+.001):0)]
        decal('Expansion wall runoff',position,[Math.min(length-.04,4),Math.min(s.y-.04,3)],2,rotation,node)
      }
    }
    return true
  }
  return false
}

export function addExpansionDressing(api,map,h) {
  const {group,box,mesh,plane,partGroup,label,decal,m}=h
  if(!map.environment)return
  const dress=partGroup('Bunker expansion fittings')
  // Long service trunks sit above Heavy head height. Flanges remain within wall thickness.
  for(const x of [-38.66,-31.34])for(const y of [-.78,-1.02]) {
    mesh('Service main pipe',new api.CylinderGeometry(.13,.13,30.4,12),[x,y,0],m.rust,dress,[Math.PI/2,0,0])
    for(let z=-14;z<=14;z+=4)mesh('Service pipe coupling',new api.CylinderGeometry(.165,.165,.13,12),[x,y,z],m.steel,dress,[Math.PI/2,0,0])
  }
  for(const z of [-13,-5,5,13]) {
    box('Tunnel ceiling cable tray',[-35,-.54,z],[7.3,.07,.35],m.dark,dress)
    for(const x of [-38,-32])box('Ceiling tray hanger',[x,-.62,z],[.035,.2,.035],m.steel,dress)
  }
  for(let z=-14;z<=14;z+=3){
    decal('Service floor water and mineral stain',[-35.1+Math.sin(z*7)*.65,-3.495,z],[3.2,2.4],12+(Math.abs(z)%4),[-Math.PI/2,0,0],dress,m.puddle)
    box('Recessed floor drainage grate',[-32,-3.498,z],[.38,.004,2.6],m.dark,dress)
    for(let i=0;i<8;i++)box('Drain crossbar',[-32,-3.494,z-1.1+i*.3],[.38,.004,.03],m.steel,dress)
    for(const x of [-38.697,-31.303])decal('Tunnel rising damp',[x,-2.95,z],[2.9,1.05],3,[0,x<-35?Math.PI/2:-Math.PI/2,0],dress)
  }
  for(const z of [-13,12]) {
    plane('Service loop route stencil',[-31.301,-1.65,z],[2.4,.58],label(z<0?'SOUTH YARD / 01':'NORTH YARD / 02','#c9b887'),[0,-Math.PI/2,0],dress)
  }
  plane('Pump room warning',[-35.9,-.67,-.411],[2.3,.27],label('LOW CLEARANCE / 07','#c7b991'),[0,Math.PI,0],dress)
  // Surface-mounted service boxes sit within their structural wall volumes.
  for(const z of [-10,8]){
    box('Tunnel recessed junction cabinet',[-38.84,-1.65,z],[.28,.7,.58],m.dark,dress)
    box('Tunnel cabinet cover',[-38.691,-1.65,z],[.018,.6,.51],m.steel,dress)
    decal('High voltage cabinet warning',[-38.677,-1.63,z],[.34,.4],10,[0,Math.PI/2,0],dress)
  }
  // Window surrounds follow solid sills, lintels and jambs. No pane spans the opening.
  for(const x of [31,41])for(const y of [0,3.2])for(const z of [7.25,12.5,17.5,21.75]) {
    if(x===31&&y===0&&z===12.5)continue
    const width=z===7.25||z===21.75?3.5:4
    for(const dy of [1.12,2.38])box('Window steel reveal',[x,y+dy,z],[.405,.04,width],m.steel,dress)
  }
  for(const y of [0,3.2]){
    plane('Barracks corridor floor direction',[36,y+.008,13],[1.2,3.5],label('BLOCK C\nNORTH EXIT','#b0a57c'),[-Math.PI/2,0,Math.PI],dress)
    for(const x of [34,38])for(const z of [5.5,10]) {
      plane('Barracks evacuation notice',[x+(x===34?.112:-.112),y+1.55,z],[.55,.85],label('EVACUATE\nLEVEL C','#9baba2','#333d37'),[0,x===34?Math.PI/2:-Math.PI/2,0],dress)
      decal('Barracks bullet scars',[x+(x===34?.114:-.114),y+1.4,z+.45],[.7,.9],8,[0,x===34?Math.PI/2:-Math.PI/2,0],dress)
    }
  }
  plane('Block C facade identification',[32.75,2.25,3.794],[2.8,.8],label('BARRACKS\nBLOCK C','#d8c08b'),[0,Math.PI,0],dress)
  plane('Depot shell identification',[36,5.3,-14.74],[6,.8],label('MOTOR POOL / 07','#c9b98f'),[0,0,0],dress)
  // Overhead beams and grilles add depth without placing new uncollided cover at player height.
  for(const x of [14,18,22,26,30])box('Colonnade transverse girder',[x,3.94,13],[.16,.12,5.5],m.dark,dress)
  for(const z of [10.3,15.7])box('Colonnade edge fascia',[22,4.05,z],[18,.3,.14],m.rust,dress)
  const rubble=partGroup('Perimeter shell broken masonry')
  rubble.userData.mapBackdrop=true
  for(const c of map.colliders.filter(c=>c.area==='expansion'&&c.id.includes('broken_roof'))){
    for(let i=0;i<12;i++){
      const x=c.center.x-c.size.x/2+.35+i*(c.size.x-.7)/11,z=c.center.z+(i%3-1)*.3
      mesh('Shell broken parapet tooth',new api.DodecahedronGeometry(.3,0),[x,c.center.y+.28,z],m.concrete,rubble)
      if(i%3===0)box('Exposed roof reinforcing bar',[x,c.center.y+.55,z],[.025,.85,.025],m.rust,rubble,[.12,0,.15])
    }
  }
  for(const c of map.colliders.filter(c=>c.area==='expansion'&&['supply','generator','spool','sandbags'].includes(c.kind))) {
    decal('Cover oil and tracked grime',[c.center.x,c.center.y-c.size.y/2+.003,c.center.z],[c.size.x+1,c.size.z+1],c.kind==='generator'?6:4,[-Math.PI/2,0,0],dress)
  }
}
