// The published game boots through `createGame` on a generated index.html.
// This builds that page and serves it straight from the project directory, so
// the real project files run without the editor. Nothing is written into the
// repository. `tools/play.mjs` and `tools/stress-frames.mjs --mode=standalone`
// both boot the game this way, so what a measurement sees is what a player
// sees.
import {createReadStream} from 'node:fs'
import {access, readFile, stat} from 'node:fs/promises'
import {createServer} from 'node:http'
import {extname, join, normalize} from 'node:path'

const RUNTIME_PATH = '/_blitz/runtime.js'
const RUNTIME_FILE = 'node_modules/@kite3d/engine/dist/runtime.js'

// `createGame` reads the boot scene from the project's package.json `mainScene`
// field, so a different scene means a different package.json. The file on disk
// never changes: the server answers `/package.json` with this copy instead.
export async function packageJsonWithScene(projectDir, scene) {
  const packageJson = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
  return `${JSON.stringify({...packageJson, mainScene: scene}, null, 2)}\n`
}

export async function buildStandaloneHtml(projectDir) {
  const packageJson = JSON.parse(await readFile(join(projectDir, 'package.json'), 'utf8'))
  const engine = JSON.parse(await readFile(join(projectDir, 'node_modules/@kite3d/engine/package.json'), 'utf8'))
  const shared = ['threepipe', 'three', 'uiconfig.js', 'ts-browser-helpers', '@kite3d/engine']
  const imports = Object.fromEntries(shared.map(key => [key, `.${RUNTIME_PATH}`]))
  const external = [...shared]
  for (const [key, version] of Object.entries(packageJson.dependencies || {})) {
    if (shared.includes(key) || String(version).startsWith('file:')) continue
    imports[key] = `https://esm.sh/${key}@${String(version).replace(/^[\^~]/, '')}?external=${external.join(',')}`
  }
  Object.assign(imports, packageJson.kite3d?.imports || {})
  // Without a declared icon the browser asks for /favicon.ico and logs a 404.
  const icon = await access(join(projectDir, 'icon.svg')).then(() => true, () => false)
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<title>${packageJson.kite3d?.name || packageJson.name}</title>`
    + (icon ? `<link rel="icon" href="./icon.svg">` : '')
    + `<meta name="kite3d-runtime" content="${engine.version} local">`
    + `<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block;width:100%;height:100%}</style>`
    + `<script type="importmap">${JSON.stringify({imports})}</script></head>`
    + `<body><canvas id="kite3d-canvas"></canvas>`
    + `<script type="module">import {createGame} from '.${RUNTIME_PATH}';`
    + `createGame({base: new URL('./', location.href).href, canvas: document.getElementById('kite3d-canvas')})`
    + `.then(() => {window.__standaloneReady = true}).catch(error => {window.__standaloneError = String(error)});</script></body></html>`
}

// Resolves to the listening server plus the URL it answers on. Pass port 0 to
// let the operating system choose a free port; `url` then carries the real one.
// `scene` is a project-relative path; without it the project's own package.json
// is served, so the boot scene stays the one the project names.
export async function createStandaloneServer({projectDir, port = 0, host = '127.0.0.1', scene = null}) {
  const html = await buildStandaloneHtml(projectDir)
  const packageJson = scene ? await packageJsonWithScene(projectDir, scene) : null
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname)
    if (path === '/' || path === '/index.html') return send(response, 200, 'text/html', html)
    if (packageJson && path === '/package.json') return send(response, 200, 'application/json', packageJson)
    const file = path === RUNTIME_PATH
      ? join(projectDir, RUNTIME_FILE)
      : join(projectDir, normalize(path).replace(/^(\.\.[/\\])+/, ''))
    try {
      const info = await stat(file)
      if (!info.isFile()) throw new Error('not a file')
      response.writeHead(200, {'content-type': mime(file), 'content-length': info.size, 'access-control-allow-origin': '*'})
      createReadStream(file).pipe(response)
    } catch { send(response, 404, 'text/plain', 'not found') }
  })
  await new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(port, host, () => { server.removeListener('error', fail); done() })
  })
  return {
    server, html, scene,
    url: `http://${host}:${server.address().port}/`,
    // A browser holds its connection open, so the listener alone never closes.
    close: () => new Promise(done => { server.closeAllConnections?.(); server.close(done) }),
  }
}

export function send(response, status, type, body) {
  response.writeHead(status, {'content-type': type, 'content-length': Buffer.byteLength(body), 'access-control-allow-origin': '*'})
  response.end(body)
}

export function mime(file) {
  return {'.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.gltf': 'model/gltf+json',
    '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
    '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream',
    '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.css': 'text/css',
    '.svg': 'image/svg+xml', '.html': 'text/html'}[extname(file).toLowerCase()] || 'application/octet-stream'
}
