This pass adds three enemy rigs, their visual state machines, and the boss HUD. The AAA target remains unmet.

T-1000 findings from the film study:
- Smooth chrome regions carry large moving highlights.
- Human shoulders and a narrow waist define the silhouette.
- The walking pose stays upright and controlled.
- Blade arms taper from a thicker forearm root.
- Liquid pools have convex edges and merging ripples.

HK-Aerial findings from the film study:
- A wide silhouette surrounds a compact central hull.
- Paired engine pods create a clear underside signature.
- Banking starts before the hull completes its turn.
- Searchlight beams separate the aircraft from the dark battlefield.
- Gun hardware hangs below the main body.

HK-Tank findings from the film and product study:
- Wide tread assemblies communicate weight.
- Transverse cleats repeat around the tread belts.
- The turret moves independently above the chassis.
- Paired long barrels create the main attack silhouette.
- Cold rim light and warm fire reflections divide the armor surfaces.

Film frames and fifteen initial findings per unit live under [docs/reference/terminator](reference/terminator/SOURCES.md).
Hot Toys images were added during the final comparison. Initial product studies used DarkSide and HCG models.
[Evidence and limitations](evidence/roster-visuals/README.md) contain benchmark numbers, test counts, check results, and six captures.

Files added or changed follow. Each line describes one file.

- [assets/LICENSES.md](../assets/LICENSES.md): Records each original roster texture license.
- [assets/main.scene.gltf](../assets/main.scene.gltf): Regenerates three named authored template nodes.
- [assets/textures/roster/hk-albedo.jpg](../assets/textures/roster/hk-albedo.jpg): Adds an original licensed PBR texture.
- [assets/textures/roster/hk-normal.png](../assets/textures/roster/hk-normal.png): Adds an original licensed PBR texture.
- [assets/textures/roster/hk-orm.png](../assets/textures/roster/hk-orm.png): Adds an original licensed PBR texture.
- [assets/textures/roster/liquid-albedo.jpg](../assets/textures/roster/liquid-albedo.jpg): Adds an original licensed PBR texture.
- [assets/textures/roster/liquid-normal.png](../assets/textures/roster/liquid-normal.png): Adds an original licensed PBR texture.
- [assets/textures/roster/liquid-orm.png](../assets/textures/roster/liquid-orm.png): Adds an original licensed PBR texture.
- [docs/evidence/roster-visuals/01-t1000-blade.png](../docs/evidence/roster-visuals/01-t1000-blade.png): Records one 1920 by 1080 headless game fixture.
- [docs/evidence/roster-visuals/02-hkaerial-bank.png](../docs/evidence/roster-visuals/02-hkaerial-bank.png): Records one 1920 by 1080 headless game fixture.
- [docs/evidence/roster-visuals/03-hktank-boss.png](../docs/evidence/roster-visuals/03-hktank-boss.png): Records one 1920 by 1080 headless game fixture.
- [docs/evidence/roster-visuals/04-t1000-puddle.png](../docs/evidence/roster-visuals/04-t1000-puddle.png): Records one 1920 by 1080 headless game fixture.
- [docs/evidence/roster-visuals/05-hkaerial-breakup.png](../docs/evidence/roster-visuals/05-hkaerial-breakup.png): Records one 1920 by 1080 headless game fixture.
- [docs/evidence/roster-visuals/06-hktank-wreck.png](../docs/evidence/roster-visuals/06-hktank-wreck.png): Records one 1920 by 1080 headless game fixture.
- [docs/evidence/roster-visuals/README.md](../docs/evidence/roster-visuals/README.md): Reports measured results, commands, capture paths, and remaining gaps.
- [docs/evidence/roster-visuals/after.json](../docs/evidence/roster-visuals/after.json): Retains the final mixed-roster benchmark.
- [docs/evidence/roster-visuals/before.json](../docs/evidence/roster-visuals/before.json): Retains the baseline mixed-roster benchmark.
- [docs/evidence/roster-visuals/capture.json](../docs/evidence/roster-visuals/capture.json): Records headless fixture assertions and disposal results.
- [docs/evidence/roster-visuals/collider-fit.json](../docs/evidence/roster-visuals/collider-fit.json): Records twenty part bounds and six settled pose comparisons.
- [docs/evidence/roster-visuals/deaths.json](../docs/evidence/roster-visuals/deaths.json): Retains the three-type death benchmark.
- [docs/evidence/roster-visuals/validation.json](../docs/evidence/roster-visuals/validation.json): Records test totals and all three Kite3D outcomes.
- [docs/reference/terminator/SOURCES.md](../docs/reference/terminator/SOURCES.md): Records film and product sources and the final comparison.
- [docs/reference/terminator/hkaerial/NOTES.md](../docs/reference/terminator/hkaerial/NOTES.md): Records fifteen observations before modeling.
- [docs/reference/terminator/hkaerial/action-01.jpg](../docs/reference/terminator/hkaerial/action-01.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-02.jpg](../docs/reference/terminator/hkaerial/action-02.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-03.jpg](../docs/reference/terminator/hkaerial/action-03.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-04.jpg](../docs/reference/terminator/hkaerial/action-04.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-05.jpg](../docs/reference/terminator/hkaerial/action-05.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-06.jpg](../docs/reference/terminator/hkaerial/action-06.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-07.jpg](../docs/reference/terminator/hkaerial/action-07.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/action-08.jpg](../docs/reference/terminator/hkaerial/action-08.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/product.jpg](../docs/reference/terminator/hkaerial/product.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/salvation-flight-03.jpg](../docs/reference/terminator/hkaerial/salvation-flight-03.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/salvation-flight-04.jpg](../docs/reference/terminator/hkaerial/salvation-flight-04.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hkaerial/salvation-thumbnail.jpg](../docs/reference/terminator/hkaerial/salvation-thumbnail.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hktank/NOTES.md](../docs/reference/terminator/hktank/NOTES.md): Records fifteen observations before modeling.
- [docs/reference/terminator/hktank/action-06.jpg](../docs/reference/terminator/hktank/action-06.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hktank/product.jpg](../docs/reference/terminator/hktank/product.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hktank/track-07.jpg](../docs/reference/terminator/hktank/track-07.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/hktank/track-08.jpg](../docs/reference/terminator/hktank/track-08.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/NOTES.md](../docs/reference/terminator/t1000/NOTES.md): Records fifteen observations before modeling.
- [docs/reference/terminator/t1000/action-01.jpg](../docs/reference/terminator/t1000/action-01.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/action-02.jpg](../docs/reference/terminator/t1000/action-02.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/action-03.jpg](../docs/reference/terminator/t1000/action-03.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/action-04.jpg](../docs/reference/terminator/t1000/action-04.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/action-05.jpg](../docs/reference/terminator/t1000/action-05.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/action-06.jpg](../docs/reference/terminator/t1000/action-06.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/action-07.jpg](../docs/reference/terminator/t1000/action-07.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/film-01.jpg](../docs/reference/terminator/t1000/film-01.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/film-02.jpg](../docs/reference/terminator/t1000/film-02.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/film-03.jpg](../docs/reference/terminator/t1000/film-03.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/film-15s.jpg](../docs/reference/terminator/t1000/film-15s.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/hot-toys-detail.jpg](../docs/reference/terminator/t1000/hot-toys-detail.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/hot-toys-face.jpg](../docs/reference/terminator/t1000/hot-toys-face.jpg): Retains a study image excluded from publishing.
- [docs/reference/terminator/t1000/product.jpg](../docs/reference/terminator/t1000/product.jpg): Retains a study image excluded from publishing.
- [docs/roster-visuals.md](../docs/roster-visuals.md): Maps reference findings and changed files.
- [generators/roster-geometry.js](../generators/roster-geometry.js): Builds merged human, gunship, tank, and low-detail rigs.
- [generators/roster-materials.js](../generators/roster-materials.js): Loads shared PBR maps and installs liquid and tread shaders.
- [generators/roster-textures.py](../generators/roster-textures.py): Bakes six deterministic 1024-pixel PBR textures.
- [generators/unit-placeholders.js](../generators/unit-placeholders.js): Routes legacy factory calls to the new roster builders.
- [generators/unit-template.generator.js](../generators/unit-template.generator.js): Registers the three new authored previews.
- [lib/ui/boss.js](../lib/ui/boss.js): Renders boss health, rear-core hint, and inbound title.
- [lib/ui/hud.js](../lib/ui/hud.js): Integrates boss UI and fixes T-1000 names and roster kill icons.
- [lib/ui/icons.js](../lib/ui/icons.js): Adds T-1000, Aerial, Tank, and core symbols.
- [lib/view/camera-feel.js](../lib/view/camera-feel.js): Adds nearby moving Tank vibration.
- [lib/view/gore.js](../lib/view/gore.js): Converts T-1000 damage and dismemberment to ripples.
- [lib/view/match-warmup.js](../lib/view/match-warmup.js): Waits for roster texture and reflection readiness.
- [lib/view/roster-animation.js](../lib/view/roster-animation.js): Drives blade morphs, regeneration, banking, searchlight tracking, treads, recoil, and core flashes.
- [lib/view/roster-fx.js](../lib/view/roster-fx.js): Pools particles and vehicle debris, then runs the three death sequences.
- [lib/view/units-animation.js](../lib/view/units-animation.js): Binds roster rigs and retains the Endo skeleton for the liquid unit.
- [lib/view/units-fx.js](../lib/view/units-fx.js): Stops solid-metal damage marks on liquid units.
- [lib/view/units.js](../lib/view/units.js): Owns roster pools, event hooks, warmup, recycling, and disposal.
- [test/view/roster.test.js](../test/view/roster.test.js): Adds nine roster, material, animation, death, bounds, and boss tests.
- [tools/benchmark-browser.mjs](../tools/benchmark-browser.mjs): Adds the wave-five mixture and three-type death stress.
- [tools/build-scene.mjs](../tools/build-scene.mjs): Adds stable generator sources for the three new units.
- [tools/capture-roster-visuals.mjs](../tools/capture-roster-visuals.mjs): Asserts six headless fixtures, HUD states, and runtime cleanup.
- [tools/collider-fit.mjs](../tools/collider-fit.mjs): Measures every new part and excludes melee blade extensions.
