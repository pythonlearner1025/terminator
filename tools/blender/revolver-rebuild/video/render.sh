#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( available >= 3145728 )) || { echo "Deferred: need3GiB RAM (${available}KiB available)" >&2; exit 75; }
# Keep the shared wrapper's working snap GPU environment. Snap creates its own
# scope: the first Python script caps only that own scope before source loading.
wrapper="${REVOLVER_BLENDER:-/home/minjune/games/terminator-v2/coordination/revolver-blender}"
exec timeout --signal=TERM --kill-after=5s 240s "$wrapper" \
  -b --python-exit-code 1 -P tools/blender/revolver-rebuild/video/limit-snap.py \
  tools/blender/revolver-rebuild/source/assembled/revolver-rebuild.blend \
  -P tools/blender/revolver-rebuild/video/render.py -- "$@"
