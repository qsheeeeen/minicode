#!/usr/bin/env bash
#
# One-shot setup for running Terminal-Bench (Harbor) with minicode:
#   1. Docker Engine (Ubuntu/Debian, via sudo)
#   2. Docker daemon proxy synced to the Clash port in the WSL environment
#   3. Harbor CLI (via uv, falling back to an isolated /tmp uv install)
#   4. Standalone minicode eval binary (via bun)
#
# Everything is idempotent and auto-detected: already-installed tools, an
# up-to-date binary and a matching daemon proxy are skipped without asking.
# Run this from a normal WSL2/Ubuntu terminal (not inside the Codex sandbox),
# from anywhere — it locates the repo relative to this script:
#
#   bash eval/harbor/setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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
  if command -v docker >/dev/null 2>&1 &&
    { docker info >/dev/null 2>&1 || sudo -n docker info >/dev/null 2>&1; }; then
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

sync_docker_proxy() {
  # Clash on Windows pushes its (random) proxy port into WSL via HTTPS_PROXY.
  # The Docker daemon needs the same port to pull images from Docker Hub.
  local src="${HTTPS_PROXY:-${https_proxy:-}}"
  if [[ -z "$src" ]]; then
    say "No proxy in WSL environment (HTTPS_PROXY) — skipping daemon proxy sync."
    return 0
  fi

  local port="${src##*:}"
  port="${port%%/*}"

  local current=""
  local conf=/etc/systemd/system/docker.service.d/proxy.conf
  if [[ -f "$conf" ]]; then
    current="$(sed -n 's/.*HTTPS_PROXY=http:\/\/127.0.0.1:\([0-9]*\).*/\1/p' "$conf" | head -1)"
  fi
  if [[ "$current" == "$port" ]]; then
    say "Docker daemon proxy already at 127.0.0.1:$port — skipping."
    return 0
  fi

  require_sudo
  say "Syncing Docker daemon proxy to 127.0.0.1:$port (restarts Docker)..."
  sudo mkdir -p /etc/systemd/system/docker.service.d
  sudo tee "$conf" >/dev/null <<EOF
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:${port}"
Environment="HTTPS_PROXY=http://127.0.0.1:${port}"
Environment="NO_PROXY=localhost,127.0.0.1,192.168.*,172.*,10.*,<local>"
EOF
  sudo systemctl daemon-reload
  sudo systemctl restart docker
  say "Docker daemon proxy is now 127.0.0.1:$port"
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

install_docker
sync_docker_proxy
install_harbor
build_binary

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
