# Incremental recent-event projection

## Initial findings

- Base: `1d86ae5`; pre-work Kite3D checkpoint: `fdca0f2`.
- `projectViewModel` filters every historical event on each call. Its consumers
  rely on insertion order, inclusive cutoffs, and future events being eligible.
- `World.emit` appends; `World.applySnapshot` replaces the array or truncates and
  appends a structured-cloned suffix. The last consumed object's identity detects
  same-length and longer suffix replacement without inspecting old prefixes.
- Implementation uses a world-keyed WeakMap, retains only qualifying events,
  scans appended entries, and rebuilds on rewind/replacement/shrink/boundary
  change. Advancing time filters retained candidates; paused calls reuse them.
- Scope: viewmodel, focused core helper, CPU tests, and this report. No browser,
  GPU, other agents, publishing, push, engine, scene, UI, or dependency changes.

## Validation

### Incremental results

- First focused run: 8/8 tests passed. A seeded 2,000-operation differential test
  agrees with the original `Array.filter` across append, pause, time changes,
  array replacement, shrink, and structured-cloned suffix replacement.
- With 100,000 historical events, 600 paused calls, an appended delta, and 600
  advancing calls read zero historical timestamps after initial admission.
  Numeric index counters see only two boundary accesses per paused call and
  delta-length plus two accesses on append. Expired candidates stop being read.
- Real `projectViewModel` integration: 100,000 historical entries, then 1,201
  calls spanning pause/append/advancing time, with zero historical timestamp
  rereads. The additional expiry check confirms retired candidates are not read.
- Full public view-model comparisons cover host, guest, missing-player fallback,
  enemy-nameplate options, health, boss, kill order/limit/ages, shot attribution,
  legacy host damage, guest damage, chatter order, future timestamps, and rewind.
  Previous returned arrays remain independent and event history is unchanged.
- Real `World.applySnapshot` tests exercise same-length, longer and shorter
  cloned suffixes, rewind, and full array replacement.
- Explicit tests cover inclusive boundaries, non-finite timestamps/time, sparse
  arrays, world cache isolation, and subtraction rounding that differs from an
  algebraically rewritten timestamp cutoff.

### Serial CPU regression run

```sh
/usr/bin/time -v node --max-old-space-size=1024 --test --test-concurrency=1 \
  test/core/recent-events.test.js test/core/viewmodel.test.js \
  test/core/coop/snapshot.test.js test/core/sustained-retention.test.js
```

- 16/16 passed before the additional floating-point regression was added.
- Elapsed: 6.17 s; maximum resident set: 151,240 KiB (about 148 MiB), below 1.5 GB.
- Includes the existing ten-minute simulation retention regression from the base.
- Browser/editor/Kite3D runtime checks were not run under the explicit CPU-only,
  no-browser/GPU constraint; this is core projection validation only.

### Final verification and handoff

- Final focused run after adding the floating-point case: 12/12 passed via
  `node --max-old-space-size=1024 --test --test-concurrency=1 test/core/recent-events.test.js test/core/viewmodel.test.js`.
- `git diff --check` passed. Production changes are the focused helper and the
  import/call substitution in `lib/core/viewmodel.js`; all downstream public
  projection formulas remain unchanged.
- Commit subject: `Project recent view-model events incrementally`.
- Ready for parent review/cherry-pick; no publish or push performed.

## Limits to preserve in handoff

- Initial projection and invalidation rebuilds still scan the complete log.
- The existing downstream filters/maps and per-nameplate chatter search still
  process recent candidates. This task removes the historical scan only.
- Work and additional event references scale with qualifying events plus the
  appended delta, not a fixed count. Future timestamps must remain eligible.
- The cache relies on the specified immutable-prefix/clone-on-replacement
  contract. Undetectable in-place timestamp edits or interior replacements that
  retain the cached boundary identity are outside that contract.
- This does not bound the authoritative event history or establish full-game
  FPS/GPU performance.
