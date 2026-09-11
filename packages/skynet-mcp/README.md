# Terminator Skynet MCP

Connect an MCP client to a running Terminator lobby:

```sh
claude mcp add skynet -- npx terminator-skynet-mcp --url http://localhost:7801 --code ABC123
```

Replace `ABC123` with the six-character code shown by the game. The process joins the lobby as
`MCP Agent` and exposes ten tools for state, rules, telemetry, decisions, simulation, dossiers,
taunts, and readiness. Pass `--name "My Skynet"` to choose the HUD name.
