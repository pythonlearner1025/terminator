# Three-player lobby QA

## Verdict

The full three-player lobby works through the deployed signaling service.

All peers joined from the invite link. Both data channels opened for each guest.

All three players earned wave-one kills through normal firing. All players bought ammunition during intermission.

The party reached wave-two intermission. The wipe showed three-row scoreboards on all pages.

The same party code and roster survived the return. All players started wave one again.

The final headless run reported no console errors and no failed assertions.

`npx kite3d check` passed Playable, Editable, and Persisted.

## Test conditions

The harness used three isolated Chromium contexts. Chromium ran headlessly.

Kite3D ran on port 4740 with `--no-open`. The signaling origin was the deployed worker.

The baseline and each load row ran for six seconds. A catch-up clock drove 60 simulation ticks each second.

CPU p99 measures one party simulation step. It excludes view synchronization, compositor work, and GPU work.

Four other processes exceeded 20 percent CPU at launch. One was an unrelated Node process.

Three other processes exceeded 20 percent CPU during every measured row.

They were the owner's Chrome renderer, Chrome GPU process, and WindowServer.

The normal three-player director established `maxAlive=36`.

The harness replaced its zero-time schedule and called `spawnDueUnits()` for exact enemy counts.

The combat helper moved one-HP targets into range. It then used host melee and guest fire inputs.

Damage, kill credit, and phase progression used the normal game paths.

The raw record contains all per-second desync samples and WebRTC statistics.

## Baseline connection

Room creation took 318 ms.

| Guest | Room creation to channels open | Join start to channels open | Channels open to welcome |
|---|---:|---:|---:|
| Sarah | 1,310 ms | 338 ms | 70 ms |
| Kyle | 1,516 ms | 134 ms | 83 ms |

The host and Sarah gathered `host` and `srflx` candidates. Kyle gathered `host` candidates.

Both selected paths were UDP host-to-host paths. No relay candidate was gathered or selected.

| View | Peer | Sent | Received | RTT | State messages sent/received |
|---|---|---:|---:|---:|---:|
| Host | Sarah | 184,513.451 B/s | 13,141.315 B/s | 1 ms | 120 / 360 |
| Host | Kyle | 184,513.451 B/s | 13,105.115 B/s | 1 ms | 120 / 359 |
| Sarah | Host | 13,141.315 B/s | 184,513.451 B/s | 1 ms | 360 / 120 |
| Kyle | Host | 13,105.115 B/s | 184,513.451 B/s | 1 ms | 359 / 120 |

| Guest | Snapshots received | Inputs sent | Application state loss | Snapshot bytes median/p99/max |
|---|---:|---:|---:|---:|
| Sarah | 19.927/s | 59.781/s | 0 | 9,350 / 10,589 / 10,629 |
| Kyle | 19.927/s | 59.615/s | 0 | 9,350 / 10,589 / 10,629 |

Chromium does not expose `packetsLost` for SCTP data channels.

The harness therefore counts missing state snapshots at the application layer.

## Load matrix

| Enemies | Host CPU p99 | Guest CPU p99, Sarah/Kyle | Snapshot bytes median/p99/max | Snapshot Hz, Sarah/Kyle | Input Hz, Sarah/Kyle | State loss, Sarah/Kyle | RTT, Sarah/Kyle | Maximum desync, Sarah/Kyle | Other heavy processes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 12 | 1.7 ms | 0.3 / 0.3 ms | 22,775 / 28,715 / 28,716 | 19.885 / 19.885 | 59.984 / 59.984 | 0 / 0 | 1 / 1 ms | 0.268 / 0.303 m | 3 |
| 24 | 2.2 ms | 0.3 / 0.3 ms | 33,092 / 40,168 / 40,703 | 19.888 / 19.888 | 59.993 / 59.993 | 0 / 0 | 1 / 1 ms | 0.289 / 0.329 m | 3 |
| 36 | 2.7 ms | 0.2 / 0.2 ms | 41,184 / 48,912 / 49,054 | 20.016 / 20.016 | 60.049 / 60.049 | 0 / 0 | 1 / 0 ms | 0.307 / 0.276 m | 3 |

The 36-enemy maximum snapshot stayed 16,482 bytes below the 64 KiB limit.

The snapshot rate is a frozen 20 Hz protocol constant. No 30 Hz knob exists.

## Signaling service churn

The harness created 30 rooms while the real match ran with 36 enemies.

Each room connected one host and two guests. All 90 fake peers received welcomes.

| Metric | Count | Minimum | Median | p95 | p99 | Maximum | Mean |
|---|---:|---:|---:|---:|---:|---:|---:|
| Room creation | 30 | 330.272 ms | 491.218 ms | 580.002 ms | 581.087 ms | 581.087 ms | 496.512 ms |
| WebSocket welcome | 90 | 77.366 ms | 180.550 ms | 671.305 ms | 3,201.975 ms | 3,201.975 ms | 256.049 ms |

The signaling churn produced zero errors. It did not affect the match.

Both guests stayed connected. They received 20.016 snapshots/s and sent 60.049 inputs/s.

## Guest churn

Kyle dropped and rejoined twice during wave two.

| Cycle | Recovery time | Player ID retained | Resume token retained |
|---:|---:|---|---|
| 1 | 370 ms | Yes | Yes |
| 2 | 591 ms | Yes | Yes |

## Latency and loss injection

CDP network emulation does not shape WebRTC data channels. The harness did not use it.

The harness delayed Sarah's incoming state messages after WebRTC delivery.

It dropped every fiftieth state message. This produces deterministic two-percent application loss.

This method does not emulate ICE, UDP, SCTP, congestion control, or retransmission behavior.

| One-way delay | Requested loss | Dropped state messages | Snapshot rate | Maximum remote-position error | Connected |
|---:|---:|---:|---:|---:|---|
| 100 ms | 2% | 2 | 19.508/s | 0.675 m | Yes |
| 250 ms | 2% | 2 | 19.276/s | 1.047 m | Yes |

Remote-position accuracy degraded first. No disconnect, phase failure, or snapshot-rate collapse occurred.

## Wipe and restart timeline

All timestamps use UTC.

| Timestamp | Event |
|---|---|
| 2026-09-12T10:16:26.356Z | The host created room KQDWR6. |
| 2026-09-12T10:16:27.975Z | Both guests opened both data channels. |
| 2026-09-12T10:16:29.691Z | All three reached wave one. |
| 2026-09-12T10:16:37.620Z | All three had kills. All three reached intermission. |
| 2026-09-12T10:16:37.889Z | All three completed trader purchases. |
| 2026-09-12T10:16:37.961Z | All three reached wave two. |
| 2026-09-12T10:16:59.525Z | Kyle completed both drop-and-rejoin cycles. |
| 2026-09-12T10:17:12.286Z | All three reached wave-two intermission. |
| 2026-09-12T10:17:12.354Z | All three entered wave three for the wipe. |
| 2026-09-12T10:17:12.568Z | All three scoreboards showed three rows. |
| 2026-09-12T10:17:13.070Z | The same code and roster returned to the party lobby. |
| 2026-09-12T10:17:15.425Z | The same party reached wave one again. |

## Failures and limitations

The final run found no game or signaling failure. `test/e2e/lobby-load.mjs` passed.

The 30 Hz comparison was unavailable because the game has no snapshot-rate knob.

True WebRTC latency and packet loss were unavailable through headless Chromium CDP.

SCTP packet-loss counters were unavailable. Application snapshot loss was zero in all measured load rows.

## Evidence files

- [Raw JSON](./raw-results.json)
- [Host during wave two](./host-mid-wave-2.png)
- [Guest during 36 enemies](./guest-36-enemies.png)
- [Party lobby after the wipe](./party-lobby-after-wipe.png)
