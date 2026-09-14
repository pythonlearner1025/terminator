import scan from '../../../assets/v2/architecture/rubble-cover.json' with {type:'json'}

// Pure data: integration appends these specs BEFORE World/NavGrid and preview.
// Neither this function nor the renderer mutates the map or adds collisions.
export function getV2ArchitectureCover(map) {
  const byId=new Map((map?.colliders||[]).map(c=>[c.id,c])), result=[]
  const layouts=[
    ['barracks_w_front','exp_barracks_partition_34_0_5.5',-.95,1.35,.96,Math.PI/2],
    ['barracks_e_front','exp_barracks_partition_38_0_5.5',.95,1.65,.92,Math.PI],
    ['barracks_w_rear','exp_barracks_partition_34_0_10',-.92,1.75,.84,Math.PI/2],
    ['barracks_e_rear','exp_barracks_partition_38_0_10',.95,2.35,.88,Math.PI],
    ['service_w_front','exp_service_side_-39',1.48,-8.5,.70,Math.PI/2],
    ['service_w_rear','exp_service_side_-39',1.48,-3.9,.69,Math.PI/2],
    ['service_e_middle','exp_service_side_-31',-1.49,-6.0,.72,Math.PI],
  ]
  for (const [name,anchorId,offsetX,offsetZ,scale,yaw] of layouts) {
    const anchor=byId.get(anchorId)
    if (!anchor || anchor.kind!=='building_wall' || anchor.yaw || anchor.shapes || !anchor.size) continue
    const floorY=anchor.center.y-anchor.size.y/2
    const pile={version:1,source:scan.source,anchorId,sourceBinSha256:scan.sourceBinSha256,x:anchor.center.x+offsetX,y:floorY,z:anchor.center.z+offsetZ,scale,yaw}
    const size={x:(scan.max[0]-scan.min[0])*scale,y:(scan.max[1]-scan.min[1]+.002)*scale,z:(scan.max[2]-scan.min[2])*scale}
    // Supported footprint on a single existing floor, including its outer corners.
    const cs=Math.cos(yaw),sn=Math.sin(yaw)
    const supported=(map.colliders||[]).some(f=>f.kind==='floor'&&!f.yaw&&!f.shapes&&Math.abs(f.center.y+f.size.y/2-floorY)<.025&&[-1,1].every(a=>[-1,1].every(b=>{
      const x=pile.x+a*size.x/2*cs+b*size.z/2*sn,z=pile.z-a*size.x/2*sn+b*size.z/2*cs
      return Math.abs(x-f.center.x)<=f.size.x/2-.035&&Math.abs(z-f.center.z)<=f.size.z/2-.035
    })))
    if (!supported) continue
    const center={x:pile.x,y:floorY+size.y/2,z:pile.z}
    const shapes=scan.cells.map(cell=>({shape:'box',offset:{x:cell.x*scale,y:cell.height*scale/2-size.y/2,z:cell.z*scale},size:{x:cell.width*scale+.00001,y:cell.height*scale,z:cell.depth*scale+.00001}}))
    result.push({id:`v2_arch_cover_${name}`,kind:'rubble',center,size,yaw,navBlock:true,blocksSight:true,shapes,v2ArchitectureCover:true,v2Pile:pile})
  }
  return result
}

// Only exactly matching, explicitly installed specs can create visible cover.
// Extra unrelated metadata is harmless; changed shape/placement is not.
export function declaredV2ArchitectureCover(map) {
  const expected=new Map(getV2ArchitectureCover(map).map(c=>[c.id,c]))
  const result=[]
  for (const e of expected.values()) {
    const matches=(map?.colliders||[]).filter(c=>c.id===e.id)
    if (matches.length!==1 || !matches[0].v2ArchitectureCover) continue
    const c=matches[0]
    if (['kind','center','size','yaw','navBlock','blocksSight','shapes','v2Pile'].every(key=>canonical(c[key])===canonical(e[key]))) result.push(c)
  }
  return result
}
function canonical(value) {
  if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']'
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'
  return JSON.stringify(value)
}
