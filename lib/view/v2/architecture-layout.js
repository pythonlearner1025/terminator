/** Long shear remnants with small aggregate-scale fractures, never periodic waves. */
export function breakProfile(length, rand, amplitude = 1) {
  const spans=[]
  for(let at=-length/2;at<length/2;) {
    const width=Math.min(length/2-at,1.1+rand()*5.7)
    const high=rand()<.32?.025:(.16+rand()*.84)*amplitude
    const drop=.12+rand()*.55
    spans.push({at,width,high,drop,lean:rand()<.5?-1:1})
    at+=width
  }
  const points=[]
  for(const s of spans) {
    const n=Math.max(2,Math.ceil(s.width/(.14+rand()*.16)))
    for(let i=0;i<n;i++) {
      const t=i/n,shoulder=s.lean>0?t:1-t
      const shear=shoulder<s.drop?.12+.88*shoulder/s.drop:1-(shoulder-s.drop)*.22
      points.push([s.at+s.width*t,.025+s.high*shear+(rand()-.5)*.085*amplitude])
    }
  }
  points.push([length/2,points.at(-1)?.[1]||.025])
  return points.map(([u,h])=>[u,Math.max(.012,h)])
}

/** Two offset depth tiers. Every footprint stays outside the playable rectangle. */
export function skylineLayout(bounds, rand) {
  const result=[]
  for(let side=0;side<4;side++)for(let i=0;i<4;i++) {
    const far=i%2===0,along=(i-1.5)*29+(rand()-.5)*13
    const distance=far?65+rand()*18:29+rand()*14
    result.push({id:`skyline-${side}-${i}`,depthTier:far?'far':'near',
      x:side===0?bounds.minX-distance:side===1?bounds.maxX+distance:along,
      z:side===2?bounds.minZ-distance:side===3?bounds.maxZ+distance:along,
      width:14+rand()*16,depth:10+rand()*9,height:far?19+rand()*20:10+rand()*12,
      yaw:(rand()-.5)*.44+(side<2?Math.PI/2:0)})
  }
  return result
}
