// Teeny supplies managed bindings. Only $Database receives them; no raw R2 calls.
import { $Database, teenyHono, OpenApiExtension, PocketUIExtension, Hono } from 'teenybase'
import config from 'virtual:teenybase'
import { handleGallery } from './gallery'

const userApp = new Hono()
userApp.all('*', async (c, next) => {
  const result = await handleGallery(c.req.raw, c.get('$db'))
  if (result) return result
  return next() // /agents.md remains reserved to the hosting platform.
})

const app = teenyHono(async (c) => {
  const db = new $Database(c, config, c.env.TEENY_PRIMARY_DB, c.env.TEENY_PRIMARY_R2)
  await db.registerExtension(new OpenApiExtension(db, true))
  await db.registerExtension(new PocketUIExtension(db))
  return db
}, undefined, { logger: false, cors: false, onError: false })
app.onError(() => new Response('Service unavailable; retry later', {
  status: 503,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
}))
app.route('/', userApp)
export default app
