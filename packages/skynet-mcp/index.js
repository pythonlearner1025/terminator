#!/usr/bin/env node
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js'

const args = parseArgs(process.argv.slice(2))
if (!args.url || !/^[A-Z0-9]{6}$/.test(args.code || '')) {
  console.error('Usage: terminator-skynet-mcp --url http://localhost:7801 --code ABC123 [--name "Agent name"]')
  process.exit(1)
}

const baseUrl = `${args.url.replace(/\/$/, '')}/api/lobby/${args.code}`
let token = ''

const tools = [
  tool('skynet_state', 'Read the current lobby phase, wave budget, deadline, applied config, script revisions, and fallback count.', {}, () => api('GET', '/state')),
  tool('skynet_rules', 'Read the unit catalog, map controls, costs, simulation caps, script API version, default scripts, and map ids.', {}, () => api('GET', '/rules')),
  tool('skynet_telemetry', 'Read the complete summary for a finished wave.', {
    wave: {type: 'integer', minimum: 1, description: 'Finished wave number.'},
  }, ({wave}) => api('GET', `/telemetry/${wave}`), ['wave']),
  tool('skynet_wave_config', 'Submit the complete spawn schedule and map controls for the next wave. Invalid configs return every validation error.', {
    wave: {type: 'integer', minimum: 1},
    spawns: {
      type: 'array',
      items: {
        type: 'object',
        required: ['t', 'gate', 'unit', 'count'],
        properties: {
          t: {type: 'number', minimum: 0},
          gate: {type: 'string'},
          unit: {type: 'string', enum: ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']},
          count: {type: 'integer', minimum: 1},
        },
      },
    },
    knobs: {type: 'object', description: 'Map controls using gates, doors, lights, fog, hazards, and break_flank_wall.'},
  }, (input) => api('POST', '/wave_config', input), ['wave', 'spawns', 'knobs']),
  tool('skynet_script', 'Validate and submit one unit brain script. Accepted scripts receive a new per-type revision.', {
    unit_type: {type: 'string', enum: ['scout', 'endo', 'heavy', 't1000', 'hkaerial', 'hktank']},
    source: {type: 'string', description: 'ES module source exporting tick and optionally init.'},
    note: {type: 'string'},
  }, (input) => api('POST', '/script', input), ['unit_type', 'source']),
  tool('skynet_simulate', 'Run one headless worker-thread simulation against a recorded player ghost. Limited to ten calls per intermission.', {
    wave_config: {type: 'object'},
    scripts: {type: 'object'},
    ghost: {description: 'Use last, best, or a finished wave number.', oneOf: [{type: 'string', enum: ['last', 'best']}, {type: 'integer', minimum: 1}]},
    seed: {type: 'number'},
  }, (input) => api('POST', '/simulate', input)),
  tool('skynet_dossier_read', 'Read Skynet dossier markdown and structured player traits.', {}, () => api('GET', '/dossier')),
  tool('skynet_dossier_write', 'Replace Skynet dossier markdown and traits. Confidence values must be from zero to one.', {
    markdown: {type: 'string'},
    traits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'value', 'confidence'],
        properties: {key: {type: 'string'}, value: {}, confidence: {type: 'number', minimum: 0, maximum: 1}},
      },
    },
  }, (input) => api('PUT', '/dossier', input), ['markdown', 'traits']),
  tool('skynet_taunt', 'Send a HUD transmission of at most 80 characters. Limited to one every 20 seconds.', {
    text: {type: 'string', minLength: 1, maxLength: 80},
  }, (input) => api('POST', '/taunt', input), ['text']),
  tool('skynet_ready', 'Mark the agent ready for a target wave after its decisions have been submitted.', {
    wave: {type: 'integer', minimum: 1},
  }, (input) => api('POST', '/ready', input), ['wave']),
]

const server = new Server({name: 'terminator-skynet-mcp', version: '0.1.0'}, {capabilities: {tools: {}}})
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: tools.map(({run, ...definition}) => definition)}))
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const selected = tools.find((item) => item.name === request.params.name)
  if (!selected) throw new Error(`Unknown tool: ${request.params.name}`)
  try {
    const result = await selected.run(request.params.arguments || {})
    return {content: [{type: 'text', text: JSON.stringify(result, null, 2)}], structuredContent: result, isError: result?.ok === false}
  } catch (error) {
    return {content: [{type: 'text', text: String(error?.message || error)}], isError: true}
  }
})

await join()
await server.connect(new StdioServerTransport())

function tool(name, description, properties, run, required = []) {
  return {name, description, inputSchema: {type: 'object', properties, ...(required.length ? {required} : {}), additionalProperties: false}, run}
}

async function join() {
  try {
    const response = await fetch(`${baseUrl}/join`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({name: args.name || 'MCP Agent', agent_info: {client: 'terminator-skynet-mcp', version: '0.1.0'}}),
    })
    if (response.ok) token = (await response.json()).token || ''
    else if (response.status !== 409) throw new Error(`join failed with HTTP ${response.status}`)
  } catch (error) {
    console.error(`Skynet MCP could not join lobby: ${String(error?.message || error)}`)
  }
}

async function api(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  })
  const result = await response.json()
  if (!response.ok && result?.ok !== false) throw new Error(`${method} ${route} failed with HTTP ${response.status}`)
  return result
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    if (!values[index].startsWith('--')) continue
    result[values[index].slice(2)] = values[index + 1]
    index += 1
  }
  return result
}
