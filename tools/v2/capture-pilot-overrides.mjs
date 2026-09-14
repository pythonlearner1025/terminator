import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'

/** Diagnostic browser-only routing; never writes worker files into this checkout. */
export function loadPilotOverrides(specification = process.env.CAPTURE_PILOT_OVERRIDES) {
  if (!specification) return null
  const requested = JSON.parse(specification), files = new Map(), modules = []
  if (!requested || Array.isArray(requested) || typeof requested !== 'object') throw Error('Pilot overrides must map module owners to commit hashes')
  if (requested.smoke && !requested.lighting) throw Error('Smoke helper diagnostic requires an explicit lighting caller pin')
  // Smoke owns two helpers only; apply them after the lighting caller regardless
  // of JSON key order. It cannot replace interior controls or lighting assets.
  const entries=Object.entries(requested).sort(([a],[b])=>Number(a==='smoke')-Number(b==='smoke'))
  for (const [owner, revision] of entries) {
    if (!['architecture', 'materials', 'lighting', 'effects', 'ground', 'smoke'].includes(owner)) throw Error(`Unknown pilot module owner: ${owner}`)
    if (typeof revision !== 'string' || !/^[a-f0-9]{7,40}$/.test(revision)) throw Error('Pilot revision must be a commit hash')
    const commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {encoding: 'utf8'}).trim()
    const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', commit, 'lib/view/v2', `assets/v2/${owner}`], {encoding: 'utf8'}).trim().split('\n')
    const owned = owner==='smoke' ? tree.filter(file=>['lib/view/v2/lighting-volume.js','lib/view/v2/lighting-noise.js'].includes(file)) : tree.filter(file => file.startsWith(`assets/v2/${owner}/`) || file === `lib/view/v2/${owner}.js` || file.startsWith(`lib/view/v2/${owner}-`))
    if (owner==='smoke' ? owned.length!==2 : !owned.includes(`lib/view/v2/${owner}.js`)) throw Error(`Pilot commit has no complete ${owner} module`)
    const hashes = {}
    for (const file of owned) {
      const body = execFileSync('git', ['show', `${commit}:${file}`], {maxBuffer: 64 * 1024 * 1024})
      hashes[file] = createHash('sha256').update(body).digest('hex')
      files.set(file, body)
    }
    modules.push({owner, commit, sourceFiles: hashes})
  }
  if (!modules.length) throw Error('Pilot overrides must contain at least one module')
  const mime = file => ({js: 'text/javascript', json: 'application/json', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gltf: 'model/gltf+json', glb: 'model/gltf-binary'}[file.split('.').pop()] || 'application/octet-stream')
  return {
    manifest: {purpose: 'Diagnostic only; browser module overrides, not an integrated or accepted commit', modules},
    async install(page) {
      if (requested.ground) {
        if (!requested.architecture) throw Error('Ground diagnostic requires a paired architecture override without a broad field')
      }
      await page.route('**/files/**', async route => {
        const file = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/files\//, '')
        const body = files.get(file)
        if (body) await route.fulfill({status: 200, contentType: mime(file), body})
        else await route.continue()
      })
    },
  }
}
