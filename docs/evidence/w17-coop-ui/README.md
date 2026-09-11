# Co-op UI evidence

All PNGs are 1920 x 1080, captured with headless Playwright. No desktop windows were opened, activated, moved, resized, or recorded. The UI server runs on port 4595 with `--no-open`. Nothing was published.

## Screens and states

| Screenshots | Coverage |
| --- | --- |
| [01](01-main-menu.png) | Main menu with Host Party and Join Party |
| [02](02-host-create.png), [03](03-host-service-unavailable.png) | Host creation and unavailable-service fallback |
| [04](04-host-one-player.png), [05](05-host-two-players-waiting.png), [06](06-host-three-players-waiting.png) | One, two, and three-player rosters and core difficulty previews; LAN and tunnel invite fields |
| [07](07-host-override.png), [08](08-host-everyone-ready.png) | Explicit host override and everyone-ready Start states |
| [09](09-join-empty.png), [10](10-join-bad-code.png), [11](11-join-pasted-invite.png) | Join form, bad code, and pasted invite |
| [12](12-guest-connected-not-ready.png), [13](13-guest-ready.png) | Guest connected and ready states |
| [14](14-join-relay-unreachable.png), [15](15-join-party-full.png), [16](16-join-host-left.png), [17](17-host-left-main-notice.png) | Relay unreachable, party full, host-left join error, and main-menu departure notice |
| [18](18-match-teammates-nameplates.png), [19](19-match-teammate-downed.png) | Teammate HUD, health bars, armor, distance, world nameplates, downed marker, and three-player scaling |
| [20](20-spectating-reese.png), [21](21-spectating-blair.png), [22](22-spectating-one-survivor.png), [23](23-next-wave-respawn.png) | Spectate targets, mouse cycling, one remaining survivor, and respawn |
| [24](24-postmatch-scoreboard.png), [25](25-postmatch-dossier.png), [33](33-postmatch-partial-history.png) | Per-player scoreboard, subsequent dossier, and partial-history disclosure |
| [26](26-relay-host-created.png), [27](27-relay-host-two-players.png), [28](28-relay-guest-connected.png), [29](29-relay-squad-ready.png) | Actual GameManager hooks and WebSocket relay: host creation, guest join, and ready marks |
| [30](30-relay-guest-in-match.png), [31](31-relay-guest-spectating.png), [32](32-relay-host-left.png) | Actual guest HUD and scaling, spectate following a death snapshot, and host departure |

## What was exercised

`capture.mjs` uses two isolated browser contexts and explicit UI fixtures. Its badge identifies fixture screenshots. It mounts the actual game, UI, models, and camera. The party hooks are controlled stubs in this suite; the tunnel URLs are examples, not a running public tunnel. The unavailable-service screen deliberately disables the hook. Scoreboard events are deterministic test data, not a claimed completed match. Clipboard calls are intercepted to check their exact contents.

`relay-capture.mjs` uses the existing `test/server/helpers.js` server pattern and real `GameManager.startHost`, `joinParty`, `setPartyReady`, `startMatch`, and `leaveParty`. Host and guest have separate browser contexts. Guest movement uses real input messages and host simulation steps. Death and respawn are controlled host-side triggers sent through actual snapshots. No public tunnel or third-party player was used.

The capture runtime renders on demand. Its UI remains 1920 x 1080. This prevents two unchanged menus from continuously rendering the scene during screenshots. Finite CSS animations finish before capture. Spectate cycling is tested with headless mouse input on the canvas; pointer lock is not required.

- [results.json](results.json): 30 fixture assertions, including input restoration, both mouse directions, target departure, cleanup, and partial-history labeling.
- [relay-results.json](relay-results.json): 9 real-relay assertions.
- [ui.test.mjs](ui.test.mjs): 5 Node tests for parsing, error classification, cancellation, readiness, and match-wide score attribution.
- [kite3d-native-check.json](kite3d-native-check.json): Playable, Editable, and Persisted pass using the unchanged Kite3D runtime checker in headless full Chromium.
- [kite3d-check.json](kite3d-check.json): all 15 static CLI checks pass; the default headless-shell runtime timed out at 45 seconds. That launcher limitation remains recorded, rather than being presented as a CLI pass.

## Contracts and remaining data limits

- Party hooks are provided by the concurrent netcode work. The UI subscribes through `onPartyState` and also reads `partyState`; their current field names are used directly. It handles readiness, invites, errors, match start, host departure, and listener cleanup.
- The current core `nameplates` array contains enemy plates. `lib/ui/coop-view.js` adds missing teammate entries from read-only world positions into that same presentation channel. If core starts supplying teammate entries, existing IDs are preserved instead of duplicated.
- The core view-model does not expose a cumulative per-player scoreboard. `presentation.js` aggregates the received match event history. Damage means damage dealt, accuracy counts the player's own shots, and scrap means final balance. Enemy shots that identify a player as their target do not count as player shots. A disconnected player's unavailable balance is shown as N/A. A guest whose snapshot cursor exceeds its available history gets an explicit partial-history note. Complete results for late joiners need cumulative totals or complete history from the host.
- The spectate adapter reads player positions and never changes authoritative player state. It uses the configured FOV, hides the followed body only during rendering, restores weapon visibility on respawn, and removes listeners on Stop. The single GameManager mounting hook was committed separately as `3872c32`.

## Reproduce

From the project directory, keep the UI server running:

```sh
npx kite3d dev --port 4595 --no-open > /tmp/terminator-w17-dev.log 2>&1
```

In another terminal:

```sh
node --test docs/evidence/w17-coop-ui/ui.test.mjs
node docs/evidence/w17-coop-ui/capture.mjs
node docs/evidence/w17-coop-ui/relay-capture.mjs
node docs/evidence/w17-coop-ui/check-local.mjs
node docs/evidence/w17-coop-ui/native-check.mjs
```

The scripts read the private session URL without printing it. `check-local.mjs` runs `npx kite3d check` from an isolated temporary directory with symlinks to the same source and a private connection file for port 4595. This avoids sending check commands to another agent's server through the shared `.kite3d/dev.json`. Its temporary files are removed afterward. `native-check.mjs` invokes the unchanged checker with headless full Chromium and records its outcomes separately.
