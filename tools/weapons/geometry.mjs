// Offline authoring helpers. This module is never imported by the game.
globalThis.ImageData ??= class {}
export const T = await import('three')
const {mergeGeometries} = await import('three/addons/utils/BufferGeometryUtils.js')
const {RoundedBoxGeometry} = await import('three/addons/geometries/RoundedBoxGeometry.js')
export const tiles = ['steel','edge','dark','polymer','wood','glove','cloth','brass','red','olive','white','cell','mark','knuckle','rubber','glass']
export function group(name,parent,pos=[0,0,0]) {const g=new T.Group();g.name=name;g.position.fromArray(pos);parent?.add(g);return g}
export class Parts {
  constructor() {this.buckets=new Map()}
  add(parent,geo,surface='steel',pos=[0,0,0],rot=[0,0,0],size=[1,1,1]) {
    let g=geo.index?geo.toNonIndexed():geo.clone()
    const p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv
    if(!uv)g.setAttribute('uv',new T.Float32BufferAttribute(new Float32Array(p.count*2),2))
    g.computeBoundingBox();const min=g.boundingBox.min,max=g.boundingBox.max,span=max.clone().sub(min)
    const tile=tiles.indexOf(surface);if(tile<0)throw Error(surface)
    // Per-part planar unwrap keeps lettering straight and aligns wear with real edges.
    for(let i=0;i<p.count;i++) {
      const normal=new T.Vector3(n.getX(i),n.getY(i),n.getZ(i));const a=[Math.abs(normal.x),Math.abs(normal.y),Math.abs(normal.z)]
      const face=a.indexOf(Math.max(...a));let u,v
      if(face===0){u=(p.getZ(i)-min.z)/(span.z||1);v=(p.getY(i)-min.y)/(span.y||1)}
      else if(face===1){u=(p.getZ(i)-min.z)/(span.z||1);v=(p.getX(i)-min.x)/(span.x||1)}
      else {u=(p.getX(i)-min.x)/(span.x||1);v=(p.getY(i)-min.y)/(span.y||1)}
      if(['glove','cloth','knuckle'].includes(surface)&&uv){u=uv.getX(i);v=uv.getY(i)}
      g.attributes.uv.setXY(i,((tile%4)+.015+u*.97)/4,(3-Math.floor(tile/4)+.015+v*.97)/4)
    }
    const m=new T.Matrix4().compose(new T.Vector3(...pos),new T.Quaternion().setFromEuler(new T.Euler(...rot)),new T.Vector3(...size))
    g.applyMatrix4(m)
    const bucket=this.buckets.get(parent)||[];bucket.push(g);this.buckets.set(parent,bucket);geo.dispose();return g
  }
  box(p,s,at,m='steel',r=[0,0,0],bevel=.0015) {
    const g=new RoundedBoxGeometry(...s,1,Math.min(bevel,Math.min(...s)*.2));return this.add(p,g,m,at,r)
  }
  sphere(p,s,at,m='steel',r=[0,0,0]) {return this.add(p,new T.SphereGeometry(1,16,10),m,at,r,s)}
  rod(p,r,l,at,m='steel',rot=[Math.PI/2,0,0],segments=24) {return this.add(p,new T.CylinderGeometry(r,r,l,segments,1),m,at,rot)}
  tube(p,outer,inner,l,at,m='steel',segments=32) {
    const profile=[[inner,-l/2],[outer-.001,-l/2],[outer,-l/2+.001],[outer,l/2-.001],[outer-.001,l/2],[inner,l/2],[inner,-l/2]].map(a=>new T.Vector2(...a))
    let geometry=new T.LatheGeometry(profile,segments)
    if(segments===8){const flat=geometry.toNonIndexed();geometry.dispose();geometry=flat;geometry.computeVertexNormals()}
    return this.add(p,geometry,m,at,[Math.PI/2,0,0])
  }
  ring(p,r,t,at,m='edge',rot=[0,0,0]) {return this.add(p,new T.TorusGeometry(r,t,6,24),m,at,rot)}
  profile(p,points,depth,at=[0,0,0],mat='steel',bevel=.002) {
    // Shape points are [z,y]. Extrude along X to author the side silhouette.
    const shape=new T.Shape();shape.moveTo(points[0][0],points[0][1]);for(const [z,y] of points.slice(1))shape.lineTo(z,y);shape.closePath()
    const g=new T.ExtrudeGeometry(shape,{depth,steps:1,bevelEnabled:bevel>0,bevelThickness:bevel,bevelSize:bevel,bevelSegments:2,curveSegments:8})
    // Mapping shape +X -> world -Z keeps outward winding after the rotation.
    g.translate(0,0,-depth/2);g.rotateY(Math.PI/2);g.scale(1,1,-1)
    // Reflection reverses the triangles.
    const a=g.attributes
    for(let i=0;i<a.position.count;i+=3)for(const name of ['position','normal','uv']){
      const v=a[name],size=v.itemSize
      for(let c=0;c<size;c++){const k=(i+1)*size+c,j=(i+2)*size+c,t=v.array[k];v.array[k]=v.array[j];v.array[j]=t}
    }
    g.computeVertexNormals();return this.add(p,g,mat,at)
  }
  path(p,points,r,mat='steel',segments=24) {return this.add(p,new T.TubeGeometry(new T.CatmullRomCurve3(points.map(a=>new T.Vector3(...a))),segments,r,8,false),mat)}
  finish(material) {
    for(const [parent,geos] of this.buckets) {
      const g=mergeGeometries(geos);g.computeBoundingSphere();const mesh=new T.Mesh(g,material);mesh.name=parent.name+' Surface';parent.add(mesh)
      geos.forEach(g=>g.dispose())
    }
  }
}
export function bolt(b,p,x,y,z,r=.0035) {
  b.rod(p,r,.0025,[x,y,z],'edge',[0,0,Math.PI/2],12)
  b.box(p,[.001,.001,r*1.3],[x+(x<0?-.0016:.0016),y,z],'dark',[0,0,0],.0001)
}
export function rail(b,p,start,end,y,width=.037) {
  b.box(p,[width*.80,.007,end-start],[0,y-.004,(start+end)/2],'dark')
  const count=Math.floor((end-start)/.016)
  for(let i=0;i<count;i++)b.box(p,[width,.005,.008],[0,y+.001,start+i*.016+.005],'steel',[0,0,0],.0007)
}
export function trigger(b,body,z=0,y=-.038,brass=false) {
  const bow=group('TriggerGuard',body)
  b.path(bow,[[0,y+.019,z+.025],[0,y-.032,z+.025],[0,y-.041,z-.017],[0,y-.029,z-.055],[0,y+.017,z-.051]],.0037,brass?'brass':'dark',20)
  const t=group('Trigger',body)
  b.path(t,[[0,y+.016,z-.009],[0,y-.009,z-.020],[0,y-.018,z-.010]],.0027,'edge',10)
}
export function sights(b,body,front,rear,y,{aperture=true}={}) {
  const g=group('Sights',body)
  b.box(g,[.032,.005,.030],[0,y-.023,rear],'dark')
  if(aperture){b.ring(g,.0045,.002,[0,y,rear],'steel');b.box(g,[.009,.020,.010],[0,y-.015,rear],'steel');for(const x of [-.012,.012])b.box(g,[.003,.023,.012],[x,y-.006,rear],'dark')}
  else for(const s of [-1,1])b.box(g,[.011,.013,.017],[s*.010,y-.003,rear],'steel')
  b.box(g,[.031,.007,.026],[0,y-.031,front],'dark')
  b.box(g,[.0038,.026,.011],[0,y-.014,front],'edge')
  return {height:y,distance:.30,front,rear}
}
