// R3: only a rare, low-frequency ash mask. No synthetic cracks or relief.
const fract = x => x-Math.floor(x)
const mix = (a,b,t) => a+(b-a)*t
const clamp = x => Math.max(0,Math.min(1,x))
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t) }
export function v2SurfaceHash([x,y,z]) {
  x=fract(x*.1031);y=fract(y*.1031);z=fract(z*.1031)
  const d=x*(y+33.33)+y*(z+33.33)+z*(x+33.33)
  return fract((x+y+d*2)*(z+d))
}
export function v2SurfaceNoise(p) {
  const i=p.map(Math.floor), f=p.map(fract).map(t=>t*t*(3-2*t))
  const h=(x,y,z)=>v2SurfaceHash([i[0]+x,i[1]+y,i[2]+z])
  return mix(mix(mix(h(0,0,0),h(1,0,0),f[0]),mix(h(0,1,0),h(1,1,0),f[0]),f[1]),
    mix(mix(h(0,0,1),h(1,0,1),f[0]),mix(h(0,1,1),h(1,1,1),f[0]),f[1]),f[2])
}

export function sampleV2Ash(position, normal=[0,1,0]) {
  const a=v2SurfaceNoise(position.map((v,i)=>v*.31+[7.3,2.1,5.7][i]))
  const b=v2SurfaceNoise(position.map((v,i)=>v*.83+[19.1,3.7,11.2][i]))
  return smooth(.77,.94,a*.65+b*.35)*smooth(.5,.95,normal[1])
}
export const V2_WEATHERING_GLSL = `
float v2Hash(vec3 p) { p=fract(p*.1031); p+=dot(p,p.yzx+33.33); return fract((p.x+p.y)*p.z); }
float v2Noise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(v2Hash(i),v2Hash(i+vec3(1,0,0)),f.x),mix(v2Hash(i+vec3(0,1,0)),v2Hash(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(v2Hash(i+vec3(0,0,1)),v2Hash(i+vec3(1,0,1)),f.x),mix(v2Hash(i+vec3(0,1,1)),v2Hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
`;
