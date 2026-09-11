# W10 integration gaps

The UI does not add gameplay rules to the core or mutate the saved scene.

## Purchase API resolved during integration

The core workstream added `World.purchase(item)` and `World.traderViewModel()` during this task.
The trader now calls those APIs directly. It does not calculate prices or apply purchases itself.
The earlier missing-API error remains a defensive fallback if the API is removed:

```
Purchase unavailable: World.purchase is not installed.
```

Action IDs are `m4`, `shotgun`, `plasma`, `ammo:pistol`, `ammo:m4`, `ammo:shotgun`,
`ammo:plasma`, `fill-ammo`, `full-armor`, `grenade`, and `medkit`. The price projection supplies
`{fillAmmo, fullArmor, medkit}`. The purchase result supplies `{ok, error?, name?, price?}`.

## View-model omissions

`projectViewModel` has no trader position or distance, total scheduled wave population, count of
pending spawns, weapon catalog, owned loadout, coming-wave budget during intermission, aggregate
match statistics, dossier, or lobby install information. `lib/ui/presentation.js` reads the existing
World and WaveDirector objects without changing them. Dossier and lobby information come from
LobbyClient and the documented HTTP endpoint.

The core exports current sprint stamina but no maximum. The display-only constant
`SPRINT_MAX_SECONDS_PLACEHOLDER = 6` names this missing value explicitly.

`hitMarkers.kind` collapses a headshot kill into `kill`; the camera-feel hook reads the original
kill event's `headshot` flag for its 40 ms hit-stop.

## Lobby integration

The client arrived during this task. It has no headless presentation option. UiSession replaces
`showLobby`, `renderConnectedLobby`, and `useLocalFallback` on its own LobbyClient instance and
restores them during cleanup. Network requests, polling, and director integration remain in
`lib/net/lobby-client.js`. Offline fallback waits for the player's Start action.

No dossier is invented for built-in Skynet. `DOSSIER_UNAVAILABLE_PLACEHOLDER` displays
"No dossier received" until a server dossier is available. Evidence uses a clearly identified
local test agent and a dossier fixture submitted through the real endpoint.

## Initial external runtime blocker

The first browser and Kite3D checks failed on a concurrent sandbox dependency change:

```
Failed to resolve module specifier "quickjs-emscripten/dist/chunk-OHAYRCBA". Relative references must start with either "/", "./", or "../".
```

That file is outside W10 ownership. See `results.json` and `check.json` for the final observed status.

## Viewer disposal issue observed after the full flow

The normal game flow completed with an empty console error list. Calling the engine's full
`CreatedGame.dispose()` then raised this error (separate from GameManager.stop / UI cleanup):

```
SSAOPlugin: pass/viewer not created yet
```

Installed `threepipe/src/plugins/pipeline/SSAOPlugin.ts` registers
`renderManager.gbufferUnpackExtensionChanged` in `onAdded` but does not detach it in `onRemove`.
`lib/view/post.js` removes SSAO at Stop, leaving that callback behind. When the viewer subsequently
removes GBuffer, the removed SSAO callback throws. The map/post-processing owner can detach
`plugin._gbufferUnpackExtensionChanged` from the render manager before removing its SSAO plugin.
W10 does not edit this view file.

## Final CLI status

Static project checks pass. The last two checks against the isolated port-4800 server fail at the
headless runtime frame gate, with this exact error:

```
The game did not render 30 frames within 10 seconds.
```

Playable, Editable, and Persisted are all reported as FAIL. This remains an unmet acceptance
criterion. The standalone browser flow and all UI/feel tests pass. No map, post-processing,
engine package, or headless-check timeout was altered by W10 to bypass this failure.
