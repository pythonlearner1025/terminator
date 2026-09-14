import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import {defaultMap} from '../lib/core/map.js'
import {buildEffectsEmitters, effectsCardFit, effectsClearance, effectsTime, sampleEffectsParticle} from '../lib/view/v2/effects-simulation.js'
import {createEffectsAtlas} from '../lib/view/v2/effects-textures.js'
globalThis.ImageData ??= class {}
globalThis.window ??= {}
const E = await import('threepipe')
const {mountV2Effects} = await import('../lib/view/v2/effects.js')
function snapshot(handle) {
  return handle.root.children.map(mesh => Object.fromEntries(Object.entries(mesh.geometry.attributes).map(([key,attr]) => [key,[...attr.array]])))
}
function refsFixture(root) {
  const make = () => { const object = new E.Object3D(); root.add(object); return object }
  const flame = make(), smoke = make(), light = make(), steam = make(), sparks = make(), hazardSteam = make(), electric = make()
  smoke.visible = false; light.intensity = 32; hazardSteam.visible = false
  return {fires:[{pos:[-4,1.3,3],flame,smoke,light}],atmosphere:{steam,sparks},hazards:[{id:'courtyard_center',steam:hazardSteam,electric}]}
}

test('atlas matches committed PNG, with transparent borders and nonuniform soft density', async () => {
  const atlas = createEffectsAtlas(), png = await readFile(new URL('../assets/v2/effects/particles.png',import.meta.url))
  let offset=8; const chunks=[]
  while(offset<png.length) { const size=png.readUInt32BE(offset); if(png.toString('ascii',offset+4,offset+8)==='IDAT')chunks.push(png.subarray(offset+8,offset+8+size));offset+=size+12 }
  const rows=inflateSync(Buffer.concat(chunks)), raw=new Uint8Array(atlas.data.length)
  for(let y=0;y<atlas.height;y++){assert.equal(rows[y*(atlas.width*4+1)],0);raw.set(rows.subarray(y*(atlas.width*4+1)+1,(y+1)*(atlas.width*4+1)),y*atlas.width*4)}
  assert.equal(createHash('sha256').update(raw).digest('hex'),createHash('sha256').update(atlas.data).digest('hex'))
  for(let tile=0;tile<8;tile++){
    const alphas=new Set();let nonzero=0
    for(let y=0;y<128;y++)for(let x=0;x<128;x++){
      const alpha=raw[(((tile>>2)*128+y)*512+(tile%4)*128+x)*4+3]
      if(x===0||y===0||x===127||y===127)assert.ok(alpha<=3,`tile ${tile} edge`)
      alphas.add(alpha);if(alpha)nonzero++
    }
    assert.ok(alphas.size>60);assert.ok(nonzero>100&&nonzero<16384)
  }
})

test('bounded default emitters follow actual barrel, vent, spark and hazard sources',()=>{
  const emitters=buildEffectsEmitters(defaultMap)
  assert.equal(emitters.length,19);assert.equal(emitters.reduce((sum,e)=>sum+e.count,0),228)
  assert.equal(emitters.filter(e=>e.kind==='flame').length,4)
  const vents=emitters.filter(e=>e.kind==='steam')
  assert.equal(vents.length,3)
  assert.ok(vents.filter(e=>e.pos[1]<0).every(e=>e.ceiling<=-.3))
  assert.ok(vents[0].driftX<0);assert.ok(vents[1].driftX>0)
})

test('all visible billboards stay outside collider solids and below the service ceiling over 20 seconds',()=>{
  const emitters=buildEffectsEmitters(defaultMap), sample=new Float64Array(12)
  for(let tick=0;tick<=1200;tick+=7)for(const emitter of emitters)for(let index=0;index<emitter.count;index++){
    sampleEffectsParticle(emitter,index,tick/60,sample)
    assert.ok(sample.every(Number.isFinite))
    assert.ok(sample[3]<=1.45&&sample[4]<=1.45)
    if(sample[6]>.001){
      const radius=Math.hypot(sample[3],sample[4])/2
      if(sample[11]===0) assert.ok(radius<=effectsClearance(sample[0],sample[1],sample[2],emitter.solids,emitter.ceiling)+1e-8,emitter.id)
      else {
        // Rotate the player through a full circle. Sample the full card surface,
        // including its centre, against each actual map OBB in local coordinates.
        const c=Math.cos(sample[5]),s=Math.sin(sample[5])
        for(let yaw=0;yaw<12;yaw++) for(const u of [-.5,0,.5]) for(const v of [-.5,0,.5]) {
          const rx=c*u*sample[3]-s*v*sample[4],ry=s*u*sample[3]+c*v*sample[4]
          const x=sample[0]+(sample[11]===1?rx:Math.cos(yaw*Math.PI/6)*rx)
          const y=sample[1]+(sample[11]===1?0:ry)
          const z=sample[2]+(sample[11]===1?-ry:Math.sin(yaw*Math.PI/6)*rx)
          assert.ok(y<=emitter.ceiling+1e-8)
          for(const b of emitter.solids){
            const dx=x-b.x,dz=z-b.z
            const inside=Math.abs(dx*b.cos-dz*b.sin)<b.hx-1e-8&&Math.abs(y-b.y)<b.hy-1e-8&&Math.abs(dx*b.sin+dz*b.cos)<b.hz-1e-8
            assert.equal(inside,false,emitter.id+' intersects collider')
          }
        }
      }
    }
  }
})

test('flame revision stays low, connected to each rim and orange throughout the cycle',()=>{
  const flames=buildEffectsEmitters(defaultMap).filter(e=>e.kind==='flame'),sample=new Float64Array(12)
  const barrels=defaultMap.colliders.filter(c=>c.kind==='barrel')
  for(const [index,emitter] of flames.entries()){
    const rim=barrels[index].center.y+barrels[index].size.y/2
    assert.equal(emitter.pos[1],rim,'do not lift the flame origin off the lid')
    for(let tick=0;tick<1200;tick+=3){
      let contact=0,visibleWisps=0,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity
      for(let i=0;i<emitter.count;i++){
        sampleEffectsParticle(emitter,i,tick/60,sample)
        const c=Math.abs(Math.cos(sample[5])),s=Math.abs(Math.sin(sample[5]))
        const halfHeight=sample[11]===1?0:(sample[4]*c+sample[3]*s)/2
        assert.ok(sample[1]-halfHeight>=rim,'card bottom never enters drum')
        assert.ok(sample[1]+halfHeight-rim<.32,'no tall flame silhouette')
        assert.ok(sample[7]<4,'use irregular density, not repeated candle atlas tiles')
        assert.ok(sample[9]/sample[8]<.22,'orange rather than broad yellow emission')
        if(sample[11]===1&&sample[6]>.3&&sample[1]-rim<.02)contact++
        if(sample[11]===2&&sample[6]>.04)visibleWisps++
        minX=Math.min(minX,sample[0]);maxX=Math.max(maxX,sample[0]);minZ=Math.min(minZ,sample[2]);maxZ=Math.max(maxZ,sample[2])
      }
      assert.equal(contact,3,'continuous low bed instead of detached flames')
      assert.ok(visibleWisps>=2,'multiple sparse wisps remain visible')
      assert.ok(maxX-minX>.12&&maxZ-minZ>.12,'world-space depth provides parallax')
    }
  }
})

test('oriented confinement handles lid contact, walls, interior solids and ceilings',()=>{
  const drum={x:0,y:0,z:0,hx:.4,hy:.65,hz:.4,cos:1,sin:0}
  assert.equal(effectsCardFit(0,.662,0,.2,0,[drum]),1,'horizontal bed fits above lid')
  assert.ok(Math.abs(effectsCardFit(0,.7,0,.2,.1,[drum])-.5)<1e-8,'upright card shrinks before drum')
  assert.equal(effectsCardFit(0,0,0,.2,.1,[drum]),0,'card inside drum disappears')
  assert.ok(Math.abs(effectsCardFit(.5,0,0,.2,.1,[drum])-.5)<1e-8,'wall-side card shrinks')
  assert.ok(Math.abs(effectsCardFit(0,1,0,.2,.1,[],1.05)-.5)<1e-8,'ceiling constrains full height')
})

test('frozen tick is byte-stable, does not upload unchanged buffers, rewinds, and sync never calls RNG',async()=>{
  const root=new E.Group(), handle=mountV2Effects({root,map:defaultMap});await handle.ready
  handle.sync({tick:120});const before=snapshot(handle),version=handle.root.children[0].geometry.attributes.fxPosition.version
  const rng=Math.random;Math.random=()=>{throw Error('RNG called during sync')}
  try{for(let i=0;i<20;i++)handle.sync({tick:120,time:i*300})}finally{Math.random=rng}
  assert.deepEqual(snapshot(handle),before);assert.equal(handle.root.children[0].geometry.attributes.fxPosition.version,version)
  handle.sync({tick:121});assert.notDeepEqual(snapshot(handle),before)
  handle.sync({tick:120});assert.deepEqual(snapshot(handle),before)
  handle.dispose()
})

test('original emitters mute after every base sync, electric hazards and immutable world state remain intact',()=>{
  const root=new E.Group(),refs=refsFixture(root),handle=mountV2Effects({root,map:defaultMap,refs})
  const world={tick:120,mapState:{hazards:[{slot:'courtyard_center',kind:'steam'}]}},original=JSON.stringify(world)
  handle.sync(world)
  const hazard=handle.root.children.find(mesh=>mesh.name==='V2 hazard-courtyard_center')
  assert.equal(hazard.visible,true);assert.equal(refs.hazards[0].electric.visible,true)
  refs.fires[0].flame.visible=true;refs.atmosphere.sparks.visible=true;refs.fires[0].light.intensity=40
  handle.sync(world)
  assert.equal(refs.fires[0].flame.visible,false);assert.equal(refs.atmosphere.sparks.visible,false)
  assert.ok(refs.fires[0].light.intensity>=1.11&&refs.fires[0].light.intensity<=1.79)
  assert.equal(JSON.stringify(world),original)
  world.mapState.hazards[0].kind='electric';handle.sync(world);assert.equal(hazard.visible,false)
  handle.dispose()
  assert.equal(refs.fires[0].flame.visible,true);assert.equal(refs.fires[0].smoke.visible,false);assert.equal(refs.fires[0].light.intensity,32)
  assert.equal(refs.atmosphere.steam.visible,true);assert.equal(refs.hazards[0].steam.visible,false)
})

test('repeated mount/dispose releases exactly owned resources and preserves sibling meshes/materials',()=>{
  const root=new E.Group(),source=new E.Mesh2(new E.BoxGeometry(),new E.PhysicalMaterial());root.add(source)
  let sourceDisposals=0;source.material.addEventListener('dispose',()=>sourceDisposals++)
  for(let cycle=0;cycle<5;cycle++){
    const handle=mountV2Effects({root,map:defaultMap}),meshes=[...handle.root.children]
    let geometries=0,materials=0,textures=0
    for(const mesh of meshes)mesh.geometry.addEventListener('dispose',()=>geometries++)
    meshes[0].material.addEventListener('dispose',()=>materials++);meshes[0].material.map.addEventListener('dispose',()=>textures++)
    handle.dispose();handle.dispose();handle.sync({tick:100})
    assert.equal(geometries,meshes.length);assert.equal(materials,1);assert.equal(textures,1);assert.deepEqual(root.children,[source])
  }
  assert.equal(sourceDisposals,0)
})

test('preview remains populated and frozen without DOM, refs, viewer, or world',async()=>{
  const root=new E.Group(),handle=mountV2Effects({root,map:defaultMap,preview:true});await handle.ready
  const before=snapshot(handle);handle.sync({tick:10000});assert.deepEqual(snapshot(handle),before)
  assert.ok(handle.root.children.every(mesh=>mesh.visible));assert.equal(effectsTime({time:3}),3)
  handle.dispose()
})

test('disposal while atlas is loading never reattaches meshes or leaks the late texture',async()=>{
  const original=E.TextureLoader.prototype.load,originalDocument=globalThis.document
  let finish,texture,disposals=0
  E.TextureLoader.prototype.load=function(url,onLoad){assert.match(url,/assets\/v2\/effects\/particles.png$/);texture=new E.Texture();texture.addEventListener('dispose',()=>disposals++);finish=()=>onLoad(texture);return texture}
  globalThis.document={}
  try{
    const root=new E.Group(),handle=mountV2Effects({root,map:defaultMap});handle.dispose();finish();await handle.ready
    assert.equal(root.children.length,0);assert.equal(disposals,2)
  }finally{E.TextureLoader.prototype.load=original;if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument}
})
