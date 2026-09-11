// Isolated rendering test while other workstreams edit the shared GameManager.
// Uses the real MapView and PlayerView with a map-state fixture. It does not validate wave integration.
import {ThreeViewer, Group, GBufferPlugin} from 'threepipe'
import {setAuthoringMetadata} from '@kite3d/engine'
import {MapView} from '../../../lib/view/map.js'
import {PlayerView} from '../../../lib/view/player.js'
const map = await (await fetch('../../../lib/core/data/map.json')).json()
const viewer = new ThreeViewer({canvas: document.querySelector('canvas'), msaa: true, tonemap: true, backgroundColor: '#080e18'})
viewer.addPluginSync(GBufferPlugin)
const source = new Group(); source.name = 'Map'; setAuthoringMetadata(source, {role:'generator',id:'map-test'})
viewer.scene.modelRoot.add(source)
const start = new Group(); start.name='Player Start'; setAuthoringMetadata(start,{role:'direct',id:'start-test'});viewer.scene.modelRoot.add(start)
const world = {map, tick:0, player:{pos:{...map.playerStart.pos},yaw:0,pitch:0,crouch:false}, mapState:{doors:Object.fromEntries(map.doors.map(d=>[d.id,d.default])),lights:Object.fromEntries(map.lightZones.map(z=>[z.id,z.default])),fog:0,gates:[],hazards:[],flankWallBroken:false}, eventLog:[],unitById:new Map()}
world.phase='intermission'
const mapView = new MapView(viewer, map); mapView.start()
const playerView = new PlayerView(viewer); playerView.start(world)
window.viewer = viewer
window.terminator = {world, manager:{world,mapView,playerView,input:{yaw:0,pitch:0}}}
const update = ()=>{world.tick++;mapView.sync(world);playerView.sync(world);viewer.setDirty()}
viewer.addEventListener('preFrame',update)
window.stopMapPreview = ()=>{viewer.removeEventListener('preFrame',update);playerView.stop();mapView.stop()}
window.mapPreviewReady = true
