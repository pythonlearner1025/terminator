import {Skeleton} from 'threepipe'

export function bindUnitRig(object) {
  const joints = {}
  object.traverse(child => { if (child.isBone || child.userData.unitJoint) joints[child.name.replaceAll('_', ' ')] = child })
  if (!joints.Pelvis) throw new Error('Missing Pelvis in clone: ' + Object.keys(joints).join(', '))
  // Object3D.clone shares the source Skeleton. Rebind its bones to this instance.
  object.traverse(child => {
    if (!child.isSkinnedMesh) return
    const source = child.skeleton
    child.skeleton = new Skeleton(source.bones.map(b => joints[b.name.replaceAll('_', ' ')]), source.boneInverses.map(m => m.clone()))
  })
  return {joints, targets: {}, phase: 0, move: 0, aim: 0, spin: 0, recoil: 0, hit: 0, headshot: 0, death: 0,
    muzzleHeat: object.getObjectByName('Muzzle Heat'), baseY: joints.Pelvis.position.y, states: new Set(), eyes: object.getObjectByName('Eye Emitters')}
}

const mix = (a, b, t) => a + (b - a) * t
const clamp = v => Math.max(0, Math.min(1, v))
export function animateUnit(rig, unit, dt, time) {
  const j = rig.joints, scout = unit.type === 'scout', heavy = unit.type === 'heavy'
  const speed = Math.hypot(unit.vel?.x || 0, unit.vel?.z || 0)
  const moving = unit.alive && speed > .08
  const aiming = unit.alive && !scout && Boolean(unit.intent?.aimAt || unit.intent?.fire)
  const blend = 1 - Math.exp(-dt / .055) // 95% transition in 165 ms.
  rig.move = mix(rig.move, moving ? 1 : 0, blend)
  rig.aim = mix(rig.aim, aiming ? 1 : 0, blend)
  rig.spin = mix(rig.spin, unit.alive ? clamp(unit.spinUp || 0) : 0, blend)
  rig.phase += dt * (scout ? 12 + speed : 3 + speed * 1.9)
  rig.recoil = Math.max(0, rig.recoil - dt * 9)
  rig.hit = Math.max(0, rig.hit - dt * 5.5)
  rig.headshot = Math.max(0, rig.headshot - dt * 4)
  if (!unit.alive) rig.death += dt
  else rig.death = 0
  const phase = rig.phase, gait = Math.sin(phase) * rig.move
  const crouch = scout ? rig.move : 0
  // Reset target axes through blending to allow overlapping recoil and flinch.
  const pose = (name, x = 0, y = 0, z = 0) => {
    const b = j[name]
    if (!b) return
    const target = rig.targets[name] ||= {x:0,y:0,z:0}
    target.x=x; target.y=y; target.z=z
  }
  const aimPoint = unit.intent?.aimAt
  const pitch = aimPoint ? Math.max(-.55, Math.min(.55, Math.atan2(aimPoint.y - unit.pos.y - 1.45, Math.hypot(aimPoint.x-unit.pos.x,aimPoint.z-unit.pos.z)))) : 0
  const flinch = Math.sin(rig.hit * Math.PI) * .24
  let pelvisY = rig.baseY - crouch * .10 + Math.abs(gait) * .025
  pose('Pelvis', crouch * 1.28, 0, gait * .025)
  pose('Spine', .04 + crouch * .18 - flinch, gait * .045)
  pose('Chest', .04 - pitch * rig.aim * .3, -gait * .075, flinch * .65)
  pose('Neck', -crouch * .6 - .035)
  pose('Head', -crouch * .79 - pitch * rig.aim * .6 + Math.cos(phase*2)*.015*rig.move + flinch*.65, Math.sin(time*.4)*.025)
  pose('Jaw', .015 + rig.hit * .13)
  for(const [side,sign] of [['Left',-1],['Right',1]]) {
    const step = Math.sin(phase + (sign < 0 ? 0 : Math.PI))
    // The stance half-cycle keeps a straight knee and level sole; the swing lifts the heel.
    const lift = Math.max(0, step) * rig.move
    pose('Thigh '+side, step * .45 * rig.move - crouch*.6, 0, sign * (.025 + crouch*.18))
    pose('Shin '+side, -lift * .72 - crouch*.54)
    pose('Foot '+side, -step * .45 * rig.move + lift * .65 + crouch*.12)
    const armed = side === 'Right' && !scout
    pose('Shoulder '+side, 0, 0, sign * -.025)
    pose('Upper Arm '+side, armed ? -.10 + rig.aim*.25 + rig.recoil*.13 : -step*.34*rig.move - crouch*1.30,
      armed ? -.09*rig.aim : 0, sign*(.055 + crouch*.14))
    pose('Forearm '+side, armed ? -.18 - rig.aim*1.1 - pitch*rig.aim : -.12 - crouch*.25 - Math.max(0,-step)*crouch*.7)
    pose('Hand '+side, crouch*.25, 0, 0)
  }
  if (j.Weapon) pose('Weapon', .28 + rig.aim*1.01 + pitch*rig.aim*.7 + rig.recoil*.06)
  if (j.Barrels) j.Barrels.rotation.z += dt * (rig.spin * 75 + rig.recoil * 18)
  if (rig.muzzleHeat) { rig.muzzleHeat.visible = rig.spin > .02; rig.muzzleHeat.material.opacity = rig.spin * .7; rig.muzzleHeat.material.color.setHex(0xff5f12) }
  if (rig.recoil > 0) rig.states.add('firing')
  if (rig.hit > 0) rig.states.add('hit')
  if (rig.spin > .01) rig.states.add('spin-up')
  rig.states.add(moving ? scout ? 'quadruped sprint' : 'servo walk' : 'idle')
  if (aiming) rig.states.add('aiming')
  if (scout && unit.intent?.melee && !moving) {
    pose('Upper Arm Right', -1.1 + Math.sin(time*7)*.6)
    pose('Forearm Right', -.6)
    rig.states.add('melee')
  }
  if (rig.death > 0) {
    rig.states.add('dying')
    const t = rig.death
    // Staggered servo power failure: wrist, head, shoulders, knees, then torso.
    pose('Hand Right', clamp(t/.15)*1.0)
    pose('Hand Left', clamp(t/.19)*.8)
    pose('Head', clamp((t-.08)/.3)*.72, 0, .15)
    pose('Jaw', .24)
    pose('Upper Arm Right', .35, 0, -.3)
    pose('Upper Arm Left', -.25, 0, .3)
    pose('Forearm Right', -.3); pose('Forearm Left', -.5)
    pose('Thigh Left', clamp((t-.2)/.4)*.9)
    pose('Thigh Right', clamp((t-.25)/.4)*1.1)
    pose('Shin Left', -clamp((t-.2)/.4)*1.5)
    pose('Shin Right', -clamp((t-.25)/.4)*1.6)
    pose('Spine', clamp((t-.3)/.55)*.6)
    pose('Pelvis', -clamp((t-.45)/.55)*1.1, 0, clamp((t-.35)/.7)*.35)
    pelvisY = .22
  }
  j.Pelvis.position.y=mix(j.Pelvis.position.y,pelvisY,blend)
  for(const [name,target] of Object.entries(rig.targets)) {
    const r=j[name].rotation
    r.x=mix(r.x,target.x,blend);r.y=mix(r.y,target.y,blend);r.z=mix(r.z,target.z,blend)
  }
  const eyePower = Math.max(0, 1-rig.death/1.1)
  const flicker = .94 + .06*Math.sin(time*2.3) + .018*Math.sin(time*13)
  if (rig.eyes) {
    for (const eye of rig.eyes.children) {
      if (eye.name === 'Eye Bloom') {
        eye.scale.setScalar(flicker + rig.headshot * 1.2)
        eye.material.opacity = eyePower * flicker
      } else eye.material.emissiveIntensity = (6*flicker + rig.headshot*12) * eyePower
    }
    rig.eyes.visible = eyePower > .001
  }
}

export function disposeUnitRig(rig, object) {
  object.traverse(child => { if (child.isSkinnedMesh) child.skeleton.dispose() })
  for (const material of rig.eyeMaterials || []) material.dispose()
}
