# W14 aim down sights evidence

Captured with headless Chrome on port 4570. All eight images are unedited canvas screenshots.
The fixture stocks the four firearms and advances the real World in fixed ticks without a wave
director or enemies. Hip and sight frames use the same courtyard position. Playwright holds the
right mouse button to enter aim; it does not set the aim flag for those screenshots.

- `pistol-hip.png`, `pistol-sights.png`
- `m4-hip.png`, `m4-sights.png`
- `shotgun-hip.png`, `shotgun-sights.png`
- `plasma-hip.png`, `plasma-sights.png`

`results.json` records the screenshots, measured projections, and 25 browser behavior checks.
The capture also asserts that the transition eases out and reaches its 120 ms target within
8 ticks at 60 Hz, that every sight lands within 3 pixels of center, and that RMB produces no shot.
World FOV changes from 72 to 55 degrees; the independent viewmodel projection changes from
54 to approximately 40.1 degrees, using the same zoom ratio. Configured base FOV is restored on release.

For each firearm, the script fires 30 shots from the hip and 30 while aiming with seed 2029,
including normal cooldowns and reloads. It records actual hitscan directions and checks each
ray's yaw and pitch deviation, as well as World's spread. The shotgun produces 240 rays per pose.

| Weapon | Hip spread, degrees | Aim spread, degrees |
| --- | ---: | ---: |
| Pistol | 1.5 | 0.525 |
| M4 | 2 | 0.7 |
| Shotgun | 7 | 2.45 |
| Plasma | 1 | 0.35 |

Hip movement is 5 m/s; sprint is 7.5 m/s; aiming and aiming plus sprint are both 3 m/s.
Over 30 ticks those cover 2.5, 3.75, 1.5, and 1.5 meters respectively. Aiming consumes no sprint stamina.

The browser checks also cover reload suppression, quick actions, recoil from the sight pose,
0.6 mouse sensitivity in locked and cursor modes, no jump entering cursor aim, one-third bob,
sway and breath at equal speed, centered hit/reload feedback, context-menu suppression,
blur/stop input cleanup, camera restoration, and weapon view restart.
Only the isolated input-listener check stubs pointer lock on an unattached canvas. The screenshot
RMB path uses the live controller. Browser warnings and errors: zero.

`npm-test.txt`: 63 tests passed, zero failed, including eight new aim tests.
`kite3d-check.json`: Playable, Editable, Persisted all pass in headless mode. Editable reports
`CAMERA_CONTAINMENT_UNVERIFIED` for the unchanged asphalt and skyline geometry bounds.
The scene and its saved camera were not edited.

To reproduce without changing the owner's port 4300 server metadata, copy the project runtime
files to a temporary directory and share only the installed dependencies:

```sh
W14_PROJECT=$(mktemp -d /tmp/terminator-w14-ads.XXXXXX)
cp -R assets lib generators scripts main.js package.json assets.json "$W14_PROJECT/"
ln -s "$PWD/node_modules" "$W14_PROJECT/node_modules"
(cd "$W14_PROJECT" && npx kite3d dev --port 4570 --no-open > dev.log 2>&1) &
# Once the server is ready, from this repository:
W14_PROJECT="$W14_PROJECT" node docs/evidence/w14-ads/capture.mjs
(cd "$W14_PROJECT" && npx kite3d check)
npm test
```

The capture script reads the isolated server's dev.json privately. It never prints the session token.
No browser window, OS focus action, recording, or publishing is used.
