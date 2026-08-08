#!/usr/bin/env bash
#
# Manage proxy access for eval runs.
#
# Two modes:
#   * Direct:  set MINICODE_PROXY_URL to a container-reachable proxy address
#              (e.g. http://172.17.0.1:4395 when the proxy listens on 0.0.0.0).
#   * Forward: default — the host proxy listens on 127.0.0.1 only, so a small
#              forwarder exposes it on 0.0.0.0:4396 for containers.
#
#   bash eval/harbor/proxy.sh start   # prepare proxy access + apt conf
#   bash eval/harbor/proxy.sh stop    # stop the forwarder (forward mode only)
#   bash eval/harbor/proxy.sh status  # show proxy/forwarder state

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LISTEN_PORT="${MINICODE_PROXY_PORT:-4396}"
UPSTREAM="${MINICODE_PROXY_UPSTREAM:-127.0.0.1:4395}"
DIRECT_URL="${MINICODE_PROXY_URL:-}"
PID_FILE="/tmp/minicode-proxy-forward.pid"
LOG_FILE="/tmp/minicode-proxy-forward.log"
APT_CONF="/tmp/minicode-apt-proxy.conf"

if [[ -n "$DIRECT_URL" ]]; then
  proxy_url="$DIRECT_URL"
else
  proxy_url="http://172.17.0.1:${LISTEN_PORT}"
fi

start() {
  # Fail early if the upstream proxy is down.
  if [[ -n "$DIRECT_URL" ]]; then
    host="${DIRECT_URL#http://}"
    host="${host%%/*}"
    hport="${host##*:}"
    hhost="${host%:*}"
    if ! (exec 3<>"/dev/tcp/$hhost/$hport") 2>/dev/null; then
      echo "error: proxy $DIRECT_URL is not reachable — start it first." >&2
      exit 1
    fi
  else
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "forwarder already running (pid $(cat "$PID_FILE"))"
    else
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
    fi
  fi

  # apt ignores env vars; give the container a static apt proxy config that
  # eval/run.sh --proxy mounts into the task container.
  cat > "$APT_CONF" <<EOF
Acquire::http::Proxy "$proxy_url";
Acquire::https::Proxy "$proxy_url";
EOF

  if [[ -n "$DIRECT_URL" ]]; then
    echo "direct proxy:      $proxy_url"
  else
    echo "forwarder started: 0.0.0.0:${LISTEN_PORT} -> $UPSTREAM (pid $(cat "$PID_FILE"))"
  fi
  echo "container proxy:   $proxy_url"
  echo "apt proxy conf:    $APT_CONF"
}

stop() {
  if [[ -n "$DIRECT_URL" ]]; then
    echo "direct mode: no forwarder to stop"
    exit 0
  fi
  if [[ ! -f "$PID_FILE" ]]; then
    echo "no forwarder running"
    exit 0
  fi
  kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "forwarder stopped"
}

status() {
  if [[ -n "$DIRECT_URL" ]]; then
    host="${DIRECT_URL#http://}"
    host="${host%%/*}"
    hport="${host##*:}"
    hhost="${host%:*}"
    if (exec 3<>"/dev/tcp/$hhost/$hport") 2>/dev/null; then
      echo "direct proxy: $DIRECT_URL reachable"
    else
      echo "direct proxy: $DIRECT_URL NOT reachable"
    fi
    exit 0
  fi
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
