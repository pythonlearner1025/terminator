# Swing-out revolver, open work

The owner reviewed the first animated build on 2026-09-13. His verdict: the gun animation is
better, the hands and the reload are not. Both must be fixed in Blender, in the source scene.
Nothing here can be fixed by changing runtime code.

Not launched yet. Start this only when the owner says so.

## Hands

1. The fingers pinch and intersect the gun near 0.84 s and 1.8 s in Reload.
2. The finger solver does not enforce skin clearance, so contact is not guaranteed anywhere.
3. Fingers must wrap surfaces and touch them. No sinking, no hovering, no floating grip.

## Reload

4. The reload reads as absent when played in the game. Whatever the cause, the motion must be
   large enough and long enough to be unmistakable at 1x, not only at 0.25x.
5. A partial reload still ejects six spent cases. Only fired chambers may eject.
6. The bullet leaves the barrel about 50 ms before the visual hammer strike. The shot must follow
   the hammer, not lead it.

## Smaller

7. Brass has no wall collisions.
8. The case pool replaces old cases after four reloads.
9. Audio was never auditioned.

## Interfaces that must not change

The nine clip names, the Muzzle node, the part names recorded in docs/authoring.md, the asset path
assets/models/weapons/swingout/, and `npm run build:swingout` as the rebuild step.

The weapons lab UI was deleted on 2026-09-13. Verify in the game, not through lab panels.

## 2026-09-13 follow-up status

The owner launched this work. Builds 10 through 13 are complete.
The hand and complete reload bars remain open. See the new review section in `ROUNDS.md`.

| Item | Status |
| --- | --- |
| 1 | Open. Left skin still intersects at both cited times. |
| 2 | Open. The new fit uses skin barriers, but does not guarantee clearance. |
| 3 | Open. Some contacts and finger separation still fail. |
| 4 | Partial. Opening and loading read clearly. Rod contact and falling brass remain weak at 1x. |
| 5 | Done. One, three, five, and six fired chambers eject matching case counts. Unfired cartridges remain. |
| 6 | Visible order fixed. Hammer contact occurs at 50 ms. The first visible bullet occurs at 66.7 ms. |
| 7 | Open. Brass still has no wall collision. |
| 8 | Open. The 24-case pool still recycles after four full reloads. |
| 9 | Open. No listening assessment was completed. |

The visible discharge target is 58.3 ms. Fixed gameplay ticks show it at 66.7 ms.
Core hitscan damage and its shot event remain immediate. This change coordinates presentation only.
The nine clips, Muzzle, mechanism names, asset path, and rebuild command remain available.
