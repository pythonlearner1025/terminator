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
- [~] W12 Audio (sol)
- [~] Checkpoint 1: tests 54 pass, check passes, editor open on port 4300 in Play, owner playing (2026-09-11)
- [ ] W13 Feedback fixes and polish, then Checkpoint 2

## Open items

- Reference image file is not on disk. The art agent builds to the written description in
  docs/art-reference.md until `assets/reference/t800-endoskeleton.png` is dropped in.
