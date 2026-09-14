import test from 'node:test'
import assert from 'node:assert/strict'
import {bakeSky, bakeSmoke, bakeMist, bakeLampSmoke, bakePlume, bakeHorizonHaze} from '../lib/view/v2/lighting-noise.js'
import {defaultMap} from '../lib/core/map.js'
globalThis.ImageData ??= class {}
// Threepipe's package initialization reads window.location even for scene-only use.
globalThis.window ??= {}
const E = await import('threepipe')
const {mountV2Lighting, V2_LIGHTING_PARAMS: P} = await import('../lib/view/v2/lighting.js')
function meshCount(root) {let count=0;root.traverse(n=>{if(n.isMesh)count++});return count}
function fixture() {
  const scene = new E.Scene(), root = new E.Group(); scene.add(root)
  const background = new E.Color(0x102030), fog = new E.FogExp2(0x112233, .004)
  scene.background = background; scene.fog = fog; scene.environmentIntensity = .32
  scene.autoDisposeSceneMaps = true
  const key = new E.DirectionalLight(0xffffff, 1.3); key.name = 'Map moon shadow key'; key.position.set(-18, 34, -12)
  const fill = new E.HemisphereLight(0xffffff, 0x554433, .48); fill.name = 'Map night sky fill'
  const local = new E.PointLight(0xffaa00, 90), pool = new E.PointLight()
  local.position.set(4, 6, 2); pool.position.copy(local.position); pool.name = 'Bunker local light 1'
  root.add(key, key.target, fill, local, pool)
  const beamMaterial = new E.ShaderMaterial({uniforms: {opacity: {value: .06}}})
  const beam = new E.Mesh2(new E.PlaneGeometry(), beamMaterial), spot = new E.SpotLight()
  root.add(beam, spot)
  const zone = {id:'building', power:90, light:local}
  const shaft = {zone:'courtyard', beam, light:spot, power:160, directLight:true}
  const refs = {zones:[zone], fixtureLights:[], weather:{shafts:[shaft]}}
  const tone = {exposure:1.25}, viewer = {scene, getPlugin:()=>tone, setDirty(){}}
  return {viewer, root, refs, key, fill, local, pool, zone, shaft, beamMaterial, tone, fog, background}
}
test('sky is deterministic, continuous at longitude seam and smoke fades at every edge', () => {
  const sky = bakeSky(64, 32), again = bakeSky(64, 32)
  assert.deepEqual(sky.data, again.data)
  for (let y=0;y<32;y++) assert.deepEqual(sky.data.slice(y*64*4,y*64*4+4),sky.data.slice((y*64+63)*4,(y*64+64)*4))
  const smoke = bakeSmoke(32)
  for(let i=0;i<32;i++) for (const k of [i,31*32+i,i*32,i*32+31]) assert.equal(smoke.data[k*4+3],0)
  assert.ok(smoke.data.some((v,i)=>i%4===3&&v>70))
})
test('sync survives late HDR, respects fog and light-off gameplay, and never grows content', async () => {
  const f=fixture(), h=mountV2Lighting(f); await h.ready
  const count=f.root.children.length, state={mapState:{fog:2,lights:{building:'off',courtyard:'off'}},tick:120}
  f.viewer.scene.background = new E.Texture(); f.viewer.scene.environmentIntensity=.32
  for(let i=0;i<1000;i++) h.sync(state)
  assert.equal(f.root.children.length,count)
  assert.equal(f.viewer.scene.environmentIntensity,P.environmentIntensity)
  assert.equal(f.viewer.scene.fog.density,.036)
  assert.equal(f.local.intensity,0); assert.equal(f.pool.intensity,0); assert.equal(f.shaft.light.intensity,0)
  assert.equal(f.shaft.beam.visible,false)
  assert.equal(f.zone.power,P.buildingPower)
  h.dispose()
})
test('dispose restores materials and viewer/light state and is repeatable', () => {
  const f=fixture(), children=[...f.root.children]
  for(let i=0;i<3;i++) {
    const h=mountV2Lighting({...f,preview:i===1})
    assert.notEqual(f.shaft.beam.material,f.beamMaterial)
    assert.equal(meshCount(h.root),36)
    let textureDisposals=0
    h.root.getObjectByName('V2 fixed smoky sky dome').material.map.addEventListener('dispose',()=>textureDisposals++)
    h.dispose();h.dispose();h.sync({tick:10})
    assert.equal(textureDisposals,1)
    assert.deepEqual(f.root.children,children)
    assert.equal(f.viewer.scene.fog,f.fog); assert.equal(f.viewer.scene.background,f.background)
    assert.equal(f.viewer.scene.environmentIntensity,.32); assert.equal(f.viewer.scene.autoDisposeSceneMaps,true)
    assert.equal(f.shaft.beam.material,f.beamMaterial); assert.equal(f.zone.power,90)
    assert.equal(f.fill.groundColor.getHex(),0x554433)
    assert.equal(f.key.intensity,1.3); assert.deepEqual(f.key.position.toArray(),[-18,34,-12])
    assert.equal(f.tone.exposure,1.25)
  }
})
test('empty preview is synchronous and disposal before ready settles leaves no owned objects', async () => {
  const scene=new E.Scene(),root=new E.Group();scene.add(root)
  const h=mountV2Lighting({viewer:{scene},root,preview:true})
  assert.equal(root.children.length,1);h.dispose();await h.ready;assert.equal(root.children.length,0)
})

// These assertions check the cause of the visual regression, not screenshot pixel matching.
test('wall crosslight favours vertical relief with bounded sky fill and HDR', () => {
  const f = fixture(), h = mountV2Lighting(f)
  const rim = h.root.getObjectByName('V2 fixed southwest wall crosslight')
  const direction = rim.position.clone().normalize()
  assert.ok(Math.abs(direction.z) > direction.y * 5)
  assert.ok(P.fillIntensity <= .13 && P.environmentIntensity <= .10)
  assert.deepEqual(h.root.getObjectByName('V2 fixed smoky sky dome').scale.toArray(), [1,1,1])
  assert.equal(h.root.children.filter(n => n.isSprite).length, 0)
  const exits = h.root.children.filter(n => n.isSpotLight)
  assert.equal(exits.length, 8)
  assert.ok(exits.every(n => !n.castShadow && n.distance <= 22))
  h.sync({mapState:{lights:{courtyard:'off',building:'off'}}})
  assert.ok(exits.every(n => n.intensity === 0))
  h.dispose()
})
test('independent projected smoke banks have distinct depth and shading, with bounded resources', () => {
  const a = bakeSmoke(48, 0), b = bakeSmoke(48, 1)
  assert.notDeepEqual(a.data, b.data)
  assert.ok(a.data.some((v, i) => i % 4 === 0 && v > 20 && v < 200))
  const f=fixture(), h=mountV2Lighting(f), maps=new Set()
  h.root.traverse(n=>{if(n.material?.map)maps.add(n.material.map)})
  assert.equal(maps.size, 9)
  assert.ok(meshCount(h.root) <= 36)
  h.dispose()
})

// Real map geometry rather than a test-only room catches the R2 reversed-cone bug.
test('exit beams reach visible risers and pass through the real barracks doorway', () => {
  const f=fixture(), h=mountV2Lighting({...f,map:defaultMap})
  const spots=h.root.children.filter(o=>o.isSpotLight)
  for(const light of spots) {
    for(const c of defaultMap.colliders) {
      const inside=['x','y','z'].every(k=>Math.abs(light.position[k]-c.center[k])<c.size[k]/2-.001)
      assert.equal(inside,false,`${light.name} inside ${c.id}`)
    }
  }
  const service=h.root.getObjectByName('V2 service stair daylight')
  const axis=service.target.position.clone().sub(service.position).normalize()
  const risers=defaultMap.colliders.filter(c=>c.id.startsWith('exp_service_north_'))
  assert.equal(risers.length,7)
  for(const c of risers) {
    const face=new E.Vector3(c.center.x,c.center.y,c.center.z-c.size.z/2)
    const delta=face.clone().sub(service.position), d=delta.length()
    assert.ok(service.position.z<face.z,`${c.id} visible -Z face must face source`)
    assert.ok(d<service.distance && delta.normalize().dot(axis)>Math.cos(service.angle),`${c.id} outside cone`)
  }
  const exit=h.root.getObjectByName('V2 barracks exit practical')
  const ray=new E.Ray(exit.position,exit.target.position.clone().sub(exit.position).normalize())
  for(const c of defaultMap.colliders.filter(c=>c.id.startsWith('exp_barracks_north_'))) {
    const center=new E.Vector3(c.center.x,c.center.y,c.center.z),size=new E.Vector3(c.size.x,c.size.y,c.size.z)
    assert.equal(ray.intersectsBox(new E.Box3().setFromCenterAndSize(center,size)),false,`beam blocked by ${c.id}`)
  }
  h.dispose()
})
test('opening mist carries light without dark cutouts and lamp scattering is independently seeded', () => {
  const mist=bakeMist(32),a=bakeLampSmoke(48,0),b=bakeLampSmoke(48,1)
  assert.ok(mist.data.every((v,i)=>i%4===3||v===255))
  assert.notDeepEqual(a.data,b.data)
  for(const tex of [mist,a,b]) for(let i=0;i<tex.width;i++) {
    assert.equal(tex.data[i*4+3],0)
    assert.equal(tex.data[((tex.height-1)*tex.width+i)*4+3],0)
  }
})

test('broad upward bounce reaches soffit samples but excludes the underlying floor', () => {
  const f=fixture(),h=mountV2Lighting(f)
  const lights=h.root.children.filter(o=>o.isSpotLight&&o.name.includes('ceiling bounce'))
  assert.equal(lights.length,4)
  for(const light of lights) {
    const axis=light.target.position.clone().sub(light.position).normalize()
    for(const z of [-4,0,4]) for(const x of [-1,1]) {
      const ceiling=new E.Vector3(x,2.65,z).normalize()
      assert.ok(ceiling.dot(axis)>Math.cos(light.angle)+.02,`${light.name} misses broad soffit`)
      const floor=new E.Vector3(x,-.3,z).normalize()
      assert.ok(floor.dot(axis)<Math.cos(light.angle),`${light.name} spills onto floor`)
    }
  }
  h.dispose()
})

test('optical-depth banks retain a filled broad core and fade before the plane boundary', () => {
  for(let seed=0;seed<6;seed++) {
    const {data,width:n}=bakeSmoke(48,seed)
    let filled=0,total=0
    for(let y=16;y<32;y++) for(let x=14;x<34;x++) {
      total++; if(data[(y*n+x)*4+3]>220) filled++
    }
    // Reject the former narrow/hollow stalk even when its lit boundary is bright.
    assert.ok(filled/total>.9,`seed ${seed} has an empty or narrow core`)
    for(let i=0;i<n;i++) for(const k of [i,(n-1)*n+i,i*n,i*n+n-1]) {
      assert.equal(data[k*4+3],0,`seed ${seed} reaches a rectangular boundary`)
    }
    assert.ok(data[(24*n+24)*4+2]>10,`seed ${seed} core must carry low blue scattering`)
  }
})


test('key azimuth change preserves floor incidence while moving the measured reflection', () => {
  const f=fixture(),h=mountV2Lighting(f)
  const old=new E.Vector3(-25,12,38).normalize(),now=f.key.position.clone().normalize()
  assert.ok(Math.abs(old.y-now.y)<1e-12,'flat-ground diffuse incidence changed')
  const view=new E.Vector3(36,1.65,5.5).sub(new E.Vector3(28.6666666667,0,14.9626257032)).normalize()
  const oldHalf=old.clone().add(view).normalize(),newHalf=now.clone().add(view).normalize()
  assert.ok(oldHalf.y>.95,'probe sample must reproduce the near-normal reflection')
  assert.ok(newHalf.y<.87,'azimuth did not move the half-vector off the clipped floor normal')
  h.dispose()
})


test('horizon air has no horizontal islands and rising volume retains a connected base', () => {
  const h=bakeHorizonHaze(32,48)
  for(let y=0;y<h.height;y++) for(let x=1;x<h.width;x++) {
    assert.equal(h.data[(y*h.width+x)*4+3],h.data[y*h.width*4+3])
  }
  for(const y of [0,h.height-1]) assert.equal(h.data[y*h.width*4+3],0)
  const p=bakePlume(64,0)
  for(const y of [12,20,28,36,44,50]) {
    let filled=0
    for(let x=18;x<46;x++) if(p.data[(y*64+x)*4+3]>200)filled++
    assert.ok(filled>=6,`plume disconnected at row ${y}`)
  }
  const f=fixture(),handle=mountV2Lighting(f)
  assert.equal(handle.root.children.filter(n=>n.name.startsWith('V2 distant flood fixture')).length,3)
  for(let i=1;i<=3;i++) {
    const fixture=handle.root.getObjectByName(`V2 distant flood fixture ${i}`)
    assert.ok(fixture.getObjectByName(`V2 distant flood housing ${i}`))
    assert.ok(fixture.getObjectByName(`V2 distant floodlamp core ${i}`))
  }
  handle.dispose()
})


test('dense plumes preserve optical depth independently of thin-haze controls', () => {
  const f=fixture(),h=mountV2Lighting({...f,params:{hazeOpacity:.01}})
  for(let seed=0;seed<4;seed++) {
    const {data,width:n}=bakePlume(96,seed)
    const material=h.root.getObjectByName(`V2 distant smoke bank ${seed*2+1}`).material
    let opaque=0,dark=0,litEdge=0
    for(let k=0;k<data.length;k+=4) {
      const alpha=data[k+3]/255
      if(alpha*material.opacity>.86) {opaque++;if(data[k+2]<35)dark++}
      if(alpha>.10&&alpha<.75&&data[k+2]>40)litEdge++
    }
    // This would fail with the old .32 multiplier regardless of baked extinction.
    assert.ok(opaque>n*n*.14,`seed ${seed} has no substantial opaque core`)
    assert.ok(dark/opaque>.5,`seed ${seed} becomes a bright cotton mass`)
    assert.ok(litEdge>n*n*.02,`seed ${seed} loses selective outer scattering`)
    assert.equal(material.map.premultiplyAlpha,false,'bake outputs straight-alpha RGB')
    for(let i=0;i<n;i++)for(const k of [i,(n-1)*n+i,i*n,i*n+n-1])assert.equal(data[k*4+3],0)
  }
  assert.equal(h.root.getObjectByName('V2 cover depth haze 1').material.opacity,.14)
  assert.equal(h.root.getObjectByName('V2 interior suspended haze 1').material.opacity,P.exitHazeOpacity)
  h.dispose()
})

test('short searchlight braces have real wall support and shared resources dispose once', () => {
  const f=fixture(),h=mountV2Lighting({...f,map:defaultMap}),resources=new Set()
  for(let i=1;i<=3;i++) {
    const lamp=h.root.getObjectByName(`V2 distant flood fixture ${i}`)
    const support=defaultMap.colliders.find(c=>c.id===lamp.userData.supportCollider)
    assert.ok(support)
    assert.ok(Math.abs(lamp.position.x-support.center.x)<support.size.x/2)
    assert.ok(Math.abs(lamp.position.z-support.center.z)<=support.size.z/2)
    assert.equal(lamp.position.y,support.center.y+support.size.y/2-.15)
    const core=lamp.getObjectByName(`V2 distant floodlamp core ${i}`)
    assert.ok(core.position.y<2,'fixture became a tall pole')
    assert.equal(core.geometry.type,'CylinderGeometry','retain circular finite lens')
    assert.equal(lamp.children.filter(n=>n.name.startsWith('V2 broken searchlight brace')).length,3)
  }
  assert.equal(h.root.getObjectByName('V2 distant flood mast 1'),undefined)
  h.root.traverse(n=>{if(n.geometry)resources.add(n.geometry);if(n.material){resources.add(n.material);if(n.material.map)resources.add(n.material.map)}})
  const disposals=new Map([...resources].map(r=>[r,0]))
  for(const r of resources)r.addEventListener('dispose',()=>disposals.set(r,disposals.get(r)+1))
  h.dispose();h.dispose()
  for(const count of disposals.values())assert.equal(count,1)
  assert.equal(f.root.getObjectByName('V2 cold sky and distant atmosphere'),undefined)
})


test('offline plume assets match the source recipe, hashes and straight-alpha payload', async () => {
  const {readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto')
  const base=new URL('../assets/v2/lighting/',import.meta.url)
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'))
  const hash=data=>createHash('sha256').update(data).digest('hex')
  assert.equal(manifest.sourceSha256,hash(await readFile(new URL('../lib/view/v2/lighting-noise.js',import.meta.url))))
  assert.equal(manifest.files.length,4)
  for(const entry of manifest.files) {
    const data=await readFile(new URL(entry.file,base))
    assert.equal(data.byteLength,512*512*4);assert.equal(hash(data),entry.sha256)
    let dense=0
    for(let k=3;k<data.length;k+=4)if(data[k]>245)dense++
    assert.ok(dense>512*512*.14,'offline output lost its optically thick core')
  }
})

test('local baked-plume loading exposes ready and survives disposal before completion', async () => {
  const previousFetch=globalThis.fetch,previousLocation=window.location
  try {
    window.location={origin:'http://v2-unit.invalid'}
    const requests=[]
    globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))
    const f=fixture(),h=mountV2Lighting({...f,loadNoisePixels:null})
    assert.equal(requests.length,4)
    const map=h.root.getObjectByName('V2 distant smoke bank 1').material.map
    for(const [i,r] of requests.entries()) {
      assert.equal(r.url,`/files/assets/v2/lighting/plume-${i}.rgba`)
      r.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(512*512*4)})
    }
    await h.ready;assert.equal(map.image.width,512);assert.equal(map.premultiplyAlpha,false)
    h.dispose()
    requests.length=0
    const early=mountV2Lighting({...f,loadNoisePixels:null}),earlyMap=early.root.getObjectByName('V2 distant smoke bank 1').material.map
    const before=earlyMap.image;let count=0
    earlyMap.addEventListener('dispose',()=>count++)
    early.dispose()
    for(const r of requests) {
      assert.equal(r.options.signal.aborted,true)
      r.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(512*512*4)})
    }
    await early.ready;early.dispose()
    assert.equal(earlyMap.image,before,'disposed texture was resurrected by late load')
    assert.equal(count,1);assert.equal(f.root.getObjectByName('V2 cold sky and distant atmosphere'),undefined)
  } finally {globalThis.fetch=previousFetch;window.location=previousLocation}
})


test('exit air stays behind stair geometry and window axes pass through actual openings',()=>{
  const f=fixture(),h=mountV2Lighting({...f,map:defaultMap})
  const mist=h.root.getObjectByName('V2 interior suspended haze 1')
  const last=defaultMap.colliders.find(c=>c.id==='exp_service_north_7')
  assert.ok(mist.position.z>last.center.z+last.size.z/2,'mist must not veil front tread faces')
  // This bounds the old white sheet contribution without asserting image pixels.
  assert.ok(mist.material.color.b*mist.material.opacity<.035)
  for(const side of ['west','east']) {
    const light=h.root.getObjectByName(`V2 barracks ${side} window crosslight`)
    const axis=light.target.position.clone().sub(light.position).normalize(),ray=new E.Ray(light.position,axis)
    const wallX=side==='west'?31:41,t=(wallX-light.position.x)/axis.x,opening=ray.at(t,new E.Vector3())
    assert.ok(opening.y>1.1&&opening.y<2.4)
    for(const c of defaultMap.colliders.filter(c=>c.id.startsWith(`exp_barracks_side_${wallX}_0`))) {
      const box=new E.Box3().setFromCenterAndSize(new E.Vector3(c.center.x,c.center.y,c.center.z),new E.Vector3(c.size.x,c.size.y,c.size.z))
      assert.equal(box.containsPoint(opening),false,`${side} window axis blocked by ${c.id}`)
    }
    assert.equal(light.castShadow,false);assert.equal(light.intensity,P.windowFillPower)
  }
  h.sync({mapState:{lights:{building:'off'}}})
  for(const side of ['west','east'])assert.equal(h.root.getObjectByName(`V2 barracks ${side} window crosslight`).intensity,0)
  h.dispose()
})
