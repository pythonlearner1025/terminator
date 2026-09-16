# Reference rebuild workstation — setup/practice only

No revolver was modeled. `Rebuild` is empty. Imported candidate geometry remains
read-only under `Reference/SOURCE`, with source hashes, metadata, and one uniform
alignment transform. `Practice` contains only a generic modeling coupon and a
hinged circle/cylinder child, hidden by default. No game assets, old tools, scene,
or dependencies are changed. Batch usage needs no add-on; interactive control uses the official Blender MCP.

## Create a new workspace

From the repository root, using Blender 5.2.1 (Mac executable typically
`/Applications/Blender.app/Contents/MacOS/Blender`):

```sh
blender -b -t 2 --python-exit-code 1 \
  --python tools/blender/rebuild-workspace/workstation.py -- \
  --setup --reference loafbrr-cc0 \
  --output /absolute/new/folder/output.blend --proof
```

Output must be an explicit **new** `.blend` path. Open that file in the parent's
local Blender UI; the saved camera frames the reference in Studio Workbench.
Textures used by the imported reference are packed into the blend (three packed
images in the default proof). The blend opens independently of Linux source paths.
The script resolves candidate paths relative to its own repository location.

Linux bounded proof command used here (one process at a time):

```sh
systemd-run --user --scope -p MemoryMax=2560M -p TasksMax=192 \
  env DISPLAY=:1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 LP_NUM_THREADS=2 \
  timeout 240 /snap/bin/blender -b -t 2 --python-exit-code 1 \
  --python tools/blender/rebuild-workspace/workstation.py -- \
  --setup --output "$PWD/tools/blender/rebuild-workspace/generated/output.blend" --proof
```

Workbench uses OpenGL; this is not a claim of CPU-only rendering. No Cycles,
game browser, heavy benchmark, or concurrent Blender process was used.

## Reference selection and scale

`--reference` accepts `loafbrr-cc0` (pending-choice default), `pavel-cc0`,
`detective-cc0`, `webley-ccby`, `loafbrr-cc0-hd`, or `kf2-1858-reference`.
The KF2 reference was supplied to the ignored local reference folder. The default
proof uses loafbrr; KF2 has not been tested with this workstation. Override with `--reference-path /path/reference.gltf` or
`.glb`, and optionally `--conversion-path /path/conversion.json`.
Relative overrides resolve against the repository. Missing metadata means native
imported units, with no invented length. No FBX/blend source conversion is included.

`conversion.json` and the existing `tools/blender/external/candidates.json` are
retained as provenance. Default loafbrr length is **0.35 m, declared scaled
reference**, not a physical firearm specification. Geometry's bounding-box center
becomes world zero. A single parent applies translation and uniform scaling along
all axes to match declared X extent; local mesh data and hierarchy stay untouched.
Default imported bounds already match conversion bounds; scale is effectively 1.
There is no automatic per-model rotation, per-view fit, or rebuild fit. Custom
references must already have the intended axes: length X, width Y, up Z, front -X.
Fixed camera scale is 0.48 world units horizontally at 640×480. Change the config
explicitly when establishing a different comparison; keep it fixed thereafter.

## Script API (execute through official Blender MCP)

Load without invoking the CLI or changing the open scene:

```python
import importlib.util
from pathlib import Path
p = Path('/Users/minjunes/games/terminator-wt/revolver-rebuild-setup/tools/blender/rebuild-workspace/workstation.py')
spec = importlib.util.spec_from_file_location('workstation', p)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
w.set_view('left')
w.capture_pair('/absolute/comparison/folder', 'threequarter_left')
```

Presets: `left`, `right`, `top`, `bottom`, `front`, `rear`,
`threequarter_left`, `threequarter_right`, `inspection` (perspective).
Left looks from -Y; rear looks from +X. All angles are degrees:

```python
w.set_view('custom', azimuth=-120, elevation=25, roll=4,
           projection='PERSP', fov=45, ortho_scale=0.48,
           target=[0, 0, 0], distance=1.2)
w.capture_pair('/absolute/comparison/folder', 'custom', mode='silhouette',
               azimuth=-120, elevation=25, roll=4, projection='PERSP',
               fov=45, ortho_scale=0.48, target=[0, 0, 0], distance=1.2)
```

Custom overrides must be passed again to repeat a custom capture; preset defaults
come from the config embedded in the blend. `camera_record()` returns the exact
world matrix, object scale, lens/FOV, orthographic scale, clipping, projection,
resolution and crop settings. JSON files accompany every capture pair. Named
camera objects and parameters persist in the blend; `cameras.json` records all nine.
`capture_pair` changes the active camera/mode and restores collection visibility.
It toggles Reference and Rebuild in the same coordinates with identical lighting,
background, camera, scale and crop. Practice is always excluded. Empty Rebuild
therefore yields a deliberately blank PNG. Source captures are ground truth for
later comparison, not a target raster used to generate geometry.

Modes are `clay` (default), `material` (Workbench material colors, **not** full PBR
texture evaluation), and `silhouette`. `set_view` updates all 3D viewports to the
active camera. For orbit inspection, leave camera view normally in Blender.

## Practice and evidence

`--proof` creates a cube with inset/extrude/bevel operations, plus circle extrusion
and a cylinder operator on a separate child. The child's local origin is its hinge;
frames 1 and 20 test rotation, child-only movement, fixed pivot, and return to rest.
Show `Practice` manually in the Outliner to inspect it, and hide Reference for clarity.
`export_practice(path)` exports only explicitly tagged, exclusively owned Practice
objects. There is no game or Rebuild export path in this setup tool. Imported source
and Practice must never be copied into Rebuild during a later scratch build.

Linux Blender 5.2.1 proof passed:

- Source file hashes, local vertex/topology digest, centered/scaled bounds, and selection locks.
- Empty Rebuild and hidden Practice after save/reopen; all nine camera records unchanged.
- Left, three-quarter, rear PNG pairs; all source vertices inside their frames.
- Repeated side camera exactly equal and **zero changed pixel channels** on this environment.
- Two Practice meshes only in GLB; roundtrip world bounds and projected bounds error both zero.
- Generic child hinge moves only the child, keeps its origin fixed, and reverts at frame 1.
- Importlib does not mutate the scene; all nine presets frame the reference; arbitrary camera
  parameters repeat exactly; material and silhouette capture smoke checks.

The parent also verified the Mac workspace through official Blender MCP: scene
inspection, saved script execution, generic hinge animation, identical custom
camera parameters, reference/rebuild captures, source mesh invariance, and a
window screenshot. `generated/mac-mcp/proof.json` records the local result.
Packed images and repository-relative code paths support transfer; pixel identity
is asserted only within the tested Linux environment, never across GPU/OS versions.
`evidence.json` is the small committed report; generated logs, complete camera
records, reference provenance, PNGs, practice GLB and the packed blend are ignored.

Checkpoint: `ca53a59`, authorized empty Git commit from clean base `4d9a0f3` because
Kite3D/dependencies were absent. No package installation was attempted. Kite3D game
checks are outside this tools-only scope; no game scene was changed.

## Generated transfer paths

All artifacts reside under:

`/home/minjune/games/terminator-v2/revolver-workspace-tools/tools/blender/rebuild-workspace/generated/`

Copy `output.blend`, `manifest.json`, `cameras.json`, `reference.json`, `renders/`,
`repeat/`, `practice-only.glb`, `practice-coupon.png`, `modes/`, and `api-checks.json`.
Use the parent's SSH host alias with SCP; no host alias was assumed by this tool.

## Plan hooks after setup

1. Parent confirms candidate and inspects the source in the local Blender workspace.
2. Freeze reference ID/hash, alignment datum, scale basis, and camera config.
3. Agree on visual part decomposition and articulation boundaries before making meshes.
4. In a future authorized phase, build new bmesh parts only in Rebuild, with explicit
   origins and independent ownership. Do not reuse failed experiments or imported meshes.
5. Compare identical camera pairs at milestones; keep practice/export validation separate.

No part of that future rebuild is implemented by this setup.

## Official MCP connection used locally

Source: https://projects.blender.org/lab/blender_mcp.git
(source commit `ff54e4d8f6b09502f2f466189cca0e52b4a91643`).
Server package 1.0.2; Blender Lab extension 1.0.0; Blender 5.2.1 LTS.
The add-on is enabled in Blender, with its bridge listening on 127.0.0.1:9876.
Blender's Allow Online Access preference is enabled because the add-on requires it.
Codex has a `blender-official` MCP entry. This already-running session uses the
MCP Python SDK client below to call that same official stdio server directly.

The local server environment is `/Users/minjunes/.local/share/blender-official-mcp/.venv`.
Run from this worktree root:

```sh
/Users/minjunes/.local/share/blender-official-mcp/.venv/bin/python \
  tools/blender/rebuild-workspace/mcp_client.py \
  --code-file /absolute/path/to/modeling-script.py
```

The client sends the file to `execute_blender_code`; assign a JSON-serializable
`result` dict to return measurements. It also accepts `--tool`,
`--arguments-file` (JSON), and `--image-output` for the official screenshot tool.
No console typing is involved. `verify_mcp_workspace.py` is the saved setup-only
smoke script; it requires this workspace open and refuses a nonempty Rebuild.
It checks the generic hinge with Practice temporarily visible: Blender skips
animation evaluation for a collection hidden from the viewport.

Reference geometry is still only a candidate import. The next modeling phase
will build independent bmesh parts in Rebuild, then rig moving parts and new
arms, compare fixed views and player views, and validate the glTF game contract.
