import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {request} from 'node:http'
import {readFile, readdir, stat} from 'node:fs/promises'
import {basename, dirname, join} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import * as nodeModule from 'node:module'
import {serverFixture} from '../helpers/kite3d-server-fixture.js'

const hash = body => createHash('sha256').update(body).digest('hex')
const pattern = size => Buffer.from(Array.from({length: size}, (_, i) => i % 251))

for (const source of [false, true]) {
  test(`real installed server PUT (${source ? 'TypeScript source' : 'dist'})`, {
    timeout: 30_000,
    skip: source && !nodeModule.stripTypeScriptTypes ? 'Source execution needs Node 22.13+' : false,
  }, async t => {
    const f = await serverFixture({source})
    t.after(() => f.close())
    async function put(path, body, headers = {}, extra = {}) {
      return fetch(`${f.origin}/files/${path}`, {
        method: 'PUT', headers: {...f.headers, ...headers}, body,
        signal: AbortSignal.timeout(4000), ...extra,
      })
    }
    async function assertSaved(path, body, status = 201, headers = {}, extra = {}) {
      const response = await put(path, body, headers, extra)
      assert.equal(response.status, status)
      const result = await response.json()
      const disk = await readFile(join(f.root, path))
      assert.equal(result.sha256, hash(disk))
      assert.deepEqual(disk, body)
      assert.equal((await readdir(join(f.root, dirname(path)))).some(name => name.startsWith(`.${basename(path)}.kite3d-`)), false)
      return result
    }

    await t.test('100 bytes, exact scene size, and multi-megabyte PUT complete with exact bytes/hash', async () => {
      for (const size of [0, 100, 376506, 2 * 1024 * 1024]) {
        await assertSaved(`assets/probe-${size}.bin`, pattern(size))
      }
    })

    await t.test('paced scene-sized chunked request without Content-Length crosses backpressure boundaries', async () => {
      const expected = pattern(376506)
      async function* chunks() {
        for (let i = 0; i < expected.length; i += 8192) {
          yield expected.subarray(i, i + 8192)
          await delay(2)
        }
      }
      const response = await put('assets/chunked.bin', chunks(), {}, {duplex: 'half'})
      assert.equal(response.status, 201)
      assert.equal((await response.json()).sha256, hash(expected))
      assert.deepEqual(await readFile(join(f.root, 'assets/chunked.bin')), expected)
    })

    await t.test('repeat and concurrent uploads settle; overwrite uses exact If-Match hash', async () => {
      const body = pattern(376506)
      await Promise.all([0, 1, 2].map(i => assertSaved(`parallel-${i}.bin`, body)))
      for (let i = 0; i < 3; i++) {
        await assertSaved('parallel-0.bin', body, 200, {'If-Match': `"${hash(body)}"`})
      }
    })

    await t.test('auth, optimistic preconditions, protected paths and atomic failure leave bytes intact', async () => {
      const path = 'assets/probe-376506.bin', before = await readFile(join(f.root, path))
      for (const [headers, status] of [
        [{'X-Kite3D-Token': 'invalid'}, 401],
        [{'If-Match': '"wrong-hash"'}, 412],
        [{'If-Match': ''}, 412],
      ]) {
        const response = await put(path, Buffer.from('replacement'), headers)
        assert.equal(response.status, status)
        await response.text()
      }
      const protectedResponse = await put('.kite3d/dev.json', Buffer.from('{}'))
      assert.equal(protectedResponse.status, 403)
      await protectedResponse.text()
      assert.deepEqual(await readFile(join(f.root, path)), before)
    })

    await t.test('disconnect mid-upload cleans temporary file and preserves previous target', async () => {
      const path = 'abort.bin', before = Buffer.from('existing authored bytes')
      await assertSaved(path, before)
      const req = request(`${f.origin}/files/${path}`, {method: 'PUT', headers: {...f.headers, 'Content-Length': 376506}})
      req.on('error', () => {})
      req.write(pattern(100000))
      try {
        let written = false
        for (let i = 0; i < 150; i++) {
          const temporary = (await readdir(f.root)).find(name => name.startsWith('.abort.bin.kite3d-'))
          if (temporary && (await stat(join(f.root, temporary))).size > 0) {written = true; break}
          await delay(10)
        }
        assert.ok(written, 'partial upload must reach the temporary file before disconnect')
      } finally {req.destroy()}
      let leftovers = []
      for (let i = 0; i < 150; i++) {
        leftovers = (await readdir(f.root)).filter(name => name.startsWith('.abort.bin.kite3d-'))
        if (!leftovers.length) break
        await delay(10)
      }
      assert.deepEqual(leftovers, [])
      assert.deepEqual(await readFile(join(f.root, path)), before)
      await assertSaved(path, Buffer.from('successful retry'), 200)
    })

    await t.test('scene-sized JSON saves stable edits and completes the journal before responding', async () => {
      const path = 'assets/main.scene.gltf'
      const scene = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [
        {name: 'Moved prop', translation: [4, 2, 1], extras: {gltfUUID: 'stable-prop-id'}},
      ]}
      const body = Buffer.from(JSON.stringify(scene).padEnd(376506, ' '))
      await assertSaved(path, body, 201, {'X-Kite3D-Client': 'regression-client'})
      assert.deepEqual(JSON.parse(await readFile(join(f.root, path), 'utf8')), scene)
      const journal = (await readFile(join(f.root, '.kite3d/journal.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
      assert.ok(journal.some(entry => entry.client === 'regression-client'))
    })
  })
}
