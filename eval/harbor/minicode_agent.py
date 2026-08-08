"""Harbor installed-agent adapter for minicode.

Implements the ``BaseInstalledAgent`` interface so minicode can be evaluated
on Terminal-Bench datasets through Harbor:

    PYTHONPATH=eval/harbor harbor run \
        -d terminal-bench@2.0 \
        -a minicode_agent:MinicodeAgent \
        -m anthropic/claude-sonnet-4-5 \
        -l 5

The adapter compiles minicode into a standalone binary on the host, uploads it
into each task container, writes a minicode config (API key, model, yolo
permissions) into a private HOME, and runs ``minicode -H --perm yolo`` on the
task instruction. The task container's shell is minicode's own shell tool, so
all agent actions happen inside the isolated benchmark environment.

API keys are read from the host environment using the provider's standard
variable (e.g. ``ANTHROPIC_API_KEY``, ``OPENAI_API_KEY``,
``DEEPSEEK_API_KEY``), mirroring how Harbor's built-in installed agents work.
"""

from __future__ import annotations

import json
import os
import shlex
import tempfile
from pathlib import Path
from typing import override

from harbor.agents.installed.base import (
    BaseInstalledAgent,
    with_prompt_template,
)
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

from _build import build_standalone_binary

REMOTE_BINARY = "/installed-agent/minicode"
REMOTE_HOME = "/tmp/minicode-home"
REMOTE_CONFIG = f"{REMOTE_HOME}/.minicode/config.json"
RUN_LOG = "/logs/agent/minicode.txt"

# Standard API-key environment variables, in preference order. Any provider
# not listed falls back to <PROVIDER>_API_KEY (uppercased, '-' -> '_').
PROVIDER_API_KEY_ENVS: dict[str, tuple[str, ...]] = {
    "anthropic": ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    "openai": ("OPENAI_API_KEY",),
    "deepseek": ("DEEPSEEK_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "google": ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"),
    "groq": ("GROQ_API_KEY",),
    "mistral": ("MISTRAL_API_KEY",),
    "xai": ("XAI_API_KEY",),
    "together": ("TOGETHER_API_KEY", "TOGETHERAI_API_KEY"),
    "dashscope": ("DASHSCOPE_API_KEY",),
    "moonshot": ("MOONSHOT_API_KEY",),
    "kimi": ("KIMI_API_KEY", "MOONSHOT_API_KEY"),
    "zai": ("ZAI_API_KEY",),
    "ollama": ("OLLAMA_API_KEY",),
}


def _first_env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _api_key_envs(provider: str) -> tuple[str, ...]:
    known = PROVIDER_API_KEY_ENVS.get(provider)
    if known:
        return known
    return (f"{provider.upper().replace('-', '_')}_API_KEY",)


def _host_minicode_config() -> dict | None:
    """Fall back to the user's ~/.minicode/config.json for API keys."""
    config_path = Path(
        os.environ.get("MINICODE_CONFIG", "~/.minicode/config.json")
    ).expanduser()
    try:
        raw = config_path.read_text()
    except OSError:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


class MinicodeAgent(BaseInstalledAgent):
    """Run minicode headlessly inside the Terminal-Bench task container."""

    SUPPORTS_RESUME = False
    SUPPORTS_ATIF = False

    @staticmethod
    @override
    def name() -> str:
        return "minicode"

    def __init__(
        self,
        *args,
        protocol: str | None = None,
        mirrors: bool = False,
        **kwargs,
    ):
        """``protocol`` overrides minicode's LLM protocol for the provider.

        Defaults to ``anthropic`` for the anthropic provider and
        ``openai-responses`` for everything else; pass e.g.
        ``--ak protocol=openai-chat`` for OpenAI-compatible endpoints that only
        support the chat completions API.

        ``mirrors`` switches apt (Debian/Ubuntu) and uv/PyPI to China mirror
        endpoints inside the task container. Useful when the task/verifier
        needs to install packages but direct international traffic is slow or
        blocked; off by default so benchmark semantics stay untouched.
        """
        self._protocol = protocol
        self._mirrors = mirrors
        super().__init__(*args, **kwargs)

    @override
    def get_version_command(self) -> str | None:
        return f"{shlex.quote(REMOTE_BINARY)} --version"

    @override
    def parse_version(self, stdout: str) -> str:
        # "Mini Code v1.0.0" -> "1.0.0"
        text = stdout.strip()
        for line in text.splitlines():
            if "v" in line:
                return line.rsplit("v", 1)[-1].strip()
        return text

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        binary = build_standalone_binary()
        await environment.upload_file(binary, REMOTE_BINARY)
        await self.exec_as_root(
            environment,
            command=f"chmod 755 {shlex.quote(REMOTE_BINARY)}",
        )
        if self._mirrors:
            await self._configure_mirrors(environment)

    async def _configure_mirrors(self, environment: BaseEnvironment) -> None:
        """Point apt and uv/PyPI at China mirrors for faster installs.

        Best-effort: every step tolerates failure so a container that can't
        reach the mirrors still proceeds with the agent run.
        """
        script = r"""
set +e
. /etc/os-release 2>/dev/null
APT_MIRROR=
case "$ID" in
  debian)
    APT_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/debian"
    SECURITY_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/debian-security"
    CODENAME="${VERSION_CODENAME:-bookworm}"
    ;;
  ubuntu)
    APT_MIRROR="https://mirrors.tuna.tsinghua.edu.cn/ubuntu"
    SECURITY_MIRROR="$APT_MIRROR"
    CODENAME="${VERSION_CODENAME:-noble}"
    ;;
esac

if [ -n "$APT_MIRROR" ] && command -v apt-get >/dev/null 2>&1; then
  if [ -f /etc/apt/sources.list ]; then
    cp /etc/apt/sources.list /etc/apt/sources.list.bak.minicode 2>/dev/null
    cat > /etc/apt/sources.list <<EOF
deb $APT_MIRROR $CODENAME main restricted universe multiverse
deb $APT_MIRROR $CODENAME-updates main restricted universe multiverse
deb $SECURITY_MIRROR $CODENAME-security main restricted universe multiverse
EOF
  fi
  # Ubuntu 24.04+ uses deb822 sources; override the file when present.
  if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
    cp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak.minicode 2>/dev/null
    cat > /etc/apt/sources.list.d/ubuntu.sources <<EOF
Types: deb
URIs: $APT_MIRROR
Suites: $CODENAME $CODENAME-updates $CODENAME-security
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
  fi
  apt-get update >/dev/null 2>&1
fi

# uv/PyPI mirror for every user home (uv reads ~/.config/uv/uv.toml).
for HOME_DIR in "$HOME" /root /home/*; do
  [ -d "$HOME_DIR" ] || continue
  mkdir -p "$HOME_DIR/.config/uv" 2>/dev/null
  cat > "$HOME_DIR/.config/uv/uv.toml" <<EOF
default-index = "https://pypi.tuna.tsinghua.edu.cn/simple"
EOF
done
exit 0
"""
        await self.exec_as_root(environment, command=script)

    async def _write_config(
        self,
        environment: BaseEnvironment,
        config: dict[str, object],
    ) -> None:
        """Upload minicode's config to a private HOME with owner-only perms."""
        config_dir = f"{REMOTE_HOME}/.minicode"
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p {shlex.quote(config_dir)}",
        )

        with tempfile.NamedTemporaryFile(
            mode="w",
            prefix="minicode-config-",
            suffix=".json",
        ) as tmp:
            json.dump(config, tmp, indent=2)
            tmp.flush()
            await environment.upload_file(Path(tmp.name), REMOTE_CONFIG)

        if environment.default_user is not None:
            await self.exec_as_root(
                environment,
                command=(
                    f"chown {shlex.quote(str(environment.default_user))} "
                    f"{shlex.quote(REMOTE_CONFIG)} && "
                    f"chmod 600 {shlex.quote(REMOTE_CONFIG)}"
                ),
            )

    @override
    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError(
                "--model must be in provider/model form, e.g. "
                "anthropic/claude-sonnet-4-5"
            )

        provider, _, model = self.model_name.partition("/")
        api_key = _first_env(*_api_key_envs(provider))
        base_url = _first_env(
            f"{provider.upper().replace('-', '_')}_BASE_URL",
            "MINICODE_BASE_URL",
        )

        # Fall back to the user's minicode config (providers.<name>.apiKey).
        host_config = _host_minicode_config()
        provider_config_host = None
        if host_config is not None:
            providers = host_config.get("providers")
            if isinstance(providers, dict):
                provider_config_host = providers.get(provider)
                if isinstance(provider_config_host, dict):
                    api_key = api_key or provider_config_host.get("apiKey")
                    base_url = base_url or provider_config_host.get("baseURL")

        if not api_key:
            raise ValueError(
                f"No API key found for provider '{provider}'. Set "
                f"{_api_key_envs(provider)[0]} (or the provider's usual key "
                "env var), or add providers.<provider>.apiKey to "
                "~/.minicode/config.json."
            )

        protocol = self._protocol or (
            "anthropic" if provider == "anthropic" else "openai-responses"
        )

        provider_config: dict[str, object] = {
            "apiKey": api_key,
            "protocol": protocol,
        }
        if base_url:
            provider_config["baseURL"] = base_url

        config = {
            "model": f"{model}@{provider}",
            "providers": {provider: provider_config},
            "permissionMode": "yolo",
        }
        await self._write_config(environment, config)

        escaped_instruction = shlex.quote(instruction)
        env = {
            "HOME": REMOTE_HOME,
            _api_key_envs(provider)[0]: api_key,
        }
        if base_url:
            env[f"{provider.upper().replace('-', '_')}_BASE_URL"] = base_url

        await self.exec_as_agent(
            environment,
            command=(
                f"{shlex.quote(REMOTE_BINARY)} -H --perm yolo "
                f"{escaped_instruction} "
                f"2>&1 </dev/null | stdbuf -oL tee {shlex.quote(RUN_LOG)}"
            ),
            env=env,
        )
