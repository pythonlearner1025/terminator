import {solidMaterial, surfaceGeometry} from '../lib/view/fx-world.js'
import {RANGE_START} from '../lib/core/range.js'

// The lane runs east through the south courtyard. Plates sit 15 m from its line.
export const RANGE_PLATES = Object.freeze([-25, -22.5, -20, -17.5, -15, -10].map((z, i) =>
  Object.freeze({id: `range-plate-${i + 1}`, x: RANGE_START.x + 15, y: 1.8, z})))

export function createRangeProps(E) {
  const root = new E.Group(); root.name = 'Range steel targets and firing line'
  const material = solidMaterial(); material.name = 'Range worn steel PBR'
  const shape = new E.Shape()
  const points = [[-.25,-.8],[.25,-.8],[.29,-.70],[.29,-.2],[.25,-.12],[.11,-.12],[.11,.10],[.08,.14],[-.08,.14],[-.11,.10],[-.11,-.12],[-.25,-.12],[-.29,-.2],[-.29,-.70]]
  points.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y)); shape.closePath()
  const geometry = new E.ExtrudeGeometry(shape, {depth:.012, bevelEnabled:true, bevelSegments:1, steps:1, bevelSize:.004, bevelThickness:.003})
  const uv=geometry.attributes.uv, p=geometry.attributes.position
  for(let i=0;i<uv.count;i++)uv.setXY(i,(p.getX(i)+.3)/.6,(p.getY(i)+.81)/.96)
  surfaceGeometry(geometry, 10)
  const rod = surfaceGeometry(new E.BoxGeometry(.055,1, .055), 0)
  const foot = surfaceGeometry(new E.BoxGeometry(.75,.05,.6), 0)
  root.plates = RANGE_PLATES.map(spec => {
    const stand = new E.Group(); stand.name = spec.id; stand.position.set(spec.x,0,spec.z); stand.rotation.y = Math.PI / 2; root.add(stand)
    for(const x of [-.42,.42]) {
      const leg=new E.Mesh2(rod,material);leg.position.set(x,.99,0);leg.scale.y=1.98;stand.add(leg)
      const base=new E.Mesh2(foot,material);base.position.set(x,.03,0);stand.add(base)
    }
    const beam=new E.Mesh2(rod,material);beam.rotation.z=Math.PI/2;beam.position.y=2;beam.scale.y=1.05;stand.add(beam)
    const pivot = new E.Group(); pivot.position.y=spec.y; stand.add(pivot)
    const plate = new E.Mesh2(geometry,material); plate.name='Suspended steel silhouette'; pivot.add(plate)
    for(const x of [-.2,.2]) {const strap=new E.Mesh2(rod,material);strap.position.set(x,0,.035);strap.scale.set(.5,.35,.5);pivot.add(strap)}
    return {...spec, pivot, lastHit: -Infinity, hits:0}
  })
  const line = new E.Mesh2(surfaceGeometry(new E.BoxGeometry(.1,.015,18), 2),material)
  line.name='Range firing line';line.position.set(RANGE_START.x,.012,-18);root.add(line)
  return root
}
