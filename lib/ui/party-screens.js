import {escapeHtml as esc} from './hud.js'
import {difficultyScaling} from '../core/waves.js'
import {parsePartyInvite, partyErrorMessage, partyPlayers} from './party.js'

const button = (action, text, kind = '') => `<button type="button" class="tm-btn ${kind}" data-action="${action}" data-testid="${action}">${text}</button>`
const field = (key, label, value, placeholder, extra = '') => `<label class="tm-party-field"><span class="tm-eyebrow">${label}</span><input data-party-field="${key}" aria-label="${label}" value="${esc(value)}" placeholder="${placeholder}" ${extra}></label>`

export class PartyScreens {
  constructor(screens) {
    this.screens = screens
    this.name = 'Resistance Fighter'
    this.invite = ''
    this.relay = ''
    this.override = false
    this.onInput = event => {
      const field = event.target.dataset.partyField
      if (field) this[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
      if (field === 'override') this.refresh()
    }
    this.onSubmit = event => { if (!event.target.matches('[data-party-form]')) return; event.preventDefault(); this.action(event.target.dataset.partyForm) }
    screens.root.addEventListener('input', this.onInput)
    screens.root.addEventListener('submit', this.onSubmit)
  }
  show(route) {
    const host = route === 'party-host'
    this.error = ''
    this.override = false
    this.screens.root.classList.add('tm-party-screen')
    this.screens.root.innerHTML = `<header class="tm-screen-header"><div><div class="tm-eyebrow">RESISTANCE COMMAND / CO-OP</div><h1>${host ? 'ASSEMBLE YOUR SQUAD' : 'JOIN THE RESISTANCE'}</h1></div>${button('leave-party', 'Main menu', 'ghost')}</header>
      <div class="tm-party-grid"><section class="tm-party-connect">
      <form data-party-form="${host ? 'create-party' : 'join-party-submit'}">
        ${field('name', 'Your name', this.name, 'Resistance Fighter', 'maxlength="32" autocomplete="nickname" required')}
        ${host ? `<div class="tm-party-code-label tm-eyebrow">YOUR PARTY CODE</div><div class="tm-code" data-party="code">------</div><p class="tm-muted">Up to three fighters. One chance to hold the line.</p><div class="tm-party-submit">${button('create-party', 'Create party', 'primary')}</div>` : `${field('invite', 'Party code or invite link', this.invite, 'ABC123 or https://…?party=ABC123&relay=…', 'autocomplete="off" spellcheck="false" required aria-describedby="party-error"')}${field('relay', 'Relay address (for code-only invites)', this.relay, 'wss://your-tunnel.trycloudflare.com', 'autocomplete="off" spellcheck="false" aria-describedby="party-error"')}<p class="tm-notice">Paste the full invite to fill in both the party code and relay.</p><div class="tm-party-submit">${button('join-party-submit', 'Join party', 'primary')}</div>`}
      </form><p class="tm-party-status" role="status" data-party="status"></p><div id="party-error" class="tm-party-error" role="alert" data-party="error" hidden></div>
      ${host ? `<div class="tm-party-invites" data-party="invites"><div class="tm-eyebrow">INVITE YOUR SQUAD</div>${['lan','tunnel'].map(kind => `<label class="tm-invite-row"><span>${kind === 'lan' ? 'LOCAL NETWORK' : 'INTERNET TUNNEL'}</span><div><input readonly aria-label="${kind === 'lan' ? 'LAN invite link' : 'Tunnel invite link'}" data-party="${kind}" placeholder="${kind === 'lan' ? 'Create a party to get an invite' : 'No tunnel running'}">${button(`copy-party-${kind}`, 'Copy')}</div></label>`).join('')}<p class="tm-notice">For internet play, run <code>npm run tunnel</code> in the host project. Keep it running and share the tunnel invite.</p><p class="tm-mono tm-muted">LAN invites work on the host's local network. The game page must also be reachable by your squad.</p></div>` : `<div class="tm-surface tm-party-brief"><div class="tm-eyebrow">OPERATION / LAST STAND</div><h2>BUNKER 7</h2><p>Fight together through ten waves.<br>Dead fighters spectate until the next wave.<br>The match ends when the squad falls.</p></div>`}
      </section><aside class="tm-surface tm-party-roster"><div class="tm-party-heading"><div><div class="tm-eyebrow">RESISTANCE SQUAD</div><h2>FIGHTERS <span data-party="count">0 / 3</span></h2></div><span class="tm-party-signal" data-party="signal">OFFLINE</span></div><div data-party="players" data-testid="party-players"></div><div class="tm-party-scaling" data-testid="party-scaling"><div class="tm-eyebrow">DIFFICULTY AT NEXT WAVE</div><strong data-party="scaling-label"></strong><div data-party="scaling-stats"></div><p>Scales with connected fighters at wave start.</p></div><div class="tm-party-ready">${button('party-ready', 'Ready up')}<label data-party="override-row" class="tm-party-override" ${host ? '' : 'hidden'}><input type="checkbox" data-party-field="override"> Start even if someone is not ready</label></div></aside></div>
      <footer class="tm-screen-footer"><span class="tm-mono" data-party="start-note">${host ? 'CREATE A PARTY TO BEGIN' : 'JOIN A PARTY TO READY UP'}</span>${host ? button('party-start', 'Start match', 'primary') : '<span class="tm-eyebrow" data-party="waiting">HOST STARTS THE MATCH</span>'}</footer>`
    this.refresh()
  }
  live(key, text) { const node = this.screens.root.querySelector(`[data-party="${key}"]`); if (node) node.textContent = text }
  refresh(state = this.state) {
    this.state = state
    if (!['party-host', 'party-join'].includes(this.screens.route)) return
    const root = this.screens.root
    const players = partyPlayers(state)
    const host = this.screens.route === 'party-host'
    const connected = Boolean(state?.code && ['connected', 'lobby', 'ready'].includes(state.status))
    const busy = state?.status === 'connecting'
    const failed = this.error || state?.error || ''
    this.live('code', state?.code || '------')
    this.live('count', `${players.length} / 3`)
    this.live('signal', connected ? 'CONNECTED' : busy ? 'CONNECTING' : 'OFFLINE')
    this.live('status', busy ? (host ? 'Creating your party...' : 'Connecting to the host...') : connected ? `PARTY ${state.code} / ${host ? 'YOU ARE HOST' : 'CONNECTED TO HOST'}` : '')
    this.live('error', failed)
    root.querySelector('[data-party="error"]').hidden = !failed
    const localId = state?.playerId || state?.localPlayerId || (host ? state?.hostId : null)
    const rosterKey = JSON.stringify([players, localId, state?.hostId])
    if (rosterKey !== this.rosterKey || !root.querySelector('.tm-party-player')) {
      this.rosterKey = rosterKey
      root.querySelector('[data-party="players"]').innerHTML = Array.from({length: Math.max(3, players.length)}, (_, i) => {
        const player = players[i]
        return player ? `<div class="tm-party-player"><span class="tm-party-number">0${i+1}</span><div><strong>${esc(player.name || 'Resistance Fighter')}</strong><small>${player.id === state?.hostId || player.host ? 'HOST' : 'FIGHTER'}${player.id === localId ? ' / YOU' : ''}</small></div><span class="tm-ready-mark ${player.ready ? 'is-ready' : ''}">${player.ready ? '✓ READY' : 'NOT READY'}</span></div>` : `<div class="tm-party-player empty"><span class="tm-party-number">0${i+1}</span><div><strong>OPEN SLOT</strong><small>WAITING FOR A FIGHTER</small></div></div>`
      }).join('')
    }
    const scaling = difficultyScaling(Math.max(1, players.length))
    this.live('scaling-label', `${scaling.players} ${scaling.players === 1 ? 'PLAYER' : 'PLAYERS'} x${scaling.budgetMultiplier.toFixed(1)}`)
    this.live('scaling-stats', `ENEMY HEALTH x${scaling.unitHealthMultiplier} / MAX ALIVE ${scaling.maxAlive}`)
    const self = players.find(p => p.id === localId)
    const ready = root.querySelector('[data-action="party-ready"]')
    ready.disabled = !connected || !self || !this.screens.actions.partyCanReady()
    ready.textContent = self?.ready ? '✓ Ready / Unready' : 'Ready up'
    for (const action of ['create-party','join-party-submit']) {
      const node = root.querySelector(`[data-action="${action}"]`)
      if (node) { node.disabled = busy || connected; node.hidden = connected }
    }
    for (const input of root.querySelectorAll('form input')) input.disabled = busy || connected
    const start = root.querySelector('[data-action="party-start"]')
    const allReady = players.length > 0 && players.every(p => p.ready)
    if (start) start.disabled = !connected || (!allReady && !this.override)
    this.live('start-note', connected ? host ? allReady ? 'SQUAD READY / DEPLOY WHEN READY' : this.override ? 'HOST OVERRIDE / SQUAD WILL DEPLOY TOGETHER' : 'WAITING FOR EVERY FIGHTER TO READY UP' : self?.ready ? 'YOU ARE READY / WAITING FOR THE HOST' : 'READY UP WHEN YOU ARE PREPARED' : host ? 'CREATE A PARTY TO BEGIN' : 'JOIN A PARTY TO READY UP')
    for (const kind of ['lan','tunnel']) {
      const input = root.querySelector(`[data-party="${kind}"]`)
      if (!input) continue
      const value = state?.inviteUrls?.[kind] || ''
      if (input.value !== value) input.value = value
      root.querySelector(`[data-action="copy-party-${kind}"]`).disabled = !value
    }
  }
  async action(action) {
    if (!['create-party','join-party-submit','party-ready','party-start','leave-party','copy-party-lan','copy-party-tunnel'].includes(action)) return false
    try {
      this.error = ''
      if (action === 'leave-party') { this.screens.actions.partyLeave(); this.state = null; this.screens.show('main'); return true }
      if (action.startsWith('copy-party-')) {
        const input = this.screens.root.querySelector(`[data-party="${action.slice(11)}"]`)
        try { await navigator.clipboard.writeText(input.value); this.screens.toast('Party invite copied') }
        catch { input.select(); this.screens.toast('Clipboard unavailable. Select and copy the invite above.') }
      } else if (action === 'create-party' || action === 'join-party-submit') {
        if (this.state?.status === 'connecting') return true
        const name = this.name.trim()
        if (!name) throw new Error('Enter your name before joining the squad.')
        if (action === 'create-party') await this.screens.actions.partyHost({name})
        else {
          const invite = parsePartyInvite(this.invite, this.relay)
          this.invite = invite.code; this.relay = invite.relay || ''
          for (const key of ['invite', 'relay']) this.screens.root.querySelector(`[data-party-field="${key}"]`).value = this[key]
          await this.screens.actions.partyJoin({...invite, name})
        }
      } else if (action === 'party-ready') {
        const id = this.state?.playerId || this.state?.localPlayerId || (this.state?.role === 'host' ? this.state?.hostId : null)
        await this.screens.actions.partyReady(!partyPlayers(this.state).find(p => p.id === id)?.ready)
      } else if (action === 'party-start') {
        if (await this.screens.actions.partyStart(this.override)) { this.screens.show(null); this.screens.hud.lastPhase = '' }
      }
    } catch (error) { this.error = error.code ? partyErrorMessage(error) : error.message }
    this.refresh()
    return true
  }
  dispose() { this.screens.root.removeEventListener('input', this.onInput); this.screens.root.removeEventListener('submit', this.onSubmit) }
}
