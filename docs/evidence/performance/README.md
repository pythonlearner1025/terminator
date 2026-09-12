# Performance pass evidence

Captured on an Apple M3 Max in headless Chrome 152 through ANGLE Metal at a 1920 x 1080 render size and device scale 1. The reproducible command is `npm run benchmark:view -- --port=4660 --seconds=10 --warmup=5`. The scene fixes 24 enemies in the camera frustum, enables motion blur and every post pass, runs full rain and smoke, activates electric and steam hazards, and drives two enemy shots per frame plus ten impact bursts per second. Enemy brains are replaced by a fixed visual driver so core simulation variance is outside this view benchmark.

The pre-change capture was normalized with the HDR environment load delayed before material binding. The original code could compile its unit shader against a placeholder HDR texture and accidentally measure missing PBR bodies. That load-order correction is part of the final change.

| Metric | Before | After |
| --- | ---: | ---: |
| Effective frame rate | 59.902 fps | 60.003 fps |
| Frame interval, mean / p50 / p95 | 16.694 / 16.7 / 17.5 ms | 16.666 / 16.7 / 17.5 ms |
| Main-thread frame work, mean / p95 | 12.954 / 15.4 ms | 9.806 / 12.7 ms |
| GPU frame, mean / p50 / p95 | 16.846 / 15.737 / 25.954 ms | 11.032 / 10.609 / 15.771 ms |
| Draw calls, mean | 273.189 | 247.188 |
| Triangles, mean | 1,304,101 | 681,413 |
| Estimated texture memory | 423.106 MiB | 417.174 MiB |

The controlled baseline reached the display cadence on this later, idle-machine run, but its direct GPU timer was over the 16.7 ms budget on average and at p95. This is consistent with the owner-observed loaded-machine baseline of 27 to 28 fps, 35 ms mean, and 43 to 66 ms p95. The final GPU p95 is below the requested 20 ms ceiling with motion blur enabled.

The five largest pre-change costs were the main render pass at 7.517 ms per frame, G-buffer at 2.812 ms, unit view at 1.568 ms, HUD at 0.174 ms, and bloom at 0.136 ms. After the pass, main render was 5.112 ms, G-buffer 2.557 ms, and unit view 1.015 ms.

High quality keeps native render scale, 2048 shadow maps, full particle density, eight-sample SSAO, half-resolution G-buffer, half-resolution bloom, high-detail unit geometry through 30 meters, and 30 Hz articulated skeleton updates. Unit atlas AO replaces dynamic SSAO on the robot skins, while world SSAO remains enabled. The physical courtyard floodlights remain; the building and dock retain their visible volumetric shafts and zone lights without redundant spotlights.

Files:

- `before.json`: shader-valid pre-change capture.
- `after.json`: final 10-second capture.
- `after.png`: final 1920 x 1080 stress-scene screenshot.
