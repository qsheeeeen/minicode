#!/usr/bin/env bash
#
# Prepare local Terminal-Bench task copies with China-friendly install
# patches. Harbor runs these via `--path eval/harbor/tasks/<task>` so the
# verifier can fetch uv/PyPI reliably instead of hanging on github.com.
#
# Tasks whose tests/test.sh is the standard uv/pytest boilerplate get the
# enhanced template from eval/harbor/templates/ (apt mirror, uv retries +
# proxy fallback, TUNA PyPI). Task evaluation logic is untouched.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HERE="$REPO_ROOT/eval/harbor"
TASKS_DIR="$HERE/tasks"
TB_REPO="$TASKS_DIR/terminal-bench-2"
TB_URL="https://github.com/laude-institute/terminal-bench-2.git"
TEMPLATE="$HERE/templates/verifier-test.sh"
TASKS=(fix-git overfull-hbox)

mkdir -p "$TASKS_DIR"

if [ ! -d "$TB_REPO/.git" ]; then
  git clone --depth 1 "$TB_URL" "$TB_REPO"
fi

for task in "${TASKS[@]}"; do
  echo "==> preparing $task"
  rm -rf "$TASKS_DIR/$task"
  cp -r "$TB_REPO/$task" "$TASKS_DIR/$task"
  test_sh="$TASKS_DIR/$task/tests/test.sh"
  if grep -q "https://astral.sh/uv/0.9.5/install.sh" "$test_sh" &&
    grep -q "/tests/test_outputs.py" "$test_sh"; then
    cp "$TEMPLATE" "$test_sh"
    chmod +x "$test_sh"
    echo "  patched with the enhanced verifier template"
  else
    echo "  WARNING: $task's test.sh is not the standard uv/pytest template; left as-is"
  fi
done

echo "Done. Run: bash eval/harbor/run.sh --proxy --local fix-git deepseek/deepseek-v4-flash"
