import {mountBakedArchitecture} from './baked-environment.js'
import {installV2LinearFog} from './fog.js'
import {Group, Mesh2, PhysicalMaterial, BufferGeometry, Float32BufferAttribute} from 'threepipe'
import {replaceRuntimeWallShells} from './architecture-shells.js'
import {createScannedRubble} from './architecture-rubble.js'
import {mountV2CoverGeometry} from './architecture-cover-view.js'
import {destroyedFacade, extrudeMasonry} from './architecture-skyline.js'
import {wallMorphology} from './architecture-morphology.js'
import {fracturedWallMass, useVolumetricFracture} from './architecture-mass.js'
import {breakProfile, skylineLayout} from './architecture-layout.js'
import {releaseSubtree} from '../mesh-release.js'

const SURFACES = {
  concrete: ['V2 concrete', 0x424b55, .92, .02],
  fracture: ['V2 fractured concrete', 0x505963, .96, .01],
  rebar: ['V2 rebar', 0x242a31, .71, .72],
  steel: ['V2 charred steel', 0x1a2028, .83, .6],
  skyline: ['V2 skyline concrete', 0x252f3b, .98, 0],
}
const WALLS = new Set(['wall', 'building_wall', 'tunnel_wall', 'column'])
const TAU = Math.PI * 2

/** Deterministic, opaque architecture dressing. Coordinates use the map's local space.
 * Owns reversible runtime-shell geometry replacements; never edits authored materials, cameras or colliders.
 */
export function mountV2Architecture({viewer, root, map, refs, preview = false}) {
  const baked=mountBakedArchitecture({viewer,root,map,refs,preview})
  if(baked)return baked
  if (!root?.add || !Array.isArray(map?.colliders)) throw new TypeError('V2 architecture requires root and map.colliders')
  const owned = new Group()
  owned.name = 'V2 Ruined Architecture'
  owned.userData = {v2Architecture: true, preview, seed: 1984}
  const walls=map.colliders.filter(c=>WALLS.has(c.kind))
  const shells=replaceRuntimeWallShells(root,walls)
  root.add(owned)
  const scan=createScannedRubble({viewer,root:owned,preview})
  const materials = Object.fromEntries(Object.entries(SURFACES).map(([key, [name, color, roughness, metalness]]) => {
    const material = new PhysicalMaterial({name, color, roughness, metalness, vertexColors: true, fog: true})
    material.userData = {v2Architecture: true, v2Surface: ['rebar','steel'].includes(key) ? 'metal' : 'concrete', architectureSurface: key, surface: key === 'fracture' ? 'concrete' : key}
    return [key, material]
  }))
  const fogHandles = Object.values(materials).map(material => installV2LinearFog(material, {owned:true}))
  const batches = new Map()
  const photoCandidates=[]
  const labels = new Map((map.mapPieces || []).map(p => [p.id, p.name]))
  const stats = {colliders: 0, wallSkins: 0, fragments: 0, rods: 0, skylineBuildings: 0, triangles: 0, meshes: 0, materials: 5, collapseClusters: 0, coarseSlabs: 0, mediumSlabs: 0, fineChips: 0}
  function writer(key, id, center) {
    const cell = preview ? id : `${Math.floor(center.x / 24)},${Math.floor(center.z / 24)}`
    const batchKey = `${cell}:${key}`
    let b = batches.get(batchKey)
    if (!b) {
      b = {key, cell, ids: new Set(), positions: [], normals: [], colors: [], uv: [], fractureMasks: key==='concrete'?[]:null, hasFractureMask: false}
      batches.set(batchKey, b)
    }
    b.ids.add(id)
    return b
  }
  function tri(b, a, c, d, shade = 1, fractureMask = 0, normals = null) {
    if(b.fractureMasks){b.fractureMasks.push(fractureMask,fractureMask,fractureMask);b.hasFractureMask ||= fractureMask===1}
    b.positions.push(...a, ...c, ...d)
    b.colors.push(shade, shade, shade, shade, shade, shade, shade, shade, shade)
    // World metric UVs on the dominant face; ready for the materials worker's maps.
    const u = [c[0]-a[0],c[1]-a[1],c[2]-a[2]], v = [d[0]-a[0],d[1]-a[1],d[2]-a[2]]
    const cross = [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], size=Math.hypot(...cross)||1
    const faceNormal=cross.map(x=>x/size),n=cross.map(Math.abs)
    for(const normal of normals||[faceNormal,faceNormal,faceNormal])b.normals.push(...normal)
    const axis = n[1] >= n[0] && n[1] >= n[2] ? [0,2] : n[0] > n[2] ? [2,1] : [0,1]
    for (const p of [a,c,d]) b.uv.push(p[axis[0]],p[axis[1]])
  }
  function quad(b,a,c,d,e,shade=1) {tri(b,a,c,d,shade);tri(b,a,d,e,shade)}
  function rod(b,a,z,r=.023,shade=.8) {
    const dx=z[0]-a[0],dy=z[1]-a[1],dz=z[2]-a[2],len=Math.hypot(dx,dy,dz)
    if (len < .001) return
    const axis=[dx/len,dy/len,dz/len]
    let u=Math.abs(axis[1])>.9 ? [1,0,0] : [-axis[2],0,axis[0]]
    const ul=Math.hypot(...u);u=u.map(x=>x/ul)
    const v=[axis[1]*u[2]-axis[2]*u[1],axis[2]*u[0]-axis[0]*u[2],axis[0]*u[1]-axis[1]*u[0]]
    for(let i=0;i<5;i++) {
      const point=(p,t)=>p.map((x,j)=>x+r*(u[j]*Math.cos(t)+v[j]*Math.sin(t)))
      quad(b,point(a,(i+1)*TAU/5),point(z,(i+1)*TAU/5),point(z,i*TAU/5),point(a,i*TAU/5),shade)
    }
    stats.rods++
  }
  function chunk(b,center,size,rand,yaw=0) {
    const cs=Math.cos(yaw),sn=Math.sin(yaw)
    const vertices=[]
    for(let layer=0;layer<2;layer++) for(let i=0;i<5;i++) {
      const angle=i*TAU/5, scale=.72+rand()*.28
      const x=Math.cos(angle)*size[0]*.5*scale,z=Math.sin(angle)*size[2]*.5*scale
      vertices.push([center[0]+x*cs+z*sn,center[1]+(layer ? .18+rand()*.32 : -.5)*size[1],center[2]-x*sn+z*cs])
    }
    const shade=.62+rand()*.35
    for(let i=0;i<5;i++) quad(b,vertices[i+5],vertices[(i+1)%5+5],vertices[(i+1)%5],vertices[i],shade)
    for(let i=1;i<4;i++) {tri(b,vertices[5],vertices[6+i],vertices[5+i],shade+.06);tri(b,vertices[0],vertices[i],vertices[i+1],shade)}
    stats.fragments++
  }
  function frame(c) {
    const alongX=c.size.x>=c.size.z, yaw=(c.yaw||0)+(alongX?0:-Math.PI/2),cs=Math.cos(yaw),sn=Math.sin(yaw)
    return {length:alongX?c.size.x:c.size.z, thickness:alongX?c.size.z:c.size.x,
      p:(u,y,v)=>[c.center.x+u*cs+v*sn,c.center.y+y,c.center.z-u*sn+v*cs],
      n:(u,y,v)=>[u*cs+v*sn,y,-u*sn+v*cs]}
  }
  // Existing floors remain the sole support. Check exact sub-shapes, including roof stair holes.
  const floors=map.colliders.filter(c=>c.kind==='floor')
  function support(x,z,nearY) {
    let best=-Infinity
    for(const c of floors) {
      const cs=Math.cos(c.yaw||0),sn=Math.sin(c.yaw||0),dx=x-c.center.x,dz=z-c.center.z
      const lx=dx*cs-dz*sn,lz=dx*sn+dz*cs
      for(const part of c.shapes?.length ? c.shapes : [{size:c.size}]) {
        if(!part.size)continue
        const o=part.offset||{x:0,y:0,z:0},s=part.size,top=c.center.y+o.y+s.y/2
        if(Math.abs(lx-o.x)<s.x/2-.12&&Math.abs(lz-o.z)<s.z/2-.12&&top<=nearY+.12&&top>nearY-.35)best=Math.max(best,top)
      }
    }
    return best
  }
  function wall(c) {
    const rand=random(c.id), f=frame(c),h=c.size.y, L=f.length,T=f.thickness
    const concrete=writer('concrete',c.id,c.center),fracture=writer('fracture',c.id,c.center),iron=writer('rebar',c.id,c.center)
    const service=c.id.includes('service'),partition=c.id.includes('partition'),parapet=c.id.includes('parapet')
    const topOpen=!service&&!/sill|header|head_|lintel/.test(c.id)&&(!c.id.includes('barracks')||partition||parapet)
    const prior=wallMorphology({length:L,height:h,thickness:T,random:rand,topOpen,detail:partition||service||c.id.includes('sill')})
    // Consume the original seed stream so unrelated rods/dressing stay fixed.
    const volumetric=useVolumetricFracture(c)
    const morphology=volumetric?fracturedWallMass({length:L,height:h,thickness:T,random:random(c.id+':volume-r8'),topOpen}):prior
    if(volumetric){stats.volumeWalls=(stats.volumeWalls||0)+1;stats.volumeWallTriangles=(stats.volumeWallTriangles||0)+morphology.triangles.length;stats.volumeCuts=(stats.volumeCuts||0)+morphology.cuts}
    for(const t of morphology.triangles)tri(concrete,f.p(...t.a),f.p(...t.b),f.p(...t.c),t.surface==='concrete'?.94:.91,t.surface==='fracture'?1:0,t.normals?.map(n=>f.n(...n)))
    stats.wallSkins+=2
    stats.spallCavities=(stats.spallCavities||0)+morphology.cavities.length
    if(topOpen) {
      const amplitude=parapet?.3:partition?.18:.45+rand()*.95
      const profile=breakProfile(L,rand,amplitude)
      // Isolated torn bundles at shear fronts, with long empty intervals.
      const bundles=Math.floor(L/(5+rand()*6))+(rand()<.25?1:0)
      for(let k=0;k<bundles;k++) {
        const index=Math.floor(rand()*(profile.length-1)),[u,rise]=profile[index]
        const base=h/2-Math.min(rise*.7,h*.15),tall=(parapet?.22:partition?.18:.3+rand()*1.25)
        const count=1+Math.floor(rand()*4),bend=(rand()<.5?-1:1)*(.2+rand()*.65)
        for(let j=0;j<count;j++) {
          const x=Math.max(-L/2+.02,Math.min(L/2-.02,u+(rand()-.5)*.45))
          const a=f.p(x,base,0),b=f.p(x,base+tall*.48,0),e=f.p(x+bend,base+tall*(.55+rand()*.45),(rand()-.5)*.38)
          rod(iron,a,b,.017+rand()*.009);rod(iron,b,e,.019)
        }
      }
    }
    // At shattered wall ends the thin, darker cage frames the existing edge.
    if(h>1.2 && (partition || rand()<.34))for(const end of [-1,1]) {
      const u=end*(L/2-.03)
      for(const side of [-1,1]) {
        const v=side*(T/2+.075)
        for(let i=0;i<1;i++){const y=(rand()-.5)*h*.65,len=.18+rand()*.42
          rod(iron,f.p(u,y,v),f.p(u-end*(.06+rand()*.1),Math.min(h*.45,y+len),v+.035),.021)}
        for(let y=-h*.32;y<h*.44;y+=.3+rand()*.68)rod(iron,f.p(u-end*.19,y,v),f.p(u+end*.06,y+.025,v),.015)
      }
    }
    // Interior damage accumulates at a few broken ends, not a continuous bead chain.
    if((service||partition)&&!/header|head_|lintel/.test(c.id)&&h>1.1) {
      const clusters=Math.max(1,Math.ceil(L/8))
      for(let k=0;k<clusters;k++) {
        const anchor=(rand()<.5?-1:1)*Math.max(0,L/2-.7-rand()*.8)
        for(const side of [-1,1])for(let j=0;j<18;j++) {
          const t=rand(),u=Math.max(-L/2+.2,Math.min(L/2-.2,anchor+(rand()-.5)*2.3))
          const v=side*(T/2+.3+t*.6),p=f.p(u,-h/2,v),y=support(p[0],p[2],p[1])
          if(!Number.isFinite(y))continue
          const coarse=j<4,sx=coarse?.6+rand()*.6:.13+rand()*.35,sz=coarse?.28+rand()*.17:.12+rand()*.2
          const height=coarse?.16+(1-t)*.13:.03+(1-t)*.065
          const yaw=(c.yaw||0)+(c.size.x>=c.size.z?0:-Math.PI/2)
          // All corners retain the exact same supported elevation, including trench margins.
          const cs=Math.cos(yaw),sn=Math.sin(yaw)
          if([[-1,-1],[-1,1],[1,-1],[1,1]].some(([a,b])=>Math.abs(support(p[0]+a*sx*.5*cs+b*sz*.5*sn,p[2]-a*sx*.5*sn+b*sz*.5*cs,y)-y)>.025))continue
          slab(fracture,p[0],y+.003,p[2],sx,sz,height,yaw,rand,true)
        }
      }
    }
    stats.colliders++
  }
  function roof(c) {
    const rand=random(c.id),stone=writer('fracture',c.id,c.center),iron=writer('rebar',c.id,c.center)
    // Fascia only; original walking surface and ceiling undersides are untouched.
    for(const side of [-1,1])for(const axis of ['x','z']) {
      const L=c.size[axis],other=axis==='x'?'z':'x'
      for(let u=-L/2+.25;u<L/2-.2;u+=.25+rand()*1.4) {
        const p={...c.center};p[axis]+=u;p[other]+=side*(c.size[other]/2-.121)
        const sy=Math.min(c.size.y*.96,.16+rand()*.22)
        const span=Math.min(.22+rand()*1.4,L-2*Math.abs(u)-.002)
        const size=axis==='x'?[span,sy,.24]:[.24,sy,span]
        // Bound opaque fascia within real floor sub-shapes, including stair holes.
        if(![-1,1].every(a=>[-1,1].every(b=>(c.shapes||[{size:c.size}]).some(part=>{
          const o=part.offset||{x:0,z:0}
          return Math.abs(p.x+a*size[0]/2-c.center.x-o.x)<=part.size.x/2&&Math.abs(p.z+b*size[2]/2-c.center.z-o.z)<=part.size.z/2
        }))))continue
        chunk(stone,[p.x,c.center.y,p.z],size,rand)
        if(rand()<.15)rod(iron,[p.x,c.center.y,p.z],[p.x+(rand()-.5)*.45,c.center.y-.3-rand()*.2,p.z+(rand()-.5)*.45],.018)
      }
    }
  }
  // Flat clipped slabs have broad faces and broken corners, not pointed stone cones.
  function slab(b,x,y,z,sx,sz,height,yaw,rand,interior=false) {
    if(sx>.46) {photoCandidates.push({b,x,y,z,width:sx,depth:sz,height,yaw,variant:Math.floor(rand()*8),interior});return}
    const corners=[[-.5,-.28],[-.28,-.5],[.32,-.5],[.5,-.18],[.5,.32],[.18,.5],[-.5,.36]]
    const cs=Math.cos(yaw),sn=Math.sin(yaw),ring=[],top=[]
    const tilt=(rand()-.5)*.35
    for(const [u,v]of corners) {
      const px=u*sx*(.88+rand()*.12),pz=v*sz*(.88+rand()*.12)
      ring.push([x+px*cs+pz*sn,y,z-px*sn+pz*cs])
      top.push([x+px*cs+pz*sn,y+height*(.7+tilt*u+rand()*.18),z-px*sn+pz*cs])
    }
    const mid=[x,y+height*.86,z],shade=.66+rand()*.24
    for(let i=0;i<ring.length;i++) {
      const j=(i+1)%ring.length
      quad(b,ring[j],ring[i],top[i],top[j],shade*.83)
      tri(b,mid,top[j],top[i],shade+.07)
    }
    stats.fragments++
  }
  function buildCollapseFields() {
    // Strict whole-footprint exclusion around props, doors, stairs, hazards, and flank.
    const protectedBoxes=map.colliders.filter(c=>['stair','ramp','truck','container','barrel','supply','sandbags','generator','spool','bunk'].includes(c.kind))
    for(const c of [...map.doors||[],...map.spawnGates||[],...map.hazardSlots||[],map.flankWall].filter(Boolean))
      protectedBoxes.push({center:c.center||c.pos,size:c.size||{x:4,y:4,z:4},yaw:c.yaw||0,portal:true})
    const records=[]
    function nearBox(c,x,z,r) {
      const cs=Math.cos(c.yaw||0),sn=Math.sin(c.yaw||0),dx=x-c.center.x,dz=z-c.center.z
      return Math.abs(dx*cs-dz*sn)<c.size.x/2+r && Math.abs(dx*sn+dz*cs)<c.size.z/2+r
    }
    function put(b,id,x,z,y,sx,sz,height,yaw,rand,tier) {
      const radius=Math.hypot(sx,sz)/2
      if(protectedBoxes.some(c=>Math.abs(c.center.y-y)<c.size.y/2+1 && nearBox(c,x,z,radius+(c.portal?1:.35))))return
      // Keep continuous central movement spines and the barracks corridor clear.
      if(y<.2&&y>-.2&&((Math.abs(x+4)<.9+radius&&Math.abs(z)<23)||(Math.abs(z+12)<.85+radius&&Math.abs(x)<27)))return
      if(x>34.3-radius&&x<37.7+radius&&z>3&&z<25)return
      // Every corner and center must sit on the same existing support plane.
      const cs=Math.cos(yaw),sn=Math.sin(yaw)
      for(const [u,v]of [[0,0],[-.5,-.5],[-.5,.5],[.5,-.5],[.5,.5]]) {
        const px=x+u*sx*cs+v*sz*sn,pz=z-u*sx*sn+v*sz*cs
        if(Math.abs(support(px,pz,y)-y)>.025)return
      }
      slab(b,x,y+.003,z,sx,sz,height,yaw,rand)
      stats[tier]++
      records.push({source:id,x,z,y,width:sx,depth:sz,height,yaw,tier})
    }
    function fan(c,u,side,reach,width) {
      const f=frame(c),rand=random(c.id+':fan:'+u+':'+side),p=f.p(u,-c.size.y/2,side*(f.thickness/2+.2))
      const y=support(p[0],p[2],p[1]);if(!Number.isFinite(y))return
      const id='collapse:'+c.id,b=writer('fracture',id,c.center),yaw=(c.yaw||0)+(c.size.x>=c.size.z?0:-Math.PI/2)
      const direction=yaw+(side>0?0:Math.PI),cs=Math.cos(direction),sn=Math.sin(direction)
      // Three concentrated lobes follow one fall direction, thinning with distance.
      for(let i=0;i<72;i++) {
        const coarse=i<5,medium=i<23,t=coarse?rand()*.33:medium?rand()*.68:Math.pow(rand(),.65)
        const lateral=(rand()-.5)*width*(.35+t*.65),forward=.35+t*reach
        const x=p[0]+lateral*cs+forward*sn,z=p[2]-lateral*sn+forward*cs
        const sx=coarse?1+rand()*1.65:medium?.32+rand()*.7:.07+rand()*.26
        const sz=sx*(.38+rand()*.43),height=coarse?.12+rand()*.09:medium?.065+rand()*.07:.018+rand()*.042
        put(b,id,x,z,y,sx,sz,height,yaw+(rand()-.5)*1.2,rand,coarse?'coarseSlabs':medium?'mediumSlabs':'fineChips')
      }
      stats.collapseClusters++
    }
    for(const c of map.colliders) {
      // Declared scan piles own their full mass; do not seed another broad
      // procedural debris fan from their new gameplay collider envelopes.
      if(c.v2ArchitectureCover)continue
      if(c.kind==='rubble'||c.kind==='sandbags') {
        for(const side of [-1,1])fan(c,0,side,4.5,Math.max(c.size.x,c.size.z)+2)
      } else if(WALLS.has(c.kind)&&!c.id.includes('service')&&!c.id.includes('partition')&&c.center.y-c.size.y/2<.2&&c.size.y>1.5) {
        const L=Math.max(c.size.x,c.size.z)
        if(L<4)continue
        const rand=random(c.id+':clusters'),n=Math.max(1,Math.floor(L/7))
        for(let i=0;i<n;i++) {
          const u=(rand()-.5)*(L-2),side=rand()<.5?-1:1
          fan(c,u,side,2.3+rand()*2.2,3+rand()*3)
        }
      }
    }
    // Dock rim and roof margins: broad low slabs stay supported, never bridge holes.
    for(const c of floors.filter(c=>c.id==='dock_floor'||c.id==='exp_barracks_roof'||c.id==='exp_colonnade_canopy')) {
      const rand=random(c.id+':collapse'),id='collapse:'+c.id,b=writer('fracture',id,c.center),y=c.center.y+c.size.y/2
      for(let i=0;i<95;i++) {
        const side=rand()<.5?-1:1,x=c.center.x+side*(c.size.x/2-.5-rand()*.7),z=c.center.z+(rand()-.5)*(c.size.z-1)
        const coarse=i<25,sx=coarse?.8+rand()*1.3:.16+rand()*.45,sz=sx*(.5+rand()*.35)
        put(b,id,x,z,y,sx,sz,coarse?.14:.055,rand()*TAU,rand,coarse?'coarseSlabs':'mediumSlabs')
      }
    }
    owned.userData.collapseFragments=records
  }
  for(const c of map.colliders) {
    if(WALLS.has(c.kind)) wall(c)
    else if(c.kind==='floor'&&/roof|canopy|balcony/.test(c.id)&&!c.id.includes('service'))roof(c)
  }
  buildCollapseFields()
  // Substantial masonry fragments form the skyline; no repeated full-height grids.
  const bounds=map.bounds||{minX:-42,maxX:42,minZ:-30,maxZ:30}
  const cityRand=random('future-war-city-r2-1984')
  const skyline=skylineLayout(bounds,cityRand)
  function building(spec) {
    const {id,x:cx,z:cz,width,depth,height,yaw}=spec
    const center={x:cx,y:height/2,z:cz},rand=random(id),stone=writer('skyline',id,center),steel=writer('steel',id,center)
    const cs=Math.cos(yaw),sn=Math.sin(yaw),p=(x,y,z)=>[cx+x*cs+z*sn,y,cz-x*sn+z*cs]
    // Extrude irregular wall sections, with substantial cut aggregate end faces.
    function mass(x0,x1,y0,top0,top1,z,thickness) {
      const shape=destroyedFacade({x0,x1,bottom:y0,top0,top1,thickness,random:rand})
      for(const t of shape.triangles)tri(stone,...t.map(([x,y,v])=>p(x,y,z+v)),t.every(v=>v[2]===0)?.75:t.every(v=>v[2]===thickness)?.71:.85)
      stats.skylineOpenings=(stats.skylineOpenings||0)+shape.holes.length
    }

    const left=-width/2,right=width/2,front=-depth/2
    const gap=left+width*(.26+rand()*.3),opening=2.3+rand()*3.4
    const shoulder=height*(.5+rand()*.18)
    // Two large, uneven piers and a torn upper remnant around an actual tall void.
    mass(left,gap,0,height*.86,height,front,.75+rand()*.5)
    mass(gap+opening,right,0,height*.61,height*.35,front,1.1)
    if(rand()<.65)mass(gap-.2,gap+opening+.4,shoulder,shoulder+1.4,shoulder+.65,front,.9)
    // Rear mass offset in depth and silhouette: visible through the front fracture.
    mass(left+width*.1,right-width*.08,0,height*.32,height*.58,depth/2-1,1.2)
    // A deep, perforated return reveals floor-bearing remnants through the
    // front openings. It is a closed masonry solid, not a single background quad.
    const returning=destroyedFacade({x0:0,x1:depth,bottom:0,top0:height*.86,top1:height*.42,thickness:.85,random:rand})
    for(const t of returning.triangles)tri(stone,...t.map(([u,y,v])=>p(left+.85-v,y,front+u)),.73)
    stats.skylineOpenings+=returning.holes.length
    // Partial broken floor plates terminate inside the footprint; they aren't grid lines.
    for(let level=1;level<height/3.6;level++) {
      const y=level*3.6,reach=width*(.24+rand()*.36),far=depth*(.22+rand()*.32)
      if(y>height*.78)break
      const outline=[[left+.3,-(front+.3)],[left+reach,-(front+.3)],[left+reach*.94,-(front+far*.56)],[left+reach*.68,-(front+far*.72)],[left+reach*.74,-(front+far)],[left+.3,-(front+far)]]
      for(const t of extrudeMasonry(outline,[],.32))tri(stone,...t.map(([u,v,h])=>p(u,y-.32+h,-v)),.81)
      stats.skylineFloorRemnants=(stats.skylineFloorRemnants||0)+1
    }

    // A few surviving bent beams emerge from masonry, never a complete cage.
    for(let i=0;i<3;i++) {
      const x=left+rand()*(gap-left),y=height*(.88+rand()*.12)
      rod(steel,p(x,y-.4,front+.3),p(x+(rand()-.5)*1.2,y+.6+rand()*1.4,front+.3),.04)
    }
    for(let i=0;i<12;i++)chunk(stone,p((rand()-.5)*width,.65,(rand()-.5)*depth),[1.4+rand()*3,1.3,1.2+rand()*3],rand,rand()*TAU)
    stats.skylineBuildings++
  }
  for(const spec of skyline)building(spec)
  owned.userData.skylineLayout=skyline
  // Allocate the scan budget across exterior primary slabs and interior broken ends.
  const chosen=new Set()
  for(const interior of [false,true]) {
    const candidates=photoCandidates.filter(p=>p.interior===interior).sort((a,b)=>b.width*b.depth-a.width*a.depth)
    for(const p of candidates.slice(0,interior?60:130))chosen.add(p)
  }
  for(const p of photoCandidates) {
    if(chosen.has(p))scan.add({...p,variant:p.interior?p.variant:[0,1,6,7][p.variant%4]})
    else chunk(p.b,[p.x,p.y+p.height/2,p.z],[p.width,p.height,p.depth],random(`${p.x},${p.z}`),p.yaw)
    stats.fragments++
  }
  const geometries=[]
  for(const b of batches.values()) {
    if(!b.positions.length)continue
    const geometry=new BufferGeometry()
    geometry.setAttribute('position',new Float32BufferAttribute(b.positions,3))
    geometry.setAttribute('color',new Float32BufferAttribute(b.colors,3))
    geometry.setAttribute('uv',new Float32BufferAttribute(b.uv,2))
    if(b.hasFractureMask)geometry.setAttribute('v2FractureMask',new Float32BufferAttribute(b.fractureMasks,1))
    geometry.setAttribute('normal',new Float32BufferAttribute(b.normals,3));geometry.computeBoundingBox();geometry.computeBoundingSphere()
    const mesh=new Mesh2(geometry,materials[b.key])
    mesh.name=preview?`V2 ${labels.get(b.cell)||b.cell} · ${b.key}`:`V2 architecture ${b.cell} · ${b.key}`
    mesh.userData={v2Architecture:true,v2Surface:['rebar','steel'].includes(b.key)?'metal':'concrete',architectureSurface:b.key,sourceColliderIds:[...b.ids],selectable:true,v2FractureMask:b.hasFractureMask}
    mesh.castShadow=b.key!=='skyline'&&b.key!=='rebar';mesh.receiveShadow=true
    mesh.matrixAutoUpdate=false
    owned.add(mesh);geometries.push(geometry)
    stats.triangles+=b.positions.length/9;stats.meshes++
  }
  const scanned=scan.finish()
  stats.replacedWallBatches=shells.count;stats.scannedPatches=scanned.patches;stats.scannedTriangles=scanned.triangles;stats.borrowedAtlases=scanned.borrowedAtlases;stats.triangles+=scanned.triangles;stats.meshes+=scanned.meshes;stats.materials+=5
  const cover=mountV2CoverGeometry({viewer,root:owned,map,preview,
    loadBinary:refs?.v2ArchitectureIO?.loadBinary,loadTexture:refs?.v2ArchitectureIO?.loadTexture})
  const ready=Promise.all([scan.ready,cover.ready]).then(()=>{
    stats.coverPiles=cover.stats.piles;stats.coverTriangles=cover.stats.triangles;stats.coverGeometryBytes=cover.stats.geometryBytes
    stats.triangles+=cover.stats.triangles;stats.meshes+=cover.stats.meshes;stats.materials+=cover.stats.materials
    owned.userData.stats={...stats}
  })
  owned.userData.stats={...stats}
  viewer?.setDirty?.()
  let disposed=false
  return {
    root:owned,stats,ready,
    sync(_world) {},
    dispose() {
      if(disposed)return
      disposed=true;owned.removeFromParent();cover.dispose();scan.dispose();shells.dispose()
      // Do not traverse/dispose materials now assigned by another module. Only ours.
      for(const geometry of geometries)geometry.dispose()
      for(const handle of fogHandles)handle.dispose()
      for(const material of Object.values(materials))material.dispose()
      releaseSubtree(owned);owned.clear();viewer?.setDirty?.()
    },
  }
}
function random(text) {
  let seed=2166136261
  for(let i=0;i<text.length;i++)seed=Math.imul(seed^text.charCodeAt(i),16777619)
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}
}
