export default function generate({params, engine}) {
  const type = ['scout', 'endo', 'heavy'].includes(params.type) ? params.type : 'endo'
  return createUnitPlaceholder(engine, type)
}

export function createUnitPlaceholder(engine, type) {
  const sizes = {
    scout: {height: 1.85, shoulder: 0.72, bulk: 0.17},
    endo: {height: 2, shoulder: 0.78, bulk: 0.21},
    heavy: {height: 2.25, shoulder: 1.05, bulk: 0.31},
  }
  const spec = sizes[type]
  const root = new engine.Group()
  root.name = `${type[0].toUpperCase()}${type.slice(1)} Placeholder Figure`
  const steel = new engine.PhysicalMaterial({color: new engine.Color(type === 'scout' ? 0x727d87 : type === 'heavy' ? 0x4d5965 : 0x606c76), roughness: 0.48, metalness: 0.72})
  const dark = new engine.PhysicalMaterial({color: new engine.Color(0x202932), roughness: 0.7, metalness: 0.55})
  const red = new engine.UnlitMaterial({color: new engine.Color(0xff1818)})
  const part = (name, geometry, material, x, y, z) => {
    const mesh = new engine.Mesh2(geometry, material)
    mesh.name = name
    mesh.position.set(x, y, z)
    root.add(mesh)
    return mesh
  }
  part('Torso', new engine.BoxGeometry(spec.shoulder, spec.height * 0.42, spec.bulk * 1.8), steel, 0, spec.height * 0.57, 0)
  part('Chest Plate', new engine.BoxGeometry(spec.shoulder * 0.9, spec.height * 0.22, spec.bulk * 0.5), dark, 0, spec.height * 0.62, spec.bulk)
  part('Pelvis', new engine.BoxGeometry(spec.shoulder * 0.65, spec.height * 0.15, spec.bulk * 1.5), dark, 0, spec.height * 0.34, 0)
  part('Head', new engine.SphereGeometry(spec.bulk * 0.82, 10, 7), steel, 0, spec.height * 0.88, 0)
  part('Eye Left', new engine.SphereGeometry(0.035, 8, 5), red, -0.075, spec.height * 0.9, spec.bulk * 0.72)
  part('Eye Right', new engine.SphereGeometry(0.035, 8, 5), red, 0.075, spec.height * 0.9, spec.bulk * 0.72)
  const limb = new engine.BoxGeometry(spec.bulk, spec.height * 0.35, spec.bulk)
  part('Leg Left', limb, steel, -spec.shoulder * 0.24, spec.height * 0.17, 0)
  part('Leg Right', limb, steel, spec.shoulder * 0.24, spec.height * 0.17, 0)
  part('Arm Left', new engine.BoxGeometry(spec.bulk, spec.height * 0.38, spec.bulk), steel, -spec.shoulder * 0.62, spec.height * 0.56, 0)
  part('Arm Right', new engine.BoxGeometry(spec.bulk, spec.height * 0.38, spec.bulk), steel, spec.shoulder * 0.62, spec.height * 0.56, 0)
  if (type !== 'scout') {
    part(type === 'heavy' ? 'Minigun' : 'Plasma Rifle', new engine.BoxGeometry(type === 'heavy' ? 0.2 : 0.13, 0.16, type === 'heavy' ? 1.15 : 0.85), dark, spec.shoulder * 0.48, spec.height * 0.53, 0.35)
  }
  root.userData.unitTemplateType = type
  return root
}
