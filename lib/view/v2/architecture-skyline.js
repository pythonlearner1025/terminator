import {ShapeUtils, Vector2} from 'three'

/** Closed masonry extrusion, including the depth returns of every actual void. */
export function extrudeMasonry(outline,holes,thickness) {
  const outer=outline.map(p=>p.slice()),voids=holes.map(h=>h.map(p=>p.slice()))
  if(ShapeUtils.isClockWise(outer.map(p=>new Vector2(...p))))outer.reverse()
  for(const h of voids)if(!ShapeUtils.isClockWise(h.map(p=>new Vector2(...p))))h.reverse()
  const flat=[...outer,...voids.flat()],triangles=[]
  const add=(a,b,c)=>triangles.push([a,b,c])
  for(const t of ShapeUtils.triangulateShape(outer.map(p=>new Vector2(...p)),voids.map(h=>h.map(p=>new Vector2(...p))))) {
    add(...t.slice().reverse().map(i=>[...flat[i],0]))
    add(...t.map(i=>[...flat[i],thickness]))
  }
  for(const ring of [outer,...voids])for(let i=0;i<ring.length;i++){
    const a=[...ring[i],0],b=[...ring[(i+1)%ring.length],0],c=[b[0],b[1],thickness],d=[a[0],a[1],thickness]
    add(a,b,c);add(a,c,d)
  }
  return triangles
}

/** Sparse surviving storeys, unequal merged openings and broken deep reveals. */
export function destroyedFacade({x0,x1,bottom,top0,top1,thickness,random:r}) {
  const width=x1-x0,n=Math.max(3,Math.ceil(width/1.1)),crown=[]
  for(let i=0;i<=n;i++){
    const t=i/n,h=top0+(top1-top0)*t+(i===0||i===n?0:(r()-.5)*.9)
    crown.push([x0+t*width,Math.max(bottom+.35,h)])
  }
  const outline=[[x0,bottom],[x1,bottom],...crown.slice().reverse()],holes=[]
  const topAt=x=>{
    const t=(x-x0)/width*n,i=Math.min(n-1,Math.floor(t)),q=t-i
    return crown[i][1]*(1-q)+crown[i+1][1]*q
  }
  const floorHeight=3.1+r()*.8,bay=3.2+r()*1.8
  let row=0
  for(let y=bottom+1.0;y<Math.max(top0,top1)-2;y+=floorHeight,row++){
    let x=x0+.65+r()*.6
    while(x<x1-1.8){
      const span=Math.min(bay*(r()<.28?1.65:.70+r()*.45),x1-x-.60)
      const next=x+span+.65+r()*.85
      if(span<1.1)break
      // Some storeys retain their face; other openings merge into large scars.
      const skip=r()<.18,head=y+1.75+r()*.70
      const knots=crown.filter(p=>p[0]>=x&&p[0]<=x+span).map(p=>p[1])
      if(!skip&&head+.45<Math.min(topAt(x),topAt(x+span),...knots)){
        const sill=y+(row%2?.15:0),a=.12+r()*.28,b=.15+r()*.40
        holes.push([[x+a,sill],[x+span-b,sill+.12],[x+span,head-.38],[x+span-.22,head],[x+.30,head-.08],[x,sill+.40]])
      }
      x=next
    }
  }
  return {triangles:extrudeMasonry(outline,holes,thickness),holes,crown}
}
