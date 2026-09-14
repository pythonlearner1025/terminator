import {ShapeUtils, Vector2} from 'three'

/** A closed, inset solid with connected edge erosion and localized damage beds, rather than a noisy face grid.
 * All coordinates are collider-local [length, height, thickness]. No source assets.
 */
export function wallMorphology({length:L,height:H,thickness:T,random:r,topOpen=false,detail=true}) {
  const triangles=[], cavities=[]
  const emit=(surface,a,b,c)=>triangles.push({surface,a,b,c})
  const quad=(surface,a,b,c,d)=>{emit(surface,a,b,c);emit(surface,a,c,d)}
  const half=T/2-.002, endMax=Math.min(L*(detail?.18:.22),detail?.46:.66), topMax=topOpen?Math.min(H*(detail?.24:.30),detail?.65:1.05):Math.min(.045,H*.04)
  // Unequal surviving shoulders joined by short angular fractures. This is a
  // piecewise failure profile, not a bell-shaped shear or periodic tooth wave.
  function failureProfile(length,maximum) {
    const out=[[0,maximum*(.04+r()*.13)]]
    let t=0,level=out[0][1],state=r()
    while(t<1) {
      let end=Math.min(1,t+((detail?.36:.85)+r()*(detail?.82:1.45))/length)
      if((1-end)*length<.14)end=1
      const step=(end-t)*(.18+r()*.55)
      const next=maximum*(state<.35?.04+r()*.14:state<.78?.27+r()*.30:.64+r()*.31)
      if(end-step>t+1e-7)out.push([end-step,Math.max(.002,level+(r()-.5)*maximum*.28)])
      out.push([end,next]);t=end;level=next;state=r()
    }
    if(!detail||maximum<.1)return out
    const chipped=[out[0]]
    for(let i=1;i<out.length;i++){
      const [a,da]=out[i-1],[b,db]=out[i],span=(b-a)*length
      // Small failure fans cluster on some surviving shoulders. Long quiet
      // stretches remain; no repeated teeth or periodic all-edge jitter.
      if(span>.23&&r()<.72){
        const start=.12+r()*.30,end=Math.min(.93,start+.22+r()*.30),count=3+Math.floor(r()*3)
        for(let j=0;j<count;j++){
          const q=start+(end-start)*j/(count-1),t=a+(b-a)*q
          const chip=Math.min(maximum*.22,.11)*(.3+r()*.7)*(j%2?1:.28)
          chipped.push([t,Math.min(maximum*.99,da+(db-da)*q+chip)])
        }
      }
      chipped.push(out[i])
    }
    return chipped
  }
  const crown=failureProfile(L,topMax)
  const profiles=[failureProfile(H,endMax),failureProfile(H,endMax)]
  const endDepth=Math.max(...profiles.flat().map(p=>p[1]))
  const crownDepth=Math.max(...crown.map(p=>p[1]))
  const bandX=Math.min(L*.20,detail?.30+r()*.32:.16+r()*.24)
  const bandY=Math.min(H*.13,detail?.16+r()*.19:.09+r()*.14)
  const coreX=Math.max(L*.12,L/2-endDepth-bandX)
  const coreBottom=-H/2+Math.min(H*.08,.17)
  const coreTop=Math.max(coreBottom+H*.28,H/2-crownDepth-bandY)
  // Side failure knots stop below the lowest crown. Separate corner shoulders
  // connect them without crossing a descending crown fracture.
  const left=profiles[0],right=profiles[1]
  const contour=[[-L/2+left[0][1],-H/2]]
  for(const [t,d] of right)contour.push([L/2-d,-H/2+t*(H-crownDepth)])
  for(let i=crown.length-1;i>=0;i--){const [t,d]=crown[i];contour.push([-L/2+endDepth+t*(L-2*endDepth),H/2-d])}
  for(let i=left.length-1;i>0;i--){const [t,d]=left[i];contour.push([-L/2+d,-H/2+t*(H-crownDepth)])}
  for(let i=contour.length-1;i>=0;i--){const a=contour[i],b=contour[(i+1)%contour.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-9)contour.splice(i,1)}
  const inner=[[-coreX,coreBottom],[coreX,coreBottom]]
  // Several context-sized tongues of erosion reach in from a failed edge.
  // Different wall spans retain different coherent faces, not a picture frame.
  const sideReach=Math.min(coreX*.24,.28), topReach=Math.min((coreTop-coreBottom)*.32,.62)
  for(const t of [.20,.44,.72])inner.push([coreX-sideReach*(.18+r()*.82),coreBottom+t*(coreTop-coreBottom)])
  inner.push([coreX,coreTop])
  const bays=Math.max(1,Math.ceil(L/(2.4+r()*2.8)))
  for(let k=bays-1;k>=0;k--){
    const center=(k+.3+r()*.4)/bays,width=.17/bays,reach=topReach*(.25+r()*.75)
    for(const [u,v] of [[center+width,0],[center,reach],[center-width,reach*.36]])inner.push([-coreX+2*coreX*u,coreTop-v])
  }
  inner.push([-coreX,coreTop])
  for(const t of [.77,.53,.26])inner.push([-coreX+sideReach*(.18+r()*.82),coreBottom+t*(coreTop-coreBottom)])
  const distance=(p,polygon)=>{
    let best=Infinity
    for(let i=0;i<polygon.length;i++){
      const a=polygon[i],b=polygon[(i+1)%polygon.length],u=b[0]-a[0],v=b[1]-a[1]
      const t=Math.max(0,Math.min(1,((p[0]-a[0])*u+(p[1]-a[1])*v)/(u*u+v*v)))
      best=Math.min(best,Math.hypot(p[0]-a[0]-t*u,p[1]-a[1]-t*v))
    }
    return best
  }
  for(const side of [-1,1]) {
    // Triangulate the eroded band as an annulus. Joining corresponding rings
    // folds at undercuts; a constrained bed instead follows the actual boundary.
    const depth=Math.min(T*.29,.115), spacing=detail?.23:.45
    const bed=distributedBed(contour.map(p=>[...p,side*half]),spacing,r,side*(half-depth*.8),depth*.08,
      [inner.map(p=>[...p,side*half])],p=>side*(half-depth*Math.min(1,distance(p,contour)/.075,distance(p,inner)/.10)*(.76+r()*.20)))
    for(const t of bed.triangles){const q=t.map(i=>bed.points[i]);if(side<0)q.reverse();emit('fracture',...q);triangles.at(-1).region='edge-bed'}
  }
  // Keep a substantial core: either side removes at most 35% of wall thickness.
  for(const side of [-1,1]) {
    const holes=[], patches=[]
    const wanted=H<1?0:detail?1:(r()<.45?1:0)
    const marginX=L/2-coreX+.07, marginY=Math.max(H/2-coreTop,H/2+coreBottom)+.07
    for(let attempt=0;attempt<wanted*15&&patches.length<wanted;attempt++) {
      const rx=Math.min(.38+r()*.50,(L-2*marginX)*.28),ry=Math.min(.48+r()*.78,(H-2*marginY)*.26)
      if(rx<.09||ry<.09)break
      const x=(r()-.5)*(L-2*(marginX+rx)), y=(r()-.5)*(H-2*(marginY+ry))
      if(distance([x,y],inner)<Math.max(rx,ry)+.025)continue
      if(patches.some(p=>Math.hypot((x-p.x)/(rx+p.rx+.08),(y-p.y)/(ry+p.ry+.08))<1))continue
      const n=detail?18+Math.floor(r()*6):11,phase=r()*Math.PI*2
      const shoulders=[1,.83,.94,.72,.91].map(v=>v*(.83+r()*.17))
      const shape=Array.from({length:n},(_,i)=>{const a=phase+i*Math.PI*2/n,t=i*shoulders.length/n,j=Math.floor(t),rad=shoulders[j]*(1-(t-j))+shoulders[(j+1)%shoulders.length]*(t-j)-r()*.055;return [Math.cos(a)*rx*rad,Math.sin(a)*ry*rad]})
      const hole=shape.map(([u,v])=>[x+u,y+v])
      holes.push(hole);patches.push({x,y,rx,ry,shape,side,depth:Math.min(T*.35,.10+r()*.15)})
    }
    const faceContour=inner
    const flat=[...faceContour,...holes.flat()]
    for(const t of ShapeUtils.triangulateShape(faceContour.map(p=>new Vector2(...p)),holes.map(h=>h.map(p=>new Vector2(...p))))) {
      const p=t.map(i=>[...flat[i],side*half]);if(side<0)p.reverse()
      emit('concrete',...p)
    }
    for(const p of patches) {
      const {x,y,shape,depth}=p,n=shape.length
      // Chipped lip, exposed coarse shoulder, deep uneven bed. Angular offsets
      // remain shared radially so every ring is watertight and nonintersecting.
      const layers=[[1,0],[.87,.27],[.68,.83]]
      const rings=layers.map(([scale,d],layer)=>shape.map(([u,v])=>[
        x+u*scale,y+v*scale,side*(half-depth*(d+(layer? (r()-.5)*.23:0)))
      ]))
      for(let k=0;k<rings.length-1;k++)for(let i=0;i<n;i++){
        const j=(i+1)%n,q=[rings[k][i],rings[k][j],rings[k+1][j],rings[k+1][i]]
        if(side<0)q.reverse();quad('fracture',...q)
      }
      const bed=distributedBed(rings.at(-1),Math.min(p.rx,p.ry)*.31,r,side*(half-depth*.87),depth*.035)
      for(const t of bed.triangles){const q=t.map(i=>bed.points[i]);if(side<0)q.reverse();emit('fracture',...q);triangles.at(-1).region='pocket-bed'}
      // A handful of partially exposed aggregate stones rooted in the recessed bed.
      // Relief remains behind the original face, with coarse/medium/fine hierarchy.
      for(let k=0;k<(detail?7:3);k++) {
        const angle=r()*Math.PI*2,rad=r()*.43,xx=x+Math.cos(angle)*p.rx*rad,yy=y+Math.sin(angle)*p.ry*rad
        const size=Math.min(p.rx,p.ry)*(k<2?.16:k<5?.09:.045),base=half-depth*.85
        const ring=Array.from({length:5},(_,i)=>{const a=i*Math.PI*2/5;return [xx+Math.cos(a)*size,yy+Math.sin(a)*size,side*base]})
        const tip=[xx+size*.15,yy-size*.2,side*(base+Math.min(size*.7,depth*.35))]
        for(let i=0;i<5;i++){const q=[ring[i],ring[(i+1)%5],tip];if(side<0)q.reverse();emit('fracture',...q)}
      }
      cavities.push({x,y,rx:p.rx,ry:p.ry,side,depth})
    }
  }
  // Rough full-thickness returns. Independent inset steps expose thickness as
  // several broad surviving strata, not two lips bridged by one smooth plane.
  const strata=3
  const rings=Array.from({length:strata},(_,k)=>{
    const inset=k===0||k===strata-1?0:.024+r()*.009
    // One positive affine inset per stratum preserves the simple fracture
    // outline. Independent knot jitter can invert short aggregate-sized chips.
    return contour.map(([x,y])=>[x*(1-Math.min(inset,L*.035)/(L/2)),y*(1-Math.min(inset,H*.035)/(H/2)),-half+k*2*half/(strata-1)])
  })
  for(let k=0;k<strata-1;k++)for(let i=0;i<contour.length;i++){
    const j=(i+1)%contour.length
    quad('fracture',rings[k][j],rings[k+1][j],rings[k+1][i],rings[k][i])
  }
  return {triangles,cavities,edgeContours:rings}
}

// Constrained planar triangulation with dispersed interior points and local edge
// flips. The closed boundary is never subdivided: its exact ring vertices are
// shared with the shoulder. No center fan or wall-wide face tessellation.
function distributedBed(boundary,spacing,random,z,relief,holes=[],height=null) {
  const points=[...boundary,...holes.flat()].map(p=>p.slice())
  const triangles=ShapeUtils.triangulateShape(boundary.map(p=>new Vector2(p[0],p[1])),holes.map(h=>h.map(p=>new Vector2(p[0],p[1]))))
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys)
  let row=0
  for(let y=y0+spacing*.65;y<y1;y+=spacing,row++)for(let x=x0+spacing*(row%2?.9:.4);x<x1;x+=spacing) {
    const p=[x+(random()-.5)*spacing*.20,y+(random()-.5)*spacing*.20,z+(random()-.5)*relief]
    const index=triangles.findIndex(t=>t.every((a,i)=>cross(points[a],points[t[(i+1)%3]],p)>1e-8))
    if(index<0)continue
    if(height)p[2]=height(p)
    const [a,b,c]=triangles[index],id=points.length;points.push(p)
    triangles.splice(index,1,[a,b,id],[b,c,id],[c,a,id])
  }
  const circum=(a,b,c,d)=>{
    const ax=a[0]-d[0],ay=a[1]-d[1],bx=b[0]-d[0],by=b[1]-d[1],cx=c[0]-d[0],cy=c[1]-d[1]
    return (ax*ax+ay*ay)*(bx*cy-by*cx)-(bx*bx+by*by)*(ax*cy-ay*cx)+(cx*cx+cy*cy)*(ax*by-ay*bx)
  }
  for(let pass=0;pass<16;pass++) {
    const edges=new Map();let flipped=false
    for(let i=0;i<triangles.length;i++)for(let k=0;k<3;k++){
      const t=triangles[i],a=t[k],b=t[(k+1)%3],c=t[(k+2)%3],key=a<b?`${a}:${b}`:`${b}:${a}`
      const e=edges.get(key)
      if(!e){edges.set(key,{i,a,b,c});continue}
      // Only still-adjacent triangles can flip; earlier flips invalidate entries.
      if(!triangles[e.i].includes(e.a)||!triangles[e.i].includes(e.b)||!triangles[e.i].includes(e.c))continue
      if(c===e.c||cross(points[c],points[e.c],points[b])<=1e-10||cross(points[e.c],points[c],points[a])<=1e-10)continue
      if(circum(points[a],points[b],points[c],points[e.c])<=1e-10)continue
      triangles[i]=[c,e.c,b];triangles[e.i]=[e.c,c,a];flipped=true;break
    }
    if(!flipped)break
  }
  return {points,triangles}
}
