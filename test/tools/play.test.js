import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {DEFAULT_PORT, QUERY_FLAGS, parsePlayOptions, playUrl, play} from '../../tools/play.mjs'

const projectDir = fileURLToPath(new URL('../../', import.meta.url))

test('npm run play is a script that points at the play tool', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(packageJson.scripts.play, 'node tools/play.mjs')
})

test('the flags are the port, the browser, and the query flags the game reads', () => {
  assert.equal(parsePlayOptions([]).port, DEFAULT_PORT)
  assert.equal(DEFAULT_PORT, 4500)
  assert.equal(parsePlayOptions([]).open, true)
  assert.equal(parsePlayOptions(['--no-open']).open, false)
  assert.equal(parsePlayOptions(['--port=4600']).port, 4600)
  assert.deepEqual(QUERY_FLAGS, ['sandbox', 'range', 'weapon', 'party'])
  assert.deepEqual(parsePlayOptions(['--sandbox', '--weapon=revolver-rebuild']).query,
    {sandbox: '1', weapon: 'revolver-rebuild'})
  assert.throws(() => parsePlayOptions(['--port=nope']), /--port needs a port number/)
  assert.throws(() => parsePlayOptions(['--editor']), /Unknown argument --editor/)
  assert.equal(playUrl('http://127.0.0.1:4500/', {sandbox: '1', party: 'ABCD'}),
    'http://127.0.0.1:4500/?sandbox=1&party=ABCD')
})

test('the server answers with the standalone page and the project files', async () => {
  const lines = []
  // Port 0 asks the operating system for a free port, so the test never fights
  // a dev server for 4500.
  const session = await play(['--port=0', '--no-open', '--sandbox'], {out: {write: line => lines.push(line)}})
  try {
    assert.match(lines.join(''), /Terminator is playable at http:\/\/127\.0\.0\.1:\d+\/\?sandbox=1/)
    assert.match(session.url, /\?sandbox=1$/)
    const origin = new URL(session.url).origin

    const page = await fetch(`${origin}/`)
    assert.equal(page.status, 200)
    assert.equal(page.headers.get('content-type'), 'text/html')
    const html = await page.text()
    assert.match(html, /createGame\(/, 'the page boots through createGame')
    assert.doesNotMatch(html, /kite3dProjectLoaded|editor/i, 'no editor is involved')
    assert.match(html, /"threepipe":"\.\/_blitz\/runtime\.js"/, 'the engine import map is present')

    const runtime = await fetch(`${origin}/_blitz/runtime.js`)
    assert.equal(runtime.status, 200)
    assert.equal(runtime.headers.get('content-type'), 'text/javascript')

    // The real project files, served from this directory, not a build.
    for (const path of ['/main.js', '/lib/view/performance-quality.js', '/package.json']) {
      const served = await fetch(`${origin}${path}`)
      assert.equal(served.status, 200, `${path} is served`)
      assert.equal(await served.text(), await readFile(`${projectDir}${path.slice(1)}`, 'utf8'), `${path} is the project file`)
    }

    assert.equal((await fetch(`${origin}/nothing-here.js`)).status, 404)
  } finally {
    await session.close()
  }
  assert.equal((await fetch(new URL(session.url).origin).catch(() => 'closed')), 'closed', 'the server stops')
})
