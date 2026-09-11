# W12 audio evidence plan

- Goal: verify the complete procedural WebAudio layer during real wave 1 gameplay.
- Pace: ship the simplest complete playable layer, with no external samples or speculative systems.
- Controls: click Play, click the canvas to unlock audio, WASD to move, mouse to aim, click to fire,
  R to reload, G for grenade, V for knife, and E to ready during intermission.
- Story: wave klaxon and ambient bed, player weapon and movement sounds, enemy spawn and movement,
  combat impacts and death, then the wave-clear and trader cues.
- Capture: use a dedicated browser window on the local port 4900 server. Save console sound lines to
  `sound-log.txt` and a short silent native window capture if available.
- Validation milestones: catalog test, browser audio unlock, full wave 1 sound log, clean Stop,
  `npx kite3d check`.
- Recovery: keep the cropped evidence MP4 in this folder. Move token-bearing raw captures to Trash
  after the cropped file fully decodes and a frame inspection confirms the browser chrome is gone.

## Progress and recovery notes

- Browser synthesis smoke test passed for 41 sounds and both variations, 82 rendered buffers total.
- Positional smoke test passed for an HRTF panner, listener orientation, and a moving minigun loop.
- Early wave attempts are not evidence. One exposed a detached hot-reload UI button, one exposed the
  QuickJS startup delay, and later attempts were interrupted by concurrent core hot reloads.
- The accepted run stayed on port 4900, completed wave 1 with five kills, and ended in intermission.
  Audio remained running, 24 distinct sound names fired across 616 logged sound events, and browser
  diagnostics were empty.
- The 18-second H.264 window capture fully decoded at 1442 by 802 after cropping browser chrome. The
  macOS capture path produced no audio track, so `sound-log.txt` is the firing evidence.
- `npx kite3d check` passed in editor runtime mode: Playable, Editable, and Persisted all passed.
