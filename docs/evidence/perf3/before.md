# Performance pass 3: before

The machine had no competing Codex exec, Playwright runner, headless Chromium, or deployment process.

Load average ranges were 3.154-8.056 at one minute, 3.767-5.502 at five minutes, and 4.325-4.939 at fifteen minutes.

Each fixture used High quality at 1920 by 1080. Three runs followed five seconds of warmup and captured ten seconds.

| Fixture | CPU p99 ms | GPU p99 ms | Max frame ms | Kill spike max ms | Floor fps | Draws p99 | Triangles p99 | Texture MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard 24 | 20.700 | 13.656 | 26.100 | 26.100 | 48.309 | 232 | 486,072 | 549.878 |
| Weapon burst 24 | 17.800 | 15.297 | 23.056 | 21.700 | 56.180 | 244 | 488,082 | 549.878 |
| Gore stress 24 | 51.900 | 92.567 | 171.989 | 171.989 | 10.803 | 258 | 607,608 | 549.878 |
| Wave 5 boss mix 24 | 29.100 | 16.835 | 53.500 | 32.500 | 34.364 | 263 | 464,806 | 549.878 |
| Standard 36 | 22.000 | 13.870 | 29.600 | 29.600 | 45.455 | 244 | 628,654 | 549.878 |

CPU and GPU p99 values are medians. Maxima cover all three runs. The workload floor uses the slower median p99.

## Worst three frames per fixture

### Standard 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 2 | 8 | 26.100 | 7.964 | M4 kill 1, first shot: M4, first hit, first decal, wreck spawn, audio start, first death: M4 kill |
| 2 | 40 | 23.000 | 12.070 | explosion |
| 3 | 8 | 23.000 | 7.744 | M4 kill 1, first shot: M4, first hit, first decal, wreck spawn, audio start, first death: M4 kill |

### Weapon burst 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 2 | 532 | 12.300 | 23.056 | render |
| 2 | 8 | 21.700 | 7.489 | M4 kill 1, first shot: M4, first hit, first decal, wreck spawn, first death: M4 kill |
| 3 | 284 | 14.700 | 21.159 | render |

### Gore stress 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 3 | 14 | 40.900 | 171.989 | gore kill 2 |
| 3 | 25 | 35.300 | 152.270 | render |
| 3 | 17 | 36.600 | 151.900 | GC: 22.198 MiB reclaimed |

### Wave 5 boss mix 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 1 | 341 | 53.500 | 16.790 | render |
| 1 | 276 | 38.600 | 14.129 | render |
| 1 | 343 | 36.300 | 10.512 | render |

### Standard 36

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 2 | 8 | 29.600 | 9.976 | M4 kill 1, first shot: M4, first hit, first decal, wreck spawn, audio start, first death: M4 kill |
| 2 | 24 | 26.800 | 8.082 | render |
| 2 | 9 | 25.400 | 11.758 | GC: 17.895 MiB reclaimed |
