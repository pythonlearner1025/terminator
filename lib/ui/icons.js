const paths = {
  scrap: 'M12 2 21 7v10l-9 5-9-5V7Zm0 0v9m9-4-9 4-9-4m9 4v11',
  armor: 'M12 2 21 6v7c0 5-9 9-9 9s-9-4-9-9V6Zm0 4v12',
  health: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
  grenade: 'M9 2h7v3l3 4v10l-4 3H9l-4-4V9l4-4Zm7 0 5 1v6M6 12h12M6 16h12M10 7v14m4-14v14',
  skull: 'M5 3h14l3 5-2 9-4 1v4H8v-4l-4-1-2-9Zm1 5 4 1-1 4-4-1m13-4-4 1 1 4 4-1m-9 3 2-3 2 3M10 18v4m4-4v4',
  crate: 'M3 5h18v15H3Zm0 5h18M8 5v15m8-15v15M9 2h6v3',
  pistol: 'M2 6h20v6H12l-2 9H4l2-10H2Zm4 0V3h12v3m-6 6 3 4h-5',
  m4: 'M1 9h5l3-3h10v3h4m-22 0v7l6-3h4l-1 8h4l2-8h4V9M12 6V3m-3 8h12',
  shotgun: 'M1 9h22v3H10l-3 7H2l3-7H1Zm9 0V6h12M14 12v3h6v-3',
  plasma: 'M1 8h6l2-3h10v4h4v5H12l-2 7H5l2-7H1Zm8-3V2h6v3m-2 3v5m4-5v5',
  ammo: 'M5 4 7 1l2 3v17H5Zm10 0 2-3 2 3v17h-4ZM5 16h4m6 0h4',
  knife: 'm3 21 6-7-2-2L21 1l-7 15-3-1-6 7Z',
}
export function icon(name, className = '') {
  return `<svg class="tm-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="bevel" aria-hidden="true"><path d="${paths[name] || paths.crate}"/></svg>`
}

// Original vector art. This lightweight menu illustration needs no second WebGL context.
export const SKULL = `<svg class="tm-skull-art" viewBox="0 0 480 620" role="img" aria-label="T-800 endoskeleton with tracking red eyes">
<defs><linearGradient id="tm-steel" x2="1" y2=".7"><stop stop-color="#142331"/><stop offset=".35" stop-color="#b5c3c9"/><stop offset=".5" stop-color="#46545f"/><stop offset=".72" stop-color="#8a9ba6"/><stop offset="1" stop-color="#101820"/></linearGradient><linearGradient id="tm-face"><stop stop-color="#243643"/><stop offset=".48" stop-color="#647a89"/><stop offset=".52" stop-color="#13212c"/><stop offset="1" stop-color="#405361"/></linearGradient><filter id="tm-glow"><feGaussianBlur stdDeviation="6"/></filter></defs>
<g stroke="#718998" stroke-width="2" stroke-linejoin="bevel">
<path fill="#0a1219" d="M169 438h142l15 173H151Z"/><path fill="url(#tm-steel)" d="M196 471h86v28h-86Zm-11 47h109v20H185Zm-8 45h126v21H177Z"/>
<path fill="url(#tm-steel)" d="m109 161 24-77 64-41h87l64 41 24 77 2 128-24 83-46 87H177l-46-87-24-83Z"/>
<path fill="url(#tm-face)" d="m137 160 17-66 44-28h85l44 28 17 66-38 30H175Z"/>
<path fill="#0a151f" d="m124 202 99 20-13 78-77-20-17-45Zm232 0-99 20 13 78 77-20 17-45Z"/>
<path fill="url(#tm-steel)" d="m122 180 108 26-8 23-110-25Zm236 0-108 26 8 23 110-25Z"/>
<path fill="#070e14" d="m233 255-19 71 26 13 26-13-19-71Z"/>
<path fill="url(#tm-face)" d="m123 293 60 26 23 31-43 24-24-29Zm234 0-60 26-23 31 43 24 24-29Z"/>
<path fill="#090e12" d="m174 351 33-15h66l33 15-10 68H185Z"/>
<path fill="url(#tm-steel)" d="m147 353 30 65 127 1 29-66 8 30-29 65-20 24H188l-21-24-29-65Z"/>
<path fill="#0a131b" d="m88 197 24-8-1 128-21-14Zm304 0-24-8 1 128 21-14Z"/>
<g fill="url(#tm-steel)">${Array.from({length: 8}, (_, i) => `<path d="M${183+i*14} 349h11v25h-11Zm0 36h11v23h-11Z"/>`).join('')}</g>
<g fill="#101a22"><circle cx="133" cy="331" r="12"/><circle cx="347" cy="331" r="12"/><circle cx="144" cy="130" r="7"/><circle cx="336" cy="130" r="7"/></g>
<path fill="none" d="M240 72v108m-44-94-22 57 33 28m77-85 22 57-33 28M164 438h150M210 483v114m60-114v114"/>
</g><g class="tm-tracking-eyes"><g fill="#ff202a" filter="url(#tm-glow)"><ellipse cx="170" cy="254" rx="26" ry="13"/><ellipse cx="310" cy="254" rx="26" ry="13"/></g><g fill="#ff3040" stroke="#ff9c98" stroke-width="2"><circle cx="170" cy="254" r="10"/><circle cx="310" cy="254" r="10"/></g><g fill="#fff0dd"><circle cx="170" cy="254" r="3"/><circle cx="310" cy="254" r="3"/></g></g></svg>`
