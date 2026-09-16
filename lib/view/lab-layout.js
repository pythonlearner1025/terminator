import baseMap from '../core/data/map.json' with {type: 'json'}
import {RANGE_START, RANGE_DISTANCES} from '../core/range.js'

export const LAB_TYPES = ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']
export const LAB_LABELS = ['Scout', 'Endo', 'Heavy', 'T-1000', 'HK-Aerial', 'HK-Tank']
export const LAB_LANES = [-21.7, -19.8, -17.7, -15.6, -12.4, -7.3]
export const LAB_PLATES = [-21, -18, -15, -12, -9, -6].map((z, i) => ({
  id: `lab-plate-${i + 1}`, x: RANGE_START.x + 15, y: 1.8, z,
}))
export const LAB_CAMERA = {position: [-30, 17, 10], target: [4, 0, -13]}
export const LAB_LIGHTS = {
  night: {name: 'Lights_Night', color: [0.43, 0.62, 1], intensity: 1.2, position: [-16, 8, -8], exposure: 1},
  overcast: {name: 'Lights_Overcast', color: [0.85, 0.92, 1], intensity: 2.6, position: [-10, 14, -17], exposure: 1.1},
  noon: {name: 'Lights_Noon', color: [1, 0.93, 0.8], intensity: 4, position: [8, 18, -5], exposure: 1},
}
export function labTargetLayout() {
  return RANGE_DISTANCES.flatMap(row => LAB_TYPES.map((type, index) => ({
    id: `lab-${row}-${type}`, type, row, distance: row,
    pos: {x: RANGE_START.x + row, y: type === 'hkaerial' ? 4 : 0, z: LAB_LANES[index]}, yaw: -Math.PI / 2,
  })))
}
export function createLabMap() {
  const box = (id, center, size, floor = false) => ({id, kind: floor ? 'floor' : 'wall',
    center: {x: center[0], y: center[1], z: center[2]}, size: {x: size[0], y: size[1], z: size[2]},
    navBlock: !floor, blocksSight: !floor})
  return {...structuredClone(baseMap), id: 'weapons-lab', name: 'Weapons Lab', size: {x: 60, z: 20},
    bounds: {minX: -23, maxX: 37, minZ: -23, maxZ: -3},
    colliders: [box('lab-floor', [7, -.2, -13], [60, .4, 20], true),
      box('lab-backstop', [36.8, 3, -13], [.4, 6, 20]),
      box('lab-north', [7, 2, -3.2], [60, 4, .4]), box('lab-south', [7, 2, -22.8], [60, 4, .4])],
    doors: [], lightZones: [], spawnGates: [], hazards: [], environment: {},
    flankWall: {...baseMap.flankWall, broken: true},
    playerStart: {pos: {x: RANGE_START.x, y: 0, z: RANGE_START.z}, yaw: RANGE_START.yaw, pitch: 0},
    navGrid: {...baseMap.navGrid, width: 60, height: 20, origin: {x: -23, z: -23}},
    walkable: {maxStep: .55, surfaces: [{collider: 'lab-floor', height: 'top'}]},
    trader: {...baseMap.trader, navBlock: false, blocksSight: false},
  }
}
