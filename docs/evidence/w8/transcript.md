# W8 Skynet relay evidence

Date: 2026-09-11

The join token is deliberately redacted. The lobby code and all other values below are from the final live run.

## Commands

Terminal 1:

```sh
npm run server
```

Response:

```text
Skynet lobby server listening on http://localhost:7801
```

Terminal 2:

```sh
node docs/evidence/w8/run-evidence.mjs
```

The evidence runner started the editor with this exact command and kept it running for the browser session:

```sh
npx kite3d dev --port 4700 --no-open --force
```

It opened the tokenized local editor URL without logging its token, clicked Play, opened the lobby, and ran these curl requests:

```sh
curl -sS -N --max-time 40 http://localhost:7801/api/lobby/KHYAIS/events

curl -sS -X POST http://localhost:7801/api/lobby/KHYAIS/join \
  -H 'Content-Type: application/json' \
  --data '{"name":"Evidence Skynet","agent_info":{"client":"curl","purpose":"w8 evidence"}}'

curl -sS http://localhost:7801/api/lobby/KHYAIS/state

curl -sS -X POST http://localhost:7801/api/lobby/KHYAIS/script \
  -H 'Content-Type: application/json' \
  --data '{"unit_type":"scout","source":"export function tick(self, sense, act, mem) {\n  const target = sense.player?.pos || sense.lastKnownPlayer?.pos || self.pos\n  act.moveTo(target)\n  act.face(target)\n  act.say('\''REV TWO ACTIVE'\'')\n  if (sense.player && self.type !== '\''scout'\'') { act.aimAt(target); act.fire() }\n  if (sense.player && self.type === '\''scout'\'') act.melee()\n}","note":"Wave 2 evidence script"}'

curl -sS -X POST http://localhost:7801/api/lobby/KHYAIS/wave_config \
  -H 'Content-Type: application/json' \
  --data '{"wave":2,"spawns":[{"t":0,"gate":"E1","unit":"scout","count":1}],"knobs":{"gates":["E1"],"doors":{"building_ground":"locked"},"lights":{"courtyard":"off"},"fog":2,"hazards":[],"break_flank_wall":false}}'
```

## Responses

The join response contained an opaque token, the full rules, dossier, and this state. Only the secret token is redacted:

```json
{"token":"[redacted]","state":{"phase":"lobby","wave":0,"agent":{"name":"Evidence Skynet","agent_info":{"client":"curl","purpose":"w8 evidence"}}}}
```

The SSE stream delivered a full wave summary. The identifying result fields were:

```json
{"type":"wave_summary","wave":1,"t":6.2167,"time_to_clear":6.2167,"player_died":false,"applied_budget":420,"counters":{"kills":5,"damageEvents":5,"shots":0,"hits":0}}
```

Script response:

```json
{"ok":true,"rev":2}
```

Wave config response:

```json
{"ok":true,"cost":150,"budget":810}
```

State after wave 2 began, captured with:

```sh
curl -sS http://localhost:7801/api/lobby/KHYAIS/state | jq -c '{phase,wave,budget,applied_config,script_revs,fallback_count,agent}'
```

```json
{"phase":"wave","wave":2,"budget":810,"applied_config":{"spawns":[{"t":0,"gate":"E1","unit":"scout","count":1}],"knobs":{"gates":["E1"],"doors":{"building_ground":"locked"},"lights":{"courtyard":"off"},"fog":2,"hazards":[],"break_flank_wall":false}},"script_revs":{"scout":2,"endo":1,"heavy":1},"fallback_count":0,"agent":{"name":"Evidence Skynet","agent_info":{"client":"curl","purpose":"w8 evidence"}}}
```

The browser had no console warnings, errors, or uncaught page errors after filtering Chromium's known headless GPU readback warning.

## Browser assertions

The final browser snapshot reported:

```json
{"phase":"wave","wave":2,"skynet":"Evidence Skynet","revs":"ENDO r1 · SCOUT r2 · HEAVY r1","transmission":"> APPLIED WAVE 2: FOG 2  DOORS building_ground:locked  LIGHTS courtyard:off","nameplates":"T-600 SCOUTrev 2 / 5 m","map":{"doors":{"tunnel_w":"unlocked","tunnel_e":"unlocked","building_ground":"locked","building_balcony":"locked"},"lights":{"courtyard":"off","building":"on","dock":"on"},"fog":2,"hazards":[],"flankWallBroken":false,"gates":["E1"]}}
```

For a repeatable short run, Playwright applied lethal player damage through the authoritative `World.damageUnit` API to every wave 1 spawn. It did not synthesize relay events or server responses. After wave 2 spawned, it froze stepping and moved the live scout and player to a clear authored area for the evidence frame. The applied configuration and accepted script revision were unchanged.

## No-server fallback

With nothing listening on port 7801:

```sh
node docs/evidence/w8/check-built-in-fallback.mjs
```

```json
{"phase":"wave","wave":1,"skynet":"BUILT-IN","serverConnected":true,"hud":"BUILT-IN","pageErrors":[]}
```

`serverConnected` is the core's Skynet-availability flag. It remains true because the local built-in planner is active even though the lobby HTTP server is offline.

## Screenshots

- `lobby-agent-connected.png`: lobby code `KHYAIS` with Evidence Skynet connected.
- `wave2-agent-config.png`: live wave 2, Evidence Skynet HUD, scout `rev 2` nameplate, fog 2, locked `building_ground`, and courtyard light off.
