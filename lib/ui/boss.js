import {icon} from './icons.js'
export const BOSS_MARKUP=`<section class="tm-boss" data-role="boss" data-testid="boss-bar" hidden aria-label="Boss">
<div class="tm-boss-title"><strong data-role="bossName"></strong><span data-role="bossHealth"></span></div>
<div class="tm-boss-meter" data-role="bossMeter" role="progressbar" aria-label="Boss health" aria-valuemin="0"><i data-role="bossFill"></i></div>
<div class="tm-boss-hint">${icon('core')}<span>REAR POWER CORE</span></div></section>`
export const BOSS_STYLE=`.tm-boss{position:absolute;top:calc(108px * var(--tm-hud-scale,1));left:50%;transform:translateX(-50%);width:min(450px,35%);padding:10px 15px;background:linear-gradient(90deg,#091018dc,#121d27d9);border-top:2px solid #b74942;box-shadow:0 7px 20px #0006;pointer-events:none}.tm-boss[hidden]{display:none}.tm-boss-title{display:flex;justify-content:space-between;align-items:center;letter-spacing:.15em;font-size:14px;color:#e4eaed}.tm-boss-title span{font-size:11px;letter-spacing:.04em;color:#aab7bd}.tm-boss-meter{height:7px;background:#04080b;border:1px solid #38414a;margin:8px 0}.tm-boss-meter i{display:block;height:100%;transform-origin:left;background:linear-gradient(90deg,#a83530,#ee7664);transition:transform .12s linear;box-shadow:0 0 8px #df30242e}.tm-boss-hint{display:flex;align-items:center;gap:7px;font-size:9px;color:#b3a894;letter-spacing:.14em}.tm-boss-hint .tm-icon{width:15px;height:15px;color:#efad60}`
export function renderBoss(elements,boss){
  elements.boss.hidden=!boss
  if(!boss)return
  const max=Number.isFinite(boss.hpMax)?Math.max(0,boss.hpMax):0
  const hp=Number.isFinite(boss.hp)?Math.max(0,Math.min(max,boss.hp)):0
  const ratio=max>0?hp/max:0
  const name=String(boss.name||'HK-Tank').toUpperCase(),health=`${Math.ceil(hp)} / ${Math.ceil(max)}`
  if(elements.bossName.textContent!==name)elements.bossName.textContent=name
  if(elements.bossHealth.textContent!==health)elements.bossHealth.textContent=health
  elements.bossFill.style.transform=`scaleX(${ratio})`
  elements.bossMeter.setAttribute('aria-valuemax',max);elements.bossMeter.setAttribute('aria-valuenow',hp)
}
export function waveBannerTitle(wave){return wave.boss||wave.current===5||wave.current===10?'HK-TANK INBOUND':`WAVE ${wave.current}`}
