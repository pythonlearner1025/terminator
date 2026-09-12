import {mapMaterials, randomSource} from './map.materials.js'

const xyz = p => [p.x, p.y, p.z]

export function createMapPreviewGroup(api, map, {markers = true} = {}) {
  const group = new api.Group()
  group.name = 'Bunker 7 Night Preview'
  const materials = {
    ground: new api.UnlitMaterial({name: 'Map preview ground', color: 0x465866}),
    structure: new api.UnlitMaterial({name: 'Map preview structures', color: 0x73818b}),
    accent: new api.UnlitMaterial({name: 'Map preview hazards and gates', color: 0xc3563c}),
  }
  const batches = new Map(Object.values(materials).map(material => [material, []]))
  const addBox = (position, size, material) => {
    const geometry = new api.BoxGeometry(size[0], size[1], size[2])
    geometry.translate(position[0], position[1], position[2])
    batches.get(material).push(geometry)
  }
  const bounds = []
  for (const collider of map.colliders) {
    const position = xyz(collider.center), size = xyz(collider.size)
    const material = ['floor', 'stair', 'ramp'].includes(collider.kind) ? materials.ground : materials.structure
    addBox(position, size, material)
    bounds.push({id: collider.id, min: position.map((value, index) => value - size[index] / 2),
      max: position.map((value, index) => value + size[index] / 2), center: position, size})
  }
  for (const door of map.doors) addBox(xyz(door.pos), xyz(door.size), materials.accent)
  for (const gate of map.spawnGates) addBox([gate.pos.x, 1.5, gate.pos.z], [3.8, 3, .12], materials.accent)
  for (const slot of map.hazardSlots) addBox([slot.pos.x, .03, slot.pos.z], [slot.size.x, .06, slot.size.z], materials.accent)
  addBox(xyz(map.trader.pos), xyz(map.trader.size), materials.accent)
  if (markers) addBox([map.playerStart.pos.x, .04, map.playerStart.pos.z], [1.2, .08, 1.2], materials.accent)
  for (const [material, geometries] of batches) {
    if (!geometries.length) continue
    const geometry = api.mergeGeometries(geometries, false)
    for (const part of geometries) part.dispose()
    if (!geometry) throw new Error(`Could not merge map preview material ${material.name}`)
    const mesh = new api.Mesh2(geometry, material)
    mesh.name = material.name
    group.add(mesh)
  }
  group.userData.mapVisualBounds = bounds
  return group
}

export function createMapGroup(api, map, {markers = true, runtime = false} = {}) {
  const group = new api.Group()
  group.name = runtime ? 'Bunker 7 Night Runtime' : 'Bunker 7 Night Preview'
  const {mats: m, label, particle, flame: flameTexture, textures} = mapMaterials(api)
  const rand = randomSource(712029)
  const batches = new Map(), bounds = []
  const refs = {doors: [], gates: [], hazards: [], fires: [], zones: [], flank: [], dust: null, trader: null}
  const boxGeo = new api.BoxGeometry(1, 1, 1)
  function mesh(name, geometry, pos, mat, parent = group, rotation = [0, 0, 0], solid = true) {
    const object = new api.Mesh2(geometry, mat)
    object.name = name; object.position.set(...pos); object.rotation.set(...rotation)
    object.castShadow = solid; object.receiveShadow = solid
    parent.add(object)
    return object
  }
  function box(name, pos, size, mat, parent = group, rotation = [0, 0, 0]) {
    const geometry = boxGeo.clone().scale(...size)
    const uv = geometry.attributes.uv
    // Box face UVs are tiled in meters, so a 60 m floor has fine detail too.
    const faceScale = [[size[2], size[1]], [size[2], size[1]], [size[0], size[2]], [size[0], size[2]], [size[0], size[1]], [size[0], size[1]]]
    for (let i = 0; i < uv.count; i++) { const s = faceScale[Math.floor(i / 4)]; uv.setXY(i, uv.getX(i) * s[0] / 3, uv.getY(i) * s[1] / 3) }
    return mesh(name, geometry, pos, mat, parent, rotation)
  }
  function plane(name, pos, size, mat, rotation = [0, 0, 0], parent = group) {
    return mesh(name, new api.PlaneGeometry(...size), pos, mat, parent, rotation, false)
  }
  function partGroup(name, position = [0, 0, 0], parent = group) {
    const node = new api.Group(); node.name = name; node.position.set(...position); parent.add(node); return node
  }
  function lamp(name, pos, color, intensity, distance, parent = group) {
    const light = new api.PointLight(color, intensity, distance, 2)
    light.name = name; light.position.set(...pos); parent.add(light); return light
  }
  function particles(name, count, color, size, additive = false) {
    const geometry = new api.BufferGeometry()
    geometry.setAttribute('position', new api.Float32BufferAttribute(new Float32Array(count * 3), 3))
    const material = new api.PointsMaterial({color, size, map: particle, transparent: true, opacity: additive ? 0.85 : 0.19,
      depthWrite: false, blending: additive ? api.AdditiveBlending : api.NormalBlending, sizeAttenuation: true})
    const points = new api.Points(geometry, material); points.name = name; points.frustumCulled = false
    points.userData.mapEffect = true; group.add(points)
    return points
  }
  function insetDetails(c) {
    const p = c.center, s = c.size
    const node = partGroup(`Structure ${c.id}`)
    node.userData.mapColliderId = c.id
    // All structural mesh bounds are tested before the static material merge.
    if (c.kind === 'rubble') {
      box(`${c.id} shattered foundation`, [p.x, p.y - s.y * 0.29, p.z], [s.x, s.y * 0.42, s.z], m.concrete, node)
      for (let i = 0; i < 14; i++) {
        const sx = s.x * (0.07 + rand() * 0.13), sz = s.z * (0.13 + rand() * 0.25), sy = s.y * (0.18 + rand() * 0.35)
        const x = p.x + (rand() - 0.5) * (s.x - sx * 1.2), z = p.z + (rand() - 0.5) * (s.z - sz * 1.2)
        const y = p.y - s.y / 2 + s.y * 0.4 + sy / 2
        mesh(`${c.id} broken slab ${i}`, new api.DodecahedronGeometry(1, 0).scale(sx * 0.6, sy * 0.6, sz * 0.6), [x, Math.min(y, p.y + s.y / 2 - sy * 0.6), z], i % 4 ? m.concrete : m.rust, node)
      }
    } else if (c.kind === 'truck') {
      box('Truck armored chassis', [p.x, 0.48, p.z], [5.45, 0.6, 2.32], m.dark, node)
      box('Truck crushed cargo bed', [p.x + 0.95, 1, p.z], [3.5, 0.55, 2.3], m.truck, node)
      for (const z of [-1.09, 1.09]) box('Truck torn cargo side', [p.x + 0.98, 1.52, p.z + z], [3.48, 0.75, 0.12], m.rust, node)
      box('Truck cabin', [p.x - 1.85, 1.3, p.z], [1.65, 1.6, 2.28], m.truck, node)
      box('Truck roof', [p.x - 1.8, 2.27, p.z], [1.8, 0.18, 2.35], m.rust, node)
      for (const z of [-1.146, 1.146]) {
        plane('Truck shattered windshield', [p.x - 1.83, 1.84, p.z + z], [1.28, 0.62], m.dark, [0, z > 0 ? 0 : Math.PI, 0], node)
        plane('Resistance stencil', [p.x - 1.83, 1.03, p.z + z], [1, 0.35], label('R / 07'), [0, z > 0 ? 0 : Math.PI, 0], node)
      }
      for (const x of [-1.8, 1.65]) for (const z of [-1.05, 1.05]) {
        mesh('Truck burnt wheel', new api.CylinderGeometry(0.49, 0.49, 0.3, 12), [p.x + x, 0.5, p.z + z], m.rubber, node, [Math.PI / 2, 0, 0])
        mesh('Truck wheel hub', new api.CylinderGeometry(0.23, 0.23, 0.28, 10), [p.x + x, 0.5, p.z + z], m.rust, node, [Math.PI / 2, 0, 0])
      }
    } else if (c.kind === 'barrel') {
      mesh('Burn barrel drum', new api.CylinderGeometry(0.38, 0.37, 1.24, 16), [p.x, 0.65, p.z], m.rust, node)
      for (const y of [0.13, 0.48, 0.96, 1.24]) mesh('Barrel steel hoop', new api.CylinderGeometry(0.395, 0.395, 0.05, 16), [p.x, y, p.z], m.dark, node)
      mesh('Hot coals', new api.CylinderGeometry(0.32, 0.32, 0.015, 12), [p.x, 1.285, p.z], m.orangeGlow, node)
      const flame = particles(`${c.id} flame and embers`, 34, 0xff9029, 0.27, true)
      const smoke = particles(`${c.id} drifting smoke`, 15, 0x79818b, 1.2)
      const tongues = mesh('Licking barrel flames', new api.PlaneGeometry(0.75, 1.3), [p.x, 1.83, p.z], new api.PhysicalMaterial({map:flameTexture, emissiveMap:flameTexture, color:0xffb74d, emissive:0xff8a24, emissiveIntensity:3, transparent:true, depthWrite:false, side:api.DoubleSide}), group, [0,0,0], false)
      refs.fires.push({pos: [p.x, 1.3, p.z], flame, smoke, tongues, light: lamp(`${c.id} firelight`, [p.x, 1.6, p.z], 0xff681c, 32, 12)})
    } else {
      const container = c.kind === 'container'
      const mat = container ? m[c.id.includes('red') ? 'red' : c.id.includes('blue') ? 'blue' : 'steel']
        : c.kind === 'floor' ? m.ground : c.kind === 'stair' || c.kind === 'ramp' ? m.steel : m.concrete
      const isFloor = c.kind === 'floor' || c.kind === 'stair' || c.kind === 'ramp'
      const holes = (map.walkable?.movementHoles || []).filter(h => h.collider === c.id)
      const tread = c.kind === 'stair' && map.walkable?.heightRules?.stairTreadOffset !== undefined
        ? p.y + map.walkable.heightRules.stairTreadOffset : p.y + s.y / 2
      if (holes.length) {
        let rectangles = [{x0: p.x - s.x / 2, x1: p.x + s.x / 2, z0: p.z - s.z / 2, z1: p.z + s.z / 2}]
        for (const h of holes) rectangles = rectangles.flatMap(r => {
          const x0 = Math.max(r.x0, h.minX), x1 = Math.min(r.x1, h.maxX), z0 = Math.max(r.z0, h.minZ), z1 = Math.min(r.z1, h.maxZ)
          if (x0 >= x1 || z0 >= z1) return [r]
          return [{...r, x1: x0}, {...r, x0: x1}, {x0, x1, z0: r.z0, z1: z0}, {x0, x1, z0: z1, z1: r.z1}].filter(v => v.x1 > v.x0 && v.z1 > v.z0)
        })
        for (const r of rectangles) box(`${c.id} around stairwell`, [(r.x0 + r.x1) / 2, p.y, (r.z0 + r.z1) / 2], [r.x1 - r.x0, s.y, r.z1 - r.z0], mat, node)
      } else if (c.kind === 'ramp' && map.walkable?.surfaces?.some(surface => surface.collider === c.id && surface.height === 'ramp')) {
        const surface = map.walkable.surfaces.find(surface => surface.collider === c.id)
        const geometry = new api.BoxGeometry(s.x, s.y, s.z, 8, 1, 8)
        const position = geometry.attributes.position
        for (let i=0; i<position.count; i++) if(position.getY(i)>0) {
          const coordinate = surface.axis === 'z' ? p.z + position.getZ(i) : p.x + position.getX(i)
          const ratio = Math.max(0, Math.min(1, (coordinate - surface.from) / (surface.to - surface.from)))
          const height = Math.min(p.y + s.y / 2, surface.low + ratio * (surface.high - surface.low))
          position.setY(i, height - p.y)
        }
        geometry.computeVertexNormals()
        mesh(c.id, geometry, xyz(p), mat, node)
      } else if (c.kind === 'stair') {
        const bottom = p.y - s.y / 2
        box(c.id, [p.x, (bottom + tread) / 2, p.z], [s.x, tread - bottom, s.z], mat, node)
      } else box(c.id, xyz(p), isFloor ? xyz(s) : [s.x - 0.025, s.y - 0.025, s.z - 0.025], mat, node)
      if (container) {
        for (const x of [-s.x / 2 + 0.06, s.x / 2 - 0.06]) {
          for (const y of [0.07, s.y - 0.07]) box('Container reinforced edge', [p.x + x, y, p.z], [0.12, 0.12, s.z], m.rust, node)
          for (let z = -s.z / 2 + 0.2; z < s.z / 2; z += 0.45) box('Container corrugation', [p.x + x, p.y, p.z + z], [0.08, s.y - 0.24, 0.06], mat, node)
        }
        for (const z of [-s.z / 2 + 0.025, s.z / 2 - 0.025]) {
          for (const x of [-0.6, 0.6]) box('Container locking bar', [p.x + x, p.y, p.z + z], [0.055, s.y - 0.25, 0.05], m.steel, node)
          plane('Container serial', [p.x, 2.24, p.z + z], [2, 0.55], label(`CYBERDYNE\nLA 2029 / ${c.id.slice(-3).toUpperCase()}`), [0, z > 0 ? 0 : Math.PI, 0], node)
        }
      } else if (!isFloor) {
        const alongX = s.x > s.z, length = alongX ? s.x : s.z, depth = alongX ? s.z : s.x
        for (let a = -length / 2 + 0.12; a < length / 2; a += 3.4) {
          box('Recessed structural rib', [p.x + (alongX ? a : 0), p.y, p.z + (alongX ? 0 : a)], alongX ? [0.2, s.y, depth] : [depth, s.y, 0.2], m.dark, node)
        }
        for (const y of [p.y - s.y / 2 + 0.14, p.y + s.y / 2 - 0.13]) box('Concrete edge beam', [p.x, y, p.z], [s.x, 0.25, s.z], m.concrete, node)
        if (c.id.startsWith('building_front')) {
          for (const y of [1.8, 4.5]) for (const x of [-3.8, 0, 3.8]) {
            // Inset black window recesses on solid walls, with steel mullions.
            plane('Sealed blast window', [p.x + x, y, p.z - s.z / 2], [2.1, 1.05], m.dark, [0, Math.PI, 0], node)
            box('Window crossbar', [p.x + x, y, p.z - s.z / 2 + 0.025], [0.07, 1.05, 0.05], m.rust, node)
          }
          plane('Bunker facade stencil', [p.x, 5.6, p.z - s.z / 2], [9, 0.55], label(c.id.endsWith('w') ? 'BUNKER 7' : 'LOS ANGELES / 2029', '#c8b988'), [0, Math.PI, 0], node)
        }
        if (c.kind === 'tunnel_wall') {
          box('Tunnel corroded conduit', [p.x, 2.3, p.z + (p.z > 0 ? -0.27 : 0.27)], [s.x, 0.1, 0.06], m.rust, node)
          plane('Tunnel wayfinding', [p.x, 1.8, p.z + (p.z > 0 ? -0.3 : 0.3)], [3.4, 0.65], label('SERVICE / 07', '#b7c6ba'), [0, p.z > 0 ? Math.PI : 0, 0], node)
        }
      }
      if (c.kind === 'stair') box('Step safety nosing', [p.x, tread - 0.01, p.z + s.z / 2 - 0.045], [s.x, 0.02, 0.09], m.yellow, node)
      if (c.id === 'dock_floor') {
        for (let z = -13; z < 3.5; z += 1.4) box('Dock hazard edge', [18.055, 0.66, z], [0.11, 0.08, 0.65], m.yellow, node)
        plane('Dock deck marking', [22, 0.7, -1], [3, 2], label('LOADING\nBAY 07', '#b4aa83'), [-Math.PI / 2, 0, 0], node)
      }
    }
    node.updateMatrixWorld(true)
    const b = new api.Box3().setFromObject(node)
    bounds.push({id: c.id, min: b.min.toArray(), max: b.max.toArray(), center: xyz(p), size: xyz(s)})
    return node
  }
  for (const collider of map.colliders) insetDetails(collider)

  // Door panels telescope into their existing bounds, never into a corridor.
  for (const d of map.doors) {
    const alongX = d.size.x > d.size.z, width = alongX ? d.size.x : d.size.z, depth = alongX ? d.size.z : d.size.x
    const door = partGroup(`Door ${d.id}`, xyz(d.pos)); if (!alongX) door.rotation.y = Math.PI / 2
    const shutter = partGroup(`${d.id} shutter`, [0, 0, 0], door)
    box('Armored door leaf', [0, 0, 0], [width - 0.1, d.size.y - 0.06, depth - 0.025], m.dark, shutter)
    for (let y = -d.size.y / 2 + 0.25; y < d.size.y / 2; y += 0.32) box('Door horizontal lamella', [0, y, 0], [width - 0.08, 0.06, depth], m.rust, shutter)
    const signal = box('Door lock indicator', [width * 0.34, d.size.y * 0.3, 0], [0.13, 0.13, depth], m.redGlow, shutter)
    const sign = label(d.id.includes('tunnel') ? 'SERVICE ACCESS' : 'RESISTANCE / 07', '#c4bc9e')
    for (const z of [-depth / 2, depth / 2]) plane('Door stencil', [0, 0.1, z], [Math.min(width - 0.3, 2.4), 0.5], sign, [0, z > 0 ? 0 : Math.PI, 0], shutter)
    refs.doors.push({id: d.id, object: door, shutter, signal, height: d.size.y, amount: 0, pos: d.pos})
    shutter.visible = !runtime || d.default === 'locked'
  }
  // Gates sit just beyond the enforced play bounds. The core provides gate positions, not solid gate colliders.
  for (const g of map.spawnGates) {
    const gate = partGroup(`Spawn gate ${g.id}`, [g.pos.x - Math.sin(g.yaw) * 2.04, 1.5, g.pos.z - Math.cos(g.yaw) * 2.04])
    gate.rotation.y = g.yaw
    const shutter = partGroup(`${g.id} bunker shutter`, [0, 0, 0], gate)
    box('Gate sealed plating', [0, 0, 0], [3.95, 3, 0.06], m.dark, shutter)
    for (let x = -1.7; x < 2; x += 0.48) box('Gate armor rib', [x, 0, 0.06], [0.1, 3, 0.08], m.rust, shutter)
    plane('Skynet gate identification', [0, 0.35, 0.11], [3.4, 0.8], label(`SKYNET / ${g.id}`, '#efb0a0'), [0, 0, 0], shutter)
    const signal = box('Gate red warning strip', [0, 1.25, 0.12], [3.75, 0.13, 0.03], m.redGlow, gate)
    const light = lamp(`${g.id} red gate spill`, [0, 1.2, 0.8], 0xff2010, 3, 6, gate)
    refs.gates.push({id: g.id, shutter, signal, light, amount: 0, lastSpawn: -1000})
  }
  // Breakup remains inside the slot. The overlapping static wall is retained, as required by the core data.
  const flank = partGroup('South flank breakable facing')
  for (let y = 0; y < 4; y++) for (let x = 0; x < 6; x++) {
    const f = map.flankWall, sx = f.size.x / 6, sy = f.size.y / 4
    const pos = [f.pos.x - f.size.x / 2 + sx * (x + 0.5), f.pos.y - f.size.y / 2 + sy * (y + 0.5), f.pos.z]
    const piece = box('Fractured south flank block', pos, [sx - 0.025, sy - 0.025, f.size.z], m.concrete, flank)
    refs.flank.push({piece, y: pos[1], x, row: y})
  }
  const f = map.flankWall
  plane('Flank demolition warning', [f.pos.x, 1.5, f.pos.z + f.size.z / 2], [3.2, 1], label('WEAK STRUCTURE\nKEEP CLEAR', '#c8a564'))
  for (const slot of map.hazardSlots) {
    const base = partGroup(`Hazard ${slot.id}`, xyz(slot.pos))
    plane('Hazard recessed grate', [0, 0, 0], [slot.size.x, slot.size.z], m.dark, [-Math.PI / 2, 0, 0], base)
    for (let x = -slot.size.x / 2 + 0.2; x < slot.size.x / 2; x += 0.35) box('Hazard grille', [x, 0, 0], [0.035, 0.02, slot.size.z - 0.12], m.steel, base)
    const electric = partGroup('Electrified floor arcs', [0, 0.02, 0], base)
    const arcGeo = new api.BufferGeometry(); arcGeo.setAttribute('position', new api.Float32BufferAttribute(new Float32Array(36 * 3), 3))
    const arcs = new api.LineSegments(arcGeo, new api.LineBasicMaterial({color: 0x8ee8ff, transparent: true, opacity: 0.9, blending: api.AdditiveBlending}))
    electric.add(arcs)
    const glow = plane('Electrical floor glow', [0, 0, 0], [slot.size.x, slot.size.z], new api.UnlitMaterial({color: 0x247dde, transparent: true, opacity: 0.16, depthWrite: false, side: api.DoubleSide}), [-Math.PI / 2, 0, 0], electric)
    const steam = particles(`${slot.id} steam plume`, 32, 0xc9dce3, 1.5)
    steam.material.opacity = 0.44
    const light = lamp(`${slot.id} arc light`, xyz(slot.pos).map((v, i) => i === 1 ? v + 0.3 : v), 0x469fff, 0, 7)
    electric.visible = false; steam.visible = false
    refs.hazards.push({id: slot.id, pos: xyz(slot.pos), size: slot.size, electric, arcs, steam, glow, light})
  }
  const trader = partGroup('Resistance trader crate', xyz(map.trader.pos))
  const ts = map.trader.size
  box('Trader armored crate', [0, -0.12, 0], [ts.x, ts.y - 0.26, ts.z], m.truck, trader)
  for (const x of [-0.8, 0.8]) box('Trader retaining strap', [x, -0.1, 0], [0.12, ts.y - 0.3, ts.z], m.rust, trader)
  const lid = partGroup('Trader sliding lid', [0, ts.y / 2 - 0.12, 0], trader)
  box('Trader lid', [0, 0, 0], [ts.x, 0.23, ts.z], m.steel, lid)
  plane('Trader supply stencil', [0, -0.05, -ts.z / 2], [1.5, 0.6], label('RESISTANCE\nSUPPLY / 07', '#a8dbbb'), [0, Math.PI, 0], trader)
  const inner = box('Trader illuminated supplies', [0, ts.y / 2 - 0.28, 0], [ts.x - 0.18, 0.06, ts.z - 0.18], m.greenGlow, trader)
  const traderLight = lamp('Trader green light', [0, 0.8, 0], 0x75ffc7, 0, 5, trader)
  refs.trader = {lid, inner, light: traderLight, amount: 0, depth: ts.z}

  // Zone point lights correspond one-to-one with the core switches.
  for (const zone of map.lightZones) {
    const light = lamp(`Light zone ${zone.id}`, xyz(zone.pos), zone.id === 'building' ? 0xb0d4bf : 0x99c9ff, zone.id === 'building' ? 90 : 135, zone.id === 'building' ? 22 : 30)
    refs.zones.push({id: zone.id, light, power: light.intensity})
  }
  // Fixtures are in existing wall volumes, with no extra poles or overhead obstructions.
  const fixtureGroup = partGroup('Switchable light fixtures')
  const fixtureMats = Object.fromEntries(map.lightZones.map(z => [z.id, m.whiteGlow.clone()]))
  for (const zone of refs.zones) zone.fixtureMaterial = fixtureMats[zone.id]
  for (const x of [-7.75, 7.75]) box('Courtyard flood fixture', [x, 5.5, 16.74], [0.9, 0.13, 0.08], fixtureMats.courtyard, fixtureGroup)
  box('Dock lamp fixture', [29.05, 2.7, -5], [0.07, 0.2, 1.3], fixtureMats.dock, fixtureGroup)
  box('Interior fluorescent fixture', [0, 2.98, 24], [3.5, 0.04, 0.2], fixtureMats.building, fixtureGroup)
  box('Tunnel utility fixture', [-24, 2.85, 0], [0.65, 0.05, 0.22], m.whiteGlow)
  lamp('Tunnel emergency utility light', [-24, 2.55, 0], 0x86b9c9, 16, 11)
  const key = new api.DirectionalLight(0x8fb6ee, 2.45)
  key.name = 'Map moon shadow key'; key.position.set(-18, 34, -12); key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  Object.assign(key.shadow.camera, {left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 100})
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.05
  group.add(key); group.add(key.target)
  const fill = new api.HemisphereLight(0x7593b3, 0x16100b, 1.05); fill.name = 'Map night sky fill'; group.add(fill)

  // Unreachable skyline outside the 60 m compound is explicitly scenery, never walkable geometry.
  const skyline = partGroup('Distant Los Angeles ruins')
  skyline.userData.mapBackdrop = true
  const silhouette = new api.UnlitMaterial({color: 0x080e16, fog: true})
  for (let i = 0; i < 46; i++) {
    const angle = i / 46 * Math.PI * 2, radius = 85 + rand() * 25, h = 8 + rand() * 26
    const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius, width = 4 + rand() * 7
    box('Ruined skyline block', [x, h / 2 - 2, z], [width, h, 5 + rand() * 6], silhouette, skyline)
    if (i % 3 === 0) box('Exposed skyscraper core', [x, h + 1, z], [width * 0.5, 6, 3], silhouette, skyline)
    if (i % 4 === 0) {
      const fire = particles(`Distant fire ${i}`, 9, 0xff751d, 1.8, true)
      const smoke = particles(`Distant smoke ${i}`, 5, 0x4c515d, 6)
      refs.fires.push({pos: [x, 1, z], flame: fire, smoke, distant: true})
    }
  }
  refs.dust = particles('Dust in light shafts and wiring sparks', 90, 0xa7becf, 0.045, true)
  refs.wire = particles('Broken tunnel wiring sparks', 10, 0xffb243, 0.07, true)
  if (markers) {
    plane('Player start marker', [map.playerStart.pos.x, 0.001, map.playerStart.pos.z], [1.8, 1.3], label('PLAYER\nSTART', '#98c9dc'), [-Math.PI / 2, 0, 0])
  }
  // Merge only static meshes. Animated roots, lights and particles retain stable names.
  const dynamicRoots = new Set([fixtureGroup, ...refs.doors.map(v => v.object), ...refs.gates.map(v => v.shutter.parent), flank, trader,
    ...refs.hazards.map(v => v.electric.parent), ...refs.fires.map(v => v.tongues).filter(Boolean)])
  function collect(node) {
    for (const child of [...node.children]) {
      if (dynamicRoots.has(child) || child.isPoints || child.isLight || child.isLine) continue
      if (child.isMesh) {
        child.updateWorldMatrix(true, false)
        const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrixWorld)
        if (!batches.has(child.material)) batches.set(child.material, [])
        batches.get(child.material).push(geometry)
        child.geometry.dispose(); child.removeFromParent()
      } else collect(child)
    }
  }
  collect(group)
  for (const [material, geometries] of batches) {
    const geometry = api.mergeGeometries(geometries, false)
    if (!geometry) throw new Error(`Could not merge map material ${material.name}`)
    mesh(`Static ${material.name || 'skyline'}`, geometry, [0, 0, 0], material)
    for (const part of geometries) part.dispose()
  }
  // Stopped-mode effects have a deterministic preview at their authored sources.
  for (const fire of refs.fires) {
    for (const [points, height, spread] of [[fire.flame, 1.4, 0.25], [fire.smoke, 6, 1]]) {
      const positions = points.geometry.attributes.position, scale = fire.distant ? 4 : 1
      for (let i = 0; i < positions.count; i++) positions.setXYZ(i, fire.pos[0] + (rand() - 0.5) * spread * scale, fire.pos[1] + rand() * height * scale, fire.pos[2] + (rand() - 0.5) * spread * scale)
    }
  }
  refs.dust.visible = runtime; refs.wire.visible = runtime
  boxGeo.dispose()
  group.userData.mapVisualBounds = bounds
  // Non-enumerable runtime refs avoid persisting cycles from generated objects.
  Object.defineProperty(group, 'mapRefs', {value: refs})
  Object.defineProperty(group, 'mapTextures', {value: textures})
  return group
}
