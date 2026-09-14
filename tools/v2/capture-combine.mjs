/** Assemble disjoint fixed-view runs only when their source/config provenance is identical. */
import assert from 'node:assert/strict'
import {readFile, mkdir, writeFile, copyFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve, relative} from 'node:path'
import {pathToFileURL} from 'node:url'

export async function combineCaptures(output, inputs) {
  assert(inputs.length >= 2, 'At least two disjoint capture runs required')
  const records = [], views = new Map()
  let common
  for (const input of inputs) {
    const path = resolve(input), bytes = await readFile(resolve(path, 'capture.json'))
    const manifest = JSON.parse(bytes), {views: captured, ...provenance} = manifest
    assert(!manifest.captureSources, 'Use original captures, not nested assemblies')
    if (common) assert.deepEqual(provenance, common, 'Capture source/config provenance differs')
    else common = provenance
    assert(Array.isArray(captured) && captured.length, 'Empty capture run')
    for (const view of captured) {
      assert(common.config.views.some(item => item.id === view.id), 'Unknown view')
      assert(!views.has(view.id), 'Duplicate view')
      assert.deepEqual(view.errors, [], 'Capture contains runtime errors')
      const png = await readFile(resolve(path, view.id + '.png'))
      assert.equal(createHash('sha256').update(png).digest('hex'), view.sha256, 'PNG hash mismatch')
      views.set(view.id, {view, path})
    }
    records.push({directory: relative(process.cwd(), path), manifestSha256: createHash('sha256').update(bytes).digest('hex')})
  }
  assert.equal(views.size, common.config.views.length, 'Incomplete fixed-view set')
  // All source, image and completeness checks happen before creating any output.
  await mkdir(resolve(output))
  const ordered = common.config.views.map(item => views.get(item.id))
  for (const {view, path} of ordered) await copyFile(resolve(path, view.id + '.png'), resolve(output, view.id + '.png'))
  await writeFile(resolve(output, 'capture.json'), JSON.stringify({...common, views: ordered.map(item => item.view), captureSources: records}, null, 2) + '\n')
  return records
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await combineCaptures(process.argv[2], process.argv.slice(3))
  console.log('Combined complete capture set; exact source/config and PNG hashes verified')
}
