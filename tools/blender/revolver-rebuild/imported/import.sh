#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
COORDINATION="${COORDINATION:-/home/minjune/games/terminator-v2/coordination}"
OUTPUT="$PROJECT/generated/imported-hands"
test "$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)" -ge 2400000 || {
  echo 'Need at least 2400000 kB available RAM before importing.' >&2
  exit 75
}
python3 -m venv "$OUTPUT/.venv"
"$OUTPUT/.venv/bin/python" -m pip install -e "$COORDINATION/hand-importer"
export PATH="$SCRIPT_DIR/bin:$PATH"
set +e
"$OUTPUT/.venv/bin/sketchfab-to-blender" e3c42c05b22944e5839deb8e003f0987 \
  --output "$OUTPUT/source" \
  --cache "$COORDINATION/hand-viewer-cache" \
  --max-texture 2048 --render-size 640 \
  --blender "$COORDINATION/revolver-blender" "$@" \
  > "$OUTPUT/import-cli.log" 2>&1
result=$?
set -e
printf '%s\n' "$result" > "$OUTPUT/import-cli.exitcode"
cat "$OUTPUT/import-cli.log"
exit "$result"
