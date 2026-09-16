#!/usr/bin/env node
// Play the game the way a published release runs it: no editor, no dev server,
// the real project files booted through `createGame`.
//
//   npm run play
//   npm run play -- --port=4600 --no-open
//   npm run play -- --sandbox --weapon=revolver-rebuild
//
// Ctrl-C stops the server and exits 0.
import {spawn} from 'node:child_process'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {createStandaloneServer} from './standalone-page.mjs'

export const DEFAULT_PORT = 4500
// The query flags the game itself reads out of location.search.
export const QUERY_FLAGS = Object.freeze(['sandbox', 'range', 'weapon', 'party'])

const projectDir = fileURLToPath(new URL('../', import.meta.url))

export function parsePlayOptions(argv) {
  const options = {port: DEFAULT_PORT, host: '127.0.0.1', open: true, query: {}}
  const known = ['--port=<n>', '--no-open', ...QUERY_FLAGS.map(flag => `--${flag}[=<value>]`)].join(', ')
  for (const arg of argv) {
    const match = /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(arg)
    if (!match) throw new Error(`Unknown argument ${arg}. Known: ${known}`)
    const [, name, value] = match
    if (name === 'no-open') { options.open = false; continue }
    if (name === 'open') { options.open = value !== 'false'; continue }
    if (name === 'port') {
      const port = Number(value)
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port needs a port number, got ${value}`)
      options.port = port
      continue
    }
    // A bare --sandbox means the flag is on; the game only checks that the
    // value is not empty.
    if (QUERY_FLAGS.includes(name)) { options.query[name] = value ?? '1'; continue }
    throw new Error(`Unknown argument ${arg}. Known: ${known}`)
  }
  return options
}

export function playUrl(base, query = {}) {
  const url = new URL(base)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.href
}

export function openBrowser(url) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  const child = spawn(command, [url], {stdio: 'ignore', detached: true, shell: process.platform === 'win32'})
  child.on('error', () => { process.stderr.write(`Could not open a browser. Visit ${url}\n`) })
  child.unref()
  return child
}

export async function play(argv = process.argv.slice(2), {out = process.stdout} = {}) {
  const options = parsePlayOptions(argv)
  const served = await createStandaloneServer({projectDir, port: options.port, host: options.host})
  const url = playUrl(served.url, options.query)
  out.write(`Terminator is playable at ${url}\nPress Ctrl-C to stop.\n`)
  if (options.open) openBrowser(url)
  return {...served, url, options}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const session = await play()
    let stopping = false
    const stop = async () => {
      if (stopping) return
      stopping = true
      process.stdout.write('\nStopping.\n')
      await session.close()
      process.exit(0)
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`)
    process.exit(1)
  }
}
