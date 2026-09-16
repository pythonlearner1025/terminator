# Local file PUT streaming patch

Kite3D 0.19.0-alpha.2 can leave Save pending inside `PUT /files/*`. The
route reads `c.req.raw.body`, then pipelines `c.env.incoming` into the temporary
file. Hono's lazy Web body getter creates a stream whose reader adapts that same
incoming stream. Its undrained Web queue can pause incoming as the other pipeline
writes, leaving the file transaction pending before hash/rename/response.

This explains why a complete or partial hidden temporary file can coexist with
an indefinitely pending Save. It is independent of rendering or exporter work.
Do not infer current construction state from `window.viewer`: the game's
`main.js` can leave it pointing to a disposed older runtime.

## Fix and scope

`tools/patch-kite3d-file-put.mjs` patches the **installed CLI**, both
`node_modules/kite3d/dist/server.js` and `node_modules/kite3d/src/server.ts`:

```js
const body = c.req.raw.body
if (!body) throw new Error('File request body is required')
await pipeline(Readable.fromWeb(body), createWriteStream(temporary, {flags: 'wx'}))
```

The TypeScript variant includes a type assertion to the Node Web stream type.
The existing `Readable` import is reused. Only the captured Web body is consumed;
no whole-body buffering is added. Using incoming exclusively without touching the
Web body is another possible approach, but would depend on no middleware having
already initialized that body. Consuming the public body avoids that dependency.

Authentication, path protections, If-Match, hash generation, atomic rename,
temporary-file cleanup, scene journaling and notifications retain their original
code. The existing **50 MiB screenshot cap** (both Content-Length and actual byte
checks) is unchanged. This Kite3D version has **no `/files/*` size cap**; this patch
does not add or remove one. The engine/editor version stays 0.19.0-alpha.2. The
round 1 lifecycle patch remains an unapplied artifact.

## Install on the parent's private project installation

Normal `npm install` / `npm ci` runs the new root `postinstall`. For an existing
installation, run from the project root:

```sh
npm run postinstall
npm run test:kite3d-put
```

Restart `kite3d dev` afterward: an already running server keeps its loaded code.
The parent owns that restart and native Save → Play verification. No scene edits
or native UI automation are performed by these scripts.

The installer fails closed unless the exact project devDependency pin,
`kite3d.version`, and installed package version are all `0.19.0-alpha.2`. It
checks the full source and dist against known original or patched content, and
validates both before writing either. Re-running is safe; a partly completed
installation can be resumed. Each file is atomically replaced, so hard links do
not mutate another installation. Source drift or an upgrade requires review of
the patch instead of a silent skip.

Symlinked/shared `node_modules`, the `kite3d` package, target directories or
target files are refused. This worktree uses shared `node_modules`; it was
intentionally left untouched. Regression fixtures use disposable private CLI
copies. Do not bypass this guard to patch another worktree's dependencies; use
a private npm installation. Install scripts disabled with `--ignore-scripts`
require the explicit `npm run postinstall` afterward.

## CPU evidence and reproduction

Linux x64, installed Hono Node adapter 1.19.17, actual `createDevServer`, isolated
temporary projects and real localhost HTTP. Node 26.7.0 matches the parent's
reported Mac Node version. The initial unmodified server run returned 201 for
100 bytes in 13 ms, while 376506 bytes stalled until abort at 4501 ms. A partial
163383-byte temporary file remained at the pre-abort snapshot. The parent's Mac
had complete 376506-byte temporary files; completion timing can vary.

Subsequent fixed-length 376506-byte requests sometimes completed. A paced
chunked upload of those same bytes reproduced the stall at 4503 ms, with a
73728-byte temporary file. A 2 MiB fixed-length request also stalled. This is a
stream-consumer/backpressure race, not a deterministic file-size cutoff.
The paced scene-sized upload and 2 MiB fixed-length stall also reproduced on
Node 22.23.1; the bug is not exclusive to Node 26.

After patching, the Node 26.7.0 probe returned 201 with exact bytes and SHA-256:
100 bytes in 14 ms, 376506 fixed-length bytes in 5 ms, 376506 paced chunked bytes
in 99 ms (including intentional 2 ms sender delays), and 2 MiB in 14 ms.

```sh
node tools/kite3d-put-probe.mjs --baseline
node tools/kite3d-put-probe.mjs --patched
```

The probe copies the installed CLI and reconstructs its hash-verified pristine
baseline if postinstall has already patched it. It never modifies the original.
It uses 4.5-second abort deadlines, snapshots temporary-file sizes before abort,
checks bytes/hash after success, prints no tokens, and closes/removes its server
and fixture. Nonzero baseline exit indicates a reproduced stall or byte mismatch;
individual fixed-length requests may pass. Use the same Node executable for both
runs. No package upgrade, browser, GPU, or full game workload is involved.

`test/server/kite3d-file-put.test.js` executes actual patched dist and stripped
TypeScript source against installed dependencies. It covers empty/small/scene/
multi-megabyte uploads, paced chunked transfer, concurrent/repeated writes,
If-Match and auth failures, protected paths, disconnect cleanup with original
target preservation, retry, and scene journal completion. Source execution
requires Node 22.13+; Node 20 runs the dist tests and skips source execution.
`kite3d-file-put-installer.test.js` covers pins, whole-file drift, idempotency,
interrupted install recovery, symlink refusal, hard-link isolation and CLI exit
behavior. A full TypeScript package build is not claimed.

Validation: **21/21** endpoint/installer cases pass on Node 26.7.0; **48/48** pass
on Node 22.23.1 when combined with the existing 27 lifecycle/rendering-hold/
warmup/startup-timing cases. Shared installed source/dist hashes remain unchanged.

Full `doctor` and `check` were not run because they launch Chromium, contrary to
the CPU-only task scope. Playable/Editable/Persisted and native Mac UI verification
remain with the parent; this patch's evidence establishes the HTTP fix only.

## Mac integration verification — 2026-09-14

Integrated in the playable release checkout on Node 26.7.0. All 21 endpoint and installer tests passed. The repaired server saved the existing in-memory scene successfully; native Chrome Play reached Wave 1 with the first-person view and enemies. The editor-hosted `kite3d check` passed Playable, Editable, and Persisted.

The hierarchy backup separately identified ten nested rubble meshes that editor Save had omitted from its deletion record. `tools/preserve-editor-rubble-deletions.mjs` preserves those specific deletions in the singly referenced rubble asset, keeping the main scene and its other user edits unchanged. This does not implement general per-instance deletion overrides for imported meshes. The upstream Play cancellation/overlay patch remains an unapplied artifact in the remote investigation branch.
