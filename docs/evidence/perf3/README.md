# Terminator performance pass 3

## Result

This pass preserves High quality, 1080p, enemy counts, effects, textures, and lighting budgets.

It materially improves the heavy fixtures, but it does not meet the requested budgets.

All values use three runs after five warmup seconds and ten capture seconds.

CPU and GPU p99 values are median run values. Maxima cover every retained run.

| Fixture | CPU p99 before→after | GPU p99 before→after | Max before→after | Kill max before→after | Floor before→after | Draws before→after | Triangles before→after | Texture MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard 24 | 20.700→17.600 | 13.656→12.986 | 26.100→23.000 | 26.100→20.200 | 48.309→56.818 | 232→231 | 486,072→481,344 | 549.878 |
| Weapon burst 24 | 17.800→17.900 | 15.297→15.223 | 23.056→21.200 | 21.700→20.200 | 56.180→55.866 | 244→243 | 488,082→483,170 | 549.878 |
| Gore stress 24 | 51.900→15.100 | 92.567→16.018 | 171.989→21.264 | 171.989→20.100 | 10.803→62.430 | 258→237 | 607,608→604,224 | 549.878 |
| Wave 5 boss mix 24 | 29.100→16.400 | 16.835→12.450 | 53.500→18.300 | 32.500→18.300 | 34.364→60.976 | 263→248 | 464,806→460,298 | 549.878 |
| Standard 36 | 22.000→20.500 | 13.870→12.967 | 29.600→24.900 | 29.600→22.200 | 45.455→48.780 | 244→243 | 628,654→623,796 | 549.878 |

## Budget verdict

| Fixture | CPU ≤13.3 | GPU ≤13.3 | Kill ≤20 | Workload floor |
| --- | --- | --- | --- | --- |
| Standard 24 | MISS, 17.600 | PASS, 12.986 | MISS, 20.200 | MISS, 56.818/75 fps |
| Weapon burst 24 | MISS, 17.900 | MISS, 15.223 | MISS, 20.200 | MISS, 55.866/75 fps |
| Gore stress 24 | MISS, 15.100 | MISS, 16.018 | MISS, 20.100 | MISS, 62.430/75 fps |
| Wave 5 boss mix 24 | MISS, 16.400 | PASS, 12.450 | PASS, 18.300 | MISS, 60.976/75 fps |
| Standard 36 | MISS, 20.500 | PASS, 12.967 | MISS, 22.200 | MISS, 48.780/60 fps |

Further reductions require visible quality, density, lighting, or effect changes.

This pass deliberately stops before those compromises.

## Machine gate

The expected deployment publisher exited after the first 60-second poll.

Long-lived owner processes remained, including idle Kite3D servers and an interactive Codex session.

An active weapons-lab Codex repeatedly launched Metal benchmarks during the pass.

The pass waited beyond the requested 20-minute ceiling before continuing.

More Codex jobs arrived later, so the quiet-machine gate never fully cleared.

Baseline load ranged 3.154–8.056, 3.767–5.502, and 4.325–4.939 across the three windows.

After load ranged 3.007–10.981, 4.722–7.419, and 5.351–6.245 across the three windows.

The raw JSON records load immediately before and after every timed capture.

No retained run reports browser warnings.

## Exact fixture state

Standard fixtures retained 24 or 36 rendered enemies throughout their captures.

Wave 5 used eight Heavies, eight T-1000s, seven HK-Aerials, and one HK-Tank.

Wave 5 killed and restored three roster types while preserving 24 alive enemies.

Gore stress killed eight enemies and retained all 24 rendered bodies.

It reached eight active unit ragdolls and 24 active detached pieces in every run.

| Capacity or count | Value |
| --- | ---: |
| Projectile pool | 192 |
| Lit projectile lights | 2 |
| Tracer pool | 256 |
| Impact decals | 72 |
| Retained debris pieces | 96 |
| Active unit ragdolls | 8 |
| Active debris physics | 24 |
| Atmosphere practical sources | 14 |
| Total practical sources | 34 |
| Active practical lights | 4 |
| Warmed renderer programs | 383 |
| Warmed textures | 96 |
| Decoded audio clips | 101 |

No timed capture compiled a shader or uploaded a first-use texture.

| Unit | High triangles | Low triangles |
| --- | ---: | ---: |
| Scout | 24,512 | 11,004 |
| Endo | 25,492 | 11,712 |
| Heavy | 27,088 | 12,252 |
| T-1000 | 29,828 | 12,052 |
| HK-Aerial | 8,276 | 4,572 |
| HK-Tank | 16,676 | 8,644 |

## Per-system cost

Each cell shows before→after milliseconds per frame.

| Fixture | Units | HUD | Map | Player | Weapons | Ragdolls | FX | Gore | Projectiles | Tracers |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard 24 | 1.277→0.967 | 0.231→0.116 | 0.160→0.156 | 0.183→0.174 | 0.140→0.131 | 0.079→0.071 | 0.074→0.076 | 0.014→0.010 | 0.004→0.004 | 0.004→0.004 |
| Weapon burst 24 | 1.199→0.938 | 0.209→0.118 | 0.143→0.148 | 0.198→0.189 | 0.170→0.161 | 0.069→0.070 | 0.069→0.069 | 0.011→0.009 | 0.054→0.072 | 0.014→0.014 |
| Gore stress 24 | 4.760→1.358 | 0.357→0.096 | 0.264→0.122 | 0.324→0.125 | 0.245→0.096 | 2.638→0.781 | 0.205→0.121 | 0.107→0.055 | 0.004→0.004 | 0.010→0.004 |
| Wave 5 boss mix 24 | 1.266→0.629 | 0.289→0.107 | 0.215→0.158 | 0.214→0.155 | 0.163→0.119 | 0.127→0.045 | 0.103→0.085 | 0.033→0.023 | 0.006→0.004 | 0.007→0.004 |
| Standard 36 | 1.738→1.231 | 0.256→0.143 | 0.149→0.144 | 0.181→0.188 | 0.140→0.151 | 0.084→0.073 | 0.078→0.072 | 0.012→0.011 | 0.005→0.005 | 0.004→0.004 |

The JSON summaries retain combat, audio, deformation, damage, and wreck-system costs.

## Per-pass cost

Each cell shows before→after milliseconds per frame.

| Fixture | Render | G-buffer | SSAO | Map bloom | Screen |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard 24 | 7.474→6.972 | 4.456→3.914 | 0.046→0.038 | 0.122→0.115 | 0.058→0.054 |
| Weapon burst 24 | 7.001→6.845 | 3.881→3.564 | 0.041→0.039 | 0.112→0.108 | 0.058→0.051 |
| Gore stress 24 | 16.459→5.097 | 6.673→2.571 | 0.089→0.027 | 0.258→0.091 | 0.130→0.040 |
| Wave 5 boss mix 24 | 12.784→6.749 | 5.313→3.156 | 0.073→0.034 | 0.201→0.110 | 0.100→0.058 |
| Standard 36 | 7.654→7.620 | 4.098→4.320 | 0.039→0.044 | 0.114→0.118 | 0.056→0.055 |

## Changes and measured effects

- Conservative offscreen LOD and static-transform skipping reduced unit cost 22–72 percent.
- Thirty-hertz HUD projection reduced HUD cost 44–73 percent.
- HK-Aerial beam instancing helped reduce Wave 5 draw calls from 263 to 248.
- Batched detached limbs helped reduce gore draw calls from 258 to 237.
- The combined gore path reduced CPU p99 71 percent and GPU p99 83 percent.
- Shared ORM sampling preserved PBR channels while avoiding two redundant texture reads.
- Distant skyline silhouettes stopped contributing meaningless gameplay SSAO.
- Live-prefix uploads limited dynamic buffer transfers to active instances.
- Nearest-projectile selection retained the original two-light budget.
- Warmup now covers every tracer, projectile, weapon, and both projectile-light shader states.
- Warmup eliminated timed shader compilation and first-use texture uploads.
- Texture residency remained exactly 549.878 MiB.

## Validation

- `npm test`: 211 of 211 tests passed.
- `npx kite3d check`: Playable, Editable, and Persisted passed headlessly.
- Post-fix play sessions added no console warnings or errors.
- `git diff --check` passed.
- No screenshots were captured because this pass changed performance plumbing, not visible content.

## Evidence index

- `before.json` and `before.md` contain baseline aggregates and worst frames.
- `after.json` and `after.md` contain final aggregates and worst frames.
- `after-runs/` contains all fifteen retained raw captures.
- `discarded-concurrent/` contains samples rejected for concurrent benchmark activity.
- `discarded-four-lights/` contains the reverted four-projectile-light experiment.
- `discarded-owner-activity/` contains samples rejected for owner GPU activity.
- `discarded-shader-error/` contains superseded samples from shader-order investigation.
