#!/usr/bin/env bash
#
# Sync the Docker daemon's proxy to the Clash port pushed into WSL.
#
# The daemon needs a proxy to pull images from Docker Hub, but Clash's port is
# random. Read HTTPS_PROXY from the WSL env (updated automatically by Clash)
# and restart Docker with the current port.
#
# Requires sudo (restarts the Docker daemon).

set -euo pipefail

SRC="${HTTPS_PROXY:-${https_proxy:-}}"
if [[ -z "$SRC" ]]; then
  echo "error: no proxy in environment (HTTPS_PROXY) — start Clash first." >&2
  exit 1
fi

PORT="${SRC##*:}"
PORT="${PORT%%/*}"

echo "updating Docker daemon proxy to 127.0.0.1:${PORT} ..."
sudo tee /etc/systemd/system/docker.service.d/proxy.conf >/dev/null <<EOF
[Service]
Environment="HTTP_PROXY=http://127.0.0.1:${PORT}"
Environment="HTTPS_PROXY=http://127.0.0.1:${PORT}"
Environment="NO_PROXY=localhost,127.0.0.1,192.168.*,172.*,10.*,<local>"
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker

echo "done — Docker daemon proxy is now 127.0.0.1:${PORT}"
