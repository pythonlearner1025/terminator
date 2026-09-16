import {cp, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {installFilePutPatch, KITE3D_PATCH_VERSION, unpatchedServerText} from '../../tools/patch-kite3d-file-put.mjs'

export const installedPackageRoot = await realpath(fileURLToPath(new URL('../../node_modules/kite3d', import.meta.url)))
export const digest = async path => (await import('node:crypto')).createHash('sha256').update(await readFile(path)).digest('hex')

// Copy only the CLI package; dependency links are read-only. Never import a
// viewer or editor, connect to an existing dev server, or touch the game scene.
export async function serverFixture({patched = true, source = false} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kite3d-put-regression-'))
  const packageRoot = join(root, 'node_modules/kite3d')
  try {
    await mkdir(join(root, 'node_modules'), {recursive: true})
    await cp(installedPackageRoot, packageRoot, {recursive: true})
    for (const file of ['dist/server.js', 'src/server.ts']) {
      const path = join(packageRoot, file)
      await writeFile(path, unpatchedServerText(await readFile(path, 'utf8'), file))
    }
    const metadata = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    for (const dependency of new Set(Object.keys({...metadata.dependencies, ...metadata.optionalDependencies}).map(name => name.split('/')[0]))) {
      await symlink(join(dirname(installedPackageRoot), dependency), join(root, 'node_modules', dependency), 'dir')
    }
    await writeFile(join(root, 'package.json'), JSON.stringify({
      name: 'file-put-regression', type: 'module', mainScene: 'assets/main.scene.gltf',
      devDependencies: {kite3d: KITE3D_PATCH_VERSION}, kite3d: {version: KITE3D_PATCH_VERSION},
    }))
    if (patched) await installFilePutPatch(root)
    let modulePath = join(packageRoot, 'dist/server.js')
    if (source) {
      const {stripTypeScriptTypes} = await import('node:module')
      modulePath = join(packageRoot, 'dist/server-source.js')
      const stripped = stripTypeScriptTypes(await readFile(join(packageRoot, 'src/server.ts'), 'utf8'))
      // Match the package build's relative import extension rewrite. Execute
      // the actual source route against the installed dist dependencies.
      await writeFile(modulePath, stripped.replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2'))
    }
    const {createDevServer} = await import(pathToFileURL(modulePath).href)
    const dev = await createDevServer({projectRoot: root, port: 0})
    return {
      root, packageRoot, dev,
      origin: `http://127.0.0.1:${dev.port}`,
      headers: {'X-Kite3D-Token': dev.token, 'If-Match': '*'},
      async close() {await dev.close(); await rm(root, {recursive: true, force: true})},
    }
  } catch (error) {
    await rm(root, {recursive: true, force: true})
    throw error
  }
}
