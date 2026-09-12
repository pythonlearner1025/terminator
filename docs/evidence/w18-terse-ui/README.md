# W18 terse UI evidence

All 19 measured screens/states meet the 80% text reduction target. The dossier UI is removed. The runtime code is committed at `5de2e7b`; original UI source is `4154573`.

## Measurement method

Headless Playwright reads the actual screen root `innerText`, or the combat root for the HUD, at 1920 x 1080. Whitespace is collapsed to one space and trimmed before counting. Raw strings are retained in [before.json](before.json) and [after.json](after.json). The comparison fails automatically if any result exceeds 20% of its baseline.

Browser `innerText` excludes input values/placeholders, SVG icons, accessible labels, and CSS generated content. Form values are recorded separately in each JSON entry, not silently treated as deleted text. In particular, Join still displays its Code and Relay placeholders; the required host invite is still present in a readonly input. Select `innerText` includes option text. The same method is used on both versions.

[before-initial.json](before-initial.json) is the first measurement, committed before UI edits in `d6eaee8`. Visual review found its gameplay views had not started, so its HUD lacked enemy nameplates. The corrected benchmark starts the real views, uses three visible enemies and five recent kills, and reruns the original UI through read-only Playwright responses from `git show 4154573:lib/ui/...`. No checkout, reset, stash, or source rollback was used. All screen baselines stayed the same; the HUD baselines now include the same visible nameplates as the final capture. Both versions receive identical world/UI fixtures and complete their transmission/dossier typewriters before counting. These are controlled states, not a claimed completed match.

## Counts, cuts and screenshots

| Screen/state | Before | After | Cut | Removed |
| --- | ---: | ---: | ---: | --- |
| [main](main.png) | 325 | 62 | 80.92% | Taglines, captions, build/location text, numbering, footer, dossier entry. |
| [lobby](lobby.png) | 530 | 105 | 80.19% | Briefing, map panel, explanations, fallback notices; status becomes an icon. |
| [host](host.png) | 792 | 51 | 93.56% | Headings, name input, setup instructions, second invite, scaling and readiness prose. |
| [join](join.png) | 668 | 4 | 99.40% | Headings, name input, briefing, roster preview, field helpers and footers. |
| [join-connected](join-connected.png) | 697 | 38 | 94.55% | Connection prose, scaling, role labels and readiness sentences. |
| [settings](settings.png) | 416 | 82 | 80.29% | Descriptions, explanatory panel, footer; control labels shortened to one word. |
| [pause](pause.png) | 58 | 6 | 89.66% | Eyebrow and heading; Settings/Menu use icons, Resume remains. |
| [quit](quit.png) | 92 | 9 | 90.22% | Sign-off and helper sentences. |
| [trader-weapons](trader-weapons.png) | 526 | 80 | 84.79% | Descriptions, weapon stat text, loadout text, headings and footer hints. |
| [trader-ammo](trader-ammo.png) | 310 | 49 | 84.19% | Magazine description, loadout text, headings and footer hints. |
| [trader-armor](trader-armor.png) | 325 | 50 | 84.62% | Armor description, loadout text, headings and footer hints. |
| [trader-items](trader-items.png) | 366 | 59 | 83.88% | Item descriptions, loadout text, headings and footer hints. |
| [postmatch](postmatch.png) | 383 | 43 | 88.77% | Dossier reveal, stat labels, kill breakdown, duration and closing sentences. |
| [scoreboard](scoreboard.png) | 430 | 82 | 80.93% | Descriptions, role/status text, duration, column words, dossier action; names become initials. |
| dossier (removed) | 229 | 0 | 100.00% | Entire screen, entry, reveal, UI fetch/cache and dossier styles. |
| [hud](hud.png) | 628 | 112 | 82.17% | Control prompts, word labels, multiplier/fallback text, uplink header, chatter; feed becomes three icon entries. |
| [intermission](intermission.png) | 710 | 119 | 83.24% | Resupply instructions, crate label, trade prompt and wave-clear prose. |
| [coop-hud](coop-hud.png) | 726 | 145 | 80.03% | Squad heading, scaling words, distances and armor numerals; armor remains a bar. |
| [spectate](spectate.png) | 746 | 144 | 80.70% | Camera heading, respawn sentence, mouse hints and navigation words. |

Every PNG linked above is an unedited 1920 x 1080 headless screenshot. The small fixture badge belongs to the capture harness, outside the UI roots being measured. Utility controls have accessible names; scoreboard initials retain full accessible names and duplicate initials receive a distinguishing number. No foreground browser, desktop automation, recording, publish, or second Kite3D dev server was used.

## Interaction verification

[verification.json](verification.json): **43 passing assertions**, no uncaught browser errors. [verify.mjs](verify.mjs) boots the actual GameManager with two isolated browser contexts and an ephemeral local HTTP/WebSocket relay. It exercises menu navigation, Skynet install copy, solo Start/Pause/Resume, settings persistence, all purchase types and rejection, Ready, Play Again, real party host/join/copy/readiness/override/Start, death/respawn, mouse and button spectate cycling, scoreboard damage taken/accuracy/initials, and cleanup. Damage taken is projected from existing per-player events in `lib/ui/presentation.js`; core data and server APIs are unchanged.

The host transport stored unbound browser `fetch`, causing its invite lookup to throw `Illegal invocation`. The UI adapter binds that existing instance before its asynchronous lookup; injected fetch implementations remain unchanged. A separate small commit records this fix (`b70eb90`).

Additional 1920 x 1080 captures:

- [Host on the real relay](host-real-relay.png)
- [Joined guest on the real relay](join-real-relay.png)
- [Guest spectating after a real death snapshot](spectate-real-relay.png)
- [Invalid code](join-invalid-code.png)
- [Rejected purchase](trader-denied.png)

The scoreboard still depends on received event history; a late guest can have partial totals. That condition is retained in its accessible label. Unknown balances use `?`. Existing damage-dealt projection data remains available, while the displayed column is damage taken. Solo scrap is earned scrap; co-op scrap keeps the existing final-balance projection.

## Project checks

- [npm test](npm-test.txt): **83 passed, 0 failed**.
- [Kite3D CLI output](kite3d-check.txt), [JSON report](kite3d-check.json): **15 static rows pass; Playable, Editable and Persisted pass**, in headless mode. Editable retains the engine's `CAMERA_CONTAINMENT_UNVERIFIED` advisory.
- All final screen controls fit within the 1920 x 1080 viewport. The screenshot set was visually reviewed for clipping, panel layout and text.
- [Terse revision spec](../../hud-ux-spec.md).

## Reproduce

Use the owner's already running server on port 4300. These scripts read `.kite3d/dev.json` at runtime without printing its token; they do not start a dev server.

```sh
node docs/evidence/w18-terse-ui/measure.mjs before
node docs/evidence/w18-terse-ui/measure.mjs after
node docs/evidence/w18-terse-ui/verify.mjs
npm test
npx kite3d check
```
