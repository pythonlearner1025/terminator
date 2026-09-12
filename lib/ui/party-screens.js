import {escapeHtml as esc} from './hud.js'
import {icon} from './icons.js'
import {iconButton,shortStatus} from './labels.js'
import {parsePartyInvite, partyErrorMessage, partyPlayers} from './party.js'

const button = (action, text, kind = '') => `<button type="button" class="tm-btn ${kind}" data-action="${action}" data-testid="${action}">${text}</button>`
const field = (key, label, value, placeholder, extra = '') => `<label class="tm-party-field"><input data-party-field="${key}" aria-label="${label}" value="${esc(value)}" placeholder="${placeholder}" ${extra}></label>`

export class PartyScreens {
  constructor(screens) {
    this.screens = screens
    this.name = 'Fighter'
    this.invite = ''
    this.relay = ''
    this.override = false
    this.onInput = event => {
      const field = event.target.dataset.partyField
      if (field) this[field] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
      if (['invite','relay','name'].includes(field)) { this.error = ''; this.refresh() }
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
    this.screens.root.innerHTML = `<header class="tm-screen-header">${iconButton('leave-party','Main menu','back')}</header>
      <div class="tm-party-grid"><section class="tm-party-connect">
      ${host ? `<div class="tm-code" data-party="code"></div><div class="tm-invite-row"><div><input readonly aria-label="Invite link" data-party="invite">${iconButton('copy-party-invite','Copy invite','copy')}</div></div>` : `<form data-party-form="join-party-submit">${field('invite','Party code or invite link',this.invite,'Code','autocomplete="off" spellcheck="false" required aria-describedby="party-error"')}${field('relay','Relay address',this.relay,'Relay','autocomplete="off" spellcheck="false" aria-describedby="party-error"')}${button('join-party-submit','Join','primary')}</form>`}
      <div id="party-error" class="tm-party-error" role="alert" data-party="error" hidden></div>
      </section><aside class="tm-surface tm-party-roster" data-party="roster"><div data-party="players" data-testid="party-players"></div></aside></div>
      ${host ? `<div class="tm-screen-footer"><label class="tm-party-override"><input type="checkbox" data-party-field="override" aria-label="Start even if someone is not ready">${icon('play')}</label>${button('party-start','Start','primary')}</div>` : ''}`
    this.refresh()
    if(host && !this.state?.code && this.state?.status!=='connecting')void this.action('create-party')
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
    this.live('code', state?.code || (busy?'…':'------'))
    this.live('error', failed?shortStatus(failed):'')
    root.querySelector('[data-party="error"]').hidden = !failed
    root.querySelector('[data-party="roster"]').hidden = !host && !connected
    const localId = state?.playerId || state?.localPlayerId || (host ? state?.hostId : null)
    const rosterKey = JSON.stringify([players, localId, state?.hostId,connected,this.screens.actions.partyCanReady()])
    if (rosterKey !== this.rosterKey || !root.querySelector('.tm-party-player')) {
      this.rosterKey = rosterKey
      root.querySelector('[data-party="players"]').innerHTML = players.map(player=>`<div class="tm-party-player"><strong>${esc(player.name || 'Fighter')}</strong>${player.id===localId?`<button class="tm-btn tm-icon-button tm-ready-mark ${player.ready?'is-ready':''}" data-action="party-ready" data-testid="party-ready" aria-label="Ready" aria-pressed="${Boolean(player.ready)}" ${!connected || !this.screens.actions.partyCanReady()?'disabled':''}>${icon('check')}</button>`:`<span class="tm-ready-mark ${player.ready?'is-ready':''}" aria-label="${player.ready?'Ready':'Not ready'}">${icon(player.ready?'check':'pause')}</span>`}</div>`).join('')
    }
    const join = root.querySelector('[data-action="join-party-submit"]')
    if(join){join.disabled=busy;join.closest('form').hidden=connected}
    for (const input of root.querySelectorAll('form input')) input.disabled = busy || connected
    const start = root.querySelector('[data-action="party-start"]')
    const allReady = players.length > 0 && players.every(p => p.ready)
    if (start) start.disabled = busy || (connected && !allReady && !this.override)
    const invite = root.querySelector('[data-party="invite"]')
    if(invite){invite.value=state?.inviteUrls?.tunnel || state?.inviteUrls?.lan || '';root.querySelector('[data-action="copy-party-invite"]').disabled=!invite.value}
  }
  async action(action) {
    if (!['create-party','join-party-submit','party-ready','party-start','leave-party','copy-party-invite'].includes(action)) return false
    try {
      this.error = ''
      if (action === 'leave-party') { this.screens.actions.partyLeave(); this.state = null; this.screens.show('main'); return true }
      if (action.startsWith('copy-party-')) {
        const input = this.screens.root.querySelector(`[data-party="${action.slice(11)}"]`)
        try { await navigator.clipboard.writeText(input.value); this.screens.root.querySelector('[data-action="copy-party-invite"]').classList.add('tm-change') }
        catch { input.select(); this.screens.toast('Clipboard unavailable') }
      } else if (action === 'create-party' || action === 'join-party-submit') {
        if (this.state?.status === 'connecting') return true
        const name = this.name.trim()
        if (!name) throw new Error('Enter your name before joining the squad.')
        if (action === 'create-party') await this.screens.actions.partyHost({name, relay: this.relay || undefined})
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
        if(!this.state?.code || !['connected','lobby','ready'].includes(this.state.status)){await this.action('create-party');return true}
        if (await this.screens.actions.partyStart(this.override)) { this.screens.show(null); this.screens.hud.lastPhase = '' }
      }
    } catch (error) { this.error = error.code ? partyErrorMessage(error) : error.message }
    this.refresh()
    return true
  }
  dispose() { this.screens.root.removeEventListener('input', this.onInput); this.screens.root.removeEventListener('submit', this.onSubmit) }
}
