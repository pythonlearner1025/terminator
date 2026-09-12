# Co-op end-to-end evidence

Run with `npm run e2e:coop` against Kite3D on port 4730 and the party relay on port 7831. The harness uses separate headless Chromium processes and isolated contexts for host and guest, plus a reserved third guest context. Gameplay is driven through the real UI, keyboard events, canvas mouse events, and the public input state used when headless Chromium cannot acquire pointer lock. Evidence frames use the high preset at 1920 by 1080.

## Assertion transcript

1. PASS: Host clicked the real Kite3D Play control and reached the game main menu.
2. PASS: Host entered a name, created a six-character party, and the party screen released input and pointer lock.
3. PASS: Host used Copy Invite and retained the exact generated invite link.
4. PASS: Guest opened the copied invite, clicked Play, joined through the real form, and both browsers saw the same roster.
5. PASS: Both players used the Ready UI and both browsers showed every ready mark.
6. PASS: Host used Start and both browsers entered wave one with combat HUD, two players, and active local input.
7. PASS: Opening a screen during play stopped look input, released pointer lock, and Resume restored play input.
8. PASS: Keyboard movement changed both local players and each remote browser received the other position change.
9. PASS: The guest dropped and automatically reconnected from the same invite with the same player id, token, and roster slot.
10. PASS: Host and guest fired through the public input state, each killed an enemy, and both HUDs reflected authoritative health and wave state.
11. PASS: One player died, stayed in the match, and spectated the living teammate on both authoritative and HUD state.
12. PASS: The living player cleared wave one while the teammate remained down and both browsers entered the same intermission.
13. PASS: The living player bought ammunition through the Trader UI and the purchase and scrap total matched on both browsers.
14. PASS: Starting wave two respawned the downed player at full health on both browsers.
15. PASS: Both players died in wave two and both browsers showed the same two-player scoreboard instead of leaving the party.
16. PASS: Return to Party kept the code and roster and reset every ready mark.
17. PASS: The same host started a second match with the same guest and party code, without creating or opening another invite.
18. PASS: No uncaught page errors or console errors occurred in either active browser.

Chromium emitted only its known WebGL `ReadPixels` stall warnings while taking screenshots. It emitted no page errors, console errors, or failing game and relay responses.

## Performance

The 10 second native headless Metal run at 1920 by 1080 kept all 24 enemies visible with high quality, post effects, motion blur, rain, smoke, electric and steam hazards, enemy fire, and impact bursts enabled. It measured 16.666 ms mean frame interval, 9.023 ms mean frame work, 10.399 ms mean GPU time, and 60.002 effective fps across 600 samples. See [performance.json](performance.json).

## Screenshots

- [Host mid-wave](host-mid-wave.png)
- [Guest mid-wave](guest-mid-wave.png)
- [Party lobby after both players died](party-lobby-after-death.png)

Machine-readable co-op results are in [results.json](results.json).
