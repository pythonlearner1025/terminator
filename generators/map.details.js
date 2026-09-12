// Cosmetic details fit their owning solid, or sit on inaccessible container roofs.
// The map data remains the only collision and navigation authority.
export function addSurfaceDetails(api, c, node, {box, mesh, plane, label, decal, m, rand}) {
  const p = c.center, s = c.size
  if (['wall', 'building_wall', 'tunnel_wall'].includes(c.kind)) {
    const alongX = s.x > s.z
    const length = alongX ? s.x : s.z
    for (const side of [-1, 1]) {
      const rotation = [0, alongX ? (side > 0 ? 0 : Math.PI) : side * Math.PI / 2, 0]
      const depth = (alongX ? s.z : s.x) / 2 - .003
      for (let a = -length / 2 + 1.15; a < length / 2 - .8; a += 3.8) {
        const at = [p.x + (alongX ? a : side * depth), p.y, p.z + (alongX ? side * depth : a)]
        decal('Rain runoff and soot', at, [2.15, Math.min(s.y - .1, 3.7)], Math.floor(rand() * 4), rotation, node)
        if (rand() > .4) decal('Bullet impacts beside cover', [at[0], p.y - s.y * .12, at[2]], [1.1, 1.1], 8 + Math.floor(rand() * 2), rotation, node)
      }
      // Pipes remain embedded in the wall thickness, including their flanges.
      if (c.kind !== 'wall') {
        for (const y of [p.y + s.y * .29, p.y + s.y * .34]) {
          const pos = [p.x + (alongX ? 0 : side * (depth - .055)), y, p.z + (alongX ? side * (depth - .055) : 0)]
          mesh('Corroded service pipe', new api.CylinderGeometry(.055, .055, length - .15, 8), pos, m.rust, node,
            alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0])
        }
      }
    }
  }
  if (c.kind === 'container') {
    for (const side of [-1, 1]) {
      const z = p.z + side * (s.z / 2 - .002)
      const rotation = [0, side > 0 ? 0 : Math.PI, 0]
      decal('Container chipped caution corners', [p.x, .28, z], [s.x - .1, .32], 10, rotation, node)
      decal('Container oily runoff', [p.x, 1.25, z], [s.x - .15, 2.5], 2, rotation, node)
      for (const x of [-s.x / 2 + .15, s.x / 2 - .15]) for (const y of [.16, s.y - .16]) {
        box('Container cast corner fitting', [p.x + x, y, p.z + side * (s.z / 2 - .12)], [.24, .24, .24], m.steel, node)
        plane('Corner fitting recess', [p.x + x, y, z - side * .001], [.1, .075], m.dark, rotation, node)
      }
    }
  }
  if (c.kind === 'truck') {
    for (const side of [-1, 1]) {
      const z = p.z + side * 1.19
      decal('Wreck scorched paint', [p.x - 1.5, 1.3, z], [2.2, 1.65], 7, [0, side > 0 ? 0 : Math.PI, 0], node)
      for (let i = 0; i < 6; i++) box('Truck radiator rib', [p.x - 2.69, .8 + i * .09, p.z], [.035, .025, 1.75], m.steel, node)
      for (const x of [-1.85, 1.65]) for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3
        mesh('Wheel hub lug', new api.SphereGeometry(.035, 5, 3), [p.x + x + Math.cos(a) * .15, .5 + Math.sin(a) * .15, z], m.steel, node)
      }
    }
    for (let i = 0; i < 7; i++) box('Truck bed splinter', [p.x + .2 + i * .35, 1.33, p.z + (rand() - .5) * 1.4], [.25, .05, 1], m.rust, node, [0, rand() * .5, 0])
  }
  if (c.id === 'rubble_nw') {
    // Sandbags inset into rubble cover, never a new obstacle.
    for (let row = 0; row < 2; row++) for (let i = 0; i < 5; i++) {
      mesh('Resistance sandbag', new api.SphereGeometry(1, 10, 6).scale(.35, .16, .28),
        [p.x - 1.48 + i * .7 + row * .04, .79 + row * .31, p.z - .52], m.canvas, node, [0, (rand() - .5) * .2, .03])
    }
    const at = [p.x + 1.25, .53, p.z + .24]
    box('Abandoned ammunition box', at, [.92, .65, .75], m.truck, node)
    for (const dx of [-.32, .32]) box('Ammo box steel band', [at[0] + dx, at[1], at[2]], [.07, .67, .77], m.steel, node)
    plane('Ammunition caliber stencil', [at[0], at[1], at[2] + .376], [.72, .32], label('7.62 NATO'), [0, 0, 0], node)
  }
  if (c.id === 'rubble_se') {
    // A crushed civilian car is embedded entirely in the 5 x 1.1 x 2.5 rubble solid.
    box('Second wreck crushed body', [p.x, .48, p.z], [4.65, .53, 1.94], m.blue, node)
    box('Second wreck collapsed cabin', [p.x + .15, .84, p.z], [2.05, .42, 1.7], m.dark, node)
    box('Second wreck buckled roof', [p.x + .22, 1.035, p.z], [2.15, .08, 1.78], m.rust, node)
    for (const z of [-.86, .86]) plane('Second wreck shattered glass', [p.x + .1, .87, p.z + z], [1.7, .3], m.glass, [0, z > 0 ? 0 : Math.PI, 0], node)
    for (const dx of [-1.45, 1.48]) for (const dz of [-.96, .96]) {
      mesh('Second wreck deflated tire', new api.CylinderGeometry(.32, .32, .26, 12).scale(1, 1, .78), [p.x + dx, .3, p.z + dz], m.rubber, node, [Math.PI / 2, 0, 0])
      mesh('Second wreck wheel rim', new api.CylinderGeometry(.17, .17, .28, 10), [p.x + dx, .3, p.z + dz], m.steel, node, [Math.PI / 2, 0, 0])
    }
    box('Second wreck exposed bumper', [p.x - 2.36, .33, p.z], [.1, .19, 2.02], m.steel, node)
    for (const dz of [-.67, .67]) box('Second wreck broken headlight', [p.x - 2.42, .58, p.z + dz], [.06, .17, .34], m.glass, node)
  }
}

export function addMapDressing(api, map, {group, box, mesh, plane, partGroup, label, decal, m, rand}) {
  // Flush ground dressing changes no walkable heights.
  for (const [x, z, sx, sz, tile] of [[-9,-6,7,4,6],[5,-2,3,3,7],[-4,3,2.8,2.8,7],[-7,6,4,2,5],[9,-12,6,3,4]]) {
    decal('Oil and blast residue', [x,.004,z], [sx,sz], tile, [-Math.PI / 2,0,0])
  }
  for (let i = 0; i < 38; i++) {
    const x = (rand() - .5) * 55, z = -27 + rand() * 41
    if (map.colliders.some(c => c.navBlock && Math.abs(c.center.x - x) < c.size.x / 2 + 1 && Math.abs(c.center.z - z) < c.size.z / 2 + 1)) continue
    decal('Uneven rainwater pool', [x,.008,z], [1.3 + rand()*4, .6 + rand()*2], 12 + i%4, [-Math.PI/2,0,rand()*Math.PI], group, m.puddle)
  }
  for (let z = -22; z < 12; z += 5) decal('Faded courtyard lane marking', [13,.003,z], [.23,2.3], 11, [-Math.PI/2,0,0])
  // Roof props cannot be reached from any walkable surface in map.json.
  for (const c of map.colliders.filter(c => c.kind === 'container')) {
    const roof = partGroup(`Inaccessible dock roof salvage ${c.id}`)
    roof.userData.mapBackdrop = true
    for (let i = 0; i < 4; i++) {
      const x = c.center.x + (i % 2 - .5) * .8, z = c.center.z + Math.floor(i / 2) * .85 - .5
      box('Dock supply case', [x,3.13,z], [.68,.46,.68], m.truck, roof)
      for (const dx of [-.23,.23]) box('Dock case strap', [x+dx,3.13,z], [.05,.47,.69], m.steel, roof)
    }
    for (let i = 0; i < 3; i++) mesh('Dock spare pipe', new api.CylinderGeometry(.11,.11,2.2,10), [c.center.x-.65+i*.25,3.08,c.center.z+1.6], m.rust, roof,[Math.PI/2,0,0])
  }
  // Cables follow existing wall faces and are embedded in their thickness.
  for (const x of [-7.75,7.75]) {
    const points=[]
    for (let i=0;i<=18;i++) points.push(new api.Vector3(x-4+i*8/18,5.25-Math.sin(i/18*Math.PI)*.7,16.73))
    mesh('Sagging balcony electrical cable', new api.TubeGeometry(new api.CatmullRomCurve3(points),24,.025,5,false),[0,0,0],m.rubber)
  }
}
