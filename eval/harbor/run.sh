#!/usr/bin/env bash
#
# Run minicode on Terminal-Bench (one-task smoke by default).
#
# Prerequisites: Docker + Harbor installed (bash eval/harbor/setup.sh),
# an API key for the model provider, and the minicode eval binary.
#
# Usage:
#   bash eval/harbor/run.sh                                   # 1 task, anthropic/claude-sonnet-4-5
#   bash eval/harbor/run.sh deepseek/deepseek-v4-flash        # 1 task, custom model
#   bash eval/harbor/run.sh --mirrors deepseek/deepseek-v4-flash
#   bash eval/harbor/run.sh deepseek/deepseek-v4-flash -l 10  # extra flags pass to harbor run
#   bash eval/harbor/run.sh --local fix-git deepseek/deepseek-v4-flash
#   bash eval/harbor/run.sh --proxy deepseek/deepseek-v4-flash
#   MINICODE_AGENT_TIMEOUT_MULTIPLIER=1 bash eval/harbor/run.sh ...  # restore 900s
#
# Agent timeout defaults to 2x the task's timeout (1800s for most tasks) so
# complex multi-step work has room to finish; override with
# MINICODE_AGENT_TIMEOUT_MULTIPLIER (1 = task default).
#
# --mirrors points apt/uv/PyPI in the task container at China mirrors
# (--ak mirrors=true), useful when container installs are slow/blocked.
# --local <task> runs a prepared local task copy (eval/harbor/tasks/<task>)
# with patched dependency fetching; see eval/harbor/prepare_tasks.sh.
# --proxy routes the whole container through Clash: the task container runs
# with host networking so it shares the WSL loopback, and the proxy address
# (127.0.0.1:<random port>) is read from the WSL environment that Clash
# updates automatically. Prepare it with `bash eval/harbor/proxy.sh start`.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIRRORS=0
LOCAL_TASK=""
PROXY=0
POSITIONAL=()

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mirrors) MIRRORS=1 ;;
    --proxy) PROXY=1 ;;
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

COMMON_ARGS=(
  -a minicode_agent:MinicodeAgent
  -m "$MODEL"
  -l 1
  --agent-timeout-multiplier "${MINICODE_AGENT_TIMEOUT_MULTIPLIER:-2}"
  "${EXTRA_ARGS[@]}"
)

if [[ $PROXY -eq 1 ]]; then
  if [[ -n "${MINICODE_PROXY_URL:-}" ]]; then
    PROXY_URL="$MINICODE_PROXY_URL"
  else
    # Follow the proxy Clash pushed into WSL (HTTPS_PROXY=http://127.0.0.1:<port>);
    # host networking makes 127.0.0.1 inside the container reach the WSL loopback.
    SRC_PROXY="${HTTPS_PROXY:-${https_proxy:-}}"
    if [[ -z "$SRC_PROXY" ]]; then
      echo "no proxy in environment — set MINICODE_PROXY_URL or run Clash with WSL proxy support." >&2
      exit 1
    fi
    PROXY_URL="$SRC_PROXY"
  fi
  APT_CONF="/tmp/minicode-apt-proxy.conf"
  COMPOSE_FILE="/tmp/minicode-proxy-compose.yaml"
  CONFIG_FILE="/tmp/minicode-proxy-jobconfig.json"
  NO_PROXY="localhost,127.0.0.1,172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"

  # apt ignores env vars; write its proxy config so the verifier's apt steps
  # also go through the container proxy.
  cat > "$APT_CONF" <<EOF
Acquire::http::Proxy "$PROXY_URL";
Acquire::https::Proxy "$PROXY_URL";
EOF
cat > "$COMPOSE_FILE" <<EOF
services:
  main:
    network_mode: host
    volumes:
      - $APT_CONF:/etc/apt/apt.conf.d/99minicode-proxy:ro
EOF
  cat > "$CONFIG_FILE" <<EOF
{
  "environment": {
    "env": {
      "HTTP_PROXY": "$PROXY_URL",
      "HTTPS_PROXY": "$PROXY_URL",
      "ALL_PROXY": "$PROXY_URL",
      "NO_PROXY": "$NO_PROXY"
    },
    "extra_docker_compose": ["$COMPOSE_FILE"]
  },
  "verifier": {
    "env": {
      "HTTP_PROXY": "$PROXY_URL",
      "HTTPS_PROXY": "$PROXY_URL",
      "ALL_PROXY": "$PROXY_URL",
      "NO_PROXY": "$NO_PROXY"
    }
  }
}
EOF
  COMMON_ARGS+=(--config "$CONFIG_FILE")
fi

if [[ -n "$LOCAL_TASK" ]]; then
  TASK_DIR="$REPO_ROOT/eval/harbor/tasks/$LOCAL_TASK"
  if [[ ! -f "$TASK_DIR/task.toml" ]]; then
    echo "Local task not found: $TASK_DIR (run eval/harbor/prepare_tasks.sh)" >&2
    exit 1
  fi
  PYTHONPATH=eval/harbor harbor run \
    -p "$TASK_DIR" \
    "${COMMON_ARGS[@]}"
else
  PYTHONPATH=eval/harbor harbor run \
    -d terminal-bench@2.0 \
    "${COMMON_ARGS[@]}"
fi
