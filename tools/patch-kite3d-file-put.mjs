import {createHash, randomBytes} from 'node:crypto'
import {lstat, readFile, realpath, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export const KITE3D_PATCH_VERSION = '0.19.0-alpha.2'
const hash = text => createHash('sha256').update(text).digest('hex')
const targets = [
  {
    file: 'dist/server.js',
    originalHash: '7c90e452abfca7fef8a359b3118496270d3adda5fc560ac107e8bc4429d1d753',
    before: `            if (!c.req.raw.body)
                throw new Error('File request body is required');
            await pipeline(c.env.incoming, createWriteStream(temporary, { flags: 'wx' }));`,
    after: `            const body = c.req.raw.body;
            if (!body)
                throw new Error('File request body is required');
            // Consume the Web body only: its adapter already owns incoming.
            await pipeline(Readable.fromWeb(body), createWriteStream(temporary, { flags: 'wx' }));`,
  },
  {
    file: 'src/server.ts',
    originalHash: '64a88159062ae2a89fcdcb9c4fda2d0dfa56b8d67ef50f1abfe50e88f9b067c0',
    before: `            if (!c.req.raw.body) throw new Error('File request body is required')
            await pipeline(c.env.incoming, createWriteStream(temporary, {flags: 'wx'}))`,
    after: `            const body = c.req.raw.body
            if (!body) throw new Error('File request body is required')
            // Consume the Web body only: its adapter already owns incoming.
            await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(temporary, {flags: 'wx'}))`,
  },
]

function replaceOnce(text, before, after, file) {
  if (text.split(before).length !== 2) throw new Error(`Unexpected patch context: ${file}`)
  return text.replace(before, after)
}

export function patchServerText(text, file) {
  const target = targets.find(target => target.file === file)
  if (!target) throw new Error(`Unknown patch target: ${file}`)
  if (hash(text) === target.originalHash) {
    return replaceOnce(text, target.before, target.after, file)
  }
  // Verify the entire original file, even on repeat installs. A marker alone
  // must never hide package drift or a partial/manual modification.
  if (text.split(target.after).length === 2) {
    const original = replaceOnce(text, target.after, target.before, file)
    if (hash(original) === target.originalHash) return text
  }
  throw new Error(`Kite3D file PUT patch refused source drift: ${file}`)
}

// Regression fixtures can reconstruct the verified baseline from either a
// pristine install or an install on which postinstall has already run.
export function unpatchedServerText(text, file) {
  const patched = patchServerText(text, file)
  const target = targets.find(target => target.file === file)
  return replaceOnce(patched, target.after, target.before, file)
}

async function requireLocal(path, directory) {
  const info = await lstat(path)
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())
    || await realpath(path) !== path) {
    throw new Error(`Kite3D patch refuses shared/symlinked install: ${path}. Use a private project npm install.`)
  }
  return info
}

export async function installFilePutPatch(projectRoot) {
  const root = await realpath(resolve(projectRoot))
  const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  if (project.devDependencies?.kite3d !== KITE3D_PATCH_VERSION
    || project.kite3d?.version !== KITE3D_PATCH_VERSION) {
    throw new Error(`Kite3D file PUT patch requires both project pins to be exactly ${KITE3D_PATCH_VERSION}; review/remove this patch when upgrading.`)
  }
  const modules = join(root, 'node_modules')
  await requireLocal(modules, true)
  const packageRoot = join(modules, 'kite3d')
  await requireLocal(packageRoot, true)
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (installed.name !== 'kite3d' || installed.version !== KITE3D_PATCH_VERSION) {
    throw new Error(`Kite3D file PUT patch requires installed kite3d ${KITE3D_PATCH_VERSION}`)
  }
  // Validate BOTH targets before writing either. Atomic replacement also
  // avoids changing another installation through a hard-linked package file.
  const changes = []
  for (const {file} of targets) {
    const path = join(packageRoot, file)
    await requireLocal(dirname(path), true)
    const info = await requireLocal(path, false)
    const before = await readFile(path, 'utf8')
    const after = patchServerText(before, file)
    if (after !== before) changes.push({path, after, mode: info.mode})
  }
  for (const {path, after, mode} of changes) {
    const temporary = `${path}.put-patch-${randomBytes(8).toString('hex')}`
    try {
      await writeFile(temporary, after, {flag: 'wx', mode})
      await rename(temporary, path)
    } finally {
      await unlink(temporary).catch(error => {if (error.code !== 'ENOENT') throw error})
    }
  }
  return changes.length ? 'patched dist/server.js and src/server.ts' : 'already patched'
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('Usage: node tools/patch-kite3d-file-put.mjs (run from the project root)')
    console.log(`[kite3d ${KITE3D_PATCH_VERSION}] file PUT: ${await installFilePutPatch(process.cwd())}`)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
