import {mkdir, writeFile} from 'node:fs/promises'
import {deflateSync} from 'node:zlib'
import {createEffectsAtlas} from '../../lib/view/v2/effects-textures.js'
const {data, width, height} = createEffectsAtlas()
function chunk(type, bytes) {
  const label = Buffer.from(type), all = Buffer.concat([label, bytes])
  let crc = 0xffffffff
  for (const b of all) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  const head = Buffer.alloc(4), tail = Buffer.alloc(4)
  head.writeUInt32BE(bytes.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([head, all, tail])
}
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
const rows = Buffer.alloc(height * (width * 4 + 1))
for (let y = 0; y < height; y++) rows.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, {level: 9})), chunk('IEND', Buffer.alloc(0))])
const dir = new URL('../../assets/v2/effects/', import.meta.url)
await mkdir(dir, {recursive:true})
await writeFile(new URL('particles.png', dir), png)
await writeFile(new URL('provenance.json', dir), JSON.stringify({asset:'particles.png', origin:'Original mathematical density fields and flame profiles generated for this project; no external image inputs', builder:'tools/v2/build-effects.mjs', dimensions:[width,height], tiles:['smoke 0','smoke 1','smoke 2','smoke 3','flame 0','flame 1','flame 2','spark'], license:'Project-owned original procedural artwork'}, null, 2) + '\n')
console.log(`Built particles.png: ${width} x ${height}, ${png.length} bytes`)
