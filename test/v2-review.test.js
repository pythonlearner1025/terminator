import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

test('V2 evaluator numeric, masking, capture integrity and camera fixtures', () => {
  const script = fileURLToPath(new URL('../tools/v2/review-tests.py', import.meta.url))
  const result = spawnSync('python3', [script], {encoding:'utf8', timeout:60000})
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
