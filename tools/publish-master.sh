#!/bin/zsh
# Publish the current master to https://terminator.app.blitz.dev/ from the deploy worktree.
#
# Why a separate worktree: `kite3d publish` runs the project check first, and the check
# answers 409 while an editor tab is connected to the dev server of that checkout. The
# deploy worktree never has an editor, so publishing never fights the owner's editor.
#
# Called by the git post-commit and post-merge hooks of the main checkout (installed by
# tools/install-publish-hooks.sh) and safe to run by hand: tools/publish-master.sh
#
# Single flight: if a publish is running, this run leaves a "pending" marker and exits.
# The running publish loops until no marker is left, so the last master commit always ships.

set -u
# Git hooks export GIT_DIR and GIT_INDEX_FILE. Inherited here, they point git at the wrong
# repository inside the deploy worktree ("Unable to create .git/index.lock: Not a directory").
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX GIT_COMMON_DIR GIT_OBJECT_DIRECTORY 2>/dev/null
REPO=${TERMINATOR_REPO:-/Users/minjunes/games/terminator}
DEPLOY=${TERMINATOR_DEPLOY:-/Users/minjunes/games/terminator-deploy}
SLUG=${TERMINATOR_SLUG:-terminator}
STATE=$DEPLOY/.kite3d
LOG=$STATE/auto-publish.log
LOCK=$STATE/auto-publish.lock
PENDING=$STATE/auto-publish.pending

mkdir -p "$STATE"
touch "$PENDING"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "$(date '+%F %T') queued: a publish is running, marker left" >> "$LOG"
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log() { echo "$(date '+%F %T') $*" >> "$LOG" }

while [ -e "$PENDING" ]; do
  rm -f "$PENDING"
  target=$(git -C "$REPO" rev-parse master 2>/dev/null) || { log "abort: cannot read master"; exit 1 }
  subject=$(git -C "$REPO" log -1 --format=%s "$target")
  log "start: master $target ($subject)"

  # kite3d publish rewrites package.json (kite3d.version) in the deploy worktree; drop that before the check.
  git -C "$DEPLOY" checkout -q -- package.json 2>/dev/null
  if [ -n "$(git -C "$DEPLOY" status --porcelain)" ]; then
    log "abort: deploy worktree is dirty, resolve by hand: git -C $DEPLOY status"
    exit 1
  fi
  before_lock=$(git -C "$DEPLOY" rev-parse HEAD:package-lock.json 2>/dev/null)
  # The hook fires while git may still hold a lock from the commit itself. Retry briefly.
  checked_out=0
  for attempt in 1 2 3 4 5; do
    if err=$(git -C "$DEPLOY" checkout -q --detach "$target" 2>&1); then checked_out=1; break; fi
    log "checkout attempt $attempt failed: $err"
    sleep 2
  done
  [ "$checked_out" = 1 ] || { log "abort: checkout failed after 5 attempts"; exit 1 }
  after_lock=$(git -C "$DEPLOY" rev-parse HEAD:package-lock.json 2>/dev/null)
  if [ "$before_lock" != "$after_lock" ] || [ ! -d "$DEPLOY/node_modules" ]; then
    log "npm ci (lockfile changed)"
    (cd "$DEPLOY" && npm ci --no-audit --no-fund >> "$LOG" 2>&1) || { log "abort: npm ci failed"; exit 1 }
  fi

  (cd "$DEPLOY" && npx kite3d pull >> "$LOG" 2>&1) || log "warn: kite3d pull failed, publishing anyway"
  if [ -n "$(git -C "$DEPLOY" status --porcelain)" ]; then
    log "abort: kite3d pull changed files; the cloud copy has edits master lacks. Resolve by hand."
    git -C "$DEPLOY" status --porcelain >> "$LOG"
    exit 1
  fi

  node -e "const s=require('$STATE/state.json');if(s.playState==='playing'){s.playState='stopped';require('fs').writeFileSync('$STATE/state.json',JSON.stringify(s,null,2))}" 2>/dev/null
  published=0
  if (cd "$DEPLOY" && npx kite3d publish --slug "$SLUG" --message "master ${target:0:7}: $subject" >> "$LOG" 2>&1); then
    published=1
  elif tail -n 20 "$LOG" | grep -q "did not render 30 frames"; then
    # The bundled check has a 10 s render budget and fails under machine load. Prove the tree
    # with a standalone check, then publish without the bundled check.
    log "bundled check timed out; running a standalone check (up to 3 tries)"
    checked=0
    for try in 1 2 3; do
      if (cd "$DEPLOY" && npx kite3d check >> "$LOG" 2>&1); then checked=1; break; fi
      log "standalone check try $try failed; waiting 30 s for the machine to settle"
      sleep 30
    done
    if [ "$checked" = 1 ] && (cd "$DEPLOY" && npx kite3d publish --no-check --slug "$SLUG" --message "master ${target:0:7}: $subject" >> "$LOG" 2>&1); then
      published=1
    fi
  fi
  if [ "$published" = 1 ]; then
    hash=$(node -e "console.log(require('$STATE/deploys.json').last_publish.release_hash.slice(0,8))" 2>/dev/null)
    code=$(curl -s -o /dev/null -w '%{http_code}' https://$SLUG.app.blitz.dev/)
    log "done: master ${target:0:7} published as release $hash, live site answered $code"
    echo "$target" > "$STATE/auto-publish.last"
  else
    log "FAILED: publish of master ${target:0:7}; see the lines above"
    exit 1
  fi
done
