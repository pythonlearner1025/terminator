# KF2 weapon study

Frames were inspected before changing animation code. Sources and sample windows are in SOURCES.md.
Observations describe visible frames. Decisions state adaptations, not measured KF2 timing.
Sparse frames cannot establish exact recoil or tracer speeds. No copied asset ships.

## pistol: 1858 Revolver

1. The long barrel sits above an exposed cylinder and a curved grip.
2. Single revolver reloads turn the weapon upright across the center view.
3. The free hand approaches the cylinder from the opposite side.
4. Dual revolvers alternate their high muzzle positions after firing.
5. The muzzle flash has a white center and a short orange fringe.
6. The dark grip stays readable against the bright test environment.
7. The sights return toward center between the captured shots.
8. Decision: rotate the hammer and index the cylinder on each shot.
9. Decision: remove, seat and close the cylinder during the existing reload timer.
10. Decision: use a fast kick and a slower return; preserve core ammunition capacity.

## m4: AR-15 Varmint Rifle and SCAR-H

1. The AR-15 has a narrow muzzle and a broad rear sight aperture.
2. Its sights move onto the center ray when aiming.
3. Its fired cases leave through the right side.
4. The SCAR reload exposes the left receiver face with a strong upward tilt.
5. The support hand leaves the fore-end before the magazine exchange.
6. The replacement magazine approaches from below the receiver.
7. The support hand reaches the action after seating the magazine.
8. Decision: separate magazine removal, pouch reach, seating and action phases.
9. Decision: retain a small kick for automatic fire and a short settling overshoot.
10. Decision: use orange travelling ribbons to make rapid fire readable without a crosshair.

## shotgun: M4 Combat Shotgun and Boomstick

1. The M4 has a long top barrel and a lower magazine tube.
2. The M4 gameplay frames show a broad upward kick after firing.
3. The support hand stays close to the tube fore-end during normal fire.
4. The Boomstick opens the barrels far enough to expose the chambers.
5. Its free hand carries bright shells toward the open breech.
6. Its close pose hides the chambers before returning to the firing position.
7. Decision: retain this game's pump action and tube-loading gameplay.
8. Decision: use distinct insert strokes followed by a final pump stroke.
9. Decision: eject after the rearward pump stroke, not on muzzle ignition.
10. Decision: draw nine short visual pellets with a wide flash and slower recovery.

## plasma: Microwave Gun and Railgun

1. The Microwave Gun has a bulky shroud with layered metal and exposed mechanisms.
2. Its effect remains legible in a bright snow environment.
3. Its support hand sits farther forward than the pistol support hand.
4. The Railgun has a large optic and a long, rectangular receiver.
5. The optic frames a clean sight picture with a fine reticle.
6. Sparse Microwave gameplay frames do not resolve a complete reload sequence.
7. Decision: keep the original Skynet shroud and animate a removable power cell.
8. Decision: unlock the action before removing the cell; lock it after seating.
9. Decision: use a blue core, a wider halo and a long continuous trail.
10. Decision: give the heavy shroud a slower recoil return than the M4.

## knife: KF2 knife and KF-BAR

1. The blade catches long highlights along the ground edge.
2. The idle knife points up and away from the right wrist.
3. The opposite hand stays open and offset from the blade.
4. The attack brings the blade across the center of the view.
5. The camera view tilts during large slashes.
6. The follow-through finishes below the initial ready position.
7. Decision: begin at contact because core melee damage occurs immediately.
8. Decision: exaggerate lateral follow-through and wrist roll during recovery.
9. Decision: preserve the free hand as a counterbalance during the slash.
10. Decision: return to the prior firearm through its raise transition.

## grenade: HE grenade

1. The HE showcase begins with the normal firearm still visible.
2. The firearm lowers before the grenade appears in flight.
3. The grenade travels across a clear central sight picture.
4. The view returns to the firearm while the grenade remains airborne.
5. The throwing action is too fast for a five-second sampling interval.
6. Additional frames sample 30.5 seconds onward at five frames per second.
7. Decision: retain the core's immediate projectile release and existing GrenadeView.
8. Decision: show the throwing hand in extension, then recover below the view.
9. Decision: never delay the projectile to manufacture a longer pin-pull sequence.
10. Decision: preserve pin and lever articulation for staged inspection of the model.

## sniper: M14 EBR

1. The metal chassis has a long top rail and a separate stock support.
2. The large optic sits on two mounts above the receiver.
3. The magazine is short and broad with a clearly visible lower edge.
4. Firing moves the muzzle up while keeping the stock close to the shoulder.
5. Reloading rotates the barrel almost upright.
6. The support hand seats the magazine against the tilted receiver.
7. The receiver stays visible during the final mechanical action.
8. Decision: use a steep reload tilt and rock the magazine into its well.
9. Decision: animate the side action before lowering back into the firing pose.
10. Decision: use core aimFov, a scope aperture and a long white tracer trail.

## launcher: M79 Grenade Launcher

1. The launcher has a much wider bore than the rifles.
2. The short barrel and large front opening dominate the aiming pose.
3. Reloading lowers the open barrel relative to the receiver.
4. The support hand approaches the breech from below and left.
5. A large shell contrasts with the dark receiver during insertion.
6. The barrel closes before the weapon returns to its aiming pose.
7. Decision: hinge the entire barrel, fore-end and ladder sight together.
8. Decision: eject the spent case only after the breech opens.
9. Decision: slide the replacement shell along the open barrel axis.
10. Decision: use a brief broad flash, strong shoulder kick and a spinning projectile.
