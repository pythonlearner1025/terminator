#!/usr/bin/env node
import {spawn, spawnSync} from 'node:child_process'

const portIndex = process.argv.indexOf('--port')
const port = Number(process.env.PORT || (portIndex >= 0 ? process.argv[portIndex + 1] : 7801))
const origin = `http://127.0.0.1:${port}`

const installed = spawnSync('cloudflared', ['version'], {stdio: 'ignore'}).status === 0
if (!installed) {
  console.error('cloudflared is required for a no-account Quick Tunnel.')
  console.error('macOS: brew install cloudflared')
  console.error('Other platforms: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
  process.exit(1)
}

console.log(`Starting a no-account Cloudflare Quick Tunnel to ${origin}`)
const child = spawn('cloudflared', ['tunnel', '--url', origin], {stdio: ['ignore', 'pipe', 'pipe']})
let announced = false
let buffered = ''

for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    process.stderr.write(chunk)
    buffered = `${buffered}${chunk}`.slice(-16_384)
    const match = buffered.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/i)
    if (match && !announced) announce(match[0])
  })
}

async function announce(httpUrl) {
  announced = true
  const relayUrl = httpUrl.replace(/^https:/, 'wss:')
  console.log(`Public relay URL: ${relayUrl}`)
  const gameUrl = await publishedGameUrl()
  if (gameUrl) {
    console.log(`Host from the published game with this link (the host must use the tunnel too, browsers block a public page from reaching localhost):`)
    console.log(`  ${gameUrl}?relay=${encodeURIComponent(relayUrl)}`)
  }
  try {
    const response = await fetch(`${origin}/api/party/tunnel`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: httpUrl}),
    })
    if (!response.ok) console.error(`Lobby server did not register the tunnel URL (${response.status}).`)
  } catch {
    console.error(`Lobby server is not reachable at ${origin}. Start it with npm run server, then restart this tunnel.`)
  }
}

async function publishedGameUrl() {
  try {
    const {readFile} = await import('node:fs/promises')
    const deploys = JSON.parse(await readFile(new URL('../.kite3d/deploys.json', import.meta.url), 'utf8'))
    const entry = Array.isArray(deploys) ? deploys[0] : (deploys.deploys?.[0] || deploys)
    const url = entry?.preview_url || entry?.url || null
    return url ? String(url).replace(/\/$/, '') : null
  } catch {
    return null
  }
}

child.once('error', (error) => {
  console.error(`Unable to start cloudflared: ${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  if (!announced && code !== 0) console.error('cloudflared stopped before publishing a relay URL.')
  if (signal) console.error(`cloudflared stopped after ${signal}.`)
  process.exitCode = code || 0
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
