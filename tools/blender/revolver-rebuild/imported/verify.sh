#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
COORDINATION="${COORDINATION:-/home/minjune/games/terminator-v2/coordination}"
OUTPUT="$PROJECT/generated/imported-hands"
export PATH="$SCRIPT_DIR/bin:$PATH"
"$COORDINATION/revolver-blender" -b "$OUTPUT/source/model.blend" \
  --python-exit-code 1 --python "$SCRIPT_DIR/pose_tests.py" -- "$OUTPUT" \
  > "$OUTPUT/pose-tests.log" 2>&1
for pose in neutral test-grip; do
  set +e
  "$COORDINATION/revolver-blender" -b "$OUTPUT/$pose.blend" \
    --python-exit-code 1 --python "$SCRIPT_DIR/verify_saved.py" -- "$OUTPUT" \
    > "$OUTPUT/$pose-reopen.log" 2>&1
  result=$?
  set -e
  printf '%s\n' "$result" > "$OUTPUT/$pose-reopen.exitcode"
  if (( result != 0 )); then
    cat "$OUTPUT/$pose-reopen.log"
    exit "$result"
  fi
done
"$OUTPUT/.venv/bin/python" "$SCRIPT_DIR/finish_report.py" "$OUTPUT"
