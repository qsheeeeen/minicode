#!/usr/bin/env bash
#
# Prepare proxy access for eval runs.
#
# The proxy must already be reachable from containers (listen on 0.0.0.0 /
# allow-lan) and its container-reachable address goes in MINICODE_PROXY_URL,
# e.g. http://172.17.0.1:4395 (docker0 gateway).
#
#   MINICODE_PROXY_URL=http://172.17.0.1:4395 bash eval/harbor/proxy.sh start
#   MINICODE_PROXY_URL=http://172.17.0.1:4395 bash eval/run.sh --proxy deepseek/deepseek-v4-flash

set -euo pipefail

PROXY_URL="${MINICODE_PROXY_URL:-}"
APT_CONF="/tmp/minicode-apt-proxy.conf"

if [[ -z "$PROXY_URL" ]]; then
  echo "error: MINICODE_PROXY_URL is required (e.g. http://172.17.0.1:4395)" >&2
  exit 1
fi

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
  # eval/run.sh --proxy mounts into the task container.
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
