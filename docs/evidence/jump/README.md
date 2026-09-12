# Jump pass evidence

- `controls.png` shows Jump bound to Space on the live 1920 by 1080 key bindings screen.
- `combat-24.png` shows the live 1920 by 1080 combat benchmark with 24 enemies in view.
- `performance.json` records 17.949 ms mean frame interval, 21.6 ms p95, and 55.713 effective FPS.
- `performance-recheck.json` records 18.250 ms mean frame interval, 22.0 ms p95, and 54.795 effective FPS.

Both performance runs used high quality, render scale 1, all post effects, rain, smoke, two hazards,
24 visible enemies, two enemy shots per frame, and ten impact bursts per second. The 60 FPS target was
not met on these runs. GPU mean time stayed below budget at 9.827 and 10.159 ms, while measured main
thread frame work was 15.366 and 15.801 ms.

`npm test` passed all 98 tests. `npx kite3d check` passed Playable, Editable, and Persisted.

The jump pass adds motion feel, but it does not replace the procedural character or weapon models.
Those silhouettes and repeated enemy presentation remain the clearest gap from Killing Floor 2.
