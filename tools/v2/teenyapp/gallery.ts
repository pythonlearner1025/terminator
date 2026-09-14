// Web-standard handler, injected per-request managed Teeny Database. No raw R2.
export const MAX_BYTES = 8 * 1024 * 1024
const SHA = /^[a-f0-9]{64}$/
const SNAPSHOT = /^snapshots\/[a-z0-9][a-z0-9_-]{0,79}\/(?:index\.html|gallery\.json|public-copy\.json)$/
const PNG = /^static\/assets\/([a-f0-9]{64})\.png$/
const ROOT = new Set(['index.html', 'history.json', 'public-copy.json', 'export.json'])
export function mimeFor(path) {
  if (typeof path !== 'string' || path.length > 160 || !(ROOT.has(path) || SNAPSHOT.test(path) || PNG.test(path))) return null
  return path.endsWith('.png') ? 'image/png' : path.endsWith('.html') ? 'text/html' : 'application/json'
}
export const CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
const response = (status, message) => new Response(message, {status, headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}})
const json = (status, data) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}})
export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
}
async function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right || left.length > 1024) return false
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(left)))
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(right)))
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
async function readBounded(request) {
  const declared = request.headers.get('Content-Length')
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new RangeError('body limit')
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader(), chunks = []
  let size = 0
  try {
    for (;;) {
      const {value, done} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BYTES) {await reader.cancel(); throw new RangeError('body limit')}
      chunks.push(value)
    }
  } finally {reader.releaseLock()}
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength}
  return bytes
}
function wherePath(path) {return `path == ${JSON.stringify(path)}`}
async function find(table, path) {
  const rows = await table.select({where: wherePath(path), select: ['path', 'mime', 'sha256', 'blob'], limit: 1})
  if (!Array.isArray(rows)) throw Error('Unexpected table result')
  return rows[0]
}
function fileKey(row) {
  if (typeof row.blob !== 'string' || !/^[a-zA-Z0-9_.-]{1,200}$/.test(row.blob) || row.blob.includes('..')) throw Error('Invalid file reference')
  return 'gallery/' + row.blob
}
export async function handleGallery(request, db) {
  const url = new URL(request.url)
  if (url.pathname === '/agents.md') return null // Reserved platform discovery.
  const publishing = url.pathname === '/_publish/file'
  if (!publishing && request.method !== 'GET' && request.method !== 'HEAD') return response(405, 'Method not allowed')
  if (publishing) {
    if (request.method !== 'POST' && request.method !== 'PUT') return response(405, 'Method not allowed')
    // Never initialize admin auth, read a body or touch a table before this gate.
    const secret = await db.secretResolver.resolve('$GALLERY_PUBLISH_TOKEN')
    if (!await equalSecret(request.headers.get('X-Gallery-Publish-Token'), secret)) return response(401, 'Unauthorized')
    const path = url.searchParams.get('path'), mime = mimeFor(path)
    if (!mime || url.searchParams.size !== 1) return response(400, 'Invalid export path')
    const contentType = request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
    if (contentType !== mime) return response(415, 'Content type does not match path')
    const expected = request.headers.get('X-Content-SHA256')
    if (!expected || !SHA.test(expected)) return response(400, 'A lowercase SHA256 header is required')
    let bytes
    try {bytes = await readBounded(request)} catch (error) {
      if (error instanceof RangeError) return response(413, 'File exceeds 8 MiB')
      return response(400, 'Unable to read file')
    }
    if (await sha256(bytes) !== expected || (PNG.test(path) && PNG.exec(path)[1] !== expected)) return response(422, 'SHA256 mismatch')
    if (mime === 'image/png') {
      const signature = [137, 80, 78, 71, 13, 10, 26, 10]
      if (bytes.length < 8 || signature.some((value, i) => bytes[i] !== value)) return response(415, 'Invalid PNG signature')
    } else {
      try {
        const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes)
        if (mime === 'application/json') JSON.parse(text)
      } catch {return response(415, 'Invalid text or JSON')}
    }
    const admin = await db.secretResolver.resolve('$ADMIN_SERVICE_TOKEN')
    if (!admin) return response(503, 'Publishing is not configured')
    await db.initAuth(admin)
    const table = db.table('gallery_files'), existing = await find(table, path)
    if (existing?.sha256 === expected && existing.mime === mime && await db.headFileObject(fileKey(existing))) return json(200, {path, sha256: expected, alreadyUploaded: true})
    // Table normalizes names and owns replacement/rollback/file cleanup. Read
    // its resulting blob field; never assume the raw File name is the R2 key.
    const blob = new File([bytes], expected + '.' + path.split('.').pop(), {type: mime})
    const values = {path, mime, sha256: expected, blob}
    if (existing) await table.update({where: wherePath(path), setValues: values})
    else await table.insert({values})
    const saved = await find(table, path)
    if (!saved || saved.sha256 !== expected || !await db.headFileObject(fileKey(saved))) return response(503, 'Upload verification failed; retry')
    return json(existing ? 200 : 201, {path, sha256: expected, alreadyUploaded: false})
  }
  const path = url.pathname === '/' ? 'index.html' : url.pathname.slice(1), mime = mimeFor(path)
  if (!mime) return response(404, 'Not found')
  const row = await find(db.table('gallery_files'), path)
  if (!row) return response(404, 'Not found')
  if (row.mime !== mime || !SHA.test(row.sha256)) return response(503, 'Invalid file metadata')
  const object = request.method === 'HEAD' ? await db.headFileObject(fileKey(row)) : await db.getFileObject(fileKey(row))
  if (!object) return response(404, 'Not found')
  const headers = new Headers({'Content-Type': mime + (mime === 'image/png' ? '' : '; charset=utf-8'), 'Content-Length': String(object.size), 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline', 'Content-Security-Policy': CSP, 'ETag': `"${row.sha256}"`, 'Cache-Control': PNG.test(path) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate'})
  if (request.headers.get('If-None-Match') === headers.get('ETag')) {headers.delete('Content-Length'); return new Response(null, {status: 304, headers})}
  return new Response(request.method === 'HEAD' ? null : object.body, {headers})
}
