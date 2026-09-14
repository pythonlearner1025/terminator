// Original procedural density atlas. Shared by the offline PNG builder and DOM-free tests.
export const EFFECTS_TILE_SIZE = 128
export const EFFECTS_ATLAS_COLUMNS = 4
export const EFFECTS_ATLAS_ROWS = 2
const clamp = x => Math.max(0, Math.min(1, x))
const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x) }
function hash(x, y, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177)
  n = Math.imul(n ^ n >>> 13, 1274126177)
  return ((n ^ n >>> 16) >>> 0) / 4294967295
}
function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), a = smooth(x - ix), b = smooth(y - iy)
  const p = hash(ix, iy, seed), q = hash(ix + 1, iy, seed)
  return (p + (q - p) * a) * (1 - b) + (hash(ix, iy + 1, seed) * (1 - a) + hash(ix + 1, iy + 1, seed) * a) * b
}
function fbm(x, y, seed) {
  return .52 * noise(x, y, seed) + .28 * noise(x * 2.07, y * 2.07, seed + 3) + .14 * noise(x * 4.13, y * 4.13, seed + 7) + .06 * noise(x * 8.2, y * 8.2, seed + 11)
}
export function createEffectsAtlas() {
  const size = EFFECTS_TILE_SIZE, width = size * 4, height = size * 2
  const data = new Uint8Array(width * height * 4)
  for (let tile = 0; tile < 8; tile++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size, v = (y + .5) / size, nx = u * 2 - 1, ny = v * 2 - 1
    let alpha, r = 255, g = 255, b = 255
    if (tile < 4) {
      const warp = fbm(u * 3, v * 3, tile + 41)
      const density = fbm(u * 6 + warp * 1.7, v * 6 - warp, tile + 103)
      const radius = Math.hypot(nx + (warp - .5) * .25, ny + (density - .5) * .18)
      alpha = smooth((.96 - radius) / .38) * smooth((density - .18) / .58) * .87
      // Low contrast interior density, with a little cold edge illumination.
      r = g = b = Math.round(170 + 85 * density)
    } else if (tile < 7) {
      const h = 1 - v, n = fbm(u * 6 + tile, v * 5, 61 + tile)
      const bend = Math.sin(h * 10 + tile) * .12 * h + (n - .5) * .17
      const widthAtHeight = .34 * Math.pow(1 - h, .8) + .025
      const body = smooth((widthAtHeight - Math.abs(nx - bend)) / .16)
      const tongues = smooth((n + .38 - h * .62) / .35)
      alpha = body * tongues * smooth((1 - h) / .12) * smooth(h / .08)
      r = 255; g = Math.round(105 + 112 * (1 - h)); b = Math.round(22 + 86 * Math.pow(1 - h, 3))
    } else {
      alpha = Math.exp(-nx * nx * 35 - ny * ny * 5) * smooth((1 - Math.abs(nx)) / .2) * smooth((1 - Math.abs(ny)) / .2)
    }
    // A transparent guard band survives mipmapping without neighboring tile bleed.
    alpha *= smooth(Math.min(u, v, 1 - u, 1 - v) * 24)
    const offset = (((tile >> 2) * size + y) * width + (tile % 4) * size + x) * 4
    data[offset] = r; data[offset + 1] = g; data[offset + 2] = b; data[offset + 3] = Math.round(clamp(alpha) * 255)
  }
  return {data, width, height}
}
