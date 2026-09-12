import {escapeHtml as esc} from './hud.js'
import {icon} from './icons.js'
import {iconButton,shortStatus} from './labels.js'
import {parsePartyInvite, partyErrorMessage, partyPlayers} from './party.js'

const button = (action, text, kind = '') => `<button type="button" class="tm-btn ${kind}" data-action="${action}" data-testid="${action}">${text}</button>`
const field = (key, label, value, placeholder, extra = '') => `<label class="tm-party-field"><span class="tm-eyebrow">${label}</span><input data-party-field="${key}" aria-label="${label}" value="${esc(value)}" placeholder="${placeholder}" ${extra}></label>`

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
      if (['invite','name'].includes(field)) { this.error = ''; this.refresh() }
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
      ${host ? `<form data-party-form="create-party">${field('name','YOUR NAME',this.name,'Name','autocomplete="off" spellcheck="false" required')}${button('create-party','CREATE','primary')}</form><div class="tm-eyebrow">PARTY CODE</div><div class="tm-code" data-party="code"></div><div class="tm-eyebrow">INVITE LINK</div><div class="tm-invite-row"><div><input readonly aria-label="Invite link" data-party="invite"><button type="button" class="tm-btn ghost" data-action="copy-party-invite" data-testid="copy-party-invite">COPY</button></div></div><p class="tm-muted" data-party="inviteNote"></p>${this.screens.difficultyControl()}` : `<form data-party-form="join-party-submit">${field('name','YOUR NAME',this.name,'Name','autocomplete="off" spellcheck="false" required')}${field('invite','PARTY CODE OR INVITE LINK',this.invite,'ABC123 or https://...','autocomplete="off" spellcheck="false" required aria-describedby="party-error"')}${button('join-party-submit','JOIN','primary')}</form>`}
      <div id="party-error" class="tm-party-error" role="alert" data-party="error" hidden></div>
      </section><aside class="tm-surface tm-party-roster" data-party="roster"><div class="tm-eyebrow">PLAYERS</div><div data-party="players" data-testid="party-players"></div><p class="tm-muted" data-party="rosterNote"></p></aside></div>
      ${host ? `<div class="tm-screen-footer"><label class="tm-party-override"><input type="checkbox" data-party-field="override" aria-label="Start even if someone is not ready"> OVERRIDE</label>${button('party-start','START','primary')}</div>` : ''}`
    this.refresh()
  }
  live(key, text) { const node = this.screens.root.querySelector(`[data-party="${key}"]`); if (node) node.textContent = text }
  refresh(state = this.state) {
    this.state = state
    if (!['party-host', 'party-join'].includes(this.screens.route)) return
    const root = this.screens.root
    const players = partyPlayers(state)
    const host = this.screens.route === 'party-host'
    const connected = Boolean(state?.code && (state?.signaling || ['connected', 'lobby', 'ready'].includes(state.status)))
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
      root.querySelector('[data-party="players"]').innerHTML = players.map(player=>`<div class="tm-party-player"><strong>${esc(player.name || 'Fighter')}</strong>${player.id===localId?`<button class="tm-btn tm-ready-mark ${player.ready?'is-ready':''}" data-action="party-ready" data-testid="party-ready" aria-label="Ready" aria-pressed="${Boolean(player.ready)}" ${!connected || !this.screens.actions.partyCanReady()?'disabled':''}>${icon('check')} ${player.ready?'READY':'CLICK WHEN READY'}</button>`:`<span class="tm-ready-mark ${player.ready?'is-ready':''}" aria-label="${player.ready?'Ready':'Not ready'}">${icon(player.ready?'check':'pause')} ${player.ready?'READY':'NOT READY'}</span>`}</div>`).join('')
    }
    const join = root.querySelector('[data-action="join-party-submit"]')
    if(join){join.disabled=busy;join.closest('form').hidden=connected}
    for (const input of root.querySelectorAll('form input')) input.disabled = busy || connected
    const create = root.querySelector('[data-action="create-party"]')
    if (create) { create.disabled = busy || connected; create.closest('form').hidden = connected }
    const start = root.querySelector('[data-action="party-start"]')
    const allReady = players.length > 0 && players.every(p => p.ready)
    if (start) start.disabled = busy || (connected && !allReady && !this.override)
    const invite = root.querySelector('[data-party="invite"]')
    if(invite){invite.value=state?.inviteUrl || state?.inviteUrls?.tunnel || state?.inviteUrls?.lan || '';root.querySelector('[data-action="copy-party-invite"]').disabled=!invite.value}
    this.live('inviteNote',invite?.value?'Send this link to your friends.':'')
    this.live('rosterNote',(players?.length || 0)<2?'Waiting for players to join.':'')
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
        if (action === 'create-party') {
          await this.screens.actions.partyHost({name})
        }
        else {
          const invite = parsePartyInvite(this.invite, this.relay)
          this.invite = invite.code; this.relay = invite.relay || ''
          this.screens.root.querySelector('[data-party-field="invite"]').value = this.invite
          await this.screens.actions.partyJoin({...invite, name})
        }
      } else if (action === 'party-ready') {
        const id = this.state?.playerId || this.state?.localPlayerId || (this.state?.role === 'host' ? this.state?.hostId : null)
        const ready=!partyPlayers(this.state).find(p => p.id === id)?.ready
        if(ready && !this.screens.settings.controlsSeen)await this.screens.enterMatch(()=>this.screens.actions.partyReady(true),this.screens.route)
        else await this.screens.actions.partyReady(ready)
      } else if (action === 'party-start') {
        if(!this.state?.code || !['connected','lobby','ready'].includes(this.state.status)){await this.action('create-party');return true}
        await this.screens.enterMatch(async()=>{
          if(!await this.screens.actions.partyStart(this.override))throw new Error('Start unavailable')
        })
      }
    } catch (error) { this.error = error.code ? partyErrorMessage(error) : error.message }
    this.refresh()
    return true
  }
  dispose() { this.screens.root.removeEventListener('input', this.onInput); this.screens.root.removeEventListener('submit', this.onSubmit) }
}
