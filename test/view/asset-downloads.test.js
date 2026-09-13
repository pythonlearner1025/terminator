import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {cachedArchiveValid, fetchAssetJson} from '../../tools/lib/asset-downloads.mjs'

test('resume skips only complete archives matching their source receipt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'selected-assets-'))
  const path = join(dir, 'model.zip'), asset = {id: 'model', url: 'https://sketchfab.com/models/model'}
  const bytes = Buffer.from('complete archive')
  try {
    assert.equal(await cachedArchiveValid(path, asset), false)
    await writeFile(path, bytes)
    await writeFile(join(dir, 'model.json'), JSON.stringify({...asset, source: asset.url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}))
    assert.equal(await cachedArchiveValid(path, asset), true)
    assert.equal(await cachedArchiveValid(path, {...asset, id: 'other'}), false)
    await writeFile(path, Buffer.from('corrupt archive!'))
    assert.equal(await cachedArchiveValid(path, asset), false)
  } finally { await rm(dir, {recursive: true, force: true}) }
})

test('429 waits for Retry-After before retrying metadata, without printing credentials', async () => {
  const waits = [], logs = [], requests = []
  const data = await fetchAssetJson('https://api.sketchfab.com/v3/models/id/download', {Authorization: 'Token private-test-token'}, {
    fetchImpl: async (_, options) => {
      requests.push(options)
      return requests.length === 1 ? new Response('', {status: 429, headers: {'Retry-After': '12'}}) : Response.json({gltf: {url: 'https://example.com/model.zip'}})
    },
    wait: async ms => waits.push(ms), log: text => logs.push(text),
  })
  assert.equal(data.gltf.url, 'https://example.com/model.zip')
  assert.deepEqual(waits, [12000])
  assert.equal(requests.length, 2)
  assert.ok(logs.every(line => !line.includes('private-test-token')))
})

test('long cooldowns report the server reset time without retrying early', async () => {
  let requests = 0
  await assert.rejects(fetchAssetJson('https://api.sketchfab.com', {}, {
    fetchImpl: async () => { requests++; return new Response('', {status: 429, headers: {'Retry-After': 'Sun, 13 Sep 2026 12:00:00 GMT'}}) },
    now: () => Date.parse('2026-09-13T11:00:00Z'), wait: async () => assert.fail('must not wait or retry early'),
  }), /Retry after 2026-09-13T12:00:00.000Z/)
  assert.equal(requests, 1)
})

test('persistent 429 without a reset header stops after bounded backoff', async () => {
  const waits = []
  await assert.rejects(fetchAssetJson('https://api.sketchfab.com', {}, {
    fetchImpl: async () => new Response('', {status: 429}),
    wait: async ms => waits.push(ms), log: () => {},
  }), /server did not specify a reset time/)
  assert.deepEqual(waits, [30000, 60000, 60000])
})
