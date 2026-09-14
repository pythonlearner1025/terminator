// CPU-only, deterministic smoke synthesis. No image/canvas APIs or runtime ray marching.
const mix = (a, b, t) => a + (b - a) * t
const smooth = t => t * t * (3 - 2 * t)
const clamp = x => Math.min(1, Math.max(0, x))
const ramp = (a, b, x) => smooth(clamp((x - a) / (b - a)))
const hash = (x, y, z) => {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1442695041)
  n = Math.imul(n ^ n >>> 13, 1274126177)
  return ((n ^ n >>> 16) >>> 0) / 4294967295
}
export function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz)
  const a = mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), u)
  const b = mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), u)
  const c = mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), u)
  const d = mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), u)
  return mix(mix(a, b, v), mix(c, d, v), w)
}
function turbulence(x, y, z) {
  let value = 0, amplitude = .55
  for (let i = 0; i < 4; i++) {
    value += noise3(x, y, z) * amplitude
    // Rotated octave coordinates avoid aligned texture bands.
    const oldX = x
    x = y * 1.64 + z * 1.21 + 13.1
    y = z * 1.64 - oldX * 1.21 - 7.3
    z = oldX * 1.64 + y * .37 + 3.8
    amplitude *= .48
  }
  return value
}
export const V2_SKY_LAMPS = Object.freeze([
  Object.freeze([-28, 19, 47, 220]), Object.freeze([-57, 24, -23, 190]), Object.freeze([43, 18, 37, 165]),
])
let cachedSky
const srgbByte = x => Math.round(255 * clamp(x <= .0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - .055))
// The enclosure supplies quiet distant air only. Visible self-shaded billows live
// on finite banks at distinct world depths, rather than noisy sky-wide strata.
export function bakeSky(width = 2048, height = 1024) {
  if (width === 2048 && height === 1024 && cachedSky) return cachedSky
  const data = new Uint8Array(width * height * 4)
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    const phi=i/(width-1)*Math.PI*2, theta=j/(height-1)*Math.PI
    const x=-Math.cos(phi)*Math.sin(theta), y=-Math.cos(theta), z=Math.sin(phi)*Math.sin(theta)
    const mass=noise3(x*3.2+17,y*3.2-4,z*3.2+9)
    const canopy=1-ramp(.12,.9,y)*.60
    const quiet=(.62+.38*mass)*canopy
    const k=(j*width+i)*4
    // Quiet distant air behind the finite smoke, strongest at the horizon.
    // This is background radiance only; no increase to surface fill or world fog.
    const lowerAir=1-ramp(.02,.52,y)
    data[k]=srgbByte((.018+.007*lowerAir)*quiet)
    data[k+1]=srgbByte((.030+.019*lowerAir)*quiet)
    data[k+2]=srgbByte((.056+.036*lowerAir)*quiet)
    data[k+3]=255
  }
  const result={data,width,height}
  if(width===2048&&height===1024)cachedSky=result
  return result
}
/** Nearly uniform light-carrying air; edge feathering, never black smoke cutouts. */
export function bakeMist(size = 96) {
  const data = new Uint8Array(size * size * 4)
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const u=x/(size-1),v=y/(size-1),edge=Math.pow(Math.max(0,1-((u-.5)*2)**2-((v-.5)*2)**2),.8)
    const k=(y*size+x)*4,variation=.76+noise3(u*8,v*8,17)*.24
    data[k]=data[k+1]=data[k+2]=255;data[k+3]=Math.round(edge*variation*255)
  }
  return {data,width:size,height:size}
}
// Bounded CPU bake: a 96×96×64 density volume, one directional optical-depth
// sweep from the rear light, then front-to-back single-scattering integration.
// Nothing here runs in sync or uses a browser/GPU. Only default production maps
// are cached; arbitrary test sizes cannot grow a long-lived cache.
const volumeCache = new Map()
function bakeVolume(size, seed, lamp, plume = false, sampling = {}) {
  const cacheKey = `${lamp}:${plume}:${seed}`
  const cacheable = !sampling.resolution && !sampling.depth && Number.isInteger(seed) && seed >= 0 && (lamp ? size === 256 && seed < 3 : size === 384 && seed < (plume ? 4 : 6))
  if (cacheable && volumeCache.has(cacheKey)) return volumeCache.get(cacheKey)
  const n = Math.min(192, Math.max(16,sampling.resolution || Math.min(96,size))), depth = Math.min(128, sampling.depth || Math.min(64,n)), area = n*n, dz = 2/(depth-1)
  const density = new Float32Array(area*depth), optical = new Float32Array(area*depth)
  // A substantial connected core plus overlapping unequal 3D billows. There is
  // no line of small circles, derivative edge mask, or noise-cut center opacity.
  const lobes = plume
    ? [[-.12,-.55,0,.20,.28,.26],[-.08,-.22,.02,.28,.34,.34],
      [.04,.12,-.05,.34,.34,.39],[.17,.40,-.09,.38,.31,.36]]
    : [[-.25,-.08,0,.40,.32,.40],[.2,0,.03,.42,.34,.40],[.04,.22,-.1,.30,.31,.32]]
  if (plume) for (const [i,lobe] of lobes.entries()) {
    lobe[0]+=(hash(i,seed,21)-.5)*.12
    lobe[3]*=.92+hash(i,seed,22)*.22
  }
  for (let i=0;i<24;i++) {
    const angle=i*2.399+seed*.79, radius=.14+hash(i,seed,4)*.13
    const rise=-.58+(i/23)*1.16, spread=.10+(rise+.58)*.14
    lobes.push([plume ? rise*.24+Math.cos(angle)*spread : Math.cos(angle)*.53,
      plume ? rise : Math.sin(angle)*.34+(hash(i,seed,2)-.5)*.12,
      (hash(i,seed,8)-.5)*(plume?.40:.50),
      radius*(plume?.82:1),radius*(.78+hash(i,seed,6)*.35),radius*(.8+hash(i,seed,3)*.3)])
  }
  // The larger connected ellipsoids otherwise bury the small front billows.
  // Attach a bounded set to the visible volume surface, not a 2D edge mask.
  if (plume) for(let i=0;i<16;i++) {
    const rise=-.52+(i/15)*1.04,angle=i*2.399+seed*.61
    const r=.105+hash(i,seed,31)*.075
    lobes.push([rise*.20+Math.cos(angle)*(.12+(rise+.52)*.10),rise,
      .22+hash(i,seed,32)*.12,r,r*(.8+hash(i,seed,33)*.4),r])
  }
  for (let z=0;z<depth;z++) for (let y=0;y<n;y++) for (let x=0;x<n;x++) {
    const px=x/(n-1)*2-1,py=y/(n-1)*2-1,pz=z/(depth-1)*2-1
    const warp=(turbulence(px*9+seed*7,py*9-11,pz*9+seed*3)-.46)*(plume?.50:.24)
    let d=-10
    for (const [cx,cy,cz,rx,ry,rz] of lobes) {
      const r=Math.sqrt(((px-cx)/rx)**2+((py-cy)/ry)**2+((pz-cz)/rz)**2)
      d=Math.max(d,(1-r)*Math.min(rx,ry,rz))
    }
    // Smooth extinction ramp follows the volume boundary, with a protective
    // outer envelope reaching zero before every texture edge.
    const bound=1-ramp(.82,.98,Math.max(Math.abs(px),Math.abs(py),Math.abs(pz)))
    // Filled core density varies smoothly in 3D without perforating its alpha.
    // This affects both optical paths, not a decorative noise overlay on RGB.
    const body=plume?.8+.5*noise3(px*5+seed*3,py*5-7,pz*5+11):1
    density[z*area+y*n+x]=ramp(plume?-.012:-.025,plume?.022:.075,d+warp)*bound*body
  }
  const sliceSample = (array,z,x,y) => {
    if (x<0||y<0||x>n-1||y>n-1||z<0) return 0
    const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy
    const a=z*area+iy*n+ix,b=z*area+Math.min(iy+1,n-1)*n+ix
    return mix(mix(array[a],array[a+(ix<n-1?1:0)],u),
      mix(array[b],array[b+(ix<n-1?1:0)],u),v)
  }
  const extinction=lamp?2.2:plume?10:6.5
  // Positive image X/Y, negative volume Z: oblique backlight, not an all-around rim.
  for(let z=0;z<depth;z++) for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const k=z*area+y*n+x
    optical[k]=sliceSample(optical,z-1,x+1.8,y+1.25)+density[k]*dz*extinction
  }
  // Weak oblique sky light arrives from the front/top side. Rear light alone
  // leaves opaque cores constant-colored: bright contour with a visually empty
  // interior. A second optical path reveals self-shadowed attached billows.
  const frontOptical=plume?new Float32Array(area*depth):null
  if (frontOptical) for(let z=depth-1;z>=0;z--) for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const k=z*area+y*n+x
    frontOptical[k]=(z===depth-1?0:sliceSample(frontOptical,z+1,x-.9,y+1.5))+density[k]*dz*extinction
  }
  const projected=new Float32Array(area*4)
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    let transmission=1,red=0,green=0,blue=0
    for(let z=depth-1;z>=0;z--) {
      const k=z*area+y*n+x,d=density[k],alpha=1-Math.exp(-d*extinction*dz)
      const light=Math.exp(-optical[k]*.85),weight=transmission*alpha
      // Low-frequency multiple-scattering approximation gives dark cores body.
      // Direct light is attenuated by actual integrated density toward the rear.
      const side=frontOptical?Math.exp(-frontOptical[k]*1.15):0
      red+=weight*((plume?.006:.025)+light*(lamp?.22:plume?.17:.23)+side*.024)
      green+=weight*((plume?.012:.042)+light*(lamp?.37:plume?.27:.36)+side*.043)
      blue+=weight*((plume?.024:.075)+light*(lamp?.65:plume?.42:.57)+side*.075)
      transmission*=1-alpha
    }
    const k=(y*n+x)*4
    projected[k]=red;projected[k+1]=green;projected[k+2]=blue;projected[k+3]=1-transmission
  }
  const data=new Uint8Array(size*size*4)
  for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const px=x/(size-1)*(n-1),py=y/(size-1)*(n-1),ix=Math.floor(px),iy=Math.floor(py)
    const u=px-ix,v=py-iy,a=(iy*n+ix)*4,b=(Math.min(iy+1,n-1)*n+ix)*4
    const step=ix<n-1?4:0,k=(y*size+x)*4
    const sample=c=>mix(mix(projected[a+c],projected[a+step+c],u),mix(projected[b+c],projected[b+step+c],u),v)
    // Preserve straight alpha: optical-depth integration accumulated associated
    // radiance; divide ONCE here. Never divide by material opacity/compositor alpha.
    const alpha=sample(3)
    for(let c=0;c<3;c++) data[k+c]=Math.round(255*clamp(alpha>.00001?sample(c)/alpha:0))
    data[k+3]=Math.round(255*alpha)
  }
  const result={data,width:size,height:size}
  if(cacheable) volumeCache.set(cacheKey,result)
  return result
}
/** Filled, self-shadowed smoke bank, returned as straight-alpha linear RGBA. */
export function bakeSmoke(size=384,seed=0) {return bakeVolume(size,seed,false)}
/** Lower optical thickness at the fixed source; no radial halo or ring mask. */
export function bakeLampSmoke(size=256,seed=0) {return bakeVolume(size,seed,true)}

/** Rising connected volume; same optical integration as the bank, different mass layout. */
export function bakePlume(size=384,seed=0,sampling={}) {return bakeVolume(size,seed,false,true,sampling)}
/** Continuous lower air. Horizontal coordinates deliberately have no islands or noise. */
export function bakeHorizonHaze(width=32,height=96) {
  const data=new Uint8Array(width*height*4)
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const v=y/(height-1),alpha=ramp(0,.23,v)*(1-ramp(.36,1,v)),k=(y*width+x)*4
    data[k]=data[k+1]=data[k+2]=255;data[k+3]=Math.round(alpha*255)
  }
  return {data,width,height}
}
