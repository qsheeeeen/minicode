#!/usr/bin/env bash
#
# Prepare proxy access for eval runs.
#
# Clash on Windows pushes its (random) proxy port into WSL via
# HTTPS_PROXY=http://127.0.0.1:<port>. eval/harbor/run.sh --proxy runs the task
# container with --network host so 127.0.0.1 inside the container is the WSL
# loopback and the proxy is directly reachable. This script generates the apt
# proxy config that run.sh mounts into the container.
#
#   bash eval/harbor/proxy.sh start   # auto-detect proxy from env
#   MINICODE_PROXY_URL=http://127.0.0.1:11952 bash eval/harbor/run.sh --proxy deepseek/deepseek-v4-flash

set -euo pipefail

APT_CONF="/tmp/minicode-apt-proxy.conf"

container_proxy_url() {
  if [[ -n "${MINICODE_PROXY_URL:-}" ]]; then
    echo "$MINICODE_PROXY_URL"
    return 0
  fi
  local src="${HTTPS_PROXY:-${https_proxy:-}}"
  if [[ -z "$src" ]]; then
    echo "error: no proxy in environment (HTTPS_PROXY) and MINICODE_PROXY_URL unset" >&2
    return 1
  fi
  # With --network host the container shares the WSL network stack, so the
  # WSL-visible 127.0.0.1:<port> is already the container proxy address.
  echo "$src"
}

PROXY_URL="$(container_proxy_url)"

parse_host() {
  local host="${PROXY_URL#http://}"
  host="${host%%/*}"
  echo "${host##*:} ${host%:*}"
}

reachable() {
  read -r port host <<<"$(parse_host)"
  (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null
}

start() {
  if ! reachable; then
    echo "error: proxy $PROXY_URL is not reachable — start it first." >&2
    exit 1
  fi

  # apt ignores env vars; give the container a static apt proxy config that
  # eval/harbor/run.sh --proxy mounts into the task container.
  cat > "$APT_CONF" <<EOF
Acquire::http::Proxy "$PROXY_URL";
Acquire::https::Proxy "$PROXY_URL";
EOF

  echo "container proxy: $PROXY_URL"
  echo "apt proxy conf:  $APT_CONF"
}

stop() {
  echo "no forwarder process; nothing to stop"
}

status() {
  if reachable; then
    echo "proxy $PROXY_URL: reachable"
  else
    echo "proxy $PROXY_URL: NOT reachable"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    sed -n '4,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac
