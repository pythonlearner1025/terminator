# Teeny hosting handoff

Deployable source files, each below the platform's 1 MB source limit:

1. `gallery.ts` — bounded request handler using the injected managed Database.
2. `teenybase.ts` — exact starter users/posts declarations plus `gallery_files`.
3. `worker.ts` — official starter imports, virtual config and managed bindings.

The parent owns source upload, authentication, generated SQL review, migration,
deployment and actual public upload verification. No handwritten SQL or direct
R2 binding calls are included. Source upload builds automatically; saving these
files is a deployment action and was **not** performed by the integration worker.
The public destination is `https://terminator-v2-scene-journal.app.teenyapp.com`.

`gallery_files` has unique `path`, `mime`, `sha256` and a `blob` file field under
`r2Base: 'gallery'`, plus standard ID/timestamps. Its public list/view rules allow
reads; create/update/delete rules are null. The starter users/posts schema and
rules remain unchanged. Review generated SQL for only this additive table/index
and its standard triggers before applying it.

## Upload protocol

Send raw bytes to `PUT` or `POST /_publish/file?path=<export-relative-path>` with:

- `X-Gallery-Publish-Token`: the parent-managed encrypted publishing secret.
- `X-Content-SHA256`: lowercase SHA256 of the exact bytes.
- `Content-Type`: `image/png`, `text/html`, or `application/json`, matching path.

The handler checks the publishing secret before reading the body, accessing a
table or initializing admin auth. It streams the body into bounded chunks with
an **8 MiB actual byte limit**, independent of Content-Length. MIME, UTF-8/JSON,
PNG signature and SHA256 are validated before admin initialization. PNG paths
must also contain the same SHA256 as their body.

Only root `index.html`, `history.json`, `public-copy.json`, `export.json`, three
known snapshot metadata/page names under bounded milestone slugs, and
`static/assets/<sha256>.png` are accepted. Arbitrary text, game/source files,
private manifests, traversal and platform routes cannot be uploaded. HTML is
text, but its MIME must be `text/html`; no generic plain-text upload is needed
by this export. `/agents.md` is served by Teeny itself and never overridden.

After authentication, `db.initAuth` uses the resolved admin service token, then
`db.table('gallery_files').insert({values})` or `.update({where, setValues})` owns
file upload and replacement cleanup. Native `new File(...)` is intentional:
the supplied official `$Table.filesToUpload` accepts `instanceof File` and
normalizes its name. There is no invented `newFile` framework import. The handler
reads back the persisted `blob` name and checks `db.headFileObject('gallery/' +
blob)` before acknowledging success. Repeating the same path/hash with an
existing object returns `200` and `alreadyUploaded: true` without rewriting.
Missing objects are repaired through the same supported table update.

Public GET/HEAD use a bounded exact-path select with JSON-string-quoted filter,
and `getFileObject`/`headFileObject`. HTML is inline; all files get nosniff, ETag
and a restrictive CSP. Hash-addressed images are immutable for a year; changing
HTML/JSON requires revalidation. No scripts, iframes or forms are enabled. The
worker disables request logging and catches unhandled failures with a generic
503 response, without logging headers or secrets.

## Export and validation

The corrected public bundle is `coordination/public-gallery-hosting` outside
this checkout. It has 131 files / 185,788,891 bytes: all 16 historical comparison
pages plus latest, 95 byte-identical PNGs and safe metadata. Its 443-word recap
correctly attributes native screenshot review to the coordinating AI agent and
art direction/feedback to the user. All 17 HTML pages have “Make your own” links
to `/agents.md`; the validator treats only that exact path as platform-owned.

The first export, `coordination/public-gallery`, is preserved. All 401 protected
source archive/history files retain their original hashes; milestone 16 remains
latest, Needs revision. No game source or runtime settings changed.

The parent should upload the `export.json` file allowlist, plus `export.json`
itself, sequentially. Upload image and snapshot dependencies first, root
`index.html` last. There is no atomic whole-bundle publication; a new deployment
returns 404 for files not uploaded yet. Retries are safe by path/hash. Concurrent
writers to the same path are not a supported publisher workflow.

Checks:

```sh
node --experimental-strip-types --test --test-concurrency=1 tools/v2/teenyapp/gallery.test.mjs
python3 -B tools/v2/integrate-public-gallery.test.py
node --check tools/v2/teenyapp/worker.ts
node --check tools/v2/teenyapp/teenybase.ts
```

Six focused handler tests cover unauthenticated writes, path restrictions,
streamed body limit, MIME/hash/format failures, idempotence, normalized file
references, replacement, GET/HEAD, ETag, PNG caching and reserved discovery.
These use a Table/File storage double, not a deployed Teeny database. Parent's
actual build, generated migration and live storage checks remain authoritative.
The export suite separately validates preservation, links, quotes, privacy,
repeatability and the exact platform-link exception. No GPU or browser is
needed for this handler/copy correction.

Framework source references: parent-provided official worker/config starter and
`$Database`/`$Table` source; [official teenyHono implementation](https://github.com/teenybase/teenybase/blob/main/packages/teenybase/src/worker/honoApp.ts).
