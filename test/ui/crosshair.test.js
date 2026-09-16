import assert from 'node:assert/strict'
import test from 'node:test'
import {readFile} from 'node:fs/promises'
import {DEFAULT_SETTINGS,normalizeSettings} from '../../lib/ui/settings.js'

function element(tag){
  const style={setProperty(key,value){style[key]=value}}
  const node={tag,style,dataset:{},children:[],parent:null,hidden:false,className:'',
    querySelector(){return null},addEventListener(){},removeEventListener(){},
    append(...kids){for(const kid of kids){kid.parent=node;node.children.push(kid)}},
    remove(){if(!node.parent)return;node.parent.children=node.parent.children.filter(child=>child!==node);node.parent=null}}
  return node
}
globalThis.ImageData ??= class {}
globalThis.window ??= {addEventListener(){},removeEventListener(){},dispatchEvent(){},matchMedia:()=>({matches:false})}
globalThis.requestAnimationFrame ??= ()=>1
globalThis.document ??= {createElement:element,head:{appendChild(){}}}
const {Crosshair,mountCrosshair}=await import('../../lib/ui/crosshair.js')
const {Screens}=await import('../../lib/ui/screens.js')
const {UiSession}=await import('../../lib/ui/session.js')

const SETTINGS={difficulty:'normal',bindings:{trader:'KeyE',ready:'KeyR'},hud:72,sensitivity:1,fov:72,
  quality:'high',master:80,music:65,effects:85,crosshair:false}
function session(){
  const root=element('div')
  const manager={sessionMode:'single',director:{setDifficulty(){}},hud:{root},input:{},playerView:{camera:null},
    startup:{cancelMatch(){}},ctx:{viewer:{renderManager:{setSize(){}},setDirty(){}}}}
  return {root,instance:Object.assign(Object.create(UiSession.prototype),{manager,bindings:null,lobbyDifficulty:null,
    active:true,assetQueue:null,rangePanel:null,sandbox:null,menuScene:{dispose(){}},party:{dispose(){}},
    spectate:{dispose(){}},screens:{dispose(){}},lobbyMethods:null})}
}

test('the crosshair setting is off by default and only true turns it on',()=>{
  assert.equal(DEFAULT_SETTINGS.crosshair,false)
  assert.equal(normalizeSettings({}).crosshair,false)
  assert.equal(normalizeSettings({crosshair:'yes'}).crosshair,false)
  assert.equal(normalizeSettings({crosshair:true}).crosshair,true)
})

test('the settings screen renders a crosshair toggle that follows the setting',async()=>{
  const render=crosshair=>{
    const screen={root:{innerHTML:''},settings:{...SETTINGS,crosshair},formatSetting:Screens.prototype.formatSetting}
    Screens.prototype.settingsScreen.call(screen)
    return screen.root.innerHTML
  }
  assert.match(render(false),/data-setting="crosshair"[^>]*type="checkbox"/)
  assert.doesNotMatch(render(false),/data-setting="crosshair"[^>]*checked/)
  assert.match(render(true),/data-setting="crosshair"[^>]*checked/)
  // The shared settings input handler has to read checkboxes, not their value string.
  const source=await readFile(new URL('../../lib/ui/screens.js',import.meta.url),'utf8')
  assert.match(source,/e\.target\.type==='checkbox'\?e\.target\.checked/)
  // The toggle is a labelled row with an ON or OFF readout, like every other setting.
  assert.match(render(false),/class="tm-setting tm-setting-toggle"/)
  assert.match(render(false),/<output data-output="crosshair">OFF<\/output>/)
  assert.match(render(true),/<output data-output="crosshair">ON<\/output>/)
  assert.doesNotMatch(render(false),/data-setting="crosshair"[^>]*style=/,'no inline size: the sheet owns it')
  // `.tm-setting input{height:4px}` sizes the sliders. It rendered the checkbox as a dot.
  const styles=await readFile(new URL('../../lib/ui/presentation-styles.js',import.meta.url),'utf8')
  assert.match(styles,/\.tm-setting input\[type=checkbox\]\{[^}]*height:28px/)
})

test('the crosshair mounts only when the setting is on, and unmounts on stop',()=>{
  const root=element('div')
  assert.equal(mountCrosshair(root,{crosshair:false}),null)
  assert.equal(root.children.length,0,'the setting is off, so nothing is mounted')

  const crosshair=mountCrosshair(root,{crosshair:true})
  assert.ok(crosshair,'the setting is on, so the crosshair mounts')
  assert.equal(root.children.length,1)
  assert.equal(root.children[0].dataset.testid,'crosshair')
  assert.equal(root.children[0].children.length,4,'four lines')

  assert.equal(mountCrosshair(root,{crosshair:true},crosshair),crosshair,'a second pass does not mount a copy')
  assert.equal(root.children.length,1)

  assert.equal(mountCrosshair(root,{crosshair:false},crosshair),null,'turning the setting off removes it')
  assert.equal(root.children.length,0,'the node is gone from the HUD root')

  const again=mountCrosshair(root,{crosshair:true})
  again.stop()
  assert.equal(root.children.length,0,'stop removes the node cleanly')
  again.stop()
  assert.equal(root.children.length,0,'stop twice is safe')
})

test('the session mounts the crosshair only when the setting is on',()=>{
  const {root,instance}=session()
  instance.applySettings({...SETTINGS,crosshair:false})
  assert.equal(root.children.length,0,'default settings mount nothing')
  assert.equal(instance.crosshair,null)

  instance.applySettings({...SETTINGS,crosshair:true})
  assert.equal(root.children.length,1,'turning the setting on mounts the crosshair')
  const mounted=instance.crosshair
  instance.applySettings({...SETTINGS,crosshair:true})
  assert.equal(instance.crosshair,mounted,'re-applying the same settings does not mount a copy')
  assert.equal(root.children.length,1)

  instance.applySettings({...SETTINGS,crosshair:false})
  assert.equal(root.children.length,0,'turning the setting off removes it')
  assert.equal(instance.crosshair,null)
})

test('the session removes the crosshair on stop',()=>{
  const {root,instance}=session()
  instance.applySettings({...SETTINGS,crosshair:true})
  assert.equal(root.children.length,1)
  instance.dispose()
  assert.equal(root.children.length,0,'dispose removes the crosshair from the HUD root')
  assert.equal(instance.crosshair,null)
})

test('the crosshair opens with spread and closes when aiming',()=>{
  const root=element('div')
  const crosshair=new Crosshair(root)
  const gapAt=(spread,aiming=false)=>{crosshair.sync({weapon:{spread,aiming}});return crosshair.gap}
  const rest=gapAt(0)
  const pistol=gapAt(1.2)
  const shotgun=gapAt(7)
  assert.ok(pistol>rest,`${pistol} opens past the resting ${rest}`)
  assert.ok(shotgun>pistol,`${shotgun} opens past the pistol ${pistol}`)
  // world.playerSpreadFor already multiplies the spread by the aim multiplier.
  assert.ok(gapAt(1.2*0.35,true)<pistol,'aiming closes the crosshair')
  assert.ok(gapAt(7*0.35,true)<shotgun,'aiming closes the shotgun crosshair too')

  const up=crosshair.lines.find(line=>line.direction==='up').line
  const right=crosshair.lines.find(line=>line.direction==='right').line
  gapAt(0)
  const tight=[up.style.top,right.style.left]
  gapAt(7)
  assert.notEqual(up.style.top,tight[0],'the lines move out with spread')
  assert.notEqual(right.style.left,tight[1])

  crosshair.sync({weapon:{spread:0,aiming:false}},false)
  assert.equal(crosshair.node.hidden,true,'the crosshair hides while a screen is open or the player is dead')
  crosshair.sync({weapon:{spread:0,aiming:false}},true)
  assert.equal(crosshair.node.hidden,false)
  crosshair.sync()
  assert.equal(crosshair.gap,3.5,'a missing view model falls back to the resting gap')
})

test('the session syncs the crosshair with the live view model',async()=>{
  // sync() drives the whole HUD, so guard the one line that feeds the crosshair.
  const source=await readFile(new URL('../../lib/ui/session.js',import.meta.url),'utf8')
  assert.match(source,/this\.crosshair\?\.sync\(view,!this\.screens\.route && this\.localPlayer\.alive\)/)
})
