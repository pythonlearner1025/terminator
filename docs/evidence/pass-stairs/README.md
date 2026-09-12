# Dead enemies on stairs regression

The Node regression places and kills six Scouts on the building stair treads, then walks the player down and back up through them. It also verifies a dead Scout cannot affect a balcony-edge fall or either direction of dock-ramp traversal.

`24-enemies.png` is the 1920 by 1080 high-quality performance fixture. All post effects, motion blur, rain, smoke, both hazards, and combat effects were enabled. Exactly 24 enemies were alive, rendered, and in view. Over 10 seconds after a 3 second warmup, mean frame interval was 17.052 ms, p50 was 16.8 ms, p95 was 19.6 ms, and effective throughput was 58.643 fps. The 60 fps target is narrowly missed.

Full measurements are in `performance.json`. `npm test` passed 93 of 93 tests. `npx kite3d check` passed Playable, Editable, and Persisted in headless mode.
