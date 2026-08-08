#!/usr/bin/env bash
#
# Prepare local Terminal-Bench task copies with China-friendly install
# patches. Harbor runs these via `--path eval/harbor/tasks/<task>` so the
# verifier can fetch uv/PyPI through mirrors instead of hanging on
# github.com / pypi.org.
#
# The task content itself is untouched except tests/test.sh dependency
# fetching; the patch is in eval/harbor/patches/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERE="$REPO_ROOT/eval/harbor"
TASKS_DIR="$HERE/tasks"
TB_REPO="$TASKS_DIR/terminal-bench-2"
TB_URL="https://github.com/laude-institute/terminal-bench-2.git"
TASKS=(fix-git)

mkdir -p "$TASKS_DIR"

if [ ! -d "$TB_REPO/.git" ]; then
  git clone --depth 1 "$TB_URL" "$TB_REPO"
fi

for task in "${TASKS[@]}"; do
  echo "==> preparing $task"
  rm -rf "$TASKS_DIR/$task"
  cp -r "$TB_REPO/$task" "$TASKS_DIR/$task"
  git -C "$TASKS_DIR/$task" init -q 2>/dev/null || true
  git -C "$TASKS_DIR/$task" add -A 2>/dev/null || true
  git -C "$TASKS_DIR/$task" apply "$HERE/patches/$task-verifier.patch"
  rm -rf "$TASKS_DIR/$task/.git"
done

echo "Done. Run: bash eval/harbor/run.sh --local fix-git deepseek/deepseek-v4-flash"
