export class EventBus {
  constructor({historyLimit = Infinity} = {}) {
    this.historyLimit = historyLimit
    this.history = []
    this.listeners = new Map()
  }

  on(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('event listener must be a function')
    const listeners = this.listeners.get(type) || new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
    return () => this.off(type, listener)
  }

  subscribe(listener) {
    return this.on('*', listener)
  }

  off(type, listener) {
    const listeners = this.listeners.get(type)
    if (!listeners) return false
    const removed = listeners.delete(listener)
    if (listeners.size === 0) this.listeners.delete(type)
    return removed
  }

  emit(event) {
    const snapshot = structuredClone(event)
    this.history.push(snapshot)
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit)
    for (const listener of this.listeners.get(snapshot.type) || []) listener(snapshot)
    for (const listener of this.listeners.get('*') || []) listener(snapshot)
    return snapshot
  }

  clear() {
    this.history.length = 0
  }
}
