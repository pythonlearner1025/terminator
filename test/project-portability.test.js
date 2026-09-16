import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import {basename} from 'node:path'
import {promisify} from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const loopbackOrigin = /http:\/\/(?:127\.0\.0\.1|localhost)\b/i

test('tracked scenes and asset manifests contain no local server URLs', async () => {
  const {stdout} = await execFileAsync('git', ['ls-files', '-z'])
  const paths = stdout.split('\0').filter(path =>
    path.endsWith('.scene.gltf')
      || basename(path) === 'assets.json'
      || /manifest.*\.json$/i.test(basename(path)))
  const offenders = []
  for (const path of paths) {
    const contents = await readFile(path, 'utf8')
    if (loopbackOrigin.test(contents)) offenders.push(path)
  }
  assert.deepEqual(offenders, [], `local server URLs found in: ${offenders.join(', ')}`)
})
