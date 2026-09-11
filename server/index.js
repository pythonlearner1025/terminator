#!/usr/bin/env node
import {createLobbyServer} from './lobby-server.js'

const portIndex = process.argv.indexOf('--port')
const port = Number(process.env.PORT || (portIndex >= 0 ? process.argv[portIndex + 1] : 7801))
const server = createLobbyServer()

server.listen(port, '0.0.0.0', () => {
  const address = server.address()
  console.log(`Skynet lobby server listening on http://localhost:${address.port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.closeAll?.()
    server.close(() => process.exit(0))
  })
}
