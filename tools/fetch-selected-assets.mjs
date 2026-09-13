import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {cachedArchiveValid, fetchAssetJson as json} from './lib/asset-downloads.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const selection = JSON.parse(await readFile(resolve(root, 'assets/sources/selected-assets.json'), 'utf8'))
const models = process.argv.includes('--models')
if (process.argv.slice(2).some(arg => arg !== '--models')) throw new Error('Usage: node tools/fetch-selected-assets.mjs [--models]')

async function download(url, output, expectedMD5) {
  const source = new URL(url)
  if (source.protocol !== 'https:') throw new Error('Downloads must use HTTPS')
  const response = await fetch(source, {signal: AbortSignal.timeout(180000)})
  if (!response.ok) throw new Error(`Asset download returned HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const md5 = createHash('md5').update(bytes).digest('hex')
  if (expectedMD5 && md5 !== expectedMD5) throw new Error('Asset checksum mismatch')
  await mkdir(resolve(output, '..'), {recursive: true})
  const temporary = output + '.partial'
  try { await writeFile(temporary, bytes); await rename(temporary, output) }
  finally { await rm(temporary, {force: true}) }
  return {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')}
}

try {
  if (models) {
    const token = process.env.SKETCHFAB_API_TOKEN
    const unique = new Map(selection.assets.filter(a => a.provider === 'Sketchfab').map(a => [a.id, a]))
    const cache = resolve(root, '.kite3d/selected-downloads')
    let requested = false
    for (const asset of unique.values()) {
      if (await cachedArchiveValid(resolve(cache, `${asset.id}.zip`), asset)) {
        console.log(`Already downloaded and verified: ${asset.name} (${asset.id})`)
        continue
      }
      if (!token) throw new Error('Set SKETCHFAB_API_TOKEN locally to download the remaining Sketchfab models. Completed archives are saved. Do not put the token in Git or PR text.')
      // Pace new requests as well as backing off when the provider rate limits.
      if (requested) await sleep(5000)
      requested = true
      const data = await json(`https://api.sketchfab.com/v3/models/${asset.id}/download`, {Authorization: `Token ${token}`})
      if (!data.gltf?.url) throw new Error(`No glTF archive available for ${asset.id}`)
      const result = await download(data.gltf.url, resolve(cache, `${asset.id}.zip`))
      // Signed download URLs and credentials stay out of the receipt and logs.
      await writeFile(resolve(cache, `${asset.id}.json`), JSON.stringify({id: asset.id, source: asset.url, ...result}, null, 2) + '\n')
      console.log(`Downloaded ${asset.name} (${asset.id}) to the private integration cache`)
    }
    console.log('Archives downloaded. Models still require extraction, fitting, rig adaptation and scene integration.')
  } else {
    const floor = selection.assets.find(a => a.family === 'floor')
    if (floor.id !== 'hangar_concrete_floor' || floor.provider !== 'Poly Haven') throw new Error('Unexpected floor selection')
    const metadata = await json(`https://api.polyhaven.com/files/${floor.id}`)
    const resources = []
    for (const [channel, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor_gl'], ['arm', 'arm']]) {
      const format = metadata[channel]?.['1k']?.jpg
      if (!format?.url || !format.md5) throw new Error(`Missing verified 1K ${channel} map`)
      const path = `assets/textures/map/${floor.id}_${suffix}_1k.jpg`
      const result = await download(format.url, resolve(root, path), format.md5)
      resources.push({channel, path, url: format.url, md5: format.md5, ...result})
    }
    await writeFile(resolve(root, 'assets/sources/hangar-concrete-floor.json'), JSON.stringify({id: floor.id, source: floor.url, author: floor.author, license: 'CC0-1.0', tileSizeMeters: 2, resources}, null, 2) + '\n')
    console.log('Downloaded and verified all three Hangar Concrete Floor 1K maps.')
  }
} catch (error) {
  // Fetch errors can contain signed URLs; only emit our own sanitized messages.
  console.error(error instanceof TypeError ? 'Asset network request failed.' : error.message)
  process.exitCode = 1
}
