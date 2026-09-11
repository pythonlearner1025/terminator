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

One mode: Judgment Day + Model Update. One map. Three unit types. Intermissions with a trader.
Sandboxed JS scripts with fuel. A headless simulator. A dossier. A lobby an external agent connects to.
A built-in fallback Skynet so the game plays without an agent.

## Workstreams and status

Legend: [ ] todo, [~] in progress, [x] done, [!] blocked

- [x] W0 Brainstorm and plan
- [x] W1 Discover kite3d: scaffold, API, headless, screenshots (codex, sol). See docs/kite3d-notes.md
- [x] W2 Scaffold the project with `npx kite3d` and lay down the architecture skeleton
- [ ] W3 FPS core: controller, weapons, hit detection, damage, one map with cover and spawns (visual: astra)
- [ ] W4 Enemies: three unit types built to docs/art-reference.md, animation, hit reactions, death (astra)
- [ ] W5 NPC script runtime: sandbox, fuel cap, sensor API, actuator API, default scripts per unit
- [ ] W6 Wave director: waves, intermissions, budget, map knobs, unit points, telemetry capture
- [ ] W7 Headless simulator: deterministic logic run, ghost replay of the human, call caps
- [ ] W8 Skynet lobby server: protocol, connect code, telemetry stream, config and script submission
- [ ] W9 Built-in Skynet fallback + reference LLM client
- [ ] W10 HUD and UX to KF2 quality: HUD, trader, menus, lobby screen, dossier screen (astra)
- [ ] W11 Dossier store and post-match screen
- [ ] W12 Audio
- [ ] W13 Integration QA: play it, screenshot it, test the edges, write the evidence

## Open items

- Reference image file is not on disk. The art agent builds to the written description in
  docs/art-reference.md until `assets/reference/t800-endoskeleton.png` is dropped in.
