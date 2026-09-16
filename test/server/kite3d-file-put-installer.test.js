import test from 'node:test'
import assert from 'node:assert/strict'
import {cp, link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {installFilePutPatch, patchServerText, unpatchedServerText, KITE3D_PATCH_VERSION} from '../../tools/patch-kite3d-file-put.mjs'
import {installedPackageRoot, digest} from '../helpers/kite3d-server-fixture.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kite3d-installer-test-'))
  t.after(() => rm(root, {recursive: true, force: true}))
  const pkg = join(root, 'node_modules/kite3d')
  await mkdir(join(pkg, 'dist'), {recursive: true})
  await mkdir(join(pkg, 'src'), {recursive: true})
  for (const file of ['package.json', 'dist/server.js', 'src/server.ts']) await cp(join(installedPackageRoot, file), join(pkg, file))
  for (const file of ['dist/server.js', 'src/server.ts']) {
    const path = join(pkg, file)
    await writeFile(path, unpatchedServerText(await readFile(path, 'utf8'), file))
  }
  const project = {devDependencies: {kite3d: KITE3D_PATCH_VERSION}, kite3d: {version: KITE3D_PATCH_VERSION}}
  await writeFile(join(root, 'package.json'), JSON.stringify(project))
  return {root, pkg, project}
}

test('installer patches source + dist, is idempotent, and leaves shared package untouched', async t => {
  const originals = await Promise.all(['dist/server.js', 'src/server.ts'].map(file => digest(join(installedPackageRoot, file))))
  const {root, pkg} = await fixture(t)
  assert.match(await installFilePutPatch(root), /^patched/)
  assert.equal(await installFilePutPatch(root), 'already patched')
  for (const [i, file] of ['dist/server.js', 'src/server.ts'].entries()) {
    assert.match(await readFile(join(pkg, file), 'utf8'), /pipeline\(Readable.fromWeb\(body/)
    assert.equal(await digest(join(installedPackageRoot, file)), originals[i])
  }
})

test('installer rejects either project pin or installed version mismatch without writes', async t => {
  for (const field of ['devDependencies', 'kite3d', 'installed']) {
    const {root, pkg, project} = await fixture(t)
    const before = await digest(join(pkg, 'dist/server.js'))
    if (field === 'installed') await writeFile(join(pkg, 'package.json'), JSON.stringify({name: 'kite3d', version: '0.19.0-alpha.3'}))
    else {
      project[field][field === 'kite3d' ? 'version' : 'kite3d'] = '0.19.0-alpha.3'
      await writeFile(join(root, 'package.json'), JSON.stringify(project))
    }
    await assert.rejects(installFilePutPatch(root), /requires/)
    assert.equal(await digest(join(pkg, 'dist/server.js')), before)
  }
})

test('full-file drift in second target rejects before either write, even with valid patch context', async t => {
  const {root, pkg} = await fixture(t)
  const before = await digest(join(pkg, 'dist/server.js'))
  await writeFile(join(pkg, 'src/server.ts'), `${await readFile(join(pkg, 'src/server.ts'), 'utf8')}\n// unexpected change\n`)
  await assert.rejects(installFilePutPatch(root), /source drift/)
  assert.equal(await digest(join(pkg, 'dist/server.js')), before)
})

test('installer rejects modified patched files and repairs an interrupted one-file installation', async t => {
  const {root, pkg} = await fixture(t)
  const path = join(pkg, 'dist/server.js')
  await writeFile(path, patchServerText(await readFile(path, 'utf8'), 'dist/server.js'))
  assert.match(await installFilePutPatch(root), /^patched/)
  await writeFile(path, `${await readFile(path, 'utf8')}\n// drift\n`)
  await assert.rejects(installFilePutPatch(root), /source drift/)
})

test('installer refuses symlinked node_modules, package, subdirectory and target file', async t => {
  for (const relative of ['node_modules', 'node_modules/kite3d', 'node_modules/kite3d/src', 'node_modules/kite3d/src/server.ts']) {
    const {root} = await fixture(t)
    const target = join(root, relative), shared = join(root, 'shared-target')
    await rename(target, shared)
    await symlink(shared, target, relative.endsWith('.ts') ? 'file' : 'dir')
    await assert.rejects(installFilePutPatch(root), /shared\/symlinked/)
  }
})

test('atomic file replacement does not mutate a hard-linked original', async t => {
  const {root, pkg} = await fixture(t)
  const path = join(pkg, 'dist/server.js'), original = join(root, 'original-server.js')
  await link(path, original)
  const before = await digest(original)
  await installFilePutPatch(root)
  assert.equal(await digest(original), before)
  assert.notEqual(await digest(path), before)
})

test('postinstall CLI uses project cwd, succeeds on repeat and exits nonzero for version drift', async t => {
  const {root, project} = await fixture(t)
  const script = fileURLToPath(new URL('../../tools/patch-kite3d-file-put.mjs', import.meta.url))
  const run = () => spawnSync(process.execPath, ['--v8-pool-size=1', script], {
    cwd: root, encoding: 'utf8', timeout: 5000, env: {...process.env, UV_THREADPOOL_SIZE: '1'},
  })
  for (const expected of ['patched dist/server.js and src/server.ts', 'already patched']) {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes(expected))
  }
  project.kite3d.version = '0.19.0-alpha.3'
  await writeFile(join(root, 'package.json'), JSON.stringify(project))
  const rejected = run()
  assert.equal(rejected.status, 1)
  assert.match(rejected.stderr, /requires both project pins/)
})
