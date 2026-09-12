Weapons range proof, 2026-09-12.

Run `npx kite3d dev --port 4682 --no-open`, then `node test/view/range-browser.mjs`.
The proof uses private headless Chrome, Metal, High quality, and a 1920 by 1080 canvas.
It reads the local session URL privately. No window opens. Stop the server before `npx kite3d check`.

- `night.png`: Night key, panel visible, three real shots toward the 20 m station.
- `overcast.png`: Overcast key and exposure, with the same target setup.
- `noon.png`: Noon key and exposure, with the same target setup.
- `inspect-sniper.png`: Orbit view during the actual sniper reload, at 0.1x.

All eight weapons produced their real attack events. The knife cannot reach the 20 m station.
The proof exercised every panel control, F1, orbit drag, zoom, target replacement, range-off DOM, and combined sandbox panels.
Time controls admitted 60, 15, and 6 ticks per second. Pause held time; Step admitted one tick.
The final browser run reported no console errors or missing resources.

`npm test`: 227 passed, zero failed, including 17 range tests.
An earlier run failed the existing 30x simulation speed threshold under load. The final standard command passed after browser shutdown.
`npx kite3d check`: Playable PASS, Editable PASS, Persisted PASS. Headless cleanup reported no leaked objects.

Performance used 24 static enemies, continuous M4 fire, High effects, and 340 measured frames after warmup.
The fixture raised enemy health to retain all 24 during measurement. This does not measure attacking enemy brains.
Apple M3 Max, Chrome ANGLE Metal: frame median 33.3 ms, p95 50.0 ms, p99 66.7 ms.
Manager update median 3.3 ms, p95 5.3 ms. This run does not meet the 60 fps target.

The existing weapon detail, sleeve shapes, muzzle sprites, and environment geometry remain below KF2 quality.
The daylight presets change only the key and exposure. The existing night sky and weather remain visible.
Range plates reuse the existing worn PBR weapon atlas. Reference photographs and video frames stay outside shipped assets.
