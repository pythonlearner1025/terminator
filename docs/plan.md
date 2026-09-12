# Terminator: human vs Skynet. MVP plan

## The idea in one paragraph

A wave-based FPS. The human is the resistance. Skynet is an LLM agent that connects to the lobby.
Skynet never aims. It commands. Between waves it reads telemetry, spends a budget on map changes and
units, and writes the behavior scripts that run each unit at tick rate. Scripts persist as versioned
models. Skynet also keeps a dossier on the human that the human can read after each match.

## Core rules

- The human plays at the frame. The agent plays at the wave. The agent never controls a unit live.
- Constrain the body, not the code. Unit sensors return only what the unit can perceive. Actuators have
  turn rate, aim spread, and a fixed reaction delay. Each script has a CPU fuel cap per tick.
- Game logic runs headless. Rendering is a view over it. The same logic runs in the simulator.
- Rubber-banding is visible. The human sees Skynet's budget at all times.
- Visual quality bar: Killing Floor 2, including HUD and UX.

## MVP scope

One mode: Judgment Day + Model Update. One map. Six unit types. Intermissions with a trader.
Sandboxed JS scripts with fuel. A headless simulator. A dossier. A lobby an external agent connects to.
A built-in fallback Skynet so the game plays without an agent.

## Plan shape

Two checkpoints. The owner plays at each one and gives feedback.

- Checkpoint 1: every system present and playable, rough where it must be. Eight agents build in
  parallel in one tree with disjoint folders. Then the owner plays.
- Checkpoint 2: the owner's feedback fixed and the polish pass. Then the owner plays again.

## Workstreams and status

Legend: [ ] todo, [~] in progress, [x] done, [!] blocked

- [x] W0 Brainstorm and plan
- [x] W1 Discover kite3d: scaffold, API, headless, screenshots. See docs/kite3d-notes.md
- [x] W2 Scaffold the project and the architecture skeleton. See docs/architecture.md
- [x] W3 Map visuals for Bunker 7 (astra). Evidence docs/evidence/w3
- [x] W3b Vertical movement: stairs, balcony, multi-level navigation (sol)
- [x] W4 Enemies built to docs/art-reference.md, animation, hit reactions, death (astra). Evidence docs/evidence/w4
- [x] W5 NPC script runtime: QuickJS sandbox, fuel cap, sensor and actuator API (sol)
- [x] W6 + W7 Wave director, telemetry, event bus, headless simulator with ghost (sol)
- [x] W8 + W9 Lobby server, game relay, MCP server, reference LLM client (sol). Evidence docs/evidence/w8
- [x] W10 HUD and UX: HUD, trader, menus, lobby screen, dossier screen (astra). Evidence docs/evidence/w10
- [x] W11 First-person weapons with hands and animations (astra). Evidence docs/evidence/w11
- [x] W12 Audio: procedural WebAudio, 40 sounds, bindings (sol). Evidence docs/evidence/w12
- [x] Fixes from checkpoint 1 play: right handed controls (1de5880), no re-aim from frozen cursor on click (52de5bb)
- [x] Aim down sights on right mouse, crosshair removed, easier economy, health reset at wave clear (17d2e95, 5709510, b3fd86a)
- [x] Co-op pass (docs/coop-design.md): soldier model, multi-player core, netcode and relay, co-op UI. Two-client relay proof on the final tree: both reach wave 1, 21 Hz snapshots, zero errors. Boot regression fixed (78ad572).
- [x] Checkpoint 1 feedback round: aim down sights, terse then labeled UI, economy, health reset, kite3d 0.16.0 upgrade
- [x] AAA pass (existing level only): audio 439e7d4, materials 855b436, enemies 10ab883, presentation 304e642, weapons 8468bd1, each a squash of its worktree branch. 89 tests, check green
- [x] Performance pass 1 (sol): light previews and lazy PBR fixed the 28 s boot; published as release 703528bb
- [x] Checkpoint 2 feedback fixes, each a squash of its worktree branch: HUD scale slider and subtle HUD, jump, dead bodies no longer block stairs, Scout gallop restored (93c4404 and before)
- [x] Grenades as projectiles with a 2.5 s fuse, bounce, and 4 m blast (c64c81c, sol). 7 tests, evidence docs/evidence/pass-grenade
- [x] Ragdoll deaths on cannon-es, eight active, wrecks stay 180 s then sink and fade (bcc4554, astra). Evidence docs/evidence/ragdoll
- [x] Menu Endo: reflection map path, NaN head turn from a pose without yaw, camera framing (5755a6a, 9558f7c)
- [x] Performance pass 2 (astra, integrated with ragdolls by sol): warmup of shaders, textures, audio, and the death path; fixed pools; stable lights; 1K unit textures. 24 enemies: CPU p99 15.1 to 12.1 ms, first M4 kill 937 to 15 ms (800bf86). Evidence docs/evidence/perf2
- [x] Co-op fix pass: gameplay-only pointer lock, reliable guest prediction and reconnect, lobby return, and two-client proof
- [x] KF2 core pass: enemy projectiles, six-unit roster, bosses, sniper, launcher, telemetry, simulator proof
- [x] KF2 weapon and gore views: real sniper and launcher rigs, projectile visuals, dismemberment, deformation, and crawl state
- [x] Hitbox fit (sol): fitted collision primitives for every prop and unit, ?colliders=1 overlay (7c99d59)
- [x] WebRTC P2P co-op with platform signaling (sol): worker blitz-games-signal on blitz-cloud branch poc/p2p-signaling, lib/net/signaling.js and webrtc.js, relay only behind ?relay= (e9c2341). kite3d docs PR blitzdotdev/kite3d#6
- [x] KF2 tracers: realistic thin exposure streaks with bloom, from real footage (4fa95ed); map expansion with tunnel loop, barracks, colonnade, density (7192b26); pistol is a six-shot revolver (26522ee)
- [~] KF2 phase two: final T-1000, HK-Aerial, HK-Tank visuals and boss bar (astra, pass/roster-visuals); three-player lobby QA through the deployed signaling at 12, 24, 36 enemies (sol, pass/lobby-qa); then a quiet-machine performance pass against the 13.3 ms p99 budget
- [ ] Deferred by the passes: SMG, LMG, and real sculpted endoskeleton and weapon models
- [x] Auto-publish on every master commit from ~/games/terminator-deploy (tools/publish-master.sh, hooks via tools/install-publish-hooks.sh); latest release c87421d1 (26522ee); the owner claimed the game
- [ ] Checkpoint 2: owner hosts a party from the published game with Host Party and the ?party= link and plays with a friend
- [x] Editor bug: toolbar icons blank. Root cause: idle full-rate render loop. PR blitzdotdev/kite3d#4, CI green, unmerged
- [ ] kite3d CLI bug to file: a second `kite3d dev` on another port deletes the shared .kite3d/dev.json on exit and orphans the first server
- [~] Checkpoint 1: tests 54 pass, check passes, editor open on port 4300 in Play, owner playing (2026-09-11)
- [ ] W13 Feedback fixes and polish, then Checkpoint 2

## Open items

- Reference image file is not on disk. The art agent builds to the written description in
  docs/art-reference.md until `assets/reference/t800-endoskeleton.png` is dropped in.
