# The horde is data, not nodes

## The model, in plain words

A Scout is a `role: "common"` unit. Before this pass every live Scout owned a
scene node: a group, about forty bones under it, a skinned mesh, eight optic
emitters. three.js recomputed a world matrix for every one of those nodes on
every render pass, built them into the main render list, built them again into
the shadow-map render list, and uploaded a separate bone palette for each rig.
Sixteen Scouts were about six hundred nodes and sixteen palettes.

Now a Scout owns **a slot number**. That is all. Everything the renderer needs
for that Scout lives in flat arrays indexed by that number:

| Array | One entry per instance | Where it lives |
|---|---|---|
| `instanceMatrix` | 16 floats: position, yaw and the figure's scale | on the instanced mesh |
| `instanceColor` | 3 floats: the hit flash tint | on the instanced mesh |
| `instanceSlot` | 1 float: which slot this draw index reads | an instanced attribute on the geometry |
| bone palette | 28 matrices, 448 floats | one shared `DataTexture` |

**How one draw renders thirty Scouts.** three.js 0.163 has no instanced
skinning. Its `getBoneMatrix(i)` reads bone `i` of the one skeleton bound to the
draw, so every instance in an instanced draw would wear the same pose. This pass
replaces that one function through the material's compile hook:

```glsl
int j = ( int( instanceSlot ) * 28 + int( i ) ) * 4;
```

`instanceSlot` is an instanced attribute, so it is constant across one
instance's vertices and different for the next instance. Bone `i` of instance
`s` is read from row `s * 28 + i` of the shared palette. Nothing else in the
skinning path changes: `skinbase_vertex`, `skinning_vertex` and
`skinnormal_vertex` are the stock chunks, and `project_vertex` applies
`instanceMatrix` after the skinning exactly as it does for any instanced mesh.
So the skinning happens on the GPU, once per vertex, for the whole crowd, in one
draw call.

The same replacement is installed twice: on the surface material through
threepipe's material-extension hook, which owns the program cache key, and on a
`MeshDepthMaterial` mounted as `customDepthMaterial`, which is the program the
shadow pass draws through. Without the second one every instance would cast the
first instance's shadow. No point light in this project casts a shadow, so no
`customDistanceMaterial` is installed.

**Why no node walk happens.** The pose still comes from the same procedural
animator in `lib/view/units-animation.js` — the same `animateUnit`, the same
`plantScout` foot planting against the nav ground, the same flinches. It runs on
**one hidden scratch rig** that is never added to the scene. For each instance
the module loads that instance's twenty-eight bone transforms and its animator
state into the scratch rig, places the scratch root at the unit's world
position, runs `animateUnit`, and writes both back out. It then reads the
scratch skeleton's bone matrices, cancels the scratch root's placement so the
pose is expressed in unit-local space, and copies twenty-eight matrices into the
instance's slot. The instance matrix takes the placement instead.

The renderer never sees the scratch rig. The three nodes it does see — one root
and two LOD meshes — never move, so `holdStill` from `lib/view/hidden-subtrees.js`
takes them out of the per-pass dirty walk as well.

**Two LODs, one set of slots.** Two instanced meshes share the one bone palette:
the high figure (24,512 triangles) inside `instancedLodDistance`, the far figure
(11,004 triangles) beyond it. An instance is in exactly one of them for the
colour pass. The far mesh holds *every* live instance, distant ones first, and
its `count` is raised to cover the whole crowd for the duration of the shadow
pass and dropped again afterwards. So near Scouts still cast shadows, and no
shadow map ever draws the heavy figure.

**Death.** On death the instance's pose is handed to a pooled rig from
`lib/view/ragdoll.js` — the same rigs the specials use — and the slot is freed.
From that moment the corpse is an ordinary rig: cannon-es ragdoll, wreck ember,
the wreck budget, the fade. Nothing downstream of death changed.

## What a common lost

- **No dents.** `GoreDeformer` writes into a per-rig copy of the mesh vertices.
  An instance has no mesh of its own, so a hit leaves no dent decal geometry on
  a living Scout. Dents on the corpse still work, because the corpse is a rig.
- **No dismemberment while alive.** A limb cannot be detached from an instance.
  Blast dismemberment at the moment of death still happens, through the rig.
- **No per-bone view ray.** `hitUnitRig` walks a rig's bind-space triangles to
  find the exact impact point. For a common the view now intersects the
  instance's bounding volume instead. Gameplay is unaffected: the core already
  resolved which part was hit, with its own hit volumes, before the view sees
  the event.
- **No impact dent decals on a living common.** The pooled decal mesh attaches a
  quad to a bone's world matrix; an instance has no bone objects.

## What a common kept

The procedural gait, the foot planting against the nav ground, the flinch, the
stagger, the death fall, the red optics and their flicker (still instanced,
through `UnitOptics`), the sparks and the oil at the impact point, the headshot
burst, the ragdoll, the wreck ember, the fade, and shadows.

A common also gains a per-instance hit flash: `instanceColor` brightens for
0.16 s on damage. A rig had no equivalent.

## Limits

- Only `role: "common"` types take this path, and today that is the Scout alone.
  Specials keep their rigs and are unchanged.
- The weapons range and the F8 showcase keep rigs, so a Scout can still be
  inspected bone by bone.
- Capacity is `world.maxAlive + 8` slots, 40 today. A seventeenth common past
  the table does not fail: it falls back to a rig and is counted in
  `lostSlots`.
- The pose evaluation is the same procedural animator that ran before. Instancing
  removes the scene-graph cost around it, not the cost of the animator itself.
- One bone palette is uploaded per frame as a whole texture, 73,984 bytes.

## The numbers

Machine: Apple M3 Max, macOS 26.1, Chrome headless with `--use-angle=metal
--enable-gpu --disable-gpu-vsync --disable-frame-rate-limit`, 1512x945 at device
pixel ratio 2, High quality. **The machine was not quiet.** Another agent held a
load average between 7 and 18 for the whole session, so absolute frame times
here are not comparable with the numbers in `pass-director-perf`. Every claim
below comes from a paired A/B measured minutes apart, not from two runs hours
apart.

### Resources

| Thing | Value |
|---|---:|
| Slots | `world.maxAlive + 8` = 40 |
| Bones per slot | 28 |
| Bone palette | 68 x 68 RGBA float = **73,984 bytes**, one texture, one upload per frame while anything is alive |
| Scene nodes for the whole horde | **3** (one root, two LOD meshes) |
| Draw calls for the whole horde | **2** in the colour pass, 1 in each shadow map |
| Per-instance arrays | `instanceMatrix` 16 floats, `instanceColor` 3, `instanceSlot` 1 |
| Per-instance animator state | 280 floats of bone pose + 16 scalars + contacts and flinches |

### Pose evaluation

One shared scratch rig, every instance posed in the same frame, quiet Node
process, real Scout asset, real nav ground:

| Instances | p50 | p99 | per instance |
|---:|---:|---:|---:|
| 16 | 0.54 ms | 0.62 ms | 34 us |
| 32 | **1.09 ms** | 1.20 ms | 34 us |

The budget was 1 ms for 32. It costs 1.09 ms when every instance is posed in the
same frame. At the shipped 30 Hz animation rate a 60 fps frame poses each
instance every second frame, so the per-frame average is about half of that; in
the browser the `instanced` span measured 3.0 ms p99 with sixteen live Scouts
under load. This is the same `animateUnit` the rig path ran before. Instancing
removes the scene cost around it, not the animator.

### Scene and draws, same mob, same seed, editor Run

Sixteen Scouts with dummy brains standing 6 m to 15 m away, identical
placements, screenshots `mob-before.png` and `mob-after.png`:

| Measure | Before | After |
|---|---:|---:|
| Nodes under `Units Runtime` | 792 | **168** |
| Nodes under the instanced root | — | 3 |
| Scene objects | 4,458 | **3,837** |
| Skinned meshes in the scene | 65 | **51** |
| Nodes walked per frame | 2,112 | **1,491** |
| Draw calls per frame | 240 | **226** |
| Triangles per frame, shipped LOD | 2,325,444 | 2,433,508 |
| Triangles per frame, both forced to the near figure | 2,541,572 | 2,541,572 |
| Triangles per frame, both forced to the far figure | 2,325,444 | 2,325,444 |

At a matched LOD distance the two paths draw exactly the same triangles; the
instanced path draws them in fewer calls. The shipped numbers differ only
because `instancedLodDistance` is 12 m where the rig path's `lodDistance` is
5 m, so eight of the sixteen Scouts moved up to the near figure: +108,064
triangles, which is exactly 8 x (24,512 - 11,004).

### Nodes walked per frame, all six scenarios

| Scenario | Editor before | Editor after | Standalone before | Standalone after |
|---|---:|---:|---:|---:|
| idle | 1,488 | 1,491 | 1,363 | 1,366 |
| revolver at nothing | 1,488 | 1,491 | 1,363 | 1,366 |
| M4 at nothing | 1,484 | 1,487 | 1,359 | 1,362 |
| M4 into 16 Scouts | 2,420 | **1,799** | 2,295 | **1,674** |
| revolver headshots | 1,956 | **1,608** | 1,870 | **1,405** |
| normal wave 1 | 1,925 | **1,499** | 1,800 | **1,374** |

Idle costs three more nodes: the instanced root and its two meshes, all held
still. Combat saves 350 to 620.

### Frame time, paired A/B, standalone

Four alternating pairs, same build, 20 s each, `--experiment=instanced-off`
routes commons back to per-unit rigs and changes nothing else. Medians of four.

| Scenario | | p50 | p95 | p99 | max | over 33 ms |
|---|---|---:|---:|---:|---:|---:|
| idle | rigs | 8.5 | 12.9 | 14.6 | 17.0 | 0 |
| idle | instanced | 11.9 | 15.0 | 16.6 | 31.6 | 0 |
| M4 into 16 Scouts | rigs | 32.6 | 51.1 | 94.3 | 162.3 | 271 |
| M4 into 16 Scouts | instanced | **23.3** | **43.2** | **63.1** | **79.6** | **114** |
| revolver headshots | rigs | 17.5 | 29.6 | 32.7 | 36.9 | 9 |
| revolver headshots | instanced | **15.8** | 30.3 | 33.0 | **35.6** | 11 |

Self time inside those frames, p99 milliseconds, M4 into 16 Scouts:

| Span | rigs | instanced |
|---|---:|---:|
| `render` | 22.4 | **17.6** |
| unit pose (`units` + `instanced`) | 10.9 | **4.7** |
| `ragdolls` | 14.1 | **9.9** |
| rig clone | 45.8 | **34.0** |

The idle row is an ordering artifact, not a cost. Idle has no units at all, and
the second run of any back-to-back pair measured slower than the first whichever
side it was: in the reverse-order pair the instanced idle run was the faster one
(7.6 ms against 8.0 ms). The horde is the only thing this change touches.

### The target

The frame-time target is p99 under 13.3 ms with no frame over 33 ms in the mob,
headshot and wave scenarios. **It is still missed**, standalone and in the
editor, by a wide margin on this machine on this day. Instancing moved the worst
scenario a third of the way and cut its worst frame in half; it did not close
the gap.

### What is left, measured

V8 profile of the mob scenario after the change, 169,238 samples over 31 s
(`cpuprofile-m4-mob-after.cpuprofile`), share of all main-thread CPU:

| Class | Share | Where |
|---|---:|---|
| Corpse ragdoll physics | 10.2% | cannon-es `project`, `internalStep`, `solve`, `reset`, `vmult` |
| World-matrix updates | 9.9% | `updateMatrixWorld` 9.0% — now mostly the scratch-rig pose evaluation and the corpse rigs, not a scene walk |
| Render-list build | 8.5% | three `projectObject` |
| Matrix multiply | 4.8% | |
| Core simulation | 3.8% | `collision.js queryPrimitives` 2.7%, `rayCollider` 1.1% |
| Draw submission | 1.4% | `renderBufferDirect` |

Recommendations, in size order, all measurements only:

1. **Corpse ragdolls are now the largest single class.** The mob scenario
   sustains about thirty deaths a second and `WRECK_BUDGET` is ten. A smaller
   budget, or freezing a wreck sooner than 0.65 s of quiet, is the next lever.
   Turning ragdolls off in this scenario was worth 14.1 ms p99 before this pass.
2. **Device pixel ratio.** At dpr 1, a quarter of the pixels, the mob scenario
   ran p50 15.3 against 20.3 and p99 32.9 against 34.3. Some of the tail is
   fill, unlike the previous pass where dpr made no difference. That is a
   quality setting and was not changed.
3. **`instancedLodDistance`.** Pulling it from 12 m back to 5 m, matching the
   rig path, did not help in a paired run (p50 25.4 against 20.3 at 12 m), so
   the near figure is not what costs the mob scenario its frame time. 12 m is
   shipped.
4. **SSAO and the two shadow maps** remain what the previous pass measured:
   about 2.0 ms and 1.2 ms per frame. Both are quality settings and were not
   changed.

## One leak closed along the way

threepipe's geometry setter adds a `geometryUpdate` listener to a geometry when
a mesh takes it, and removes that listener only when the same mesh is later
given a *different* geometry. A mesh that is simply dropped stays reachable from
the geometry's listener list, and the geometry stays in the renderer's list for
the life of the page. A heap snapshot of a long match found 752 geometries
carrying 2,615 such callbacks and retaining 773 dead objects.

`lib/view/mesh-release.js` clears the reference, which removes the listener.
Every dispose path in the unit views calls it now: `units.js`,
`instanced-units.js`, `units-fx.js`, `gore.js` and `roster-fx.js`.
`ragdoll.js` creates no mesh of its own — it borrows the owner's and hands it
back — so it has nothing to release.
