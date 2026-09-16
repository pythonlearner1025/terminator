import {readFile, readdir, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {serverFixture, digest} from '../test/helpers/kite3d-server-fixture.js'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'

const mode = process.argv[2] || '--patched'
if (!['--baseline', '--patched'].includes(mode)) throw new Error('Usage: node tools/kite3d-put-probe.mjs [--baseline|--patched]')
const fixture = await serverFixture({patched: mode === '--patched'})
try {
  for (const [size, transfer] of [[100, 'fixed'], [376506, 'fixed'], [376506, 'chunked'], [2 * 1024 * 1024, 'fixed']]) {
    const name = `probe-${size}-${transfer}.bin`
    const body = Buffer.alloc(size)
    for (let i = 0; i < size; i++) body[i] = i % 251
    const expectedHash = createHash('sha256').update(body).digest('hex')
    const controller = new AbortController()
    const start = performance.now()
    // Snapshot the temporary file BEFORE abort cleanup can remove it.
    const timeout = setTimeout(async () => {
      try {
        const files = (await readdir(fixture.root)).filter(file => file.includes(name))
        for (const file of files) console.log(JSON.stringify({mode, size, transfer, pendingFile: file, bytes: (await stat(join(fixture.root, file))).size}))
      } finally {controller.abort()}
    }, 4500)
    try {
      async function* chunks() {
        for (let i = 0; i < body.length; i += 8192) {
          yield body.subarray(i, i + 8192)
          await delay(2)
        }
      }
      const response = await fetch(`${fixture.origin}/files/${name}`, {
        method: 'PUT', headers: fixture.headers, body: transfer === 'chunked' ? chunks() : body,
        ...(transfer === 'chunked' ? {duplex: 'half'} : {}), signal: controller.signal,
      })
      const result = await response.json()
      const exact = response.status === 201 && result.sha256 === expectedHash
        && await digest(join(fixture.root, name)) === expectedHash
        && (await readFile(join(fixture.root, name))).equals(body)
      console.log(JSON.stringify({mode, node: process.version, size, transfer, status: response.status, exact, ms: Math.round(performance.now() - start)}))
      if (!exact) process.exitCode = 1
    } catch (error) {
      console.log(JSON.stringify({mode, node: process.version, size, transfer, error: error.name, ms: Math.round(performance.now() - start)}))
      process.exitCode = 1
    } finally {clearTimeout(timeout)}
  }
} finally {await fixture.close()}
