# Tracer reference study

Studied before renderer changes, 2026-09-12. Frames are reference material only and never ship.
Video downloads used yt-dlp, height at most 480, and sections at most forty seconds.
ffmpeg decoded retained 640 x 360 frames. Clips and contact sheets remain in ignored scratch storage.
All distances below are estimates from perspective, unless explicitly stated as renderer parameters.

1. M240 night frame 01 shows a white core about two pixels wide inside red light; use a 1.5-pixel coverage floor.
2. Its visible streak spans about eight pixels; the camera distance is unknown, so this does not establish metre scale.
3. C6 night frame 01 shows a roughly nine-by-two-pixel dash near the horizon; preserve velocity alignment.
4. End-on shots become short dashes or points in both night clips; remove the artificial screen-length floor.
5. Photo 1 resolves a one-to-two-pixel diagonal over roughly one hundred pixels; use a constant narrow core.
6. Photo 2 contains hundreds-pixel paths only one-to-two pixels wide; long exposure is an upper bound, not persistent geometry.
7. Photo 3 has a heavily saturated white streak and orange fringe; feed HDR radiance into the existing bloom pass.
8. Wide glow follows saturation and camera exposure, not a separate body; remove the painted radial halo.
9. The hottest cores clip toward white while dimmer streaks remain red-orange; grade white head through yellow to orange.
10. These clips cannot establish physical head or tail temperatures; the colour gradient is a deliberate visual adaptation.
11. Adjacent night frames replace streak positions without leaving a bright continuous tube; limit residual light to five percent.
12. The samples cannot time a 160 ms afterimage reliably; use that requested duration as an explicit readability choice.
13. KF2 Commando Zed Time holds thin directional white marks through slow motion; exaggerate exposure, not ribbon width.
14. KF2 Sharpshooter shows brief shot light followed by muzzle smoke; separate the luminous path from muzzle effects.
15. Use 150 m/s visual speed and 17-37 ms exposure, with the last forty percent fading; preserve perspective at 20/40 m.

Sources and extraction times:

- [M240b Night Fire range](https://www.youtube.com/watch?v=qW85uzRB-L4), section 00:00-00:40, frames at local 04.00-04.25.
- [M240 / C6 tracers at night](https://www.youtube.com/watch?v=LBzC_W-Q99c), section 00:00-00:40, frames at local 03.30-03.50.
- [7.62 Tracer in Slow Motion](https://www.youtube.com/watch?v=WuKC9rJO_eE), section 00:00-00:40, frames at local 17.00-17.20.
- [KF2 Commando Zed Time demonstration](https://www.youtube.com/watch?v=6wnE3USXSQE), section 01:30-02:10, local 18.20 and 24.40.
- [KF2 Burning Paris Sharpshooter](https://www.youtube.com/watch?v=Ueq6R4sReO0), section 03:00-03:40, local 25.15 and 36.03.

Section extraction uses source keyframes. Local decoded times can differ slightly from the requested source start.
Three photographs came from [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:Tracers), downloaded with curl at 960 pixels.
Photo 1: USAF, 130314-F-VU439-488, M240B at Fort Jackson, public domain US government work.
Photo 2: USMC, DM-ST-89-00210, Camp Pendleton tracer fire, public domain US government work.
Photo 3: US Navy, Phalanx CIWS night fire, public domain US government work.
YouTube frames retain their source copyrights and serve only this visual study.
The footage gives no calibrated 20/40 m measurements. Reference comparisons must state that limitation.

Validation note: pure projection made the 40 m muzzle-aligned shot subpixel.
The final shader uses a 16-pixel directional floor, reduced from the old 112-pixel M4 floor.
This is an explicit readability adaptation, not a measured optical property.
