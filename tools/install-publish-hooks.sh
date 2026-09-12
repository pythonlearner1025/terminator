#!/bin/zsh
# Install git hooks that publish master to https://terminator.app.blitz.dev/ after every
# commit or merge on master in the main checkout. Run once per clone: tools/install-publish-hooks.sh
#
# The hooks live in .git/hooks (not versioned). They call tools/publish-master.sh detached,
# so commits stay fast. Commits on pass branches or in other worktrees are ignored.
set -eu
REPO=$(git rev-parse --show-toplevel)
HOOKS=$(git rev-parse --git-common-dir)/hooks
mkdir -p "$HOOKS"
for name in post-commit post-merge; do
  cat > "$HOOKS/$name" <<EOF
#!/bin/zsh
# Auto-publish master (installed by tools/install-publish-hooks.sh). Delete this file to stop.
[ "\$(git rev-parse --show-toplevel 2>/dev/null)" = "$REPO" ] || exit 0
[ "\$(git symbolic-ref --short HEAD 2>/dev/null)" = "master" ] || exit 0
echo "\$(date '+%F %T') hook $name fired in \$(pwd) on \$(git rev-parse --short HEAD)" >> "$REPO/../terminator-deploy/.kite3d/auto-publish.log" 2>/dev/null
nohup "$REPO/tools/publish-master.sh" >/dev/null 2>&1 &
exit 0
EOF
  chmod +x "$HOOKS/$name"
  echo "installed $HOOKS/$name"
done
