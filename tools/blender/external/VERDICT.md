# Opened-pixel verdict

Ranks compare visible surface quality within each weapon class.
All final sheets were opened at 1920 x 1080 after four comparison rounds.
Sheets contain a left profile, three-quarter view, exact 4x pixel crop, and the existing KF2 reference frame.
See `docs/evidence/external-weapons/contacts/` and [ROUNDS.md](ROUNDS.md).
Magnification enlarges render pixels. It does not imply additional texture detail.

## Revolver

1. **kf2-1858-reference**: Engraved frame panels, dark cylinder chambers, and narrow barrel highlights read clearly.
   The long barrel and loading lever match the requested weapon class.
   This beats our built revolver in frame detail and finish separation; it remains reference only.
2. **detective-cc0**: Dark polished steel contrasts with a textured brown grip and bright circular grip medallion.
   The cylinder flutes and small screws look more convincing than our built revolver's mottled frame.
   This is the best licensed surface candidate, but its short barrel makes it an unsuitable 1858 replacement.
3. **current-built**, comparison baseline: The long octagonal barrel and walnut grip retain the correct broad silhouette.
   Large purple-gray mottling weakens the frame, and the cylinder looks rounded and soft.
   Its 1858 identity beats the remaining licensed alternatives, but its finish loses to KF2 and Detective.
4. **pavel-cc0**: White metal, a fluted cylinder, narrow loading rod, and reddish grip remain readable.
   The large receiver panels look chalky and have little visible wear variation.
   This is worse than our built revolver for the requested 1858 and worse than Detective for metal finish.
5. **webley-ccby**: The short top-break frame and curved textured grip create a recognizable alternative silhouette.
   Gray metal merges with the gray grip; the enlarged engraving remains faint.
   This is worse than our built revolver for both finish separation and 1858 identity.
6. **loafbrr-cc0**: Thick white borders surround the barrel, cylinder window, and trigger guard.
   The grip has visible dotted texture, but the broad shapes look stylized.
   This is the weakest realism candidate and clearly worse than our built revolver.

## M4

1. **3dmodels-cc0**: The perforated handguard, rail teeth, front sight, selector, and magazine create a convincing M4 outline.
   Receiver panels remain uniformly gray; the enlarged view lacks strong stamps and localized wear.
   This is the best available M4 candidate, but its finish remains below KF2.

## Shotgun

1. **kf2-aa12**: The drum magazine, layered receiver, safety markings, and mottled finish create dense mechanical detail.
   Small markings and hard edges remain distinct in the enlarged receiver view.
   This is the visual winner, but it is reference only and does not replace the Boomstick silhouette.
2. **3dmodels-cc0**: Orange wood grain and pump ribs contrast with a black barrel and receiver.
   The receiver has few visible controls, while the stock transitions look simple.
   This is the licensed choice, but it is a pump shotgun with less detail than the AA-12 reference.

## Sniper

1. **stein-m14-reference**: Wood grain, the operating rod, magazine, and open receiver surfaces create convincing layered construction.
   Wear around the receiver separates bright edges from dark recesses.
   This is the visual winner, but uncertain provenance prevents shipping it.
2. **3dmodels-cc0**: The olive stock, scope, bolt, and projecting magazine read as a scoped bolt-action rifle.
   The scope rims look faceted, and the stock has broad plain surfaces.
   This is the licensed choice, but it does not match the M14 EBR.

## Plasma

1. **a104-ccby**: Dense vents, exposed lines, stacked brackets, and the open stock provide the strongest licensed science-fiction silhouette.
   Gray and tan surface wear looks dated, and no emissive plasma source appears.
   This is the best plasma candidate here, but it needs a new material pass before production.

## Knife

1. **kf2-utility**: Screws, a thumb control, textured grip panels, and a broad blade show precise mechanical construction.
   The quarter view exposes layered handle thickness and brighter machined blade edges.
   This wins mechanical detail, but it is reference only and is not a Bowie knife.
2. **machete-cc0**: Chipped dark coating, three grip rivets, and a worn blade edge create credible surface wear.
   The wide blade and serrated section read as a machete, with a simpler handle than the KF2 reference.
   This is the best licensed knife-class asset, but its silhouette cannot replace the Bowie knife.

## Grenade

1. **3dmodels-cc0**: An olive body, yellow stencil, metal lever, and wire pull ring provide clear material and part separation.
   The egg-shaped body looks too smooth and glossy for a heavily worn combat prop.
   This is the best grenade candidate here, but its surface does not reach KF2 quality.

## Launcher

1. **danish-ccbysaref**: A red wooden rifle surrounds a small underbarrel tube and simple dark controls.
   Angular receiver edges and sparse surface marks expose the low source detail.
   This is a weak reference, not a viable M79 candidate; no suitable licensed launcher was obtained.

## Remaining gaps

No licensed candidate reaches KF2 across silhouette, material detail, and close-view quality.
No licensed Remington 1858, M79, Boomstick, M14 EBR, or Bowie download passed the anonymous-access hunt.
All source geometry arrived below 30,000 triangles; conversion did not decimate it.
Some 1K maps were enlarged to 2K, and specular conversions remain approximate.
The KF2 1858 uses overall-length normalization; its 203 mm barrel still needs independent source-vertex calibration.
These are static display candidates. Existing gameplay weapons and animation clips remain unchanged.
