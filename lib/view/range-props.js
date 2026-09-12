import {solidMaterial, surfaceGeometry} from './fx-world.js'
import {RANGE_START} from '../core/range.js'

export const RANGE_PLATES = Object.freeze([-25, -22.5, -20, -17.5, -15, -10].map((z, index) =>
  Object.freeze({id: `range-plate-${index + 1}`, x: RANGE_START.x + 15, y: 1.8, z})))

// Range targets exist only in the optional runtime range mode. They are not Bunker 7 map pieces.
export function createRangeProps(engine) {
  const root = new engine.Group()
  root.name = 'Range steel targets and firing line'
  const material = solidMaterial()
  material.name = 'Range worn steel PBR'
  const shape = new engine.Shape()
  const points = [[-.25, -.8], [.25, -.8], [.29, -.70], [.29, -.2], [.25, -.12], [.11, -.12], [.11, .10], [.08, .14], [-.08, .14], [-.11, .10], [-.11, -.12], [-.25, -.12], [-.29, -.2], [-.29, -.70]]
  points.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y))
  shape.closePath()
  const geometry = new engine.ExtrudeGeometry(shape, {depth: .012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .004, bevelThickness: .003})
  const uv = geometry.attributes.uv
  const position = geometry.attributes.position
  for (let index = 0; index < uv.count; index += 1) uv.setXY(index, (position.getX(index) + .3) / .6, (position.getY(index) + .81) / .96)
  surfaceGeometry(geometry, 10)
  const rod = surfaceGeometry(new engine.BoxGeometry(.055, 1, .055), 0)
  const foot = surfaceGeometry(new engine.BoxGeometry(.75, .05, .6), 0)
  root.plates = RANGE_PLATES.map(spec => {
    const stand = new engine.Group()
    stand.name = spec.id
    stand.position.set(spec.x, 0, spec.z)
    stand.rotation.y = Math.PI / 2
    root.add(stand)
    for (const x of [-.42, .42]) {
      const leg = new engine.Mesh2(rod, material)
      leg.position.set(x, .99, 0)
      leg.scale.y = 1.98
      stand.add(leg)
      const base = new engine.Mesh2(foot, material)
      base.position.set(x, .03, 0)
      stand.add(base)
    }
    const beam = new engine.Mesh2(rod, material)
    beam.rotation.z = Math.PI / 2
    beam.position.y = 2
    beam.scale.y = 1.05
    stand.add(beam)
    const pivot = new engine.Group()
    pivot.position.y = spec.y
    stand.add(pivot)
    const plate = new engine.Mesh2(geometry, material)
    plate.name = 'Suspended steel silhouette'
    pivot.add(plate)
    for (const x of [-.2, .2]) {
      const strap = new engine.Mesh2(rod, material)
      strap.position.set(x, 0, .035)
      strap.scale.set(.5, .35, .5)
      pivot.add(strap)
    }
    return {...spec, pivot, lastHit: -Infinity, hits: 0}
  })
  const line = new engine.Mesh2(surfaceGeometry(new engine.BoxGeometry(.1, .015, 18), 2), material)
  line.name = 'Range firing line'
  line.position.set(RANGE_START.x, .012, -18)
  root.add(line)
  return root
}
