import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, readFile, rm, access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {combineCaptures} from '../tools/v2/capture-combine.mjs'

test('capture assembly rejects changed sources and image bytes before output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'v2-captures-'))
  try {
    const inputs = ['first', 'second'].map(name => join(root, name))
    const png = Buffer.from('fixture bytes'), sha256 = createHash('sha256').update(png).digest('hex')
    const manifests = inputs.map((_, i) => ({git: 'fixed', config: {views: [{id: 'a'}, {id: 'b'}]}, views: [{id: i ? 'b' : 'a', errors: [], sha256}]}))
    for (const [i, path] of inputs.entries()) {
      await mkdir(path); await writeFile(join(path, 'capture.json'), JSON.stringify(manifests[i]))
      await writeFile(join(path, (i ? 'b' : 'a') + '.png'), png)
    }
    const output = join(root, 'combined')
    await writeFile(join(inputs[1], 'capture.json'), JSON.stringify({...manifests[1], git: 'different'}))
    await assert.rejects(combineCaptures(output, inputs), /provenance differs/)
    await assert.rejects(access(output), {code: 'ENOENT'})
    await writeFile(join(inputs[1], 'capture.json'), JSON.stringify(manifests[1]))
    await writeFile(join(inputs[1], 'b.png'), 'tampered')
    await assert.rejects(combineCaptures(output, inputs), /PNG hash mismatch/)
    await assert.rejects(access(output), {code: 'ENOENT'})
    await writeFile(join(inputs[1], 'b.png'), png)
    await combineCaptures(output, inputs)
    const actual = JSON.parse(await readFile(join(output, 'capture.json')))
    assert.deepEqual(actual.views.map(view => view.id), ['a', 'b'])
    assert.equal(actual.captureSources.length, 2)
    await assert.rejects(combineCaptures(output, inputs), {code: 'EEXIST'})
  } finally { await rm(root, {recursive: true, force: true}) }
})
