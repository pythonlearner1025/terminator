/** Replace only positively identified wall-piece triangles in owned runtime batches.
 * Spatial containment is a second guard, never a substitute for source provenance.
 */
export function replaceRuntimeWallShells(root,colliders) {
  const records=[],byId=new Map(colliders.map(c=>[c.id,c]))
  root.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.name.startsWith('Static placed map '))return
    const material=mesh.material
    if(Array.isArray(material)||!/^Map (concrete|rust)$/.test(material?.name||''))return
    if(mesh.position.lengthSq()>1e-12||mesh.scale.distanceToSquared({x:1,y:1,z:1})>1e-12||Math.abs(mesh.quaternion.w-1)>1e-12)return
    const original=mesh.geometry
    if(original.groups.length||original.drawRange.start!==0||original.drawRange.count!==Infinity)return
    const p=original.getAttribute('position'),index=original.index,total=index?.count||p.count
    const draw=original.userData.mapSourceRanges,vertex=mesh.userData.v2SourceRanges
    if(draw&&vertex)return // Multiple competing ownership maps are ambiguous.
    const drawUnits=!!draw
    if(draw&&(draw.version!==1||draw.unit!=='draw-elements'||!Array.isArray(draw.entries)))return
    if(!draw&&!Array.isArray(vertex))return
    const source=draw?draw.entries.map(r=>({first:r.start,count:r.count,sourceId:r.pieceId,
      eligible:r.role==='collider'&&r.nodeId===`collider:${r.pieceId}`,record:r})):vertex.map(r=>({...r,eligible:true}))
    let end=0
    for(const r of source){
      if(!Number.isInteger(r.first)||!Number.isInteger(r.count)||r.first!==end||r.count<=0||typeof r.sourceId!=='string'||!r.sourceId)return
      if((drawUnits||!index)&&(r.first%3||r.count%3))return
      end+=r.count;if(end>(drawUnits?total:p.count))return
    }
    if(end!==(drawUnits?total:p.count))return
    const kept=[],ranges=[]
    let lastRange
    for(let i=0;i<total;i+=3){
      const ids=[0,1,2].map(k=>index?index.getX(i+k):i+k),element=drawUnits?i:ids[0]
      const range=source.find(r=>element>=r.first&&element<r.first+r.count)
      const c=range?.eligible&&(drawUnits||ids.every(j=>j>=range.first&&j<range.first+range.count))?byId.get(range.sourceId):null
      const cs=Math.cos(c?.yaw||0),sn=Math.sin(c?.yaw||0)
      const inside=c&&ids.every(j=>{const dx=p.getX(j)-c.center.x,dy=p.getY(j)-c.center.y,dz=p.getZ(j)-c.center.z
        return Math.abs(dx*cs-dz*sn)<=c.size.x/2+.002&&Math.abs(dy)<=c.size.y/2+.002&&Math.abs(dx*sn+dz*cs)<=c.size.z/2+.002})
      if(!inside){
        if(drawUnits){if(lastRange===range)ranges[ranges.length-1].count+=3
          else{ranges.push({...range.record,start:kept.length,count:3});lastRange=range}}
        kept.push(...ids)
      }
    }
    if(kept.length===total)return
    const geometry=original.clone();geometry.setIndex(kept)
    if(drawUnits)geometry.userData={...original.userData,mapSourceRanges:{...draw,entries:ranges}}
    geometry.computeBoundingBox();geometry.computeBoundingSphere()
    mesh.geometry=geometry;mesh.setDirty?.();records.push({mesh,original,geometry})
  })
  return {count:records.length,dispose(){for(const r of records){if(r.mesh.geometry===r.geometry){r.mesh.geometry=r.original;r.mesh.setDirty?.()}r.geometry.dispose()}records.length=0}}
}
