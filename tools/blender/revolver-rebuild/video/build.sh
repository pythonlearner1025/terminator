#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
for clip in Idle Draw Fire Reload AimIn AimOut AimIdle Sprint Inspect; do
  tools/blender/revolver-rebuild/video/render.sh --clip "$clip"
done
# No renderer remains. Encode/decode sequentially under the same heavy-work lock.
exec 9>"${REVOLVER_QA_LOCK:-/home/minjune/games/terminator-v2/coordination/revolver-blender.lock}"
flock -w 60 9 || { echo 'Deferred: shared resource lock busy.' >&2; exit 75; }
node tools/blender/revolver-rebuild/video/encode.mjs
node tools/blender/revolver-rebuild/video/verify.mjs
