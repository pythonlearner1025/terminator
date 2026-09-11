export class SeededRng {
  constructor(seed = 1) {
    this.state = Number(seed) >>> 0 || 1
  }

  next() {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state / 0x100000000
  }

  range(min, max) {
    return min + (max - min) * this.next()
  }
}
