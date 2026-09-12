import {PartyEvents} from './party-protocol.js'

export const WEBRTC_CONNECT_FAILURE = 'Could not connect to the host. Both players may be behind strict NAT.'
export const WEBRTC_ICE_SERVERS = Object.freeze([
  Object.freeze({urls: 'stun:stun.cloudflare.com:3478'}),
  Object.freeze({urls: 'stun:stun.l.google.com:19302'}),
])

export class WebRtcTransport {
  constructor({
    role,
    signaling,
    RTCPeerConnection: RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
    connectTimeoutMs = 15_000,
    iceServers = WEBRTC_ICE_SERVERS,
  } = {}) {
    if (role !== 'host' && role !== 'guest') throw new Error('WebRTC role must be host or guest')
    if (!signaling) throw new Error('WebRTC transport requires signaling')
    if (!RTCPeerConnectionImpl) throw new Error('RTCPeerConnection is not available')
    this.role = role
    this.signaling = signaling
    this.RTCPeerConnection = RTCPeerConnectionImpl
    this.connectTimeoutMs = connectTimeoutMs
    this.configuration = {iceServers: iceServers.map(server => ({...server}))}
    this.events = new PartyEvents()
    this.peers = new Map()
    this.offs = []
    this.closed = false
    this.started = false
  }

  on(type, listener) { return this.events.on(type, listener) }
  addEventListener(type, listener) { return this.events.addEventListener(type, listener) }
  removeEventListener(type, listener) { this.events.removeEventListener(type, listener) }

  start() {
    if (this.started) return this
    this.started = true
    this.closed = false
    this.offs.push(this.signaling.on('signal', event => this.receiveSignal(event.detail)))
    this.offs.push(this.signaling.on('peer-left', event => this.closePeer(event.detail.peerId, 'peer left')))
    this.offs.push(this.signaling.on('room-closed', event => {
      this.events.emit('room-closed', event.detail)
      this.close({closeSignaling: false})
    }))
    this.offs.push(this.signaling.on('close', event => {
      if (!event.detail.expected) this.events.emit('error', new Error(event.detail.reason || 'Party signaling connection closed.'))
    }))
    if (this.role === 'host') {
      this.offs.push(this.signaling.on('peer-joined', event => {
        if (event.detail.role === 'guest') void this.offerTo(event.detail.peerId)
      }))
      for (const peer of this.signaling.peerList()) if (peer.role === 'guest') void this.offerTo(peer.peerId)
    }
    return this
  }

  async offerTo(peerId) {
    if (this.closed || this.peers.has(peerId)) return
    try {
      const peer = this.createPeer(peerId, true)
      const offer = await peer.connection.createOffer()
      await peer.connection.setLocalDescription(offer)
      this.signaling.sendSignal(peerId, {sdp: peer.connection.localDescription})
    } catch (error) {
      this.failPeer(peerId, error)
    }
  }

  async receiveSignal({from, data} = {}) {
    if (this.closed || !from || !data) return
    try {
      let peer = this.peers.get(from)
      if (data.sdp) {
        if (!peer) {
          if (this.role !== 'guest' || data.sdp.type !== 'offer') return
          peer = this.createPeer(from, false)
        }
        await peer.connection.setRemoteDescription(data.sdp)
        await this.flushCandidates(peer)
        if (data.sdp.type === 'offer') {
          const answer = await peer.connection.createAnswer()
          await peer.connection.setLocalDescription(answer)
          this.signaling.sendSignal(from, {sdp: peer.connection.localDescription})
        }
      } else if (data.candidate) {
        if (!peer) {
          if (this.role !== 'guest') return
          peer = this.createPeer(from, false)
        }
        if (peer.connection.remoteDescription) await peer.connection.addIceCandidate(data.candidate)
        else peer.pendingCandidates.push(data.candidate)
      }
    } catch (error) {
      this.failPeer(from, error)
    }
  }

  createPeer(peerId, initiator) {
    const connection = new this.RTCPeerConnection(this.configuration)
    const peer = {
      peerId,
      connection,
      channels: {reliable: null, state: null},
      pendingCandidates: [],
      opened: false,
      closed: false,
      timer: null,
    }
    this.peers.set(peerId, peer)
    peer.timer = setTimeout(() => this.failPeer(peerId, new Error(WEBRTC_CONNECT_FAILURE)), this.connectTimeoutMs)
    peer.timer.unref?.()
    connection.onicecandidate = event => {
      if (event.candidate) this.signaling.sendSignal(peerId, {candidate: event.candidate.toJSON?.() || event.candidate})
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') this.failPeer(peerId, new Error(WEBRTC_CONNECT_FAILURE))
      else if (connection.connectionState === 'closed') this.closePeer(peerId, 'connection closed')
    }
    if (initiator) {
      this.bindChannel(peer, connection.createDataChannel('reliable', {ordered: true}))
      this.bindChannel(peer, connection.createDataChannel('state', {ordered: false, maxRetransmits: 0}))
    } else {
      connection.ondatachannel = event => this.bindChannel(peer, event.channel)
    }
    return peer
  }

  bindChannel(peer, channel) {
    if (channel.label !== 'reliable' && channel.label !== 'state') {
      channel.close()
      return
    }
    peer.channels[channel.label] = channel
    channel.onopen = () => this.maybeOpen(peer)
    channel.onmessage = event => this.events.emit('message', {
      peerId: peer.peerId,
      channel: channel.label,
      data: typeof event.data === 'string' ? event.data : String(event.data),
    })
    channel.onerror = () => this.failPeer(peer.peerId, new Error(`${channel.label} data channel failed`))
    channel.onclose = () => {
      if (peer.opened) this.closePeer(peer.peerId, `${channel.label} data channel closed`)
    }
    this.maybeOpen(peer)
  }

  maybeOpen(peer) {
    if (peer.opened || peer.closed) return
    const bothOpen = peer.channels.reliable?.readyState === 'open' && peer.channels.state?.readyState === 'open'
    if (!bothOpen) return
    peer.opened = true
    clearTimeout(peer.timer)
    peer.timer = null
    this.events.emit('peer-open', {peerId: peer.peerId})
  }

  async flushCandidates(peer) {
    for (const candidate of peer.pendingCandidates.splice(0)) await peer.connection.addIceCandidate(candidate)
  }

  sendReliable(data, peerId) { return this.send('reliable', data, peerId) }
  sendState(data, peerId) { return this.send('state', data, peerId) }

  send(label, data, peerId) {
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()]
    let sent = 0
    for (const peer of targets) {
      const channel = peer?.channels[label]
      if (peer?.opened && channel?.readyState === 'open') {
        try {
          channel.send(text)
          sent += 1
        } catch (error) {
          this.events.emit('error', error)
        }
      }
    }
    return sent
  }

  openPeerIds() { return [...this.peers.values()].filter(peer => peer.opened).map(peer => peer.peerId) }

  failPeer(peerId, error) {
    const failure = error?.message === WEBRTC_CONNECT_FAILURE ? error : new Error(error?.message || WEBRTC_CONNECT_FAILURE)
    this.events.emit('error', failure)
    this.closePeer(peerId, failure.message)
  }

  closePeer(peerId, reason = 'peer closed') {
    const peer = this.peers.get(peerId)
    if (!peer || peer.closed) return
    peer.closed = true
    clearTimeout(peer.timer)
    for (const channel of Object.values(peer.channels)) {
      if (channel) {
        channel.onopen = channel.onmessage = channel.onerror = channel.onclose = null
        if (channel.readyState !== 'closed') channel.close()
      }
    }
    peer.connection.onicecandidate = null
    peer.connection.onconnectionstatechange = null
    peer.connection.ondatachannel = null
    peer.connection.close()
    this.peers.delete(peerId)
    this.events.emit('peer-close', {peerId, reason, opened: peer.opened})
  }

  close({closeSignaling = true} = {}) {
    if (this.closed) return
    this.closed = true
    for (const off of this.offs.splice(0)) off()
    for (const peerId of [...this.peers.keys()]) this.closePeer(peerId, 'transport closed')
    if (closeSignaling) this.signaling.close()
    this.started = false
  }
}
