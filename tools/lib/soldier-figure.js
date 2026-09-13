// Metres, feet on Y=0, facing +Z. One rigid-skinned surface draw, one lamp lens.
// Bone names are shared with players-animation.js. The asset build serializes
// this figure; runtime soldiers clone that glTF and rebind their own skeleton.
export function createSoldierFigure(E, variant = 'olive', {materials} = {}) {
  if (!materials) throw new Error('createSoldierFigure requires build materials')
  const root = new E.Group(), bones = [], parts = []
  root.name = 'Resistance Soldier'; root.userData.soldierTemplate = true
  const cloth = [0xd6cfb9, .015, .98, 1], seam = [0x989680, .02, .98, 1]
  const vest = [0x494b3b, .025, .94, 0], web = [0x77745b, .02, .97, 0]
  const leather = [0x292e2b, .025, .88, 0], rubber = [0x171c1c, .02, .98, 0]
  const skin = [0xad8060, .015, .74, 0], skinShade = [0x896248, .015, .82, 0]
  const steel = [0x8d999c, .85, .48, 0], dark = [0x263238, .65, .6, 0]
  const patch = [0xcab991, .03, .95, 0]
  const primitives = {
    box: new E.BoxGeometry(1, 1, 1), ball: new E.SphereGeometry(1, 12, 8),
    cylinder: new E.CylinderGeometry(1, 1, 1, 10),
    // Rounded pouches and plates retain a worn, low-poly silhouette.
    round: new E.CylinderGeometry(1, 1, 1, 8),
  }
  const bone = (name, parent, position) => {
    const b = new E.Bone(); b.name = name; b.position.set(...position)
    b.userData.soldierJoint = true; (parent || root).add(b); bones.push(b); return b
  }
  const part = (joint, kind, scale, position, surface, rotation = [0, 0, 0]) => {
    const transform = new E.Object3D()
    transform.position.set(...position); transform.scale.set(...scale); transform.rotation.set(...rotation); transform.updateMatrix()
    parts.push({joint, geometry: primitives[kind], matrix: transform.matrix.clone(), surface})
  }
  const box = (j, s, p, m, r) => part(j, 'box', s, p, m, r)
  const ball = (j, s, p, m, r) => part(j, 'ball', s, p, m, r)
  const pelvis = bone('Pelvis', null, [0, .96, 0])
  const spine = bone('Spine', pelvis, [0, .09, 0])
  const chest = bone('Chest', spine, [0, .20, 0])
  const neck = bone('Neck', chest, [0, .27, 0])
  const head = bone('Head', neck, [0, .105, 0])
  ball(pelvis, [.19, .16, .115], [0, -.015, 0], cloth)
  ball(spine, [.185, .19, .105], [0, .045, 0], cloth)
  ball(chest, [.235, .235, .125], [0, .055, -.01], cloth)
  box(pelvis, [.355, .044, .235], [0, .06, 0], leather)
  box(pelvis, [.060, .035, .018], [0, .06, .128], steel)
  for (const sign of [-1, 1]) {
    box(pelvis, [.025, .07, .017], [sign * .12, .055, .122], web)
    ball(pelvis, [.065, .09, .055], [sign * .22, -.012, 0], vest)
  }
  // Plate carrier, shoulder straps, three magazine pouches and MOLLE tapes.
  box(chest, [.375, .32, .055], [0, .035, .128], vest)
  box(chest, [.355, .31, .055], [0, .035, -.132], vest)
  for (const sign of [-1, 1]) {
    box(chest, [.065, .22, .035], [sign * .145, .19, .092], web, [-.2, 0, sign * .12])
    box(chest, [.065, .22, .035], [sign * .145, .19, -.088], web, [.2, 0, -sign * .12])
    for (let i = 0; i < 3; i++) box(chest, [.035, .018, .26], [sign * .197, -.07 + i * .055, 0], web)
  }
  for (let i = -1; i <= 1; i++) {
    ball(chest, [.052, .086, .032], [i * .116, -.028, .174], vest)
    box(chest, [.097, .027, .037], [i * .116, .042, .187], web)
    box(chest, [.018, .085, .012], [i * .116, -.02, .207], seam)
    box(chest, [.018, .009, .007], [i * .116, .01, .218], steel)
  }
  for (let i = 0; i < 3; i++) box(chest, [.31, .012, .008], [0, .083 + i * .027, .161], web)
  box(chest, [.083, .047, .008], [-.068, .153, .162], patch)
  // A stitched resistance insignia, no texture or font dependency.
  box(chest, [.043, .006, .004], [-.068, .158, .168], vest, [0, 0, .45])
  box(chest, [.006, .026, .004], [-.063, .148, .168], vest, [0, 0, -.35])
  box(chest, [.049, .096, .035], [.137, .145, .167], dark)
  part(chest, 'cylinder', [.004, .13, .004], [.148, .246, .156], rubber)
  for (let i = 0; i < 4; i++) box(chest, [.032, .003, .002], [.137, .13 + i * .008, .186], steel)
  ball(chest, [.135, .18, .073], [0, .026, -.18], vest)
  for (const sign of [-1, 1]) box(chest, [.021, .27, .012], [sign * .081, .03, -.248], web)
  part(neck, 'cylinder', [.063, .13, .058], [0, .026, 0], skin)
  // Folded neck wrap and tied tail behind the collar.
  for (let i = 0; i < 3; i++) ball(neck, [.102 - i * .009, .031, .091], [0, -.018 + i * .026, .005], i % 2 ? seam : cloth)
  box(neck, [.06, .14, .028], [.048, -.08, -.087], cloth, [-.14, 0, -.3])
  // Human cranium, cheeks, chin, ears, recessed eyes and a projecting nose.
  ball(head, [.101, .136, .097], [0, .012, -.004], skin)
  ball(head, [.073, .067, .065], [0, -.061, .036], skin)
  ball(head, [.050, .027, .031], [0, -.095, .060], skinShade)
  for (const sign of [-1, 1]) {
    ball(head, [.014, .031, .021], [sign * .100, -.018, -.006], skinShade)
    ball(head, [.032, .019, .016], [sign * .051, -.031, .067], skin)
    ball(head, [.024, .014, .011], [sign * .042, .020, .085], skinShade)
    ball(head, [.016, .004, .003], [sign * .042, .018, .094], patch)
    ball(head, [.005, .004, .002], [sign * .042, .018, .097], rubber)
    box(head, [.039, .008, .008], [sign * .042, .034, .093], leather, [0, 0, sign * -.12])
  }
  ball(head, [.013, .035, .016], [0, -.007, .098], skin)
  ball(head, [.017, .012, .017], [0, -.030, .109], skinShade)
  box(head, [.037, .004, .006], [0, -.065, .097], skinShade)
  // Dust wrap covers the lower face, with overlapping fabric folds.
  ball(head, [.094, .053, .088], [0, -.062, .023], cloth)
  for (let i = 0; i < 3; i++) ball(head, [.081 - i * .008, .008, .014], [0, -.034 - i * .025, .105 - i * .005], seam)
  // Soft field cap, short bill, band and forehead-mounted lamp.
  ball(head, [.109, .074, .106], [0, .092, -.010], cloth)
  part(head, 'cylinder', [.109, .032, .105], [0, .065, -.005], seam)
  ball(head, [.103, .012, .102], [0, .059, .070], cloth, [.12, 0, 0])
  box(head, [.041, .040, .030], [0, .088, .107], dark)
  part(head, 'cylinder', [.019, .014, .019], [0, .088, .127], steel, [Math.PI / 2, 0, 0])
  const lens = new E.Mesh2(new E.SphereGeometry(.014, 10, 6), materials.lamp)
  lens.name = 'Headlamp Lens'; lens.position.set(0, .088, .137); lens.scale.z = .3; head.add(lens)
  const lamp = new E.SpotLight(0xffe0af, 1.1, 4, .48, .65, 2)
  lamp.name = 'Headlamp'; lamp.position.copy(lens.position); lamp.castShadow = false
  const target = new E.Group(); target.name = 'Headlamp Target'; target.position.set(0, -.11, 3)
  head.add(lamp, target); lamp.target = target
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const upper = bone(`Upper Arm ${side}`, chest, [sign * .244, .19, 0])
    const fore = bone(`Forearm ${side}`, upper, [0, -.285, 0])
    const hand = bone(`Hand ${side}`, fore, [0, -.26, 0])
    ball(upper, [.081, .096, .082], [0, -.039, 0], cloth)
    ball(upper, [.070, .142, .070], [0, -.146, 0], cloth)
    box(upper, [.014, .079, .07], [sign * .078, -.124, 0], seam)
    box(upper, [.017, .055, .058], [sign * .087, -.116, 0], patch)
    for (let i = 0; i < 3; i++) ball(upper, [.072, .009, .070], [0, -.224 - i * .016, .001], i % 2 ? seam : cloth)
    ball(fore, [.067, .060, .067], [0, -.019, 0], seam)
    ball(fore, [.065, .121, .060], [0, -.137, .003], cloth)
    box(fore, [.10, .064, .024], [0, -.033, -.053], leather)
    part(fore, 'cylinder', [.052, .035, .051], [0, -.246, 0], seam)
    ball(hand, [.044, .055, .030], [0, -.035, .005], leather)
    box(hand, [.068, .036, .013], [0, -.028, -.022], rubber)
    for (let f = 0; f < 4; f++) {
      ball(hand, [.009, .029, .012], [(f - 1.5) * .019, -.082, .014], leather)
      ball(hand, [.009, .011, .019], [(f - 1.5) * .019, -.10, .025], rubber)
    }
    ball(hand, [.018, .035, .02], [-sign * .041, -.04, .025], leather, [0, 0, sign * -.4])
    const thigh = bone(`Thigh ${side}`, pelvis, [sign * .116, -.045, 0])
    const shin = bone(`Shin ${side}`, thigh, [0, -.42, 0])
    const foot = bone(`Foot ${side}`, shin, [0, -.395, 0])
    ball(thigh, [.101, .237, .103], [0, -.174, 0], cloth)
    box(thigh, [.038, .134, .124], [sign * .09, -.205, .006], seam)
    box(thigh, [.047, .027, .133], [sign * .10, -.148, .007], cloth)
    ball(shin, [.081, .080, .073], [0, -.004, .015], cloth)
    ball(shin, [.067, .067, .027], [0, -.006, .083], rubber)
    box(shin, [.088, .073, .010], [0, -.006, .108], leather)
    ball(shin, [.076, .179, .072], [0, -.173, -.009], cloth)
    for (let i = 0; i < 3; i++) ball(shin, [.076 - i * .004, .019, .072 - i * .003], [0, -.278 - i * .025, .001], i % 2 ? cloth : seam)
    ball(foot, [.073, .125, .083], [0, .068, -.009], leather)
    ball(foot, [.080, .061, .140], [0, -.024, .043], leather)
    box(foot, [.149, .028, .245], [0, -.073, .035], rubber)
    box(foot, [.137, .016, .068], [0, -.079, -.057], rubber)
    for (let i = 0; i < 5; i++) {
      box(foot, [.090, .006, .008], [0, .005 + i * .02, .094 - i * .007], web, [0, 0, i % 2 ? .15 : -.15])
      box(foot, [.152, .012, .017], [0, -.087, -.058 + i * .044], leather)
    }
  }
  root.updateMatrixWorld(true)
  const arrays = {position: [], normal: [], uv: [], color: [], soldierSurface: [], skinIndex: [], skinWeight: []}
  for (const p of parts) {
    const geometry = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()
    geometry.applyMatrix4(new E.Matrix4().multiplyMatrices(p.joint.matrixWorld, p.matrix))
    const pos = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv
    const color = new E.Color(p.surface[0]), id = bones.indexOf(p.joint)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
      // Deterministic sun fading and grime, with no per-instance texture upload.
      const wear = .86 + .13 * Math.sin(x * 47 + y * 63 + z * 31) ** 2
      arrays.position.push(x, y, z); arrays.normal.push(n.getX(i), n.getY(i), n.getZ(i))
      arrays.uv.push(uv?.getX(i) || 0, uv?.getY(i) || 0)
      arrays.color.push(color.r * wear, color.g * wear, color.b * wear)
      arrays.soldierSurface.push(...p.surface.slice(1)); arrays.skinIndex.push(id, 0, 0, 0); arrays.skinWeight.push(1, 0, 0, 0)
    }
    geometry.dispose()
  }
  for (const geometry of Object.values(primitives)) geometry.dispose()
  const geometry = new E.BufferGeometry()
  for (const [name, size] of Object.entries({position: 3, normal: 3, uv: 2, color: 3, soldierSurface: 3, skinWeight: 4})) {
    geometry.setAttribute(name, new E.Float32BufferAttribute(arrays[name], size))
  }
  geometry.setAttribute('skinIndex', new E.Uint16BufferAttribute(arrays.skinIndex, 4))
  const mesh = new E.SkinnedMesh(geometry, materials[variant] || materials.olive)
  mesh.name = 'Soldier fatigues and equipment'; mesh.frustumCulled = false
  root.add(mesh); mesh.bind(new E.Skeleton(bones))
  root.userData.soldierAnatomy = {parts: parts.length, triangles: arrays.position.length / 9, joints: bones.map(b => b.name)}
  return root
}
