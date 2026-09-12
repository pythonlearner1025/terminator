import {createUnitFigure} from './unit-template.generator.js'

let materials

function placeholderMaterials(E) {
  if (materials) return materials
  materials = {
    chrome: new E.PhysicalMaterial({name: 'T-1000 chrome placeholder', color: 0xd9eeff, metalness: 1, roughness: 0.12}),
    hull: new E.PhysicalMaterial({name: 'HK placeholder hull', color: 0x1d2730, metalness: 0.9, roughness: 0.48}),
    edge: new E.PhysicalMaterial({name: 'HK placeholder edge', color: 0x54616d, metalness: 1, roughness: 0.32}),
    plasma: new E.PhysicalMaterial({name: 'HK placeholder plasma', color: 0x2d0504, emissive: 0xff2414, emissiveIntensity: 8}),
  }
  return materials
}

function mesh(E, geometry, material, name, position, parent) {
  const object = new E.Mesh2(geometry, material)
  object.name = name
  object.position.set(...position)
  object.castShadow = true
  object.receiveShadow = true
  parent.add(object)
  return object
}

function addAerial(E, root) {
  const m = placeholderMaterials(E)
  const visual = new E.Group()
  visual.name = 'HK-Aerial Placeholder Visual'
  root.add(visual)
  mesh(E, new E.BoxGeometry(1.45, 0.5, 1.65), m.hull, 'Hull', [0, 0.6, 0], visual)
  mesh(E, new E.BoxGeometry(1.55, 0.12, 0.72), m.edge, 'Wing Left', [-1.25, 0.65, 0], visual)
  mesh(E, new E.BoxGeometry(1.55, 0.12, 0.72), m.edge, 'Wing Right', [1.25, 0.65, 0], visual)
  const turret = new E.Group()
  turret.name = 'Placeholder Turret'
  turret.position.set(0, 0.32, 0)
  visual.add(turret)
  mesh(E, new E.SphereGeometry(0.34, 12, 8), m.edge, 'Turret', [0, 0, 0], turret)
  mesh(E, new E.CylinderGeometry(0.07, 0.07, 0.75, 10), m.plasma, 'Aerial Cannon', [0, 0, 0.48], turret).rotation.x = Math.PI / 2
  for (const x of [-0.62, 0.62]) mesh(E, new E.CylinderGeometry(0.2, 0.26, 0.45, 12), m.plasma, x < 0 ? 'Thruster Left' : 'Thruster Right', [x, 0.42, -0.45], visual)
}

function addTank(E, root) {
  const m = placeholderMaterials(E)
  const visual = new E.Group()
  visual.name = 'HK-Tank Placeholder Visual'
  root.add(visual)
  mesh(E, new E.BoxGeometry(2.6, 1.1, 3.45), m.hull, 'Hull', [0, 0.9, 0], visual)
  for (const x of [-1.45, 1.45]) mesh(E, new E.BoxGeometry(0.62, 0.72, 3.7), m.edge, x < 0 ? 'Tread Left' : 'Tread Right', [x, 0.48, 0], visual)
  const turret = new E.Group()
  turret.name = 'Placeholder Turret'
  turret.position.set(0, 1.72, 0)
  visual.add(turret)
  mesh(E, new E.CylinderGeometry(0.78, 0.9, 0.58, 12), m.edge, 'Turret', [0, 0, 0], turret)
  const cannon = mesh(E, new E.CylinderGeometry(0.12, 0.16, 2.25, 12), m.hull, 'Cannon', [0, 0.12, 1.15], turret)
  cannon.rotation.x = Math.PI / 2
  mesh(E, new E.SphereGeometry(0.3, 12, 8), m.plasma, 'Core', [0, 1.05, -1.78], visual)
}

export function createUnitPlaceholder(E, type, options = {}) {
  if (!['t1000', 'hkaerial', 'hktank'].includes(type)) return createUnitFigure(E, type, options)
  const sourceType = type === 'hktank' ? 'heavy' : 'endo'
  const root = createUnitFigure(E, sourceType, options)
  root.userData.unitTemplateType = type
  if (type === 't1000') return root
  const skeleton = root.getObjectByName('Combined articulated steel')
  if (skeleton) skeleton.visible = false
  const eyes = root.getObjectByName('Eye Emitters')
  if (eyes) eyes.visible = false
  if (type === 'hkaerial') addAerial(E, root)
  else addTank(E, root)
  return root
}

export function applyUnitPlaceholderMaterial(E, object, type) {
  if (type !== 't1000') return
  const combined = object.getObjectByName('Combined articulated steel')
  if (combined) combined.material = placeholderMaterials(E).chrome
}

export function animateUnitPlaceholder(rig, unit, time) {
  if (unit.type !== 'hkaerial' && unit.type !== 'hktank') return false
  const target = unit.intent?.aimAt || unit.intent?.face
  const turret = rig.object.getObjectByName('Placeholder Turret')
  if (turret && target) turret.rotation.y = Math.atan2(target.x - unit.pos.x, target.z - unit.pos.z) - unit.yaw
  if (unit.type === 'hkaerial') {
    rig.object.position.y += Math.sin(time * 2.2 + unit.spawnedAt * 1.7) * 0.12
    const forwardX = Math.sin(unit.yaw)
    const forwardZ = Math.cos(unit.yaw)
    const lateral = (unit.vel?.x || 0) * forwardZ - (unit.vel?.z || 0) * forwardX
    rig.object.rotation.z = Math.max(-0.28, Math.min(0.28, -lateral * 0.035))
  } else rig.object.rotation.z = 0
  rig.previous.copy(rig.object.position)
  rig.object.updateMatrixWorld(true)
  return true
}
