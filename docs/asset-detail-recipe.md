# Primitive to detailed prop

Use the barrel as the pilot. Preserve gameplay and saved placements.

1. Read the registry, scene references, asset manifest, and runtime batching code.
2. Record the existing bounds, triangles, materials, draw calls, and frame times.
3. Fetch actual photos and game frames. Keep them under `docs/reference/`.
4. Open every reference. Measure proportions and colours. Record the results in `LOOK.md`.
5. Prefer a CC0 scan. Download into ignored `tools/blender/cache/`. Pin each source hash.
6. Trace the silhouette. Spend triangles on hoops, lips, dents, openings, and bevels.
7. Keep the inner wall aligned with dents. Weld vertices before cutting holes.
8. Use Blender's Manifold Boolean solver for this closed thin shell.
9. Transfer scan UV samples into one atlas. Keep paint, rust, soot, and bare steel separate during baking.
10. Bake albedo, OpenGL normal, packed ORM, and an emissive mask. ORM means occlusion, roughness, and metalness.
11. Match measured photo colours. Put scratches on exposed edges and soot around the mouth.
12. Use one material and one 1024 x 1024 atlas set. Keep the mesh below 6,000 triangles.
13. Emit stable text glTF and a sibling binary. Preserve the asset ID and `f.gltf` route.
14. Register every texture URI in `assets.json`. Put source licences in `assets/LICENSES.md`.
15. Rebuild with `npm run build:barrel`. Run `npm run build:map-assets` to verify integration.
16. Rebuild again. Compare SHA-256 hashes for every output file.
17. Run four visual rounds. Use three-quarter, side, top, and 4x rim and rust crops.
18. Add actual map captures with the fire running. Open every sheet beside the references.
19. Write five measured differences per round. Fix them before the next round. Stop after six rounds at most.
20. Run `npm test`. Execute timing-sensitive test files serially. Keep all assertions. Run `npx kite3d check` on an isolated copy with headless Chrome.
21. Measure 24 enemies at 1920 x 1080. Report CPU, GPU, frame intervals, batching, and host contention.
22. Keep only round sheets, the final four-placement capture, and concise numbers in external evidence.
23. Commit the build source, generated asset, licence records, tests, reference study, and recipe.

Barrel commands:

```sh
npm run build:barrel
blender -b --factory-startup -P tools/blender/barrel/render.py -- 4
node tools/blender/barrel/capture.mjs 4
python3 tools/blender/barrel/sheet.py 4
```

The build needs Blender 5.2.1 and curl. Sheet assembly uses the existing system Pillow package.
Start its isolated server on port 4692 with `npx kite3d dev --port 4692 --no-open`.
The capture scripts enforce this port and headless Chrome.

The barrel keeps radius 0.395 m, height 1.262 m, and centre offset Y 0.011 m.
Its box contract remains 0.8 x 1.3 x 0.8 m. Keep all four scene placements unchanged.
Use no runtime generator. Do not change `lib/core`, the collider registry, or the main scene.

The final barrel uses 5,172 triangles and one material. Four copies merge into one batch.
The wider map, square fire particles, and close-up texture softness still fall short of KF2.
