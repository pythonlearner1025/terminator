// Four short lines around the aim point. The gap opens with the weapon spread and
// closes when the player aims. Off by default; the crosshair setting mounts it.
const REST_GAP=3.5,AIM_GAP=1.5,GAP_PER_DEGREE=3.2,LINE_LENGTH=7,LINE_THICKNESS=2
const DIRECTIONS=['up','down','left','right']

export class Crosshair {
  constructor(root){
    this.root=root
    this.node=document.createElement('div')
    this.node.className='tm-crosshair'
    this.node.dataset.testid='crosshair'
    Object.assign(this.node.style,{position:'absolute',left:'50%',top:'50%',width:'0',height:'0',zIndex:'2'})
    this.lines=DIRECTIONS.map(direction=>{
      const vertical=direction==='up' || direction==='down'
      const line=document.createElement('i')
      line.dataset.line=direction
      Object.assign(line.style,{position:'absolute',display:'block',background:'#eaf3f8',opacity:'.85',
        boxShadow:'0 0 2px #000c',width:`${vertical?LINE_THICKNESS:LINE_LENGTH}px`,height:`${vertical?LINE_LENGTH:LINE_THICKNESS}px`})
      this.node.append(line)
      return {direction,vertical,line}
    })
    root.append(this.node)
    this.gap=null
    this.sync()
  }
  // Spread arrives in degrees from world.playerSpreadFor, already reduced while aiming.
  gapFor(view){
    const weapon=view?.weapon
    if(!weapon)return REST_GAP
    return (weapon.aiming?AIM_GAP:REST_GAP)+Math.max(0,Number(weapon.spread) || 0)*GAP_PER_DEGREE
  }
  sync(view,visible=true){
    if(!this.node)return
    this.node.hidden=!visible
    if(!visible)return
    const gap=Math.round(this.gapFor(view)*10)/10
    if(gap===this.gap)return
    this.gap=gap
    const far=-(gap+LINE_LENGTH),centred=-LINE_THICKNESS/2
    for(const {vertical,direction,line}of this.lines){
      line.style.left=`${direction==='right'?gap:vertical?centred:far}px`
      line.style.top=`${direction==='down'?gap:vertical?far:centred}px`
    }
  }
  stop(){this.node?.remove();this.node=null;this.lines=[]}
}

// Returns the crosshair this setting asks for: an instance when it is on, null when off.
// Pass the live one back in so a settings change mounts or removes it exactly once.
export function mountCrosshair(root,settings,current=null){
  const wanted=settings?.crosshair===true
  if(wanted)return current || new Crosshair(root)
  current?.stop()
  return null
}
