# Co-op design: party of up to three

## Shape

Host-authoritative. One player hosts. The host's browser runs the World, the wave director, the
built-in Skynet, and the Skynet lobby relay, exactly as single player does today. Up to two guests
join with a party code. Guests send inputs. The host sends snapshots. Guests predict their own
movement locally so their controls feel instant. Guests resolve their own hitscan against the last
snapshot and report hits. The host applies damage, runs unit brains, waves, economy, and telemetry.

Why host-authoritative and not a hosted server: no new infrastructure, the headless core already
runs in the browser, and co-op against AI has no cheating problem worth a server.

## Transport and invite

- A party relay lives in the existing lobby server (server/): a WebSocket room per party code that
  forwards messages between the host and its guests. It keeps no game state.
- Local network: guests connect to `ws://<host lan ip>:7801/party/<code>`.
- Internet: `npm run tunnel` starts a Cloudflare quick tunnel (`cloudflared tunnel --url
  http://localhost:7801`, no account needed) and prints the public relay URL. The lobby screen shows
  the invite link and a copy button. The invite link carries the party code and the relay URL as
  query params: `?party=ABC123&relay=wss://...`.
- The guest's game client is either the same dev server on the LAN or the published game at
  `https://<slug>.app.blitz.dev/`. Publishing is the owner's call and is not part of this pass.
- Skynet agents keep talking to the host's lobby server as today. Skynet sees all players.

## Multi-player core

`World` holds `players`, a map from player id to player state, in join order. The host is player
one. Everything that read `world.player` now reads a specific player or all players:

- Inputs: `world.step(inputsByPlayer)` takes `{[playerId]: inputs}`. Missing ids reuse that player's
  last inputs. The replay buffer records the bundle per tick.
- Units: `sense.player` stays and means the nearest visible player (scripts written for single
  player keep working). `sense.players` lists every visible player with the same fields. Unit
  targeting uses the nearest visible player; `lastKnownPlayer` tracks the last seen one.
- Damage, ammo, armor, scrap, trader purchases, health reset at wave clear: per player.
- Death: a dead player spectates teammates until the wave ends, then respawns at the player start
  with full health and their loadout intact. The match ends when every player is dead in the same
  wave. Single player is unchanged: one death ends the match.
- Telemetry: per player, plus the aggregate the Skynet protocol already sends. The wave summary
  gains `players: [{id, name, ...}]`.
- View-model: `projectViewModel(world, playerId)` renders that player's HUD, with a teammates block
  (name, health, armor, distance, down state).
- Snapshots: `world.snapshot()` returns the full render and prediction state as plain JSON (players,
  units, projectiles, hazards, doors, phase, timers, budget, scrap, events since the last snapshot).
  `world.applySnapshot(snapshot)` replaces state on a guest. `world.predictPlayer(playerId, inputs)`
  advances only that player's movement one tick, for guest prediction. Both stay deterministic.

## Difficulty scaling by player count

Applied by the director at wave start from the number of connected players, and visible on the HUD.

| Players | Budget multiplier | Unit health | Max alive |
|---------|-------------------|-------------|-----------|
| 1 | 1.0 | 1.0 | 24 |
| 2 | 1.6 | 1.35 | 30 |
| 3 | 2.1 | 1.7 | 36 |

Scrap drops are paid to the player who made the kill. Wave clear pay goes to every living player.
Unit scripts keep their body limits; only health and count scale.

## Netcode

- Tick: the host steps the World at 60 Hz as today. It sends a snapshot at 20 Hz to each guest,
  and reliable events (kills, purchases, phase changes, transmissions, chatter) as they happen.
- Guest: applies snapshots, interpolates units and other players between snapshots (100 ms buffer),
  predicts its own player from local inputs with `predictPlayer`, and reconciles when a snapshot
  arrives (replay unacknowledged inputs on top of the snapshot's player state).
- Guest fire: hitscan runs locally against the interpolated state and sends `hit` messages with
  unit id, part, weapon, and the tick. The host applies the damage if the guest owns that weapon
  and has ammo. Ammo and reload timers run on the host and are mirrored to the guest.
- Messages (JSON over the relay): `join {name}`, `welcome {playerId, seed, rules}`, `input {tick,
  inputs}`, `snapshot {...}`, `event {...}`, `hit {...}`, `purchase {item}`, `ready`, `leave`.
- Disconnects: a guest who drops keeps its player in the world for 10 s, then the player is removed.
  If the host drops, the party ends and guests return to the main menu with a notice.

## UI

- Main menu gains Host Party and Join Party. Host shows the party code, the invite link (LAN and
  tunnel when running), the player list with ready marks, and Start. Join asks for a code or a
  pasted invite link and a name.
- In match: teammates block on the HUD, teammate nameplates in the world with health bars, a downed
  marker for dead teammates, and a spectate camera that cycles teammates with the mouse buttons.
- Post match: one scoreboard with kills, damage, accuracy, and scrap per player, then the dossier.

## Players in the world

Teammates render as resistance soldiers: a human figure in worn fatigues and a vest, carrying the
weapon they hold, with walk, run, aim, fire, reload, hit, and death animations. Built procedurally
like the enemies, same material style.

## Ownership for the build pass

- Core (sol): lib/core/world.js players, sense.players, snapshot and prediction, scaling,
  viewmodel per player, tests.
- Net (sol): server/ party relay, `npm run tunnel`, lib/net/party-host.js, lib/net/party-guest.js,
  prediction and reconciliation, GameManager wiring, tests with two headless clients in one process.
- UI (astra): lib/ui party screens, teammates HUD, spectate, scoreboard.
- Soldier model (astra): generators/soldier*, lib/view/players*.
