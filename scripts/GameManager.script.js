import {Object3DComponent} from 'threepipe'
import mapData from '../lib/core/data/map.json' with {type: 'json'}
import {BuiltinSkynet} from '../lib/core/builtin-skynet.js'
import {projectViewModel} from '../lib/core/viewmodel.js'
import {WaveDirector} from '../lib/core/waves.js'
import {TICK_SECONDS, World} from '../lib/core/world.js'
import {LobbyClient} from '../lib/net/lobby-client.js'
import {Hud} from '../lib/ui/hud.js'
import {InputController} from '../lib/view/input.js'
import {MapView} from '../lib/view/map.js'
import {PlayerView} from '../lib/view/player.js'
import {UnitView} from '../lib/view/units.js'

export class GameManager extends Object3DComponent {
  static ComponentType = 'GameManager'
  static StateProperties = [
    {key: 'seed', type: 'number'},
    {key: 'intermissionSeconds', type: 'number', uiConfig: {bounds: [5, 90], stepSize: 5}},
  ]

  seed = 2029
  intermissionSeconds = 45
  world = null
  director = null
  input = null
  mapView = null
  unitView = null
  playerView = null
  hud = null
  lobby = null
  accumulator = 0
  started = false

  start() {
    this.stop()
    const viewer = this.ctx.viewer
    this.world = new World({map: mapData, seed: this.seed})
    this.director = new WaveDirector(this.world, {
      builtin: new BuiltinSkynet({map: mapData}),
      intermissionSeconds: this.intermissionSeconds,
    })
    this.mapView = new MapView(viewer, mapData)
    this.unitView = new UnitView(viewer)
    this.playerView = new PlayerView(viewer)
    this.input = new InputController(viewer)
    this.hud = new Hud(viewer)
    this.lobby = new LobbyClient({world: this.world, director: this.director, intermissionSeconds: this.intermissionSeconds})
    this.mapView.start()
    this.unitView.start(this.world)
    this.playerView.start(this.world)
    this.input.start({yaw: this.world.player.yaw, pitch: this.world.player.pitch})
    this.lobby.start()
    this.director.start()
    this.accumulator = 0
    this.started = true
    this.syncViews()
  }

  update({deltaTime} = {}) {
    if (!this.started || !this.world) return
    this.accumulator += Math.min(0.1, Math.max(0, Number(deltaTime) || 16.667) / 1000)
    let steps = 0
    while (this.accumulator >= TICK_SECONDS && steps < 8) {
      this.director.step(this.input.sample())
      this.accumulator -= TICK_SECONDS
      steps += 1
    }
    if (steps === 8) this.accumulator = Math.min(this.accumulator, TICK_SECONDS)
    this.lobby?.update()
    this.syncViews()
    return true
  }

  preFrame() {
    this.hud?.sync()
  }

  syncViews() {
    if (!this.world) return
    this.mapView?.sync(this.world)
    this.unitView?.sync(this.world)
    this.playerView?.sync(this.world)
    this.hud?.render(projectViewModel(this.world))
    this.ctx.viewer.setDirty(this)
  }

  stop() {
    this.started = false
    this.lobby?.stop()
    this.input?.stop()
    this.hud?.dispose()
    this.playerView?.stop()
    this.unitView?.stop()
    this.mapView?.stop()
    this.input = null
    this.lobby = null
    this.hud = null
    this.playerView = null
    this.unitView = null
    this.mapView = null
    this.director = null
    this.world = null
    this.accumulator = 0
  }

  destroy() {
    this.stop()
    return super.destroy()
  }
}
