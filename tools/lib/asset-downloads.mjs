import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {setTimeout as sleep} from 'node:timers/promises'

export async function cachedArchiveValid(path, asset) {
  try {
    const receipt = JSON.parse(await readFile(path.replace(/\.zip$/, '.json'), 'utf8'))
    // Sketchfab slugs and creator names may change; the model UID is stable.
    if (receipt.id !== asset.id) return false
    const bytes = await readFile(path)
    return bytes.length === receipt.bytes && createHash('sha256').update(bytes).digest('hex') === receipt.sha256
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return false
    throw error
  }
}

export async function fetchAssetJson(url, headers = {}, {fetchImpl = fetch, wait = sleep, now = Date.now, log = console.log} = {}) {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, {headers: {'User-Agent': 'Terminator asset importer', ...headers}, signal: AbortSignal.timeout(30000)})
    if (response.status !== 429) {
      if (!response.ok) throw new Error(`Asset metadata request returned HTTP ${response.status}`)
      return response.json()
    }
    await response.body?.cancel()
    const header = response.headers.get('retry-after')
    const delay = retryDelay(header, now(), attempt)
    const resumeAt = new Date(now() + delay).toISOString()
    if (delay > 60000 || attempt >= 3) {
      throw new Error(`Sketchfab rate limit (HTTP 429). Retry after ${resumeAt}${header ? '' : ' (suggested; the server did not specify a reset time)'}. Completed archives are saved; rerunning skips verified downloads.`)
    }
    log(`Rate limited (HTTP 429); waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/3. Completed downloads are saved.`)
    await wait(delay)
  }
}

function retryDelay(header, now, attempt) {
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.max(1000, Number(header) * 1000)
  const date = header ? Date.parse(header) : NaN
  if (Number.isFinite(date)) return Math.max(1000, date - now)
  return Math.min(60000, 30000 * 2 ** attempt)
}
