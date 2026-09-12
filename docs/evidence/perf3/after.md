# Performance pass 3: after

The runner recorded host load immediately before and after every timed capture.

Load average ranges were 3.007-10.981 at one minute, 4.722-7.419 at five minutes, and 5.351-6.245 at fifteen minutes.

Each fixture used High quality at 1920 by 1080. Three runs followed five seconds of warmup and captured ten seconds.

| Fixture | CPU p99 ms | GPU p99 ms | Max frame ms | Kill spike max ms | Floor fps | Draws p99 | Triangles p99 | Texture MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Standard 24 | 17.600 | 12.986 | 23.000 | 20.200 | 56.818 | 231 | 481,344 | 549.878 |
| Weapon burst 24 | 17.900 | 15.223 | 21.200 | 20.200 | 55.866 | 243 | 483,170 | 549.878 |
| Gore stress 24 | 15.100 | 16.018 | 21.264 | 20.100 | 62.430 | 237 | 604,224 | 549.878 |
| Wave 5 boss mix 24 | 16.400 | 12.450 | 18.300 | 18.300 | 60.976 | 248 | 460,298 | 549.878 |
| Standard 36 | 20.500 | 12.967 | 24.900 | 22.200 | 48.780 | 243 | 623,796 | 549.878 |

CPU and GPU p99 values are medians. Maxima cover all three runs. The workload floor uses the slower median p99.

## Worst three frames per fixture

### Standard 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 3 | 121 | 23.000 | 7.084 | render |
| 3 | 126 | 21.000 | 6.008 | render |
| 3 | 136 | 21.000 | 7.085 | render |

### Weapon burst 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 1 | 469 | 21.200 | 7.519 | render |
| 3 | 8 | 20.200 | 10.001 | M4 kill 1, first shot: M4, first hit, first decal, wreck spawn, first death: M4 kill |
| 3 | 0 | 20.000 | 8.226 | audio start |

### Gore stress 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 2 | 48 | 12.800 | 21.264 | render |
| 1 | 341 | 10.000 | 20.970 | GC: 20.283 MiB reclaimed |
| 1 | 454 | 10.700 | 20.787 | render |

### Wave 5 boss mix 24

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 2 | 20 | 18.300 | 7.303 | hktank kill 3 |
| 3 | 332 | 10.300 | 17.933 | render |
| 2 | 15 | 17.900 | 8.882 | render |

### Standard 36

| Run | Frame | CPU ms | GPU ms | Cause |
| ---: | ---: | ---: | ---: | --- |
| 3 | 143 | 24.900 | 15.070 | render |
| 3 | 157 | 24.900 | 7.935 | render |
| 3 | 145 | 24.400 | 8.037 | render |
