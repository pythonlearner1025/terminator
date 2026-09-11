# W10 HUD and UX checklist

The running-game browser flow passes with **zero console warnings or errors**. The real core
purchase API, lobby HTTP join/copy/status, pause, settings, Ready, Play Again, and dossier fetch
were exercised. See [results.json](results.json).

**Acceptance is still blocked:** `npx kite3d check` fails with "The game did not render 30 frames within 10 seconds."
Playable, Editable, and Persisted all fail at that runtime gate. Static checks pass.

The final Kite3D check is recorded separately in [check.json](check.json) and [check-output.txt](check-output.txt).
Its result must be read independently from the browser flow. See [gaps.md](gaps.md) for external
integration issues and the view-model fields supplied by read-only adapters.

## Capture method

Run `node docs/evidence/w10/capture.mjs` with the W10 dev server on port 4800 and a local lobby
server on port 7802. The script reads its private dev URL from `/tmp/terminator-w10-dev.json`
(or `W10_DEV_CONFIG`) without printing it. `W10_LOBBY_URL` can select a different local lobby.

Playwright boots the project's normal `createGame` runtime from the W10 server. A generated
`runtime.html` avoids the editor's hot reload interrupting captures while other agents edit files.
The driver uses `window.terminator.world` and `document.exitPointerLock()`.

All screenshots are 1920 x 1080 except the four files explicitly marked 1280 or 2560. Scenarios
place actors, apply core damage, set attack cooldowns and rev/fallback display state, and shorten
waves to capture specific states. Mouse fire, movement, body hits, headshots, reload, Ready, and
purchases use the actual core. The displayed dossier was submitted by the local **W10 TEST AGENT**
fixture through the real HTTP API. These are staged scenarios, not evidence of a natural ten-wave run.
The driver freezes each rendered simulation frame and CSS animations during screenshot readback,
then resumes them. This preserves transient hit markers and damage indicators on busy hardware.

## Spec coverage

| Element or screen | Running-game screenshot |
| --- | --- |
| Health number and animated red bar; armor number and blue bar | [View](07-under-fire.png) |
| Low-health vignette and critical pulse | [View](08-low-health.png) |
| Weapon name and line icon; magazine and reserve; grenades | [View](09-reloading.png) |
| Low magazine warning and reload progress ring | [View](09-reloading.png) |
| Wave count, terminator icon bar, remaining units | [View](07-under-fire.png) |
| Trader countdown, ready hint and crate distance marker | [View](12-intermission.png) |
| Skynet name, connection dot, budget, multiplier and rev labels | [View](07-under-fire.png) |
| Skynet transmission typewriter | [View](09-reloading.png) |
| Scrap icon and counter; fading kill feed | [View](11-headshot-kill.png) |
| Dynamic crosshair, headshot and kill marker | [View](11-headshot-kill.png) |
| Directional damage arcs | [View](07-under-fire.png) |
| Projected unit nameplates, health, rev and chatter subtitle | [View](07-under-fire.png) |
| Trader categories; weapon names, icons, prices and stat bars | [View](13-trader-weapons.png) |
| Trader loadout, Scrap, fill ammo, full armor and remaining time | [View](13-trader-weapons.png) |
| Trader successful purchase through core API and balance feedback | [View](14-trader-purchase.png) |
| Insufficient Scrap shakes the red price | [View](14-trader-denied.png) |
| Ammo category | [View](15-trader-ammo.png) |
| Armor category | [View](15-trader-armor.png) |
| Items category | [View](15-trader-items.png) |
| Main menu, all navigation actions, version, cursor-tracking SVG skull | [View](01-main-menu.png) |
| Lobby code, MCP install line and copy action, map and Start | [View](04-lobby-waiting.png) |
| Live agent connection, status change and power-on | [View](05-lobby-connected.png) |
| Pause with blur, Resume, Settings, Quit to menu | [View](10-pause.png) |
| Persistent sensitivity, FOV, volumes and quality settings | [View](02-settings.png) |
| Quit screen | [View](03-quit.png) |
| Post-match result, waves, kills by type, accuracy, damage, Scrap, time | [View](19-postmatch-dossier.png) |
| Dossier markdown typewriter | [View](18-postmatch-typing.png) |
| Dossier traits, confidence bars and Play Again | [View](19-postmatch-dossier.png) |
| Dossier available from main menu | [View](20-dossier-library.png) |
| Wave start slam | [View](06-wave-start.png) |
| Wave clear Scrap tally | [View](12-intermission.png) |
| 1280 x 720 trader layout | [View](16-trader-1280.png) |
| 2560 x 1440 trader layout | [View](16-trader-2560.png) |
| 1280 x 720 combat layout | [View](17-hud-1280.png) |
| 2560 x 1440 combat layout | [View](17-hud-2560.png) |
| Skynet fallback count above zero and deployed revs | [View](07-under-fire.png) |
| Empty magazine flashes red | [View](09-empty-magazine.png) |
| Standard hit marker | [View](22-hit-marker.png) |
| Heavier red headshot marker | [View](23-headshot-marker.png) |
| SURVIVED result and Play Again | [View](21-survived.png) |
| Condensed font, angular panels, scanlines and Resistance/Skynet/warning palette | [View](13-trader-weapons.png) |
| Camera kick on fire; Heavy and grenade shake hooks | [View](22-hit-marker.png) |
| 40 ms headshot kill hit-stop | [View](11-headshot-kill.png) |
| Stable number widths and no horizontal scrolling | [View](17-hud-1280.png) |

## Additional checks

- [UI component results](ui-components-results.json): all eight screens fit at 1280 x 720,
  1920 x 1080, and 2560 x 1440; purchase rejection, escaped markdown/traits, and DOM cleanup pass.
  These are explicitly labelled isolated component fixtures and are separate from game evidence.
- [Camera feel results](feel-results.json): fire kick, nearby Heavy shake, grenade shake,
  distance filtering, application to the camera, and cleanup pass.
- The running-game driver measures the 40 ms headshot kill pause and verifies the world tick
  stays fixed during Pause. It checks the persisted FOV after returning to the main menu.
- The UI's HUD, screens, style node, and listeners are removed by GameManager.stop().
- The main menu uses an original SVG skull with red eyes that track the cursor.
- Barlow Condensed is bundled in `assets/fonts/` with its SIL OFL license.
- The initial named no-op audio hooks were subsequently connected by the concurrent audio workstream.

