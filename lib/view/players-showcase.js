import {Group, Vector3, HemisphereLight, DirectionalLight, Mesh2, PlaneGeometry, PhysicalMaterial} from 'threepipe'
import {PLAYER_WEAPONS} from './players-weapons.js'

export const SOLDIER_STATES = ['idle', 'walk', 'run', 'crouch', 'aim', 'fire', 'reload', 'hit', 'death', 'downed']

// F10's fake Map never enters the simulation. State and weapon overrides make
// the same renderer reproducible in headless Playwright before co-op lands.
export class PlayersShowcase {
  constructor(view) {
    this.view = view; this.time = 0; this.state = 'cycle'; this.weapon = null; this.last = performance.now()
    this.angle = 0; this.distance = 4.3; this.targetY = 1; this.studio = false; this.frozen = false
    this.stage = new Group(); this.stage.name = 'F10 Soldier Showcase'; view.root.add(this.stage)
    const camera = view.viewer.scene.mainCamera, forward = camera.getWorldDirection(new Vector3()); forward.y = 0; forward.normalize()
    this.stage.position.copy(camera.position).addScaledVector(forward, 4)
    this.stage.position.y = view.world.player?.pos.y || 0
    this.stage.rotation.y = Math.atan2(-forward.x, -forward.z)
    this.players = new Map(['olive', 'gray'].map((variant, i) => [`showcase-${variant}`, {
      id: `showcase-${variant}`, variant, pos: {x: (i - .5) * 1.35, y: 0, z: 0}, yaw: 0, pitch: 0,
      hp: 100, alive: true, downed: false, weapon: 'm4', crouch: false, moving: false,
      sprinting: false, aim: false, firing: false, reloading: false,
    }]))
    this.visuals = [...this.players].map(([id, p]) => view.createVisual(id, p.variant, this.stage))
    this.label = document.createElement('div'); this.label.dataset.testid = 'soldier-showcase'
    this.label.style.cssText = 'position:fixed;z-index:80;pointer-events:none;color:#eee2ca;font:12px monospace;letter-spacing:1px;background:#0b111cdd;padding:10px 14px;border-left:2px solid #d4a569'
    document.body.append(this.label)
  }
  set(options) {
    if (options.studio && !this.studio) this.enterStudio()
    Object.assign(this, options)
  }
  enterStudio() {
    const camera = this.view.viewer.scene.mainCamera
    this.savedCamera = {camera, position: camera.position.clone(), quaternion: camera.quaternion.clone(),
      target: camera.target?.clone(), autoLookAtTarget: camera.autoLookAtTarget, fov: camera.fov}
    this.stage.position.set(0, 80, 0); this.stage.rotation.y = 0
    const fill = new HemisphereLight(0xc7dded, 0x373024, 2.3); this.stage.add(fill)
    for (const [color, intensity, pos] of [[0xffedce, 4, [-3, 5, 4]], [0x9ebcde, 2.5, [3, 3, -2]]]) {
      const light = new DirectionalLight(color, intensity); light.position.set(...pos); light.target.position.set(0, 1, 0)
      this.stage.add(light, light.target)
    }
    this.floor = new Mesh2(new PlaneGeometry(40, 40), new PhysicalMaterial({name: 'Soldier showcase floor', color: 0x0b121b, roughness: .92}))
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -.005; this.stage.add(this.floor)
    this.hidden = [...document.querySelectorAll('[data-testid="terminator-hud"], [data-testid="terminator-ui"]')].map(node => [node, node.style.visibility])
    for (const [node] of this.hidden) node.style.visibility = 'hidden'
    this.firstPerson = this.view.viewer.scene.getObjectByName('First Person Weapons')
    this.firstPersonVisible = this.firstPerson?.visible
    if (this.firstPerson) this.firstPerson.visible = false
    this.studio = true
  }
  update() {
    const now = performance.now(), dt = this.frozen ? 0 : Math.min(.05, (now - this.last) / 1000)
    this.last = now; this.time += dt
    const state = this.state === 'cycle' ? SOLDIER_STATES[Math.floor(this.time / 3) % SOLDIER_STATES.length] : this.state
    const weapon = this.weapon || PLAYER_WEAPONS[Math.floor(this.time / 6) % PLAYER_WEAPONS.length]
    for (const visual of this.visuals) {
      const p = this.players.get(visual.id)
      Object.assign(p, {weapon, alive: state !== 'death', downed: state === 'downed', hp: state === 'death' ? 0 : 100,
        crouch: state === 'crouch', moving: ['walk', 'run'].includes(state), sprinting: state === 'run',
        aim: ['aim', 'fire'].includes(state), firing: state === 'fire', reloading: state === 'reload', pitch: this.pitch || 0})
      if (state === 'hit' && this.time % 1 < dt) visual.rig.hit = 1
      this.view.syncVisual(visual, p, dt, this.time)
      visual.object.visible = !this.focus || p.variant === this.focus
    }
    this.view.fx?.update(dt)
    if (this.studio) {
      const camera = this.view.viewer.scene.mainCamera, x = this.focus === 'olive' ? -.675 : this.focus === 'gray' ? .675 : 0
      camera.autoLookAtTarget = false; camera.fov = 40; camera.updateProjectionMatrix()
      camera.position.set(x + Math.sin(this.angle) * this.distance, 80 + this.targetY + (this.elevation ?? .05), Math.cos(this.angle) * this.distance)
      camera.lookAt(x, 80 + this.targetY, 0); camera.updateMatrixWorld(true)
    }
    const rect = this.view.viewer.canvas.getBoundingClientRect()
    this.label.style.left = `${rect.left + 20}px`; this.label.style.top = `${rect.top + 20}px`
    this.label.textContent = `RESISTANCE / OLIVE + GRAY  ·  ${state.toUpperCase()}  ·  ${weapon.toUpperCase()}  ·  F10 CLOSE`
    this.view.viewer.setDirty()
  }
  stop() {
    for (const visual of this.visuals) this.view.removeVisual(visual)
    this.stage.removeFromParent(); this.floor?.geometry.dispose(); this.floor?.material.dispose(); this.label.remove()
    for (const [node, visibility] of this.hidden || []) node.style.visibility = visibility
    if (this.firstPerson) this.firstPerson.visible = this.firstPersonVisible
    const saved = this.savedCamera
    if (saved) {
      saved.camera.position.copy(saved.position); saved.camera.quaternion.copy(saved.quaternion)
      if (saved.target) saved.camera.target.copy(saved.target)
      saved.camera.autoLookAtTarget = saved.autoLookAtTarget; saved.camera.fov = saved.fov; saved.camera.updateProjectionMatrix()
    }
    for (const visual of this.view.visuals.values()) visual.object.visible = true
  }
}
