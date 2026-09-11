# Art reference: T-800 endoskeleton

Source: a user-supplied screenshot of a T-800 endoskeleton render. The original file was a temporary
screenshot and is not on disk yet. When it lands it lives at `assets/reference/t800-endoskeleton.png`.
Until then, build to this description. It is written from the image directly.

## The image, described

Framing: a single endoskeleton from the hips up, three-quarter view, body turned slightly to camera-left,
head turned to face the camera. The camera sits a little below chest height and looks up. The pose is a
slight forward hunch with the shoulders rolled forward. It reads as tall, gaunt, skeletal, and menacing.

Lighting: a dark blue-gray gradient background. A cool blue-white key light from the upper right catches
the top of the skull and the right shoulder. A warm orange rim light from the lower left glows on the
left forearm, left ribs, and the lower background. The metal shows sharp specular highlights on every
rounded edge and deep near-black shadow in the recesses.

Materials: gunmetal steel, brushed, with a mix of polished chrome on the skull and dull, scuffed, slightly
oily steel on the body. Edges are worn bright. Recesses hold dark grime. There is no paint and no color
on the body. The only saturated color is the red of the eyes and the warm orange rim light.

Skull: a polished chrome cranium with a smooth dome. Deep, dark eye sockets. Two small, bright red
glowing eyes with a soft red bloom around each. A full row of exposed metal teeth in a fixed grin. The
jaw is metal with visible hinge pins. The cheekbones are sharp and angular.

Neck: a stack of short hydraulic pistons and a central spinal column. Thin cables run from the base of
the skull down and out to both shoulders. Two hoses drape over the collarbone area and into the chest.

Shoulders: large round ball-joint housings with a visible disc on the outer face. Cable bundles and a
thin hose loop over each shoulder into the upper chest.

Chest: layered angular armor plates. A central ribbed sternum. A rectangular chest plate with small
rectangular cutouts and machined detail. Exposed pistons run along the sides of the ribcage. A pair of
horizontal bars cross the upper chest under the collarbones.

Abdomen: a spine of stacked ring-shaped vertebrae, six to eight segments visible, flanked by a hydraulic
piston on each side. The waist is narrow. Flared pelvic plates start at the hips.

Arms: long and skeletal. Each upper arm is a thin core rod with two exposed hydraulic cylinders alongside.
Round disc elbows. Forearms show two parallel rods and a cylinder each. Hands are articulated metal
fingers with visible knuckle joints. The right arm hangs low and holds a large plasma rifle at hip
height. The left arm hangs straight down, slightly forward.

Weapon: a large dark gunmetal plasma rifle with a boxy receiver, a rectangular barrel shroud with heat
fins and vents, and a squared muzzle. It is held one-handed by the grip, barrel pointing down and
forward.

## Art direction for the three enemy types

All three share the same material set and the same red eye glow. The silhouette is the differentiator.

1. T-800 Endo (baseline infantry). Match the image directly. Human proportions, upright walk, plasma
   rifle. Mid speed, mid health, ranged.
2. T-600 Scout (fast, fragile). Same skeleton but leaner, no chest plate, exposed spine, no rifle. Runs
   on all fours when charging, stands to melee. Fast, low health, melee only.
3. T-800 Heavy (slow, armored). Same skull, doubled armor plates on chest and shoulders, thicker
   pistons, a minigun on the right forearm. Slow, high health, suppressive fire.

Rendering notes for the engine: emissive red eyes with bloom, a metallic PBR material with roughness
variation and edge wear, and rim lighting from level lights so the silhouettes read in the dark.
