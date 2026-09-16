import {T,Parts,group} from './geometry.mjs'
export const FINGERS=['Index','Middle','Ring','Little','Thumb']
// Continuous lofts keep joints round and supply enough rings for smooth skinning.
function loft(rings,segments=12) {
  const p=[],uv=[],ix=[]
  for(let j=0;j<rings.length;j++)for(let i=0;i<=segments;i++){
    const [y,rx,rz,cx=0,cz=0]=rings[j],a=i/segments*Math.PI*2
    p.push(cx+Math.cos(a)*rx,y,cz+Math.sin(a)*rz);uv.push(i/segments,j/(rings.length-1))
    if(j<rings.length-1&&i<segments){const k=j*(segments+1)+i;ix.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2)}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(ix);g.computeVertexNormals();return g
}
export function buildHands() {
  const root=group('Hands Asset'),material=new T.MeshStandardMaterial({name:'hands 2K PBR',metalness:1,roughness:1})
  for(const side of ['Right','Left']){
    const holder=group(side+'Hand',root),bones=[],b=new Parts(),skinGroup=group(side+'Glove',holder)
    const bone=(name,parent,at=[0,0,0])=>{const o=new T.Bone();o.name=side+name;o.position.fromArray(at);parent.add(o);bones.push(o);return o}
    const palm=bone('Palm',holder),forearm=bone('Forearm',palm,[0,-.057,0])
    const give=(g,index,weightFn)=>{
      const count=g.attributes.position.count,ids=new Uint16Array(count*4),w=new Float32Array(count*4)
      for(let i=0;i<count;i++){
        const data=weightFn?.(g.attributes.position.getY(i))
        ids[i*4]=data?.[0]??index;w[i*4]=data?.[2]??1
        if(data){ids[i*4+1]=data[1];w[i*4+1]=1-data[2]}
      }
      g.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(w,4));return g
    }
    const add=(geo,surface='glove',pos=[0,0,0],rot=[0,0,0],scale=[1,1,1],index=0)=>give(b.add(skinGroup,geo,surface,pos,rot,scale),index)
    const palmGeometry=add(loft([[-.081,.019,.014],[-.060,.021,.014],[-.045,.025,.015],[-.023,.032,.016],[.007,.036,.016],[.025,.038,.014],[.039,.030,.012],[.041,.017,.010]],16))
    give(palmGeometry,0,y=>[0,1,Math.max(0,Math.min(1,(y+.080)/.035))])
    // Thenar pad, metacarpal volume, reinforced back and wrist closure.
    add(new T.SphereGeometry(1,10,6),'glove',[-.025,-.014,-.006],[0,0,-.30],[.015,.026,.015])
    for(let fi=0;fi<5;fi++){
      const finger=FINGERS[fi],thumb=fi===4
      const x=thumb?-.033:[-.029,-.009,.012,.030][fi],y=thumb?-.016:[.029,.037,.034,.021][fi],z=thumb?-.006:0
      const lengths=thumb?[.028,.023,.020]:[[.029,.022,.017],[.034,.024,.019],[.032,.023,.018],[.025,.018,.015]][fi]
      const radius=thumb?.0105:fi===3?.0078:.009
      const joints=[bone(finger+'1',palm,[x,y,z])]
      joints.push(bone(finger+'2',joints[0],[0,lengths[0],0]))
      joints.push(bone(finger+'3',joints[1],[0,lengths[1],0]))
      const tip=bone(finger+'Tip',joints[2],[0,lengths[2],0]);tip.userData.contactRadius=radius*.60
      const total=lengths.reduce((a,b)=>a+b,0),rings=[]
      for(let k=0;k<=10;k++){
        const t=k/10,bulge=1+.07*Math.cos(t*Math.PI*4),end=t>.88?Math.sqrt(Math.max(.025,1-((t-.88)/.13)**2)):1
        rings.push([y+t*total,radius*bulge*(1-t*.25)*end,radius*.89*bulge*(1-t*.23)*end,x,z])
      }
      const g=b.add(skinGroup,loft(rings,12),'glove')
      const numbers=joints.map(j=>bones.indexOf(j)),knots=[y,y+lengths[0],y+lengths[0]+lengths[1]]
      give(g,numbers[0],v=>{
        for(let j=2;j>=1;j--)if(v>knots[j]-.006){const w=Math.max(0,Math.min(1,(v-knots[j]+.006)/.012));return [numbers[j],numbers[j-1],w]}
        return [numbers[0],0,Math.min(1,Math.max(0,(v-y+.003)/.011))]
      })

    }
    const sleeveRings=[]
    for(let i=0;i<=18;i++){
      const t=i/18,y=-.069-.35*t,base=.031+.026*Math.sin(t*Math.PI*.55),fold=(Math.sin(t*38)+Math.sin(t*63)*.35)*.0045*Math.sin(t*Math.PI)
      sleeveRings.push([y,base+fold,(base+fold)*.84,.008*t,.025*t*t])
    }
    // Reverse the rings to keep the same outward winding as the palm loft.
    add(loft(sleeveRings.reverse(),16),'cloth',undefined,undefined,undefined,1)
    for(let i=0;i<1;i++)add(new T.TorusGeometry(.031,.006,6,20),'cloth',[0,-.075,0],[Math.PI/2,0,0],[1,1,.83],1)
    b.finish(material)
    const old=skinGroup.children[0],mesh=new T.SkinnedMesh(old.geometry,material);mesh.name=side+' Hand and Sleeve';old.removeFromParent();skinGroup.add(mesh)
    root.updateMatrixWorld(true);const skeleton=new T.Skeleton(bones);mesh.bind(skeleton)
    if(side==='Left')holder.scale.x=-1
    holder.userData.handRig={side,fingers:FINGERS};holder.userData.gltfUUID='hands-'+side
  }
  root.userData={weaponAsset:'hands',gltfUUID:'weapon-hands-root'}
  root.traverse(n=>{n.userData.gltfUUID ||= 'hands-'+n.name.replaceAll(' ','-')})
  return root
}
