# Kite3D research notes

Research date: 2026-09-11. It records Kite3D 0.15.0 as it was on that date. The engine rewrite
deleted a large part of what is described below. Read `AGENTS.md` for the API this game uses now.

## Summary

`kite3d` is a new browser game toolkit and local editor. The tested release is 0.15.0. It wraps Threepipe 0.5.1 and a Threepipe fork of three.js 0.163.10003. The renderer is WebGL. Projects use a text glTF scene, native ES modules, Threepipe object components, Cannon physics, HTML overlays, and a token-protected local editor. It is not a pure Node game engine. Its CLI can validate a game in headless Chromium. Pure simulation code must be kept outside the Kite3D runtime if the same logic must run in Node.

## Package identity

These commands were run:

```sh
npx -y kite3d --help
npx -y kite3d --version
npm view kite3d
npm view kite3d readme
npm search kite3d
```

Observed facts:

- The package exists on npm.
- The tested version is `0.15.0`.
- The package requires Node 20 or newer.
- The license is Apache-2.0.
- The npm description is `The Kite3D command and secure localhost development server.`
- The registry timestamp for 0.15.0 is `2026-09-11T17:44:39.538Z`.
- `npm view kite3d readme` returned this exact error:

```text
ERROR: No README data found!
```

- The package has no `repository` or `homepage` field.
- The [npm package](https://www.npmjs.com/package/kite3d) is the package record.
- The [Kite3D site](https://kite3d.dev/) is a small landing page.
- The site says Early Access Coming Soon.
- The site names Threepipe and three.js.
- The site's GitHub link opens the [Threepipe repository](https://github.com/repalash/threepipe).
- No separate public repository for the `kite3d` npm package was found.
- The underlying API docs are the [Threepipe docs](https://threepipe.org/guide/).
- The most complete Kite3D guide is the generated project `AGENTS.md`.

The CLI identifies itself this way:

```text
Kite3D 0.15.0 builds browser 3D games with an agent and a local editor.
```

The package source was inspected. npm cache writes were redirected into the allowed scratchpad. The npx copy was here:

```text
/private/tmp/claude-501/-Users-minjunes-games-terminator/a86dbb37-a1b8-4ebc-88d0-1c5cf6c69e93/scratchpad/.npm-cache/_npx/094ca3e44f59dcaa/node_modules/kite3d
```

The installed project copies were also inspected:

```text
node_modules/kite3d/src
node_modules/@kite3d/engine/src
node_modules/@kite3d/editor/src
node_modules/threepipe/src
```

## Exact scaffold commands

This is the command for the real project. It pins the researched version. The target is already a Git repository.

```sh
cd /Users/minjunes/games/terminator && npx -y kite3d@0.15.0 init .
```

Then install dependencies:

```sh
cd /Users/minjunes/games/terminator && npm install
```

Do not add `--no-git` for the real project. Kite3D detects and uses the existing repository.

The throwaway probe used this exact scaffold command:

```sh
cd /private/tmp/claude-501/-Users-minjunes-games-terminator/a86dbb37-a1b8-4ebc-88d0-1c5cf6c69e93/scratchpad
npm_config_cache=/private/tmp/claude-501/-Users-minjunes-games-terminator/a86dbb37-a1b8-4ebc-88d0-1c5cf6c69e93/scratchpad/.npm-cache npx -y kite3d init kite3d-probe --no-git
```

It printed:

```text
Created Kite3D project at /private/tmp/claude-501/-Users-minjunes-games-terminator/a86dbb37-a1b8-4ebc-88d0-1c5cf6c69e93/scratchpad/kite3d-probe
Git repository: skipped (--no-git)
Next: cd kite3d-probe && npm install && npx kite3d dev
Then read AGENTS.md in the project before you write code. Build, run npx kite3d check, then npx kite3d publish.
```

## Generated tree

This was the fresh scaffold tree. Depth is three. `node_modules` is omitted.

```text
.
├── .gitignore
├── AGENTS.md
├── assets
│   └── main.scene.gltf
├── assets.json
├── icon.svg
├── main.js
├── package.json
└── samples
    └── Spin.script.js
```

Installation added `package-lock.json`. Runtime checks added `.kite3d/`. The screenshot probe added `kite3d-probe.png`.

## Install, build, dev, and test evidence

`npm install` succeeded. It added 109 packages. It reported three moderate vulnerabilities.

The generated project has no build script. `npm run build` was run. It failed with this exact output:

```text
npm error Missing script: "build"
npm error
npm error To see a list of scripts, run:
npm error   npm run
npm error A complete log of this run can be found in: /Users/minjunes/.npm/_logs/2026-09-11T17_52_54_588Z-debug-0.log
```

There is no separate production bundle command in the scaffold. Do not invent one. `kite3d publish` packages source and the registered engine runtime.

The generated npm scripts are:

```json
{
  "scripts": {
    "dev": "kite3d dev",
    "publish": "kite3d publish",
    "pull": "kite3d pull"
  }
}
```

Use these project commands:

```sh
npm run dev
npx kite3d check
npx kite3d doctor
npm run pull
npm run publish
```

The first requested dev port was occupied:

```text
kite3d: Port 4321 is already in use. Choose another port with --port.
```

The server was started on port 44555. It remained live for more than six minutes. `kite3d doctor` saw the live process. An authenticated `GET /api/state` returned HTTP 200. Playwright also loaded the editor from this server.

`npx kite3d check` passed:

```text
Runtime mode: headless
Playable   PASS     The game booted and ran 30 frames without errors.
  Project validation PASS: Project validations passed.
Editable   PASS     NO_VISIBLE_AUTHORED_CONTENT: Stopped-mode authored representation passed.
Persisted  PASS     Save/Reload semantic equivalence passed.
Check passed (0 static row(s)).
```

The empty scene warning is expected. The fresh glTF has no nodes.

`npx kite3d doctor --port 44555` passed Node, version pin, package versions, server, backend, runtime registration, and Playwright. It failed only the Git row. The probe was intentionally created with `--no-git`.

The audit finding is in `fflate` 0.8.2. It is [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98). It can loop on malformed ZIP64 input. Do not accept untrusted archives until Kite3D updates this dependency.

## Rendering stack

Installed versions:

| Package | Version | Role |
| --- | ---: | --- |
| `kite3d` | 0.15.0 | CLI and local server |
| `@kite3d/engine` | 0.15.0 | Runtime and game plugins |
| `@kite3d/editor` | 0.15.0 | Browser editor |
| `threepipe` | 0.5.1 | Viewer, assets, components, and render pipeline |
| `three` | 0.163.10003 | Threepipe's modified three.js build |
| `cannon-es` | 0.20.0 | Physics |

Kite3D creates a Threepipe `ThreeViewer`. Threepipe creates a three.js `WebGLRenderer`. It also wraps an `EffectComposer`. No Kite3D WebGPU runtime path was found. The installed Threepipe source refers to `WebGLRenderer` throughout its renderer interface.

The runtime adds these plugins by default:

- `EntityComponentPlugin`
- `GBufferPlugin`
- `CannonPhysicsPlugin`
- `PopmotionPlugin`
- `GLTFAnimationPlugin`
- `GLTFMeshOptDecodePlugin`
- `KTX2LoadPlugin`
- `KTXLoadPlugin`
- `PLYLoadPlugin`
- `Rhino3dmLoadPlugin`
- `STLLoadPlugin`
- `USDZLoadPlugin`

Tonemapping is enabled by default. `GBufferPlugin` is present by default. Bloom is not present by default.

## Project model

`package.json` points at the scene and runtime entry:

```json
{
  "type": "module",
  "mainScene": "assets/main.scene.gltf",
  "main": "./main.js",
  "devDependencies": {"kite3d": "0.15.0"},
  "kite3d": {"version": "0.15.0"}
}
```

Game code goes in these places:

- `main.js` runs after the scene, components, physics, and timeline start.
- `*.script.js` files define object components.
- `*.plugin.js` files define global viewer plugins.
- Generator modules define deterministic procedural previews.
- `package.json` lists scripts under `kite3d.scripts`.
- `package.json` lists plugins under `kite3d.plugins`.
- `assets/` holds scenes, models, textures, audio, and related resources.
- `assets.json` maps Kite asset IDs to project paths.

The generated `main.js` is minimal:

```js
export async function main({viewer}) {
  window.viewer = viewer
}
```

`main.js` is browser code. Do not import it from Node tests.

## Scene and asset formats

The main scene must be a text `.gltf` file. The parser rejects any other main scene suffix. The default is `assets/main.scene.gltf`. Buffer bytes go in a sibling `.bin` file. Embedded images go under `assets/textures/`. Main scene data URLs are disallowed.

The generated scene is standard glTF 2.0 JSON:

```json
{
  "asset": {"version": "2.0", "generator": "Kite3D"},
  "scene": 0,
  "scenes": [{"name": "Main Scene", "nodes": []}],
  "nodes": []
}
```

Components are stored in node extras:

```json
{
  "extras": {
    "gltfUUID": "stable-object-id",
    "EntityComponentPlugin": {
      "stable-component-id": {
        "type": "Generator",
        "state": {
          "module": "generators/forest.js",
          "params": {"count": 20}
        }
      }
    }
  }
}
```

Preserve `gltfUUID`. Preserve component IDs. Preserve unknown extras and extensions.

Threepipe handles these common formats by default:

- glTF and GLB
- FBX
- OBJ and MTL
- JSON and viewer JSON
- ZIP, GLBZ, and GLTFZ
- HDR and EXR
- PNG, JPEG, WebP, AVIF, BMP, GIF, TIFF, ICO, and SVG
- MP4, OGG, MOV, and WebM video textures
- Draco meshes

Kite3D also registers KTX, KTX2, PLY, Rhino 3DM, STL, USDZ, and meshopt support.

Load a project asset with a same-origin URL:

```js
const enemy = await this.ctx.viewer.load('/kite3d/assets/enemy.glb')
```

Use glTF or GLB for production character and map assets. Use the text glTF only for the main authored scene.

## Key API excerpts

These excerpts come from the installed packages or the generated guide.

### 1. Runtime creation

`createGame` starts the timeline, components, physics, and `main.js`. `createStoppedGame` omits those starts.

```ts
export function createGame(options: CreateGameOptions): Promise<CreatedGame> {
    return createProjectGame(options, true)
}

export function createStoppedGame(options: CreateGameOptions): Promise<CreatedGame> {
    return createProjectGame(options, false)
}
```

Both functions still require a browser canvas and an HTTP base URL.

### 2. Object component lifecycle

The sample component shows the per-frame update contract. `deltaTime` is milliseconds.

```js
import {Object3DComponent} from 'threepipe'

export class Spin extends Object3DComponent {
  static ComponentType = 'Spin'
  speed = 1
  static StateProperties = ['speed']

  update({deltaTime}) {
    this.object.rotation.y += this.speed * deltaTime / 1000
    return true
  }
}
```

Lifecycle methods are `init`, `start`, `update`, `preFrame`, `stop`, and `destroy`. `update` runs only during Play. `preFrame` also runs in edit mode. Returning true marks the viewer dirty.

### 3. Component queries and attachment

Use the plugin instance for current APIs:

```js
const ecp = viewer.getPlugin(EntityComponentPlugin)
const action = ecp.addComponent(object, EnemyDataComponent)
const enemy = action.component
const allEnemies = ecp.getComponentsOfType(EnemyDataComponent)
```

The `HtmlUiComponent.md` file shows an older static `AddComponent` spelling. The installed `EntityComponentPlugin` source exposes instance `addComponent`. Prefer the instance method.

### 4. Procedural meshes

The generated guide gives this Generator shape:

```js
export default async function generate({node, params, viewer, engine}) {
  for (let index = 0; index < params.count; index += 1) {
    const child = new engine.Group()
    child.name = `Tree ${index + 1}`
    node.add(child)
  }
}
```

Use `Mesh2` and `PhysicalMaterial` for supported lit meshes:

```js
import {BoxGeometry, Mesh2, PhysicalMaterial} from 'threepipe'

const mesh = new Mesh2(
  new BoxGeometry(1, 1, 1),
  new PhysicalMaterial({color: 0x808080}),
)
node.add(mesh)
```

Generator output is temporary. It is excluded from scene saves. `npx kite3d bake "Node Name"` converts it to authored children.

### 5. Input and FPS camera

There is no complete action mapping system. Components own browser listeners.

```js
start() {
  this._onKeyDown = (e) => { /* handle key */ }
  window.addEventListener('keydown', this._onKeyDown)
}
stop() {
  window.removeEventListener('keydown', this._onKeyDown)
}
```

Threepipe includes `PointerLockControlsPlugin`. It is not in Kite3D's default runtime plugin list. Add it explicitly. Set the main camera controls mode to `pointerLock`. Automated tests still need a cursor-aim fallback. Headless browsers normally refuse pointer lock.

### 6. HUD and overlay UI

`HtmlUiComponent` supports `world`, `screen`, and `viewport` modes.

```js
const hud = ecp.addComponent(object, HtmlUiComponent).component
hud.positionMode = 'screen'
hud.offsetX = 10
hud.offsetY = 10
hud.interactable = false
hud.setHtml('<div class="hud">HP 100</div>')
```

The component appends a div to `viewer.container` by default. The editor canvas is only the center pane. A custom fixed HUD must copy `viewer.canvas.getBoundingClientRect()`. Update it when the canvas moves or resizes.

`HtmlUiComponent` assigns `innerHTML`. Never pass untrusted NPC output to it without sanitizing.

### 7. Physics

The engine creates Cannon physics automatically. Body types are `static`, `dynamic`, and `kinematic`.

```js
const bodyAction = ecp.addComponent(object, Cannon3DBodyComponent)
bodyAction.component.type = 'dynamic'
bodyAction.component.mass = 1

const shapeAction = ecp.addComponent(object, Cannon3DShapeComponent)
shapeAction.component.type = 'autoBox'
```

The plugin gravity is `(0, -9.81, 0)`. It calls `world.fixedStep()` from a viewer `preFrame` handler. Contacts dispatch `onBeginContact` and `onEndContact` to object components.

`CannonRagdollComponent` is built in. It scans `SkinnedMesh` objects. Its default bone aliases include common Mixamo names.

### 8. Audio

Kite3D has no dedicated audio manager or audio component. Threepipe re-exports the three.js audio classes.

```js
import {AudioListener, AudioLoader, PositionalAudio} from 'threepipe'

const listener = new AudioListener()
viewer.scene.mainCamera.add(listener)
const sound = new PositionalAudio(listener)
new AudioLoader().load('/kite3d/assets/shot.ogg', buffer => {
  sound.setBuffer(buffer)
  sound.play()
})
```

Browsers require a user gesture before audio playback. Keep audio outside authoritative simulation state.

### 9. Lighting, shadows, and skeletal animation

The generated guide recommends a hemisphere fill and directional key:

```js
import {DirectionalLight, HemisphereLight, TonemapPlugin} from 'threepipe'

const fill = new HemisphereLight(0xb8d8ff, 0x30343f, 1.5)
const key = new DirectionalLight(0xfff1d6, 2.5)
key.position.set(5, 8, 4)
key.target.position.set(0, 0, 0)
viewer.scene.addObject(fill)
viewer.scene.addObject(key)
viewer.getPlugin(TonemapPlugin).exposure = 1
```

The WebGL shadow map is enabled by Threepipe. It defaults to `PCFShadowMap`. Set `key.castShadow = true`. Set mesh `castShadow` and `receiveShadow`. Call `viewer.renderManager.resetShadows()` after manual changes that need a shadow refresh.

`GLTFAnimationPlugin` is installed by default. It manages standard three.js `AnimationClip`, `AnimationAction`, and `AnimationMixer` objects.

```js
const animation = viewer.getPlugin(GLTFAnimationPlugin)
animation.loopAnimations = true
await animation.playClip('Walk')
```

Load skinned animation from glTF or GLB. Use `animation.animations` for custom action blending.

### 10. Bloom and emissive materials

Bloom comes from `@threepipe/webgi-plugins`. The installed editor has version 0.5.11. A game must declare it directly before importing it.

```js
import {BloomPlugin} from '@threepipe/webgi-plugins'

const bloom = await viewer.addPlugin(BloomPlugin)
material.emissive.set(0xff2200)
material.emissiveIntensity = 4
BloomPlugin.AddBloomData(material, {enable: true})
bloom.setDirty?.()
```

The package calls this HDR bloom. `BloomPluginPass` exposes threshold, soft threshold, intensity, iterations, radius, and power. Check the `@threepipe/webgi-plugins` license before shipping. Its installed README describes a modified GPL-3.0-only license and separate terms.

## Headless feasibility

### What works

- `npx kite3d check` runs the game in headless Chromium.
- The probe booted for 30 frames.
- Playable, Editable, and Persisted passed.
- Node can import `@kite3d/engine` after an `ImageData` stub.
- Node can import pure project modules.
- `cannon-es` can run directly in Node.

The direct Cannon test ran 60 fixed ticks:

```text
{"nodeCannonStep":true,"yAfter60Ticks":0.49999715372957587,"bodyCount":2}
```

### What does not work

`createGame` is not a pure Node API. It requires `HTMLCanvasElement`, `window`, fetchable project files, WebGL, and an absolute HTTP or HTTPS base. `createStoppedGame` avoids starting gameplay. It still creates `ThreeViewer` and needs the browser surface.

This Node call was attempted:

```js
await createGame({base: 'file:///probe/', canvas: {}})
```

It failed with:

```text
createGame Node attempt: createGame base must be an absolute HTTP(S) URL
```

Kite3D's static check imports component files in Node with `window`, event, and `ImageData` stubs. It only enumerates component types. It does not execute the full game.

### Recommendation

Keep all authoritative state in pure modules. Do not import `threepipe`, `@kite3d/engine`, DOM APIs, Web Audio, or Kite components there. Use a fixed tick. Use a seeded random generator. Pass commands and sensor snapshots as plain data.

Use a layout like this:

```text
assets/
  main.scene.gltf
main.js
src/
  sim/
    state.js
    tick.js
    rng.js
    commands.js
    wave-director.js
    combat.js
    collision.js
    telemetry.js
    npc/
      protocol.js
      sandbox.js
  shared/
    messages.js
    ids.js
  client/
    GameBridge.script.js
    render-sync.js
    input.js
    hud.js
    audio.js
  server/
    lobby.js
    session.js
test/
  sim/
  protocol/
  fixtures/
```

`src/sim/tick.js` should expose one deterministic function:

```js
export function stepGame(state, commands, fixedDelta, random) {
  // Return the next state and events as plain data.
}
```

`GameBridge.script.js` should own one simulation instance in the browser. It should sample input into commands. It should step on a fixed accumulator. It should apply snapshots to Threepipe objects. Rendering may interpolate. It must not write render transforms back into authoritative state.

The simulator should import `src/sim` directly. The lobby should import `src/sim`, `src/shared/messages.js`, and server code. It should not import Kite3D.

Declare the bridge under `kite3d.scripts`:

```json
{
  "kite3d": {
    "version": "0.15.0",
    "scripts": ["./src/client/GameBridge.script.js"]
  }
}
```

Add a real Node test script. The scaffold does not provide one:

```json
{
  "scripts": {
    "test": "node --test test/**/*.test.js",
    "check": "kite3d check"
  }
}
```

Run both layers:

```sh
npm test
npm run check
```

### NPC script sandbox

Kite3D project scripts are native ES modules. They run with page privileges. They are not a sandbox. The editor file named `SandboxPlugin.ts` is fully commented out. It was a dynamic plugin loader, not a security boundary.

Do not import LLM-written NPC code as Kite3D components. Run it inside a dedicated isolate. A QuickJS WASM worker is a practical browser option. A dedicated Node worker or isolate is a server option. Give scripts plain sensor input. Accept only plain actuator output. Enforce fuel, memory, and wall-clock limits outside the script. Terminate a worker on overrun.

## Screenshot feasibility and evidence

Checks found:

- No global `playwright` command.
- No top-level `@playwright/test` package.
- `playwright` 1.63.0 was installed through Kite3D's optional dependency.
- `npx playwright --version` printed `Version 1.63.0`.
- Kite3D doctor found its cached Chromium installation.
- Google Chrome exists at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.

The actual screenshot used Playwright with that Google Chrome executable. It did not use the cached Playwright browser. The script read the secret URL from `.kite3d/dev.json` and did not print it.

```js
const dev = JSON.parse(await fs.readFile('.kite3d/dev.json', 'utf8'))
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
await page.goto(dev.url, {waitUntil: 'domcontentloaded'})
await page.getByTestId('play').click()
await page.waitForFunction(() => Boolean(window.viewer))
await page.screenshot({path: 'kite3d-probe.png', fullPage: true})
await browser.close()
```

Observed browser state:

```text
title: Kite Editor
status text: Playing
window.viewer: true
canvas count: 7
console warnings: 0
console errors: 0
page errors: 0
```

Screenshot details:

```text
Path: /private/tmp/claude-501/-Users-minjunes-games-terminator/a86dbb37-a1b8-4ebc-88d0-1c5cf6c69e93/scratchpad/kite3d-probe/kite3d-probe.png
Size: 1440 x 1001
SHA-256: 36c75b6063db1045580e647ce30ed2aca7d93e401b6026acd663a628ecd6a1a4
```

The screenshot shows the full editor in Play mode. The viewport is blank because the fresh scene is empty.

That release's editor selectors no longer apply. Current browser harnesses import
`test/helpers/editor-driver.mjs`, wait for `window.kite3dProjectLoaded`, and use the editor's
Edit/Run controls and `.editorCanvasContainer canvas` through that adapter.

For FPS screenshots, expose a deterministic test mode. Accept synthetic aim coordinates. Do not require pointer lock. Use `page.keyboard` for movement. Read assertions from `window.terminator`.

## AI agent features

Kite3D 0.15.0 is explicitly agent-oriented.

- Every scaffold includes a 1,052-line `AGENTS.md`.
- The guide documents engine APIs, file rules, cleanup, validation, and publishing.
- `kite3d checkpoint` creates a Git recovery point.
- `kite3d restore` restores a checkpoint without rewriting history.
- `kite3d journal` reports human scene edits.
- `kite3d check` validates Playable, Editable, and Persisted outcomes.
- `kite3d bake` converts procedural previews into authored scene nodes.
- `kite3d sources` locates the installed Threepipe source.
- The local API exposes state, files, events, check, bake, and publish operations.
- The local API uses a secret token. Keep `.kite3d/dev.json` private.

The editor distribution contains `llms.txt`:

```text
# Kite3D Editor

- Agent guide: /agents.md
```

The local dev server returned HTTP 200 for `/llms.txt`. It returned HTTP 404 for `/agents.md`. The public `kite3d.dev` site returned HTTP 404 for both paths. No `SKILL.md` ships in the inspected packages.

`npm search kite3d` also found `@kite3d/mcp-bridge` 0.0.2. Its metadata points to [repalash/threepipe-blueprint-editor](https://github.com/repalash/threepipe-blueprint-editor). It advertises an MCP server and WebSocket bridge. `kite3d` 0.15.0 does not depend on it. The tested editor showed no MCP connection UI. Compatibility with the current local editor is not established. Do not make it part of the architecture without a separate compatibility test.

## Blockers and risks

- There is no scaffold build script.
- There is no scaffold unit test script.
- The public Kite3D site is only a landing page.
- The npm package has no README.
- No separate public Kite3D source repository was found.
- The shipped `llms.txt` points to a missing `agents.md`.
- The runtime does not run as a pure Node game.
- The built-in Cannon plugin steps from the render loop.
- Native project scripts are not sandboxed.
- Headless pointer lock is unreliable by design.
- The tested install has three moderate npm audit findings through `fflate`.
- The release was published on the research date. Expect API churn.
- The bloom package has license terms that need review.

These are not blockers for the proposed game if the simulation, NPC sandbox, and lobby remain separate from Kite3D. Kite3D can serve as the browser renderer, scene editor, asset loader, component host, and release checker.
