# WebRTC co-op evidence

All browser runs used headless Chromium. The game server used port 4730 with `--no-open`.

## Automated results

- `npm test`: 124 of 124 tests passed.
- `npm run e2e:webrtc`: both channels opened. Each peer received 200 of 200 state messages.
- `npm run e2e:coop`: 18 of 18 assertions passed through the local signaling stub.
- `npm run e2e:coop-three`: all three players reached wave-one intermission with zero errors.
- Deployed signaling: all three players reached wave-one intermission with zero errors.
- `npx kite3d check`: Playable, Editable, and Persisted passed.

## Stub signaling

- Host room creation: 279.5 ms.
- Sarah connection: 369.6 ms.
- Kyle connection: 360.5 ms.
- Each guest sent 60 inputs per simulated second.
- Each guest received 20 snapshots per simulated second.

The full record is in `proof-stub.json`.

## Deployed signaling

The run used `https://blitz-games-signal.blitzapp.workers.dev` without a query override.

- Host room creation: 776.3 ms.
- Sarah connection: 627.1 ms.
- Kyle connection: 601.3 ms.
- Each guest sent 60 inputs per simulated second.
- Each guest received 20 snapshots per simulated second.
- Browser and transport errors: zero.

The full record is in `proof-deployed.json`.

## Failure diagnosis

The old aim helper targeted 84 percent of unit height. Fitted hit volumes do not always cover that point.
The harness now aims at the fitted chest volume. It also preserves input pulses under the manual clock.

WebRTC exposed another limit. Full telemetry history grew snapshots beyond the data-channel message size.
Network snapshots now retain current state and counters while excluding growing historical telemetry arrays.
