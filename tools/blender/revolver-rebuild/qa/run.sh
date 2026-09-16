#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../../.."
# Browser and Blender must never overlap. Only this private browser is touched.
lock="${REVOLVER_QA_LOCK:-/home/minjune/games/terminator-v2/coordination/revolver-blender.lock}"
exec 9>"$lock"
flock -w 60 9 || { echo 'Deferred: Blender/QA resource lock is busy.' >&2; exit 75; }
available=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
(( available >= 3145728 )) || { echo "Deferred: MemAvailable ${available} KiB is below 3 GiB." >&2; exit 75; }
export REVOLVER_QA_LOCKED=1 OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=2 LP_NUM_THREADS=2
unit="revolver-qa-$(date +%s)-$$"
cleanup() { systemctl --user stop "$unit.scope" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 143' TERM INT
systemd-run --user --scope --quiet --unit="$unit" \
  -p MemoryMax=1800M -p MemoryHigh=1600M -p TasksMax=192 -p CPUQuota=200% \
  timeout --signal=TERM --kill-after=5s 120s taskset -c 0,1 xvfb-run --auto-servernum --server-num=180 --server-args="-screen 0 960x640x24 -nolisten tcp" node tools/blender/revolver-rebuild/qa/proof.mjs "$@"
