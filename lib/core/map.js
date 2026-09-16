import mapRules from './data/map.json' with {type: 'json'}
import pieceRegistry from './data/map-piece-registry.json' with {type: 'json'}
import defaultPlacements from './data/map-piece-placements.json' with {type: 'json'}

export const defaultMap = buildMapFromPlacements(mapRules, pieceRegistry, defaultPlacements.pieces)

export function buildMapFromPlacements(rules, registry, placements) {
  const map = clone(rules)
  map.colliders = []
  const assets = registry.assets || registry

  for (const placement of placements) {
    const asset = assets[placement.assetId]
    if (!asset) throw new Error(`Unknown map asset ${placement.assetId} on ${placement.id}`)
    const transform = normalizeTransform(placement)
    if (placement.role === 'collider') {
      map.colliders.push(colliderFromAsset(placement, asset, transform))
    } else if (placement.role === 'trader') {
      const collider = colliderFromAsset(placement, asset, transform)
      map.trader = {...map.trader, ...collider, pos: clone(collider.center)}
    } else if (placement.role === 'door') {
      updatePositioned(map.doors, placement, transform, asset)
    } else if (placement.role === 'gate') {
      updatePositioned(map.spawnGates, placement, transform, asset)
    } else if (placement.role === 'hazard') {
      updatePositioned(map.hazardSlots, placement, transform, asset)
    } else if (placement.role === 'flank') {
      const size = scaledSize(asset.size, transform.scale)
      map.flankWall = {...map.flankWall, pos: point(transform.translation), center: point(transform.translation), size, yaw: transform.yaw}
    } else if (placement.role === 'fixture') {
      updatePositioned(map.environment?.fixtures, placement, transform, asset)
    }
  }
  map.cacheSpots = spotList(rules.cacheSpots)
  map.traderSpots = spotList(rules.traderSpots)
  map.spawnSpots = spotList(rules.spawnSpots)
  map.extraction = rules.extraction ? {
    pos: point([rules.extraction.pos.x, rules.extraction.pos.y, rules.extraction.pos.z]),
    gateId: String(rules.extraction.gateId),
    holdSeconds: Number(rules.extraction.holdSeconds),
  } : null
  map.mapPieces = placements.map(placement => ({
    id: placement.id,
    name: placement.name,
    assetId: placement.assetId,
    role: placement.role,
    transform: normalizeTransform(placement),
  }))
  return map
}

export function scenePlacements(mapRoot) {
  const placements = []
  mapRoot?.updateWorldMatrix?.(true, true)
  mapRoot?.traverse?.(object => {
    const source = object.userData?.mapPiece
    if (!source?.assetId) return
    const position = object.getWorldPosition(tempVector(object, 'position'))
    const quaternion = object.getWorldQuaternion(tempQuaternion(object))
    const scale = object.getWorldScale(tempVector(object, 'scale'))
    placements.push({
      ...clone(source),
      assetId: assetIdFromRootPath(object.userData?.rootPath) || source.assetId,
      name: object.name,
      translation: position.toArray(),
      quaternion: quaternion.toArray(),
      scale: scale.toArray(),
    })
  })
  return placements
}

// Cache, trader, and interior spawn spots are authored in map.json alone: they
// carry no geometry, so no scene placement moves them. Every reader gets the
// same {id, pos, yaw} shape, and a map without spots gets an empty list.
function spotList(spots) {
  return (spots || []).map(spot => ({
    id: String(spot.id),
    pos: point([spot.pos.x, spot.pos.y, spot.pos.z]),
    yaw: Number(spot.yaw) || 0,
  }))
}

function colliderFromAsset(placement, asset, transform) {
  const template = asset.collider
  if (!template) throw new Error(`Map asset ${placement.assetId} has no collider`)
  const collider = {
    id: placement.id,
    kind: template.kind || asset.kind,
    center: point(transform.translation),
    size: scaledSize(template.size || asset.size, transform.scale),
    yaw: transform.yaw,
    navBlock: placement.navBlock !== false,
    blocksSight: placement.blocksSight !== false,
    ...(placement.area ? {area: placement.area} : {}),
  }
  if (template.shape && template.shape !== 'box') collider.shape = template.shape
  if (template.shapes?.length) collider.shapes = template.shapes.map(part => scalePart(part, transform.scale))
  if (!collider.yaw) delete collider.yaw
  return collider
}

function updatePositioned(records, placement, transform, asset) {
  const record = records?.find(item => item.id === placement.id)
  if (!record) return
  record.pos = point(transform.translation)
  record.yaw = transform.yaw
  if (record.size && asset.size) record.size = scaledSize(asset.size, transform.scale)
}

function scalePart(part, scale) {
  const result = clone(part)
  if (result.offset) result.offset = {
    x: result.offset.x * scale[0],
    y: result.offset.y * scale[1],
    z: result.offset.z * scale[2],
  }
  if (result.size) result.size = scaledSize(result.size, scale)
  if (result.radius !== undefined) result.radius *= Math.max(Math.abs(scale[0]), Math.abs(scale[2]))
  if (result.height !== undefined) {
    const axis = result.axis || 'y'
    result.height *= Math.abs(scale[axis === 'x' ? 0 : axis === 'z' ? 2 : 1])
  }
  return result
}

function normalizeTransform(placement) {
  const translation = array3(placement.translation, [0, 0, 0])
  const scale = array3(placement.scale, [1, 1, 1])
  const yaw = placement.quaternion ? yawFromQuaternion(placement.quaternion) : array3(placement.rotation, [0, 0, 0])[1]
  return {translation, scale, yaw}
}

function yawFromQuaternion(value) {
  const [x, y, z, w] = value.map(Number)
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z))
}

function scaledSize(size, scale) {
  return {x: size.x * Math.abs(scale[0]), y: size.y * Math.abs(scale[1]), z: size.z * Math.abs(scale[2])}
}

function array3(value, fallback) {
  return Array.isArray(value) ? [Number(value[0]), Number(value[1]), Number(value[2])] : [...fallback]
}

function point(value) {
  return {x: value[0], y: value[1], z: value[2]}
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function assetIdFromRootPath(value) {
  return typeof value === 'string' ? value.match(/^\/kite3d\/@([^/]+)\/f\.[^/]+$/)?.[1] : undefined
}

function tempVector(object, key) {
  return object[key].clone().set(0, 0, 0)
}

function tempQuaternion(object) {
  return object.quaternion.clone().identity()
}
