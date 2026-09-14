import test from 'node:test'
import assert from 'node:assert/strict'
import {handleGallery, MAX_BYTES, mimeFor, sha256} from './gallery.ts'
const token = 'test-only-publisher', admin = 'test-only-admin'
function database() {
  const rows = new Map(), objects = new Map(), calls = []
  let authenticated = false, serial = 0
  const table = {
    async select({where, limit, select}) {assert.equal(limit, 1); assert.deepEqual(select, ['path','mime','sha256','blob']); const path = JSON.parse(where.slice('path == '.length)); calls.push('select'); return rows.has(path) ? [rows.get(path)] : []},
    async insert({values}) {assert.ok(authenticated); assert.ok(!rows.has(values.path)); await save(values)},
    async update({where, setValues}) {assert.ok(authenticated); assert.equal(where, `path == ${JSON.stringify(setValues.path)}`); await save(setValues)},
  }
  async function save(values) {
    calls.push('write'); assert.ok(values.blob instanceof File)
    const bytes = new Uint8Array(await values.blob.arrayBuffer()), name = `${++serial}_${values.blob.name}`
    const old = rows.get(values.path); if (old) objects.delete('gallery/' + old.blob)
    objects.set('gallery/' + name, bytes); rows.set(values.path, {...values, blob: name})
  }
  return {rows, objects, calls, secretResolver: {async resolve(key) {calls.push(key); return key === '$GALLERY_PUBLISH_TOKEN' ? token : admin}},
    async initAuth(value) {assert.equal(value, admin); authenticated = true; calls.push('admin')},
    table(name) {assert.equal(name, 'gallery_files'); return table},
    async headFileObject(key) {calls.push('head'); return objects.has(key) ? {size: objects.get(key).byteLength} : null},
    async getFileObject(key) {calls.push('get'); return objects.has(key) ? {size: objects.get(key).byteLength, body: objects.get(key)} : null},
  }
}
async function upload(path = 'index.html', body = '<html>test</html>', extra = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  return new Request('https://example.test/_publish/file?path=' + encodeURIComponent(path), {method: 'PUT', body: bytes, headers: {'X-Gallery-Publish-Token': token, 'Content-Type': mimeFor(path) || 'text/plain', 'X-Content-SHA256': await sha256(bytes), ...extra}})
}
test('unauthenticated upload never reads body, initializes admin or accesses a table', async () => {
  const db = database(), req = await upload('index.html', 'x', {'X-Gallery-Publish-Token': 'wrong'})
  assert.equal((await handleGallery(req, db)).status, 401)
  assert.equal(req.bodyUsed, false); assert.deepEqual(db.calls, ['$GALLERY_PUBLISH_TOKEN'])
})
test('allowlist rejects traversal, reserved platform routes and unrelated sources', () => {
  for (const path of ['../index.html','/index.html','snapshots/../index.html','snapshots/x/candidate-capture.json','agents.md','.kite3d/dev.json','static/assets/no.png','worker.ts','index.html?x=1']) assert.equal(mimeFor(path), null)
  assert.equal(mimeFor('snapshots/r8-interior-lighting-16/index.html'), 'text/html')
})
test('actual streaming body limit enforced without trusting Content-Length', async () => {
  const db = database(), body = new ReadableStream({start(c) {c.enqueue(new Uint8Array(MAX_BYTES)); c.enqueue(new Uint8Array(1)); c.close()}})
  const req = new Request('https://example.test/_publish/file?path=index.html', {method:'POST', body, duplex:'half', headers:{'X-Gallery-Publish-Token':token,'Content-Type':'text/html','X-Content-SHA256':'a'.repeat(64)}})
  assert.equal((await handleGallery(req, db)).status, 413); assert.ok(!db.calls.includes('admin'))
})
test('mime/hash/PNG signature/JSON errors rejected before admin', async () => {
  const cases = [await upload('index.html','hello',{'Content-Type':'image/png'}), await upload('index.html','hello',{'X-Content-SHA256':'a'.repeat(64)}), await upload('history.json','invalid')]
  for (const [i,req] of cases.entries()) {const db=database(); assert.equal((await handleGallery(req,db)).status,[415,422,415][i]);assert.ok(!db.calls.includes('admin'))}
  const bad=new Uint8Array([1,2,3]); const path='static/assets/'+await sha256(bad)+'.png'
  assert.equal((await handleGallery(await upload(path,bad),database())).status,415)
})
test('table upload is hash-idempotent, replacement uses normalized blob key and serves exact GET/HEAD', async () => {
  const db=database(); assert.equal((await handleGallery(await upload(),db)).status,201)
  const repeat=await handleGallery(await upload(),db);assert.equal((await repeat.json()).alreadyUploaded,true);assert.equal(db.calls.filter(x=>x==='write').length,1)
  assert.equal((await handleGallery(await upload('index.html','<html>new</html>'),db)).status,200);assert.equal(db.objects.size,1)
  const get=await handleGallery(new Request('https://example.test/'),db);assert.equal(await get.text(),'<html>new</html>');assert.equal(get.headers.get('Content-Disposition'),'inline');assert.ok(get.headers.get('Content-Security-Policy').includes("default-src 'none'"));assert.equal(get.headers.get('Cache-Control'),'public, max-age=0, must-revalidate')
  const head=await handleGallery(new Request('https://example.test/index.html',{method:'HEAD'}),db);assert.equal(await head.text(),'');assert.equal(head.headers.get('Content-Length'),'16')
  const cached=await handleGallery(new Request('https://example.test/',{headers:{'If-None-Match':head.headers.get('ETag')}}),db);assert.equal(cached.status,304)
})
test('content-addressed PNG is immutable; platform discovery untouched; missing files 404', async () => {
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);const path='static/assets/'+await sha256(bytes)+'.png';const db=database()
  assert.equal((await handleGallery(await upload(path,bytes),db)).status,201)
  const got=await handleGallery(new Request('https://example.test/'+path),db);assert.deepEqual(new Uint8Array(await got.arrayBuffer()),bytes);assert.ok(got.headers.get('Cache-Control').includes('immutable'))
  assert.equal(await handleGallery(new Request('https://example.test/agents.md'),db),null)
  assert.equal((await handleGallery(new Request('https://example.test/history.json'),db)).status,404)
})
