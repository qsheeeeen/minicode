#!/usr/bin/env bash
#
# Run minicode on Terminal-Bench (one-task smoke by default).
#
# Prerequisites: Docker + Harbor installed (bash eval/harbor/setup.sh),
# an API key for the model provider, and the minicode eval binary.
#
# Usage:
#   bash eval/run.sh                                   # 1 task, anthropic/claude-sonnet-4-5
#   bash eval/run.sh deepseek/deepseek-v4-flash        # 1 task, custom model
#   bash eval/run.sh --mirrors deepseek/deepseek-v4-flash
#   bash eval/run.sh deepseek/deepseek-v4-flash -l 10  # extra flags pass to harbor run
#   bash eval/run.sh --local fix-git deepseek/deepseek-v4-flash
#
# --mirrors points apt/uv/PyPI in the task container at China mirrors
# (--ak mirrors=true), useful when container installs are slow/blocked.
# --local <task> runs a prepared local task copy (eval/harbor/tasks/<task>)
# with patched dependency fetching; see eval/harbor/prepare_tasks.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIRRORS=0
LOCAL_TASK=""
POSITIONAL=()

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mirrors) MIRRORS=1 ;;
    --local)
      LOCAL_TASK="${2:-}"
      if [[ -z "$LOCAL_TASK" ]]; then
        echo "--local requires a task name (e.g. fix-git)" >&2
        exit 1
      fi
      shift 2
      ;;
    -h | --help) usage ;;
    *) POSITIONAL+=("$1") ;;
  esac
  shift
done

MODEL="${POSITIONAL[0]:-anthropic/claude-sonnet-4-5}"
EXTRA_ARGS=("${POSITIONAL[@]:1}")
if [[ $MIRRORS -eq 1 ]]; then
  EXTRA_ARGS+=(--ak mirrors=true)
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found — run eval/harbor/setup.sh first." >&2
  exit 1
fi

if ! command -v harbor >/dev/null 2>&1; then
  echo "harbor CLI not found — run eval/harbor/setup.sh first." >&2
  exit 1
fi

echo "==> Terminal-Bench smoke: $MODEL (1 task)"
cd "$REPO_ROOT"
if [[ -n "$LOCAL_TASK" ]]; then
  TASK_DIR="$REPO_ROOT/eval/harbor/tasks/$LOCAL_TASK"
  if [[ ! -f "$TASK_DIR/task.toml" ]]; then
    echo "Local task not found: $TASK_DIR (run eval/harbor/prepare_tasks.sh)" >&2
    exit 1
  fi
  PYTHONPATH=eval/harbor harbor run \
    -p "$TASK_DIR" \
    -a minicode_agent:MinicodeAgent \
    -m "$MODEL" \
    -l 1 \
    "${EXTRA_ARGS[@]}"
else
  PYTHONPATH=eval/harbor harbor run \
    -d terminal-bench@2.0 \
    -a minicode_agent:MinicodeAgent \
    -m "$MODEL" \
    -l 1 \
    "${EXTRA_ARGS[@]}"
fi
