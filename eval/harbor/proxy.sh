#!/usr/bin/env bash
#
# Manage the Docker-facing proxy forwarder for eval runs.
#
#   bash eval/harbor/proxy.sh start   # start forwarder + write apt proxy conf
#   bash eval/harbor/proxy.sh stop    # stop the forwarder
#   bash eval/harbor/proxy.sh status  # show forwarder + upstream proxy state
#
# The upstream proxy (127.0.0.1:4395 by default) must be running first.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LISTEN_PORT="${MINICODE_PROXY_PORT:-4396}"
UPSTREAM="${MINICODE_PROXY_UPSTREAM:-127.0.0.1:4395}"
PID_FILE="/tmp/minicode-proxy-forward.pid"
LOG_FILE="/tmp/minicode-proxy-forward.log"
APT_CONF="/tmp/minicode-apt-proxy.conf"

proxy_url="http://172.17.0.1:${LISTEN_PORT}"

start() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "forwarder already running (pid $(cat "$PID_FILE"))"
    exit 0
  fi

  # Fail early if the upstream proxy is down.
  if ! (exec 3<>"/dev/tcp/${UPSTREAM%:*}/${UPSTREAM#*:}") 2>/dev/null; then
    echo "error: upstream proxy $UPSTREAM is not reachable — start it first." >&2
    exit 1
  fi

  nohup python3 "$HERE/proxy_forward.py" "$LISTEN_PORT" "$UPSTREAM" \
    >>"$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 0.5
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "error: forwarder failed to start (see $LOG_FILE)" >&2
    exit 1
  fi

  # apt ignores env vars; give the container a static apt proxy config that
  # eval/run.sh --proxy mounts into the task container.
  cat > "$APT_CONF" <<EOF
Acquire::http::Proxy "$proxy_url";
Acquire::https::Proxy "$proxy_url";
EOF

  echo "forwarder started: 0.0.0.0:${LISTEN_PORT} -> $UPSTREAM (pid $(cat "$PID_FILE"))"
  echo "container proxy:   $proxy_url"
  echo "apt proxy conf:    $APT_CONF"
}

stop() {
  if [[ ! -f "$PID_FILE" ]]; then
    echo "no forwarder running"
    exit 0
  fi
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "forwarder stopped"
}

status() {
  if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "forwarder: running (pid $(cat "$PID_FILE"))"
  else
    echo "forwarder: stopped"
  fi
  if (exec 3<>"/dev/tcp/${UPSTREAM%:*}/${UPSTREAM#*:}") 2>/dev/null; then
    echo "upstream proxy: $UPSTREAM reachable"
  else
    echo "upstream proxy: $UPSTREAM NOT reachable"
  fi
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *)
    sed -n '3,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac
