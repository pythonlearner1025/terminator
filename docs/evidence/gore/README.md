Gore pass on `pass/gore`. All captures use headless Chrome, 1920 by 1080, High, and all effects.

Headshot kills crush up to 384 skull vertices over 60 ms, extinguish optics, and eject the posed skull.
Detached parts preserve their current pose and dents. Torn sockets expose cables. Fluid and hot fragments use instance pools.
Living leg loss blends into crawling. Explosions disconnect the waist constraint and scatter both arms and legs.
Core code and the saved scene remain unchanged. Fixtures supply the agreed C1 event fields before that branch merges.
Frozen wreck reactions also read existing `shot` events. These reactions respect terrain occlusion and never restart physics.

| Event / part | Weapon | Amount | Result |
| --- | --- | --- | --- |
| Headshot kill | Any | Fatal | Skull crunch, dead optics, detached head |
| Either arm or leg | Any | At least 60% maximum HP in one hit | Struck limb detaches |
| Limb kill | Shotgun | Fatal | Struck limb detaches |
| Kill | Grenade, launcher, shell, explosion | Fatal | Four limbs detach; torso separates from pelvis |
| Body hit | Any | At least 65 | Local mesh dent |
| Body hit | Explosion | Any | Dent and attached scorch |
| Missing anatomy | Any | Any | Bounded sparks, fragments, and fluid |

Each unit retains eight dents. Physics allows eight active ragdolls and 24 active parts.
The 96-piece pool retains settled parts for 180 seconds, then sinks and fades them for two seconds.
Pool exhaustion evicts the oldest part. Frozen ragdolls keep the existing lifetime rule.

| Headless measurement | Before, eight M4 kills | Final, eight M4 kills | Final gore stress |
| --- | ---: | ---: | ---: |
| Average fps | 48.856 | 54.312 | 46.515 |
| Mean interval / CPU work, ms | 20.468 / 18.265 | 18.412 / 15.600 | 21.499 / 19.258 |
| CPU / GPU p99, ms | 23.100 / 12.659 | 24.100 / 15.670 | 27.800 / 14.339 |
| Maximum kill CPU / GPU, ms | 21.600 / 9.796 | 25.200 / 11.845 | 33.200 / 15.728 |

Each run starts with 24 enemies, warms for five seconds, and measures twelve seconds on the Apple M3 Max.
Gore stress reaches eight ragdolls and 24 active pieces. Gore update averages 0.079 ms; physics averages 1.013 ms.
A separate 90-frame test keeps eight complete ragdolls and 24 pieces active throughout.
That test measures 1.316 ms mean combined CPU, 2.200 ms p95, and 2.500 ms maximum.
An earlier gore capture reached 60.005 fps, CPU p99 16.700 ms, and GPU p99 12.370 ms.
Results varied substantially on this shared Mac. The final 60 fps, p99, and kill-spike frame budgets fail.
Gore pools, geometry buffers, and box hulls stay fixed in the tested workload. Global zero allocation remains unverified.
The existing unit pool can allocate after its twelve warmed rigs per type are exhausted.

`npm test`: 126 passed, zero failed. `kite3d check`: Playable, Editable, and Persisted pass.
Editable retains `CAMERA_CONTAINMENT_UNVERIFIED`. The headless proof reports zero errors and zero physics bodies after Stop.
One check exceeded its 10-second frame timeout. The immediate repeat passed all three outcomes.
It verifies intermediate crunch, crawling, torso separation, frozen-wreck hits, lifetime, stable buffers, and unchanged core snapshots.

Screenshots: [skull-crunch.png](skull-crunch.png), [limb-fluid.png](limb-fluid.png), [explosion-split.png](explosion-split.png).
Numbers and proof: [metrics.json](metrics.json). KF2 study notes: [NOTES.md](../../reference/kf2/gore/NOTES.md).
KF2 gaps remain: procedural anatomy, clean chrome, simple socket cuts, limited fluid detail, and conservative box collisions.
The pass changes local vertices; it does not simulate continuous tearing or create new fracture topology.

Reproduce with `npx kite3d dev --port 4720 --no-open`, then `node tools/verify-gore.mjs`.
Measure with `node tools/benchmark-browser.mjs --port=4720 --seconds=12 --warmup=5 --ragdolls=8 --gore=on`.
Stop that server before `npx kite3d check`. Nothing was published.
