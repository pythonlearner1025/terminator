# Audio sources and licenses

This build contains no downloaded audio files. Every sound is synthesized at runtime by the original
WebAudio recipes in `lib/audio/catalog.js` and `lib/audio/synth.js`. Each catalog entry has two original
variations, followed by small gain and pitch variation on playback. No third-party sample material is
embedded, so no external attribution or CC0 download record is required.

| Sound IDs | Origin | License |
| --- | --- | --- |
| `pistol_9mm`, `m4_rifle`, `shotgun_fire`, `shotgun_pump`, `plasma_bolt` | Original procedural WebAudio synthesis | Project source license |
| `minigun_spinup`, `minigun_loop`, `minigun_spindown` | Original procedural WebAudio synthesis | Project source license |
| `reload_pistol`, `reload_m4`, `reload_shotgun`, `reload_plasma`, `dry_fire` | Original procedural WebAudio synthesis | Project source license |
| `knife_swing`, `knife_hit`, `grenade_throw`, `grenade_explosion` | Original procedural WebAudio synthesis | Project source license |
| `footstep_concrete`, `footstep_metal` | Original procedural WebAudio synthesis | Project source license |
| `servo_scout`, `servo_endo`, `servo_heavy`, `heavy_stomp`, `scout_screech` | Original procedural WebAudio synthesis | Project source license |
| `plasma_impact_concrete`, `plasma_impact_player`, `sparks_metal`, `headshot_clang` | Original procedural WebAudio synthesis | Project source license |
| `unit_death`, `spawn_gate` | Original procedural WebAudio synthesis | Project source license |
| `skynet_static`, `typewriter_tick` | Original procedural WebAudio synthesis | Project source license |
| `wave_klaxon`, `wave_clear`, `trader_open`, `cash_register` | Original procedural WebAudio synthesis | Project source license |
| `ui_hover`, `ui_click`, `low_health_heartbeat` | Original procedural WebAudio synthesis | Project source license |
| `ambient_bed`, `combat_music` | Original procedural WebAudio synthesis | Project source license |

Encoded audio asset size: 0 bytes. Runtime audio buffers are generated after the first user gesture and
are not stored in the project.
