import {Skeleton, Vector3, Quaternion} from 'threepipe'

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))
const mix = (a, b, t) => a + (b - a) * t
const down = new Vector3(0, -1, 0)

export function bindPlayerRig(object) {
  const joints = {}
  object.traverse(child => { if (child.isBone) joints[child.name.replaceAll('_', ' ')] = child })
  if (!joints.Pelvis || !joints['Hand Right']) throw new Error('Resistance Soldier asset is missing its articulated rig')
  object.traverse(child => {
    if (child.isSkinnedMesh) child.skeleton = new Skeleton(child.skeleton.bones.map(b => joints[b.name.replaceAll('_', ' ')]), child.skeleton.boneInverses.map(m => m.clone()))
  })
  const lamp = object.getObjectByName('Headlamp')
  if (lamp) lamp.target = object.getObjectByName('Headlamp Target')
  const contacts = []
  for (const side of ['Left', 'Right']) {
    for (const x of [-.081, .081]) for (const z of [-.091, .184]) contacts.push([`Foot ${side}`, new Vector3(x, -.094, z)])
    for (const x of [-.053, .053]) contacts.push([`Hand ${side}`, new Vector3(x, -.115, .025)])
  }
  for (const x of [-.245, .245]) contacts.push(['Chest', new Vector3(x, .06, 0)])
  for (const x of [-.20, .20]) contacts.push(['Pelvis', new Vector3(x, -.12, 0)])
  return {object, joints, lamp, contacts, phase: 0, move: 0, run: 0, crouch: 0, aim: 0, reload: 0,
    recoil: 0, hit: 0, death: 0, downed: 0, lastHp: null, state: 'idle', states: new Set(),
    shoulder: new Vector3(), target: new Vector3(), direction: new Vector3(), elbow: new Vector3(),
    pole: new Vector3(), wrist: new Vector3(), inverse: new Quaternion(), rotation: new Quaternion()}
}

// Analytic two-bone arm IK in Chest coordinates. Reused scratch vectors keep
// IK avoids vector allocation; source hand anchors come from the real gun builder.
function reach(rig, side, target, weight = 1) {
  const j = rig.joints, upper = j[`Upper Arm ${side}`], fore = j[`Forearm ${side}`], hand = j[`Hand ${side}`]
  const sign = Math.sign(upper.position.x), a = .285, b = .26
  rig.direction.copy(target).sub(upper.position)
  const d = clamp(rig.direction.length(), .06, a + b - .002)
  rig.direction.normalize()
  const along = (a * a - b * b + d * d) / (2 * d)
  rig.pole.set(sign * .8, -.65, -.3).addScaledVector(rig.direction, -rig.pole.dot(rig.direction)).normalize()
  rig.elbow.copy(upper.position).addScaledVector(rig.direction, along).addScaledVector(rig.pole, Math.sqrt(Math.max(0, a * a - along * along)))
  rig.direction.copy(rig.elbow).sub(upper.position).normalize()
  rig.rotation.setFromUnitVectors(down, rig.direction); upper.quaternion.slerp(rig.rotation, weight)
  rig.direction.copy(target).sub(rig.elbow).normalize()
  rig.inverse.copy(upper.quaternion).invert(); rig.direction.applyQuaternion(rig.inverse)
  rig.rotation.setFromUnitVectors(down, rig.direction); fore.quaternion.slerp(rig.rotation, weight)
  // Keep the grip vertical while the elbow bends around it.
  rig.inverse.copy(upper.quaternion).multiply(fore.quaternion).invert()
  hand.quaternion.slerp(rig.inverse, weight)
}

export function animatePlayer(rig, player, weapon, dt, time) {
  const j = rig.joints, blend = 1 - Math.exp(-dt / .07)
  const alive = player.alive !== false && player.hp > 0 && !player.downed
  const moving = alive && Boolean(player.moving ?? Math.hypot(player.vel?.x || 0, player.vel?.z || 0) > .08)
  const running = moving && Boolean(player.sprinting ?? Math.hypot(player.vel?.x || 0, player.vel?.z || 0) > 6.25)
  const aiming = alive && Boolean(player.aim ?? player.aiming ?? player.firing)
  const reloading = alive && Boolean(player.reloading ?? player.reloadTimer > 0)
  if (rig.lastHp !== null && player.hp < rig.lastHp && alive) rig.hit = 1
  rig.lastHp = player.hp
  rig.move = mix(rig.move, +moving, blend); rig.run = mix(rig.run, +running, blend)
  rig.crouch = mix(rig.crouch, alive && player.crouch ? 1 : 0, blend)
  rig.aim = mix(rig.aim, +aiming, blend)
  rig.reload = reloading ? rig.reload + dt : 0
  rig.death = !alive && !player.downed ? Math.min(2, rig.death + dt) : 0
  rig.downed = mix(rig.downed, player.downed ? 1 : 0, blend)
  rig.recoil = Math.max(0, rig.recoil - dt * 9); rig.hit = Math.max(0, rig.hit - dt * 4)
  rig.phase += dt * mix(7.5, 12, rig.run)
  const gait = Math.sin(rig.phase) * rig.move, crouch = rig.crouch
  const flinch = Math.sin(rig.hit * Math.PI) * .19
  const pitch = clamp(player.pitch || 0, -1.1, 1.1)
  const pose = (name, x = 0, y = 0, z = 0) => j[name].rotation.set(x, y, z)
  j.Pelvis.position.set(0, .96 - crouch * .48 + Math.abs(gait) * (.018 + rig.run * .022), 0)
  pose('Pelvis', crouch * .12, 0, gait * .025)
  pose('Spine', .025 + rig.run * .13 + crouch * .12 - flinch, gait * .03)
  j.Chest.position.y = .20 + Math.sin(time * 2) * .002
  pose('Chest', -pitch * .20 - rig.recoil * .035, -gait * .04, flinch * .7)
  pose('Neck', -.035 - crouch * .12 - rig.run * .08)
  pose('Head', -pitch * .7 + flinch * .5, Math.sin(time * .65) * .025 * (1 - rig.aim))
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const step = Math.sin(rig.phase + (sign < 0 ? 0 : Math.PI)) * rig.move
    pose(`Thigh ${side}`, -step * (.42 + rig.run * .4) - crouch * 1.3, 0, sign * .035)
    pose(`Shin ${side}`, Math.max(0, step) * (.72 + rig.run * .65) + crouch * 2.25)
    pose(`Foot ${side}`, step * (.25 + rig.run * .3) - Math.max(0, step) * .6 - crouch * 1.07)
    pose(`Upper Arm ${side}`, 0, 0, sign * .04)
    pose(`Forearm ${side}`, -.25); pose(`Hand ${side}`)
  }
  const gun = weapon.active, oneHand = ['knife', 'grenade'].includes(weapon.id)
  weapon.root.visible = rig.death < .9
  // Gun aim is independent of the legs and counter-rotates torso pitch.
  const longGun = ['m4', 'shotgun', 'plasma'].includes(weapon.id)
  weapon.root.position.set(-.025, .055 + rig.aim * .20 - rig.run * .08, (longGun ? .10 : .30) - rig.recoil * .045)
  weapon.root.rotation.set(.25 * (1 - rig.aim) + pitch * .8 + rig.recoil * .075 - rig.run * .3, Math.PI, -.07 - rig.run * .25)
  if (oneHand) { weapon.root.position.set(-.18, -.11, .27); weapon.root.rotation.x = .22 + pitch * .7 }
  if (reloading) {
    const cycle = (rig.reload % 2) / 2, dip = Math.sin(Math.PI * cycle)
    weapon.root.rotation.z = -.28; weapon.root.rotation.x = .5
    gun.magazine.position.set(0, -Math.sin(clamp((cycle - .12) / .6) * Math.PI) * .18, 0)
    gun.magazine.rotation.z = dip * .12
  } else { gun.magazine.position.set(0, 0, 0); gun.magazine.rotation.set(0, 0, 0) }
  gun.slide.position.z = rig.recoil * .026; gun.pump.position.z = weapon.id === 'shotgun' ? Math.sin(rig.recoil * Math.PI) * .10 : 0
  weapon.root.updateMatrix()
  rig.target.copy(gun.rightGrip).applyMatrix4(weapon.root.matrix); reach(rig, 'Right', rig.target)
  rig.target.copy(gun.leftGrip).applyMatrix4(weapon.root.matrix)
  if (reloading) {
    const t = .5 - .5 * Math.cos(Math.min(1, rig.reload / .25) * Math.PI)
    rig.wrist.set(.10, -.25 + Math.sin(rig.reload * 6) * .065, .20)
    rig.target.lerp(rig.wrist, t)
  }
  if (oneHand) rig.target.set(.28, -.31, .06 + Math.sin(rig.phase) * .08 * rig.move)
  reach(rig, 'Left', rig.target)
  if (rig.death || rig.downed > .001) {
    const downed = rig.downed, collapse = clamp(rig.death / .9)
    const t = Math.max(downed, collapse), dead = rig.death > 0
    j.Pelvis.position.y = mix(j.Pelvis.position.y, dead ? .17 : .29, t)
    // Side collapse leaves the full body above the floor; downed braces on a
    // bent knee and elbow, and retains breathing to read differently from death.
    pose('Pelvis', dead ? .15 * t : -.25 * t, 0, (dead ? 1.5 : 1.05) * t)
    pose('Spine', dead ? .22 : .30); pose('Chest', dead ? .15 : .28, 0, 0)
    pose('Head', .28, 0, dead ? .12 : -.4)
    pose('Thigh Left', (dead ? -.5 : -.9) * t, 0, -.1); pose('Shin Left', (dead ? .9 : 1.5) * t)
    pose('Thigh Right', (dead ? -.16 : -.8) * t, 0, .12); pose('Shin Right', (dead ? .28 : 1.3) * t)
    pose('Foot Left', -.2); pose('Foot Right', -.1)
    pose('Upper Arm Left', dead ? -.24 : -1, 0, dead ? -.15 : .4); pose('Forearm Left', dead ? -.3 : -1)
    pose('Upper Arm Right', -.3, 0, -.4); pose('Forearm Right', -.7)
    if (!dead) j.Chest.rotation.x += Math.sin(time * 2) * .02
    weapon.root.visible = false
  }
  if (rig.death || rig.downed > .001 || crouch > .001) {
    // Keep soles, hands and carrier above the player's footing during collapse.
    // A few support points avoid evaluating thousands of skinned vertices.
    rig.object.updateMatrixWorld(true)
    const floor = rig.object.matrixWorld.elements[13]
    let lowest = Infinity
    for (const [name, point] of rig.contacts) lowest = Math.min(lowest, rig.wrist.copy(point).applyMatrix4(j[name].matrixWorld).y)
    j.Pelvis.position.y += Math.max(0, floor + .006 - lowest)
  }
  if (rig.lamp) { rig.lamp.intensity = rig.death ? Math.max(0, 1 - rig.death) : 1.1; rig.lamp.visible = true }
  rig.state = player.downed ? 'downed' : rig.death ? 'death' : rig.hit > 0 ? 'hit' : reloading ? 'reload' : rig.recoil > 0 ? 'fire' : player.crouch ? 'crouch' : running ? 'run' : moving ? 'walk' : aiming ? 'aim' : 'idle'
  rig.states.add(rig.state)
}

export function disposePlayerRig(rig) {
  rig.object.traverse(child => { if (child.isSkinnedMesh) child.skeleton.dispose() })
}
