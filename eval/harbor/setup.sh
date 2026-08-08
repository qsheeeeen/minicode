#!/usr/bin/env bash
#
# One-shot setup for running Terminal-Bench (Harbor) with minicode:
#   1. Docker Engine (Ubuntu/Debian, via sudo)
#   2. Harbor CLI (via uv, falling back to an isolated /tmp uv install)
#   3. Standalone minicode eval binary (via bun)
#
# Run this from a normal WSL2/Ubuntu terminal (not inside the Codex sandbox),
# from anywhere — it locates the repo relative to this script:
#
#   bash eval/harbor/setup.sh
#
# Options:
#   --skip-docker   skip Docker install
#   --skip-harbor   skip Harbor CLI install
#   --skip-build    skip building the minicode binary
#   -h, --help      show this help

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKIP_DOCKER=0
SKIP_HARBOR=0
SKIP_BUILD=0

usage() {
  sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-docker) SKIP_DOCKER=1 ;;
    --skip-harbor) SKIP_HARBOR=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h | --help) usage ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      ;;
  esac
  shift
done

say() { printf '\n==> %s\n' "$*"; }

require_sudo() {
  if [[ $EUID -eq 0 ]]; then
    return 0
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required to install Docker but was not found." >&2
    exit 1
  fi
  if ! sudo -n true 2>/dev/null && [[ -t 0 ]]; then
    echo "Enter your sudo password when prompted."
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
    say "Docker is already installed and running — skipping."
    return
  fi

  require_sudo
  say "Installing Docker Engine (docker.io + compose v2)..."
  sudo apt-get update
  sudo apt-get install -y docker.io docker-compose-v2

  say "Starting the Docker daemon via systemd..."
  sudo systemctl enable --now docker 2>/dev/null || {
    echo "systemd did not start Docker; trying a manual daemon start." >&2
    sudo nohup dockerd >/tmp/dockerd.log 2>&1 &
    sleep 3
  }

  if ! sudo docker info >/dev/null 2>&1; then
    echo "Docker daemon is not responding yet. Check: sudo journalctl -u docker" >&2
    exit 1
  fi

  if [[ $EUID -ne 0 ]]; then
    say "Adding $USER to the docker group (takes effect after re-login)..."
    sudo usermod -aG docker "$USER"
    echo "Note: run 'newgrp docker' in this shell, or log out/in, before using"
    echo "docker without sudo."
  fi
  say "Docker is ready."
}

install_harbor() {
  if command -v harbor >/dev/null 2>&1; then
    say "Harbor CLI already on PATH — skipping."
    return
  fi

  local uv_bin=""
  if command -v uv >/dev/null 2>&1; then
    uv_bin="$(command -v uv)"
  elif [[ -x "$HOME/.local/bin/uv" ]]; then
    uv_bin="$HOME/.local/bin/uv"
  elif [[ -x /tmp/uv-bin/uv ]]; then
    uv_bin=/tmp/uv-bin/uv
  fi

  if [[ -z "$uv_bin" ]]; then
    say "Installing uv into /tmp/uv-bin (no system-wide changes)..."
    curl -LsSf https://astral.sh/uv/install.sh -o /tmp/uv-install.sh
    UV_INSTALL_DIR=/tmp/uv-bin sh /tmp/uv-install.sh
    uv_bin=/tmp/uv-bin/uv
  fi

  say "Installing Harbor via $uv_bin..."
  "$uv_bin" tool install harbor

  if ! command -v harbor >/dev/null 2>&1; then
    echo "harbor was installed but is not on PATH. Add it with:" >&2
    echo '  export PATH="$HOME/.local/bin:$PATH"' >&2
  fi
  say "Harbor CLI is ready."
}

build_binary() {
  if ! command -v bun >/dev/null 2>&1; then
    say "bun not found — installing it..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  say "Building the standalone minicode eval binary..."
  python3 "$REPO_ROOT/eval/harbor/build_binary.py"
}

echo
echo "Terminal-Bench setup for minicode"
echo "Repo root: $REPO_ROOT"
echo

[[ $SKIP_DOCKER -eq 0 ]] && install_docker
[[ $SKIP_HARBOR -eq 0 ]] && install_harbor
[[ $SKIP_BUILD -eq 0 ]] && build_binary

cat <<EOF

Setup complete. Next steps:

  1. Export your model provider key, e.g.:
       export ANTHROPIC_API_KEY=sk-...

  2. Run a one-task smoke test:
       cd "$REPO_ROOT"
       PYTHONPATH=eval/harbor harbor run \\
         -d terminal-bench@2.0 \\
         -a minicode_agent:MinicodeAgent \\
         -m anthropic/claude-sonnet-4-5 \\
         -l 1

  3. Check eval/harbor/README.md for full datasets (terminal-bench@2.0,
     terminal-bench/terminal-bench-2-1) and tuning options.
EOF
