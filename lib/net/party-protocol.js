export const PARTY_RULES = Object.freeze({
  tickRate: 60,
  snapshotRate: 20,
  interpolationMs: 100,
  maxPlayers: 3,
  disconnectGraceMs: 10_000,
})

export class PartyEvents {
  constructor() { this.listeners = new Map() }

  on(type, listener) {
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    return () => listeners.delete(listener)
  }

  addEventListener(type, listener) { return this.on(type, listener) }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener) }

  emit(type, detail) {
    for (const listener of this.listeners.get(type) || []) listener({type, detail})
  }

  clear() { this.listeners.clear() }
}

export function partySocketUrl(relay, code, role) {
  const normalizedCode = normalizePartyCode(code)
  const url = relayUrl(relay)
  const pathMatch = url.pathname.match(/^\/party\/([A-Z0-9]{6})\/?$/i)
  if (pathMatch && pathMatch[1].toUpperCase() !== normalizedCode) throw new Error('relay URL contains a different party code')
  if (!pathMatch) url.pathname = `${url.pathname.replace(/\/$/, '')}/party/${normalizedCode}`
  url.searchParams.set('role', role)
  return url.toString()
}

export function partyInviteEndpoint(relay, code) {
  const normalizedCode = normalizePartyCode(code)
  const url = relayUrl(relay)
  if (url.protocol === 'ws:') url.protocol = 'http:'
  if (url.protocol === 'wss:') url.protocol = 'https:'
  url.pathname = `/party/${normalizedCode}/invite`
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function normalizePartyCode(value) {
  const code = String(value || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error('party code must be six letters or numbers')
  return code
}

export function createPartyCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const bytes = new Uint8Array(6)
  globalThis.crypto?.getRandomValues?.(bytes)
  let code = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const value = globalThis.crypto?.getRandomValues ? bytes[index] : Math.floor(Math.random() * 256)
    code += chars[value % chars.length]
  }
  return code
}

export function createResumeToken() {
  const bytes = new Uint8Array(18)
  globalThis.crypto?.getRandomValues?.(bytes)
  if (!globalThis.crypto?.getRandomValues) for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function defaultPartyRelay() {
  const query = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('partyRelay')
  return query || globalThis.PARTY_RELAY_URL || 'ws://localhost:7801'
}

export function sendPartyMessage(socket, message) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(message))
}

export function parsePartyMessage(event) {
  try {
    const message = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
    return message && typeof message === 'object' && !Array.isArray(message) && typeof message.type === 'string' ? message : null
  } catch {
    return null
  }
}

function relayUrl(value) {
  const url = new URL(String(value || defaultPartyRelay()))
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('party relay must use ws, wss, http, or https')
  return url
}
