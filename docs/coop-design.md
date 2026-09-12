# Co-op design: party of up to three

## Shape

Host-authoritative. One player hosts. The host's browser runs the World, the wave director, the
built-in Skynet, and the Skynet lobby relay, exactly as single player does today. Up to two guests
join with a party code. Guests send inputs. The host sends snapshots. Guests predict their own
movement locally so their controls feel instant. Guests resolve hitscan against the last snapshot.
Each shot travels with its input. The host applies damage, runs unit brains, waves, economy, and telemetry.

Why host-authoritative and not a hosted server: no new infrastructure, the headless core already
runs in the browser, and co-op against AI has no cheating problem worth a server.

## Transport and invite

- The host creates a six-character room through the platform signaling service.
- The default service is `https://blitz-games-signal.blitzapp.workers.dev`.
- Each browser keeps one signaling WebSocket open for party discovery and ICE exchange.
- Signaling carries only offers, answers, ICE candidates, pings, and peer membership.
- The host initiates one WebRTC connection to each guest in a star topology.
- The ordered `reliable` channel carries joins, readiness, purchases, events, and chat.
- The unordered `state` channel carries guest inputs and 20 Hz host snapshots.
- Network snapshots omit growing replay and telemetry history to stay below WebRTC message limits.
- Phase-changing snapshots use the reliable channel. Periodic snapshots use the state channel.
- Game traffic becomes peer-to-peer after both data channels open.
- Invites use `https://<current-origin>/?party=ABC234`.
- A `?signal=https://...` override is copied into invites for development.
- WebRTC is the default transport. The legacy WebSocket relay runs only with `?relay=...` for LAN use.

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
- Guest fire: hitscan runs locally against the interpolated state. The `input` message carries the
  unit id, part, weapon, and shot tick. The host validates ownership and ammo before applying damage.
- Messages (JSON over WebRTC data channels): `join {name}`, `welcome {playerId, seed, rules}`, `input {tick,
  inputs, shot}`, `snapshot {...}`, `event {...}`, `purchase {item}`, `ready`, `loaded`, `leave`.
- Snapshots can arrive out of order. Guests reject older ticks and retain the highest input acknowledgement.
- Match start uses `prepare`, `loaded`, and `start`. The host waits for every connected player view.
- A dropped WebRTC guest opens a new signaling session and data-channel pair for the same room.
- The guest resends its resume token. The host reclaims the same player during the 10-second grace period.
- This recovery lives in the party client. `WebRtcTransport` has no independent reconnection layer.
- If the host drops, signaling closes the room. Guests return to the main menu with a notice.
- After a wipe, the scoreboard remains visible. The host returns the existing roster to the same party.

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

## Headless co-op harnesses

- `npm run e2e:coop` runs the 18-step two-browser reliability flow over WebRTC and the signaling stub.
- `npm run e2e:coop-three` proves three players, guest inputs, snapshots, shooting, and wave-one intermission.
- `KITE3D_SIGNAL_MODE=deployed npm run e2e:coop-three` runs the same proof through platform signaling.
- `npm run e2e:webrtc` verifies both data-channel contracts and bidirectional delivery through the stub.

## Ownership for the build pass

- Core (sol): lib/core/world.js players, sense.players, snapshot and prediction, scaling,
  viewmodel per player, tests.
- Net (sol): server/ party relay, `npm run tunnel`, lib/net/party-host.js, lib/net/party-guest.js,
  prediction and reconciliation, GameManager wiring, tests with two headless clients in one process.
- UI (astra): lib/ui party screens, teammates HUD, spectate, scoreboard.
- Soldier model (astra): generators/soldier*, lib/view/players*.
