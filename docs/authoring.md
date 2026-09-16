# Authoring placed assets

## Nested asset contract

A placed asset is a glTF node with `extras.rootPath` and `extras.sProperties`.
Kite3D copies glTF `extras` into `Object3D.userData` when it loads the scene.
Use a URL in this form:

```text
/kite3d/@<asset-id>/f.gltf
```

Use these saved overrides:

```json
{
  "rootPath": "/kite3d/@map-sandbag-stack/f.gltf",
  "sProperties": ["visible", "name", "position", "quaternion", "scale"]
}
```

Unit wrappers use an empty `sProperties` list and `rootPathOptions.createUniqueNames: false`.
Map wrappers use the five transform and visibility overrides shown above.

The runtime nested loader recognizes `rootPath` only when `sProperties` is an array.
It clones the asset children and excludes those clones from scene export.
It preserves the placed node's name, visibility, position, quaternion, and scale.
See `node_modules/@kite3d/engine/src/runtime/nestedAssets.ts:16-17`,
`node_modules/@kite3d/engine/src/runtime/nestedAssets.ts:53-107`, and
`node_modules/@kite3d/engine/src/runtime/nestedAssets.ts:140-196`.

The editor creates the same metadata during file import.
It uses the five override names above.
See `/Users/minjunes/blitz/packages/editor/src/utils/ViewerInstanceManager.ts:71` and
`/Users/minjunes/blitz/packages/editor/src/utils/ViewerInstanceManager.ts:980-1011`.
The editor Inspector treats this root as an asset instance and limits edits to those overrides.
See `/Users/minjunes/blitz/packages/editor/src/components/ObjectInspectorUI.tsx:52-65` and
`/Users/minjunes/blitz/packages/editor/src/components/ObjectInspectorUI.tsx:127-145`.

## Asset manifest contract

`assets.json` has version `1` and a `files` object.
Each key is the stable asset ID used after `/kite3d/@`.
Each value has a project-relative `path` to its root file.
Text glTF assets can also provide a `files` map for exact resource resolution.

```json
{
  "version": 1,
  "files": {
    "map-sandbag-stack": {
      "path": "assets/models/map/sandbag-stack/sandbag-stack.gltf",
      "files": {
        "f.gltf": "assets/models/map/sandbag-stack/sandbag-stack.gltf",
        "sandbag-stack.bin": "assets/models/map/sandbag-stack/sandbag-stack.bin"
      }
    }
  }
}
```

The project format defines each manifest entry as `path` plus an optional resource map.
See `node_modules/@kite3d/engine/src/runtime/projectFormat.ts:19-25`.
Asset URLs resolve through that map.
See `node_modules/@kite3d/engine/src/runtime/projectFormat.ts:27-47`.
The editor writes the same entry shape.
See `/Users/minjunes/blitz/packages/editor/src/utils/ViewerInstanceManager.ts:1018-1039`.
It generates `/kite3d/@<id>/f.<extension>` URLs.
See `/Users/minjunes/blitz/packages/editor/src/utils/ViewerInstanceManager.ts:1478-1481`.

## Map ownership

The saved scene owns every map-piece placement and transform.
Map asset files own local visual geometry at the placement anchor.
The map-piece registry owns local collider shapes and simulation flags.
`lib/core/data/map.json` keeps non-visual rules, surfaces, gates, doors, switches, hazards, and starts.
Play derives world colliders by applying each saved scene transform to the registry shape.
Edit mode keeps every placed asset visible and selectable.
Play mode hides placed asset geometry while runtime material batches are active.
Stop removes the batches and restores placed asset visibility.

## Unit ownership

The scene owns one wrapper for each enemy unit and the Resistance Soldier.
Each wrapper uses a `unit-<type>` manifest entry and a type-specific glTF filename.
The unit asset owns its high-detail figure, skeleton, parts, materials, and textures.
Enemy assets also own a hidden far-detail figure for runtime LOD.
Play clones unit figures from the nested loader cache.
The menu clones the placed Endo, and player views clone the placed Soldier.
No unit wrapper uses a Generator component.

## Build and edit workflow

Run `npm run build:assets` after changing map, unit, or range build inputs.
The command builds textures, map assets, unit assets, and range assets in that order.
It creates or updates the Bunker 7 scene layout last.
After migration, it preserves human transforms, asset replacements, and deletions.
Set `RESET_MAP_PLACEMENTS=1` only when the canonical layout must replace those edits.

`assets/models/map/<piece>/<piece>.gltf` stores geometry in local anchor space.
Each text glTF uses one sibling binary file.
Its image URIs point at shared files under `assets/textures/map/`.
The builder writes all asset IDs and resources into `assets.json`.
The current build writes 69 reusable asset types for 266 placed nodes.
Ninety-nine bunker-shell nodes scale one shared shell asset while retaining independent transforms.

`Map / Bunker 7` contains the `Walls`, `Floors`, `Props`, and `Gates` groups.
Each child below those groups is one nested asset root.
Select that root to move, replace, rename, hide, or delete the piece.

`assets/models/units/<type>/<type>.gltf` stores each unit with one sibling binary file.
The unit files reference shared textures under `assets/textures/units/` and `assets/textures/roster/`.
`tools/build-unit-assets.mjs` updates the seven `unit-*` entries without removing map entries.
`tools/build-map-assets.mjs` updates the 69 `map-*` entries without removing unit entries.
`tools/build-range-assets.mjs` updates two `range-*` entries for the optional range mode.

## Data split

The migration moved collider centers, sizes, shapes, kinds, and visual placement transforms out of `map.json`.
`lib/core/data/map-piece-registry.json` now stores collider shapes in asset-local coordinates.
`lib/core/data/map-piece-placements.json` provides the initial canonical layout for scene generation.
The saved scene becomes the placement source after generation.

`map.json` keeps deterministic non-visual rules.
These include spawn gates, doors, switches, hazards, lights, starts, surfaces, fog, vents, and sparks.
`scripts/GameManager.script.js` reads placed nodes when Play starts.
`lib/core/map.js` applies their transforms to the registry shapes.
`World`, collision, and navigation receive that derived map.

## Generator retirement

The project has no `generators/` directory and registers no Generator component.
Build-only figure code lives under `tools/lib/`.
Runtime material adapters live under `lib/view/`.
The Python texture bakes live beside other build code under `tools/`.

## Range fixture ownership

The optional range is a Play-time mode, not authored Bunker 7 content.
Therefore, range placement during Play is acceptable.
`tools/build-range-assets.mjs` writes the steel target and firing-line files under `assets/models/range/`.
It also registers `range-steel-target` and `range-firing-line` in `assets.json`.
`lib/view/range-props.js` loads those files and places six target nodes during Play.
It creates no visible geometry.
Stop removes all loaded range nodes through `RuntimeObjectOwner`.

## Weapons Lab scene

The integrated game keeps Bunker 7 in `assets/main.scene.gltf` and the authored gun range in
`assets/weapons-lab.scene.gltf`. Run `npm run scene:lab` to rebuild only the gun range scene.
Run `npm install` and `npm run build:assets` to create shared unit and range assets.
`node tools/build-lab-assets.mjs` writes three lab fixture assets and updates the placed lab assets.
It creates separate placed nodes for six plates and eighteen range targets.
Run `node tools/build-lab-assets.mjs` again to confirm that the lab migration is deterministic.

## Evidence location

Historical evidence and all new agent evidence live under `/Users/minjunes/games/terminator-evidence/docs/evidence/`.
The repository keeps only `docs/evidence/README.md` as a pointer.
The publish exclusions retain `docs/**`, so evidence and tracked study frames never ship.

## Weapon asset ownership

The eight weapons and shared hand rig are placed glTF assets under `assets/models/weapons/`.
Run `npm run weapons` to rebuild the procedural packages.
Then run `npm run build:revolver` to restore the Blender-authored pistol, embedded hands, and animation clips.
The revolver provides Idle, Draw, Fire, Reload, AimIn, AimOut, AimIdle, Sprint, and Inspect clips.
Its first-person mixer consumes gameplay state without changing shot, damage, ammunition, or reload timing.
`lib/view/weapon-assets.js` loads the placed sources for first-person and third-person clones.
The active first-person rig owns its cloned animation mixer and cleans it during Stop.
All weapon proof outputs belong under `/Users/minjunes/games/terminator-evidence/docs/evidence/`.

## Swing-out source follow-up

The swing-out variant remains incomplete. See `tools/blender/swingout/TODO.md` for current acceptance status.
Run `npm run build:swingout` to rebuild its glTF package and editable `tools/blender/swingout/swingout.blend`.
The committed neutral hand scan makes the build independent of the downloaded reference cache.

Keep Frame, Crane, Cylinder, Ejector, Hammer, Trigger, Latch, Loader, and LoaderButton names stable.
Keep Case0–Case5, Fresh0–Fresh5, Bullet0–Bullet5, Muzzle, Ejection, CylinderGapLeft, and CylinderGapRight names stable.
The nine clip names and `assets/models/weapons/swingout/` remain unchanged.
Blender owns hand poses, gun motion, rod motion, and initial case flight.
The view adapter applies ammunition masks and coordinates the visible bullet with the authored discharge time.
Functional checks pass, but the skin audit still fails. The source does not meet the hand contact bar.
