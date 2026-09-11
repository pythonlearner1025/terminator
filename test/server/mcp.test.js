import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import test from 'node:test'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {createLobby, startTestServer} from './helpers.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('MCP server lists ten tools and round-trips skynet_state', async (t) => {
  const fixture = await startTestServer()
  t.after(() => fixture.close())
  const lobby = await createLobby(fixture.url)
  const child = spawn(process.execPath, ['packages/skynet-mcp/index.js', '--url', fixture.url, '--code', lobby.code, '--name', 'MCP Test'], {
    cwd: repo,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  t.after(() => child.kill())
  const rpc = makeRpc(child)
  const initialized = await rpc.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {name: 'test-client', version: '1.0.0'},
  })
  assert.equal(initialized.serverInfo.name, 'terminator-skynet-mcp')
  rpc.notify('notifications/initialized', {})
  const listed = await rpc.request('tools/list', {})
  assert.equal(listed.tools.length, 10)
  assert.deepEqual(listed.tools.map((item) => item.name), [
    'skynet_state',
    'skynet_rules',
    'skynet_telemetry',
    'skynet_wave_config',
    'skynet_script',
    'skynet_simulate',
    'skynet_dossier_read',
    'skynet_dossier_write',
    'skynet_taunt',
    'skynet_ready',
  ])
  const call = await rpc.request('tools/call', {name: 'skynet_state', arguments: {}})
  assert.equal(call.structuredContent.code, lobby.code)
  assert.equal(call.structuredContent.agent.name, 'MCP Test')
})

function makeRpc(child) {
  let id = 0
  let buffer = ''
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      const message = JSON.parse(line)
      const waiter = pending.get(message.id)
      if (!waiter) continue
      pending.delete(message.id)
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
      else waiter.resolve(message.result)
    }
  })
  child.once('exit', (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`MCP child exited with code ${code}`))
    pending.clear()
  })
  return {
    request(method, params) {
      const requestId = ++id
      child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', id: requestId, method, params})}\n`)
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`MCP request timed out: ${method}`))
        }, 5_000)
        pending.set(requestId, {
          resolve: (value) => { clearTimeout(timer); resolve(value) },
          reject: (error) => { clearTimeout(timer); reject(error) },
        })
      })
    },
    notify(method, params) {
      child.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method, params})}\n`)
    },
  }
}
