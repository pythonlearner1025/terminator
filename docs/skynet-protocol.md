# Skynet lobby protocol

The game client is authoritative for the live match. A local Node lobby server relays between the game
and the agent, runs the simulator, and stores dossiers. External agents talk HTTP and SSE, because a
Claude Code or Codex session can drive that with curl. An MCP server wraps the same calls as tools.

## Lobby lifecycle

1. The player opens the game. The client asks the server for a lobby. The server returns a 6-char code
   and a base URL, for example `http://localhost:7801/api/lobby/ABC123`.
2. The lobby screen shows the code, the MCP install line, and the agent status.
3. An agent joins with `POST /join`. The lobby shows its name. The player starts the match.
4. Each intermission the server sends the wave summary and a deadline. The agent submits configs and
   scripts before the deadline. Late or invalid submissions do not apply. The last valid config applies
   instead and the fallback counter increments.
5. At match end the server stores the dossier and the match stats.

If no agent joins, the built-in Skynet plays. It uses the same HTTP API from inside the server.

## HTTP endpoints (all JSON)

Base: `/api/lobby/:code`

| Method | Path | Body | Returns |
|--------|------|------|---------|
| POST | `/join` | `{ name, agent_info }` | `{ token, rules, dossier, state }` |
| GET | `/state` | | current phase, wave, budget, deadline, applied config, script revs, fallback count |
| GET | `/rules` | | unit catalog, wave roster, boss waves, costs, defaults, and positioned map ids |
| GET | `/telemetry/:wave` | | the full wave summary as in docs/game-design.md |
| GET | `/events` | SSE | live event stream (see below) |
| POST | `/wave_config` | `{ wave, spawns: [{ t, gate, unit, count }], knobs }` | `{ ok, cost, budget }` or `{ ok: false, errors: [] }` |
| POST | `/script` | `{ unit_type, source, note }` | `{ ok, rev }` or `{ ok: false, error, smoke_log }` |
| POST | `/simulate` | `{ wave_config?, scripts?, ghost, seed }` | `{ ok, result }` or `{ ok: false, error }` |
| GET | `/dossier` | | `{ markdown, traits }` |
| PUT | `/dossier` | `{ markdown, traits }` | `{ ok }` |
| POST | `/taunt` | `{ text }` | `{ ok }` (80 chars max, 1 per 20 s) |
| POST | `/ready` | `{ wave }` | `{ ok }` |

`knobs` shape:

```json
{
  "gates": ["N1", "E1", "S2"],
  "doors": { "tunnel_w": "locked", "balcony": "unlocked" },
  "lights": { "courtyard": "off" },
  "fog": 2,
  "hazards": [{ "slot": "courtyard_center", "kind": "electric" }],
  "break_flank_wall": false
}
```

Validation rejects a config that exceeds the budget, uses more than 3 gates, breaks the unit caps, or
names locked or unknown ids. Waves 5 and 10 require one HK-Tank at the wide `boss` gate.
The response lists every error. Nothing partial applies.

## SSE events

Each event is `data: { "type": ..., "wave": n, "t": seconds, ... }`.

- `phase` with `{ phase: "lobby" | "wave" | "intermission" | "ended", wave, deadline_ms? }`
- `wave_summary` with the full telemetry at wave end
- `damage` with `{ amount, unit_type, unit_id, headshot?, player_facing_attacker }` throttled to 5 per s
- `unit_damage` with `{ unit_id, unit_type, part, amount, weapon, headshot, pos, normal, direction }`
- `kill` with `{ unit_type, unit_id, weapon, distance, headshot, part, pos, direction }`
- `unit_spawn` and `unit_death` with `{ unit_id, unit_type, rev, cause }`
- `player_pos` with `{ pos, yaw, hp, armor, weapon }` at 1 Hz
- `script_error` and `fuel_exhausted` with `{ unit_id, unit_type, rev, message? }`
- `purchase` with `{ item, price }`
- `config_applied` with `{ wave, fallback: boolean, reason? }`

## Simulator

`POST /simulate` runs the headless core with the given config and scripts against a ghost of the
player. `ghost` is `"last"` for the most recent wave replay, `"best"` for the wave the player cleared
fastest, or a wave index. The ghost replays the recorded path and fires at visible units with the
recorded per-weapon accuracy. It does not react to new configs. The result:

```json
{
  "time_to_clear": 71.2, "player_died": false, "damage_to_player": 140,
  "units": { "scout": { "spawned": 6, "killed": 6, "damage_dealt": 90, "avg_lifetime": 12.1 } },
  "script_errors": 0, "fuel_exhausted": 3, "seed": 42
}
```

Caps: 10 simulate calls per intermission, each at most 10 s of wall time, sim runs at up to 50x real
time. The rules message states the caps.

## MCP server

`packages/skynet-mcp` exposes these tools, each a thin wrapper over the HTTP API:
`skynet_state`, `skynet_rules`, `skynet_telemetry`, `skynet_wave_config`, `skynet_script`,
`skynet_simulate`, `skynet_dossier_read`, `skynet_dossier_write`, `skynet_taunt`, `skynet_ready`.

Install line shown on the lobby screen:

```
claude mcp add skynet -- npx terminator-skynet-mcp --url http://localhost:7801 --code ABC123
```

## Reference client

`packages/skynet-client` is a small Node script that plays Skynet with any chat model. It polls state,
reads telemetry, asks the model for a config and scripts, validates, simulates once, and submits. It is
the smoke test for the whole loop and a starting point for people who bring their own agent.
