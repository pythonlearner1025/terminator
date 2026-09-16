# Terminator: Human vs Skynet

Defend Bunker 7 against waves of Skynet machines in a Future War FPS. Fight solo or with two friends against an evolving AI director.

[Play in your browser](https://terminator.app.blitz.dev/) · [Scene development journal](https://terminator-v2-scene-journal.app.teenyapp.com/)

![Courtyard — wrecked vehicles and defensive positions](docs/scene-targets/progress/snapshots/r12-loading-performance-19/images/candidate-01-courtyard.png)

![Cargo yard — containers and burning barrels](docs/scene-targets/progress/snapshots/r12-loading-performance-19/images/candidate-02-cargo.png)

![Barracks — ruined concrete corridors](docs/scene-targets/progress/snapshots/r12-loading-performance-19/images/candidate-03-barracks.png)

![Service passage — exposed pipes and drifting steam](docs/scene-targets/progress/snapshots/r12-loading-performance-19/images/candidate-04-service.png)

![Rooftop — a player view across Bunker 7](docs/scene-targets/progress/snapshots/r12-loading-performance-19/images/candidate-05-rooftop.png)

## The in-wave director

Skynet paces each wave instead of emptying a spawn list. A pacer tracks how hard the wave is pressing
each player, then walks four states: build up, peak, fade, and relax. It spends a wave reservoir on
mobs of scouts, single specials, wanderers, and an end-of-wave rush. Spawns are picked out of sight,
mostly behind you. Mobs run straight at you and shove each other apart. Your health regenerates back
to 40 after five calm seconds, four supply caches glow green somewhere on the map each wave, the
trader moves between waves and opens only in the intermission, and wave 10 ends at an extraction point.
The whole tune lives in `docs/director-design.md`.

## Just play it

`npm run play` serves the game the way the published release runs it: no editor, no Run button, the
project files booted straight through `createGame`. It prints a URL, opens your browser, and stops on
Ctrl-C. The default port is 4500; `--port=<n>` moves it and `--no-open` leaves the browser alone. The
game's own URL flags work as command flags: `--sandbox`, `--range`, `--weapon=revolver-rebuild` and
`--party=<code>`. For example, `npm run play -- --port=4600 --sandbox --no-open`. Use `npx kite3d dev`
instead when you need to edit the scene.

## Local scenes

Install the linked Kite3D rewrite and open the Bunker 7 main scene:

```sh
cd /Users/minjunes/games/terminator
npm install
npx kite3d dev --no-open
```

Open the URL printed by the command and press Run. Add `&weapon=revolver-rebuild` to that URL to opt into the rebuilt revolver without changing the normal pistol loadout.

To play-test the director, run `npx kite3d dev --no-open --port 4400`, open the printed URL, press Run, then Play and Start. Stop the server when you finish, so the next session can take the port.

The gun range is stored separately at `assets/weapons-lab.scene.gltf`. With the editor stopped, open that file from **Project files**, then press Run. The range selects `revolver-rebuild` automatically and exposes its nine animation clips through the range controls. To return to the game, open `assets/main.scene.gltf` from **Project files**.
