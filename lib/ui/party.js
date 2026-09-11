// UI boundary only. Party transport remains owned by GameManager.
export function parsePartyInvite(value, relay = '') {
  let code = String(value || '').trim()
  if (code.includes('?') || /^https?:/i.test(code)) {
    let invite
    try { invite = new URL(code, 'https://invite.invalid/') } catch { throw partyError('bad_code') }
    code = invite.searchParams.get('party') || ''
    relay = invite.searchParams.get('relay') || relay
  }
  code = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) throw partyError('bad_code')
  relay = String(relay || '').trim()
  if (relay) {
    let url
    try { url = new URL(relay) } catch { throw partyError('bad_relay') }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw partyError('bad_relay')
    url.protocol = ['https:', 'wss:'].includes(url.protocol) ? 'wss:' : 'ws:'
    relay = url.href.replace(/\/$/, '')
  }
  return {code, relay: relay || undefined}
}

const ERRORS = {
  bad_code: 'Bad party code. Enter six letters or numbers, or paste the full invite link.',
  bad_relay: 'Invalid relay address. Use the ws:// or wss:// address from your host.',
  relay_unreachable: 'Relay unreachable. Check the address and ask the host to keep the relay or tunnel running.',
  party_full: 'Party full. All three slots are occupied. Ask the host to free a slot.',
  host_left: 'Host left. This party has ended. Host a new party or join another invite.',
  party_not_found: 'Party not found. Check the code and ask the host for a fresh invite.',
  unavailable: 'Party service is unavailable in this build. Solo Play is still available.',
}
export function partyError(code) { return Object.assign(new Error(ERRORS[code] || code), {code}) }
export function partyErrorMessage(error) {
  const code = String(error?.code || error?.error?.code || error?.message || error || '').toLowerCase().replaceAll('-', '_')
  if (ERRORS[code]) return ERRORS[code]
  if (/full|capacity/.test(code)) return ERRORS.party_full
  if (/host.*(left|disconnect|closed)/.test(code)) return ERRORS.host_left
  if (/not.found|unknown.party/.test(code)) return ERRORS.party_not_found
  if (/code|invalid.party/.test(code)) return ERRORS.bad_code
  if (/network|fetch|socket|timeout|connect|unreachable/.test(code)) return ERRORS.relay_unreachable
  return 'Could not connect to the party. Check your invite and try again.'
}

export function partyPlayers(state = {}) {
  const players = state.players instanceof Map ? [...state.players.values()] : Array.isArray(state.players) ? state.players : Object.values(state.players || {})
  return players.map(player => ({...player, ready: player.ready ?? state.ready?.[player.id] ?? false}))
}

export class PartySession {
  constructor(manager, changed) {
    this.manager = manager
    this.changed = changed
    this.state = null
    this.active = true
    this.operation = 0
    this.receive = state => {
      if (!this.active || !state) return
      this.state = {...this.state, ...(state.detail || state)}
      this.changed(this.state)
    }
    this.unsubscribe = manager.onPartyState?.(this.receive)
    manager.addEventListener?.('party-state', this.receive)
  }
  sync() {
    const state = this.manager.partyState
    if (state && state !== this.lastState) { this.lastState = state; this.receive(state) }
  }
  async connect(role, options) {
    const operation = ++this.operation
    const method = role === 'host' ? 'startHost' : 'joinParty'
    this.state = {role, status: 'connecting', players: []}
    this.changed(this.state)
    try {
      if (typeof this.manager[method] !== 'function') throw partyError('unavailable')
      const result = await this.manager[method](options)
      if (!this.active || operation !== this.operation) return
      if (result?.ok === false || result?.error) throw result.error || result
      this.receive({...result, ...this.manager.partyState, role, status: this.manager.partyState?.status || result?.status || 'connected'})
    } catch (error) {
      if (this.active && operation === this.operation) this.receive({status: 'error', error: partyErrorMessage(error)})
    }
  }
  async ready(value) {
    if (typeof this.manager.setPartyReady !== 'function') throw partyError('unavailable')
    return this.manager.setPartyReady(value)
  }
  async start(override) {
    const players = partyPlayers(this.state)
    if (this.state?.role !== 'host' || !players.length || (!override && !players.every(p => p.ready))) return false
    if (typeof this.manager.startMatch !== 'function') throw partyError('unavailable')
    const result = await this.manager.startMatch({override})
    if (result?.ok === false || result?.error) throw result.error || result
    return true
  }
  leave() {
    ++this.operation
    if (this.state) this.manager.leaveParty?.()
    this.state = null
  }
  dispose() {
    this.active = false
    ++this.operation
    if (typeof this.unsubscribe === 'function') this.unsubscribe()
    this.manager.removeEventListener?.('party-state', this.receive)
  }
}
