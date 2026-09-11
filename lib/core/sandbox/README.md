# Unit script sandbox

The sandbox uses the separate-WASM release-sync variant from `quickjs-emscripten`. Package imports use
the installed core and variant in Node plus bundled ESM URLs in Kite3D. The aliases avoid the
development server externalizing QuickJS's private chunk files. The same release build loads in Node
and through the Kite3D browser development server. Every scripted unit owns one QuickJS runtime and
one context. Each runtime has a 256 KB memory limit.

Fuel is deterministic. One QuickJS interrupt-handler check represents 1,000 documented interpreter
operations, so the 10,000-operation tick budget allows 10 checks. On quickjs-emscripten 0.32.0, an
empty 1,000-iteration `for` loop causes one interrupt check. Navigation calls debit their documented
cost directly from the same operation balance. No wall clock is read.

Each tick sends `sense` into QuickJS as one JSON string. Navigation functions and `sense.rand` are
closed-over host functions, not globals. Actions and `mem` return together as one JSON string. The
host applies actions only after a successful tick and rejects `mem` larger than 4,096 UTF-8 bytes.
