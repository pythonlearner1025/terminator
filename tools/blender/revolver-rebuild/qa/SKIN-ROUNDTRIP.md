# Blender → glTF skin pose fidelity

These helpers compare evaluated Blender WORLD vertices with CPU-only Three.js
GLTFLoader/AnimationMixer skinning. They do not start a browser or render a preview.
They read an isolated, immutable copy of the source Blend and its matching export.
No source Blend is saved.

## Reproduce the smoke comparison

Run from the runtime-review checkout. First copy the frozen export and its referenced
resources into ignored `generated/qa-skin-smoke/` while holding
`../coordination/revolver-blender.lock`. Record SHA-256 hashes before copying, after
copying, and for the destination; all three must match. Keep the copy manifest with
the evidence. Do not copy an export that its owner is still writing.

```sh
timeout --kill-after=5s 120s ../coordination/revolver-blender \
  -b "$PWD/tools/blender/revolver-rebuild/generated/qa-skin-smoke/smoke.blend" \
  --python-exit-code 1 \
  -P "$PWD/tools/blender/revolver-rebuild/qa/extract-skin.py" -- \
  --out "$PWD/tools/blender/revolver-rebuild/generated/qa-skin-smoke/blender-skin.json"
node tools/blender/revolver-rebuild/qa/compare-skin.mjs
node --test tools/blender/revolver-rebuild/qa/skin-correspondence.test.mjs
```

The shared Blender wrapper enforces the lock, memory preflight, bounded scope and
two Blender threads. Do not bypass it. The Node step only loads geometry, skin and
animation; texture decoding and rendering are unnecessary for this comparison.

For another frozen export, pass `--gltf`, `--reference`, and `--out` to
`compare-skin.mjs`. The Blender extractor accepts `--mesh` and `--samples FILE`,
where FILE maps named NLA tracks to seconds, for example
`{"Idle":[0,0.016666666666666666,0.03333333333333333],"Fire":[0,0.05,0.1]}`.
Use actual action/strip ranges, recorded in the extracted evidence, rather than
potentially stale root duration metadata. Samples outside the loaded glTF clip
duration are rejected. Current sampling assumes clips start at Blender frame zero.

## Final nine-clip sample plan

```sh
node tools/blender/revolver-rebuild/qa/final-skin-samples.mjs \
  tools/blender/revolver-rebuild/generated/imported-final-frozen/revolver-rebuild.gltf \
  tools/blender/revolver-rebuild/generated/imported-final-frozen/skin-samples.json
```

Pass the generated file as `--samples` to the Blender extractor. This plans 93
instants for the final export, including 33 Reload contacts/transitions and 11 Fire
instants around discharge. Times align to source frames at 60 FPS and use actual
glTF duration accessors, rounded to avoid float32 endpoint overshoot. Between-phase
samples are included; this plan does not certify interpolation between baked frames.

## Method and limits

- Apply the evaluated Blender mesh's complete `matrix_world`, then convert axes
  `[x,y,z] → [x,z,-y]`. Three.js applies loaded skinning and the mesh's `matrixWorld`.
- Establish one correspondence using undeformed bind positions, exported UV layers
  (including the V flip), and normalized weights keyed by bone name. Keep that
  correspondence fixed for every pose. Exported seam duplicates are allowed.
- Coincident source candidates must follow equivalent trajectories across **all
  sampled poses**; otherwise the mapping fails. Coverage includes every source
  vertex in these verified equivalence classes, not just chosen representatives.
- Report max and RMS over source vertices, using the worst export error for each
  seam-duplicated source vertex. Also report statistics over all exported vertices.
- Default pose tolerance is `1e-5 m`; correspondence tolerances are recorded in JSON.
- Compare live source controls with native baked actions after muting native and
  hand attachment constraints as a separate diagnostic. Record constraints at load.
- Check embedded hand mesh metadata, exact native bone inventory, and duplicate
  glTF node names. Record actual clip durations, source motion, input hashes and
  checkout revision. The Blend hash must still match the extractor's hash.

This verifies only the requested samples. It does not establish continuous
animation fidelity, contact quality, material appearance, gameplay, or final asset
approval. Geometry correspondence currently expects a single named skinned mesh,
up to four exported skin influences, and up to four UV layers.

## Smoke result

The six requested Idle/Fire samples passed: max `3.9161361882867424e-7 m`, pooled
RMS `2.2175225693899925e-7 m`. All 4,246 source vertices were covered by 4,255
exported vertices. The 48 ambiguous matches had identical sampled trajectories.
Fire's midpoint moved vertices by up to `0.0014774799067826217 m`.

Evidence lives in ignored `generated/qa-skin-smoke/`: `copy-manifest.json`,
`blender-skin.json`, and `skin-roundtrip.json`. Exact immutable input hashes and
review status are recorded in `coordination/revolver-skin-roundtrip.findings.md`
at the parent workspace level.
