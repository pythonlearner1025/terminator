import {constants} from 'node:fs'
// A private project avoids replacing the owner's live dev connection on port 4310.
import {mkdir, cp, symlink, lstat, unlink} from 'node:fs/promises'
import {resolve} from 'node:path'
const root = resolve(import.meta.dirname, '../../..'), proof = resolve(root, '.kite3d/external-proof')
await mkdir(proof, {recursive: true})
for (const file of ['package.json', 'assets.json', 'main.js']) await cp(resolve(root, file), resolve(proof, file))
for (const folder of ['lib', 'scripts']) await cp(resolve(root, folder), resolve(proof, folder), {recursive: true})
await cp(resolve(root,'docs/reference/weapons/pistol'),resolve(proof,'docs/reference/weapons/pistol'),{recursive:true})
// Reflink copies satisfy Kite3D path containment and keep proof saves isolated.
for (const folder of ['models', 'textures', 'reference', 'audio']) {
  const path = resolve(proof, 'assets', folder)
  const info = await lstat(path).catch(() => null)
  if (info?.isSymbolicLink()) await unlink(path)
}
await cp(resolve(root, 'assets'), resolve(proof, 'assets'), {recursive: true, mode: constants.COPYFILE_FICLONE})
await symlink(resolve(root, 'node_modules'), resolve(proof, 'node_modules')).catch(error => {if (error.code !== 'EEXIST') throw error})
console.log('Prepared private headless project inside this worktree.')
