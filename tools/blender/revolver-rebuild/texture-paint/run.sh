#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
wrapper="${REVOLVER_BLENDER:-/home/minjune/games/terminator-v2/coordination/revolver-blender}"
exec "$wrapper" -b --python-exit-code 1 -P tools/blender/revolver-rebuild/video/limit-snap.py \
  "${TEXTURE_SOURCE:-tools/blender/revolver-rebuild/source/assembled/revolver-rebuild.blend}" \
  -P tools/blender/revolver-rebuild/texture-paint/source.py -- "$@"
