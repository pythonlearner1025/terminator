import {icon} from './icons.js'
import {escapeHtml as esc} from './hud.js'

export const iconButton=(action,name,glyph,kind='ghost')=>`<button class="tm-btn tm-icon-button ${kind}" data-action="${action}" data-testid="${action}" aria-label="${esc(name)}">${icon(glyph)}</button>`
export const itemName=item=>({pistol:'Pistol',m4:'M4',shotgun:'Shotgun',plasma:'Plasma',grenade:'Frag',health:'Medkit',armor:'Armor'}[item.id] || item.name)
export const shortStatus=value=>{
  const text=String(value?.message || value || '')
  if(/party full|capacity|slots are occupied/i.test(text))return 'Full'
  if(/host.*(left|disconnect|closed|lost)/i.test(text))return 'Host left'
  if(/not.found|unknown.party/i.test(text))return 'Not found'
  if(/code|invalid.party/i.test(text))return 'Invalid code'
  if(/relay.*(address|invalid)|invalid.*relay/i.test(text))return 'Invalid relay'
  if(/scrap|afford/i.test(text))return 'Scrap'
  if(/closed/i.test(text))return 'Closed'
  return 'Unavailable'
}
