// Optical reticle only appears inside the marksman scope. Hip fire has no crosshair.
import {canvasRect} from '../view/canvas-rect.js'
export class ScopeOverlay {
  constructor(viewer) {
    this.viewer=viewer;this.visible=false;this.bounds=''
    this.root=document.createElement('div');this.root.dataset.testid='sniper-scope'
    this.root.setAttribute('aria-hidden','true')
    this.root.style.cssText='position:fixed;pointer-events:none;z-index:25;overflow:hidden;display:none;'
    this.root.innerHTML=`<svg viewBox="0 0 1920 1080" preserveAspectRatio="none" width="100%" height="100%">
      <defs><mask id="tm-scope-aperture"><rect width="1920" height="1080" fill="white"/>
      <circle cx="960" cy="540" r="421" fill="black"/></mask>
      <radialGradient id="tm-scope-glass"><stop offset=".73" stop-color="#09131a" stop-opacity="0"/>
      <stop offset=".94" stop-color="#05090c" stop-opacity=".25"/><stop offset="1" stop-color="#020406" stop-opacity=".98"/></radialGradient></defs>
      <rect width="1920" height="1080" fill="#010203" mask="url(#tm-scope-aperture)"/>
      <circle cx="960" cy="540" r="424" fill="url(#tm-scope-glass)" stroke="#171e23" stroke-width="8"/>
      <g stroke="#060a0c" stroke-width="1.5"><path d="M540 540h840M960 120v840"/>
      <path d="M870 534v12m45-12v12m90-12v12m45-12v12M954 450h12m-12 45h12m-12 90h12m-12 45h12"/>
      <path d="M540 540h290m260 0h290M960 670v290" stroke-width="5"/></g>
      <circle cx="960" cy="540" r="2" fill="#d34f32"/>
    </svg>`
    viewer.container.append(this.root)
  }
  sync(weapon,aim,reloading) {
    const visible=weapon==='sniper'&&aim>.82&&!reloading
    if(visible!==this.visible){this.visible=visible;this.root.style.display=visible?'block':'none'}
  }
  layout() {
    if(!this.visible)return
    const r=canvasRect(this.viewer.canvas),key=`${r.x},${r.y},${r.width},${r.height}`
    if(key===this.bounds)return
    this.bounds=key;Object.assign(this.root.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`})
  }
  dispose(){this.root.remove();this.viewer=null}
}
