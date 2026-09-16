#!/usr/bin/env node
// Register only files present on disk. Reference-only registrations require an explicit local flag.
import {readFile, writeFile, readdir} from 'node:fs/promises'
import {resolve, relative, dirname, basename, join} from 'node:path'
import {pathToFileURL} from 'node:url'
export async function registerCandidates({references = false} = {}) {
  const root = resolve(import.meta.dirname, '..')
  const path = join(root, 'assets.json')
  const registry = JSON.parse(await readFile(path, 'utf8'))
  for (const key of Object.keys(registry.files)) if (key.startsWith('candidate-')) delete registry.files[key]
  const candidates = []
  for (const base of ['assets/models/weapons-candidates', ...(references ? ['assets/reference/weapons'] : [])]) {
    const entries = await readdir(join(root, base), {recursive: true}).catch(() => [])
    for (const entry of entries.filter(file => file.endsWith('.gltf')).sort()) {
      const file = join(root, base, entry), folder = dirname(file)
      const report = JSON.parse(await readFile(join(folder, 'conversion.json'), 'utf8'))
      const parts = entry.split('/'), weapon = parts[0], slug = parts[1]
      const id = `candidate-${weapon}-${slug}`, name = `Candidate ${weapon} ${slug}`
      const doc = JSON.parse(await readFile(file, 'utf8'))
      const files = {[basename(file)]: relative(root, file)}
      for (const item of [...(doc.buffers || []), ...(doc.images || [])]) {
        if (!item.uri || item.uri.startsWith('data:')) continue
        files[item.uri] = relative(root, resolve(folder, decodeURIComponent(item.uri)))
        await readFile(join(root, files[item.uri]))
      }
      registry.files[id] = {path: relative(root, file), files, candidate: {
        name, weapon, slug, shippable: report.shippable, triangles: report.triangles,
      }}
      candidates.push({id, file: basename(file), name, weapon, shippable: report.shippable})
    }
  }
  await writeFile(path, JSON.stringify(registry, null, 2) + '\n')
  return candidates
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const candidates = await registerCandidates({references: process.argv.includes('--references')})
  console.log(`Registered ${candidates.length} weapon candidates. Run npm run scene:lab to place them.`)
}
