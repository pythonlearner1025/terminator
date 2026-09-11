import * as engine from 'threepipe'
import {RuntimeObjectOwner} from '@kite3d/engine'

const COLORS = {
  floor: 0x1d2731,
  wall: 0x3d4b58,
  building_wall: 0x485866,
  rubble: 0x56606a,
  truck: 0x34404b,
  barrel: 0x9c4b22,
  stair: 0x68737d,
  container: 0x3f5964,
  ramp: 0x59636d,
  tunnel_wall: 0x303c47,
}

export class MapView {
  constructor(viewer, map) {
    this.viewer = viewer
    this.map = map
    this.owner = null
    this.root = null
    this.previewChildren = []
  }

  start() {
    this.stop()
    const source = this.viewer.scene.modelRoot.getObjectByName('Map')
    if (!source) throw new Error('Map authored node not found')
    this.previewChildren = source.children.filter((child) => child.userData?.kite3dGenerated === true)
    for (const child of this.previewChildren) child.visible = false
    this.owner = new RuntimeObjectOwner('terminator-map-view')
    this.root = this.owner.attachRuntimeRoot(new engine.Group(), this.viewer.scene, source)
    this.root.name = 'Map Runtime'
    this.root.add(createMapGroup(engine, this.map, {markers: false, runtime: true}))
  }

  sync(world) {
    if (!this.root) return
    this.root.traverse((object) => {
      const doorId = object.userData?.doorId
      if (doorId) object.visible = world.mapState.doors[doorId] === 'locked'
      if (object.userData?.flankWall) object.visible = !world.mapState.flankWallBroken
    })
  }

  stop() {
    this.owner?.cleanup()
    this.owner = null
    this.root = null
    for (const child of this.previewChildren) child.visible = true
    this.previewChildren = []
  }
}

export function createMapGroup(api, map, {markers = true, runtime = false} = {}) {
  const group = new api.Group()
  group.name = runtime ? 'Bunker 7 Runtime Geometry' : 'Bunker 7 Gray Box Preview'
  const materialCache = new Map()
  const material = (kind) => {
    if (!materialCache.has(kind)) {
      materialCache.set(kind, new api.PhysicalMaterial({
        color: new api.Color(COLORS[kind] || 0x46515c),
        roughness: 0.86,
        metalness: kind === 'container' || kind === 'barrel' ? 0.35 : 0.08,
      }))
    }
    return materialCache.get(kind)
  }
  const box = (name, center, size, mat, data = {}) => {
    const mesh = new api.Mesh2(new api.BoxGeometry(size.x, size.y, size.z), mat)
    mesh.name = name
    mesh.position.set(center.x, center.y, center.z)
    Object.assign(mesh.userData, data)
    group.add(mesh)
    return mesh
  }
  for (const collider of map.colliders) {
    box(`Collider ${collider.id}`, collider.center, collider.size, material(collider.kind), {
      mapColliderId: collider.id,
      mapKind: collider.kind,
    })
  }
  const doorMaterial = new api.PhysicalMaterial({color: new api.Color(0x6b2525), roughness: 0.65, metalness: 0.5})
  for (const door of map.doors) box(`Door ${door.id}`, door.pos, door.size, doorMaterial, {doorId: door.id})
  box('Flank Wall south_flank', map.flankWall.pos, map.flankWall.size, material('wall'), {flankWall: true})
  box('Trader Crate', map.trader.pos, map.trader.size, new api.PhysicalMaterial({color: new api.Color(0xb88735), roughness: 0.75, metalness: 0.25}), {trader: true})

  if (markers) addMarkers(api, group, map)
  return group
}

function addMarkers(api, group, map) {
  const markerMaterial = (color, opacity = 0.9) => new api.UnlitMaterial({
    color: new api.Color(color), transparent: opacity < 1, opacity, depthWrite: opacity === 1,
  })
  const add = (name, pos, geometry, material, data = {}) => {
    const mesh = new api.Mesh2(geometry, material)
    mesh.name = name
    mesh.position.set(pos.x, pos.y, pos.z)
    mesh.raycast = () => {}
    Object.assign(mesh.userData, data)
    group.add(mesh)
  }
  const gateGeometry = new api.CylinderGeometry(0.45, 0.45, 0.12, 12)
  const gateMaterial = markerMaterial(0xd62f2f)
  for (const gate of map.spawnGates) add(`Gate Marker ${gate.id}`, {...gate.pos, y: 0.12}, gateGeometry, gateMaterial, {markerType: 'gate', markerId: gate.id})
  const doorMarker = markerMaterial(0xff5d5d)
  for (const door of map.doors) add(`Door Marker ${door.id}`, {...door.pos, y: door.pos.y + door.size.y / 2 + 0.25}, new api.BoxGeometry(0.25, 0.25, 0.25), doorMarker, {markerType: 'door', markerId: door.id})
  const lightMaterial = markerMaterial(0x66b8ff, 0.35)
  for (const zone of map.lightZones) add(`Light Zone ${zone.id}`, zone.pos, new api.BoxGeometry(zone.size.x, 0.08, zone.size.z), lightMaterial, {markerType: 'light', markerId: zone.id})
  const hazardMaterial = markerMaterial(0xf0cb3d, 0.55)
  for (const slot of map.hazardSlots) add(`Hazard Slot ${slot.id}`, slot.pos, new api.BoxGeometry(slot.size.x, 0.05, slot.size.z), hazardMaterial, {markerType: 'hazard', markerId: slot.id})
  add('Trader Marker', {...map.trader.pos, y: map.trader.pos.y + 1.2}, new api.CylinderGeometry(0.3, 0.3, 1.2, 8), markerMaterial(0xffa52c), {markerType: 'trader'})
}
