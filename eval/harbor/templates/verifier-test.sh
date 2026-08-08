#!/bin/bash

# You can modify anything in this script. Just make sure it generates test output that
# is parsed by a parser (PytestParser by default).

# This boilerplate script installs uv (to manage Python) and runs pytest.

# China-friendly installs: apt mirror, GitHub-proxied uv with retries, TUNA PyPI.
# The task evaluation logic below is untouched.
if [ -f /etc/apt/sources.list.d/debian.sources ]; then
  sed -i \
    -e 's|deb.debian.org/debian|mirrors.tuna.tsinghua.edu.cn/debian|g' \
    -e 's|security.debian.org/debian-security|mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
    /etc/apt/sources.list.d/debian.sources 2>/dev/null || true
fi
if [ -f /etc/apt/sources.list ]; then
  sed -i \
    -e 's|deb.debian.org/debian|mirrors.tuna.tsinghua.edu.cn/debian|g' \
    -e 's|security.debian.org/debian-security|mirrors.tuna.tsinghua.edu.cn/debian-security|g' \
    /etc/apt/sources.list 2>/dev/null || true
fi

apt-get update
apt-get install -y curl

# uv's installer fetches the binary from GitHub releases, which is flaky via
# proxies. Retry a few times, then fall back to a GitHub proxy mirror.
install_uv() {
  for i in 1 2 3; do
    if curl -LsSf https://astral.sh/uv/0.9.5/install.sh | sh; then
      return 0
    fi
    echo "uv install attempt $i failed; retrying" >&2
    sleep 2
  done
  echo "direct uv install failed; using gh-proxy mirror" >&2
  export UV_INSTALLER_GITHUB_BASE_URL=https://gh-proxy.com/https://github.com/astral-sh/uv
  curl -LsSf https://astral.sh/uv/0.9.5/install.sh | sh
}
install_uv

source $HOME/.local/bin/env

# Fetch Python and pytest from the TUNA PyPI mirror.
export UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple

# Check if we're in a valid working directory
if [ "$PWD" = "/" ]; then
    echo "Error: No working directory set. Please set a WORKDIR in your Dockerfile before running this script."
    exit 1
fi

uvx \
  -p 3.13 \
  -w pytest==8.4.1 \
  -w pytest-json-ctrf==0.3.5 \
  pytest --ctrf /logs/verifier/ctrf.json /tests/test_outputs.py -rA


if [ $? -eq 0 ]; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
