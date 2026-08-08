# Terminal-Bench evaluation for minicode

This directory adapts minicode to [Terminal-Bench](https://github.com/harbor-framework/terminal-bench)
through [Harbor](https://github.com/harbor-framework/harbor), the current
benchmark harness. Each task runs in an isolated Docker container; minicode is
compiled into a standalone binary, uploaded into the container, and runs there
headlessly with `--perm yolo`, so its shell tool operates on the task
environment directly.

## Prerequisites

- Docker (running), Python 3.12+, and `bun`
- Harbor: `pip install harbor` or `uv tool install harbor`
- An API key for the model provider, e.g. `export ANTHROPIC_API_KEY=...`

The standalone binary is built for the host OS/architecture. Harbor's Docker
containers default to `linux/amd64`, so a Linux x64 host is the smoothest
setup.

## One-shot setup

From a normal WSL2/Ubuntu terminal (not inside the Codex sandbox):

```bash
bash eval/harbor/setup.sh
```

This installs Docker Engine, the Harbor CLI (via `uv`), and builds the
standalone minicode binary. Use `--skip-docker`, `--skip-harbor`, or
`--skip-build` to skip individual steps.

## Quick smoke test

Build the binary (also done lazily by the adapter):

```bash
python3 eval/harbor/build_binary.py
```

Run one task on Terminal-Bench 2.0:

```bash
PYTHONPATH=eval/harbor harbor run \
  -d terminal-bench@2.0 \
  -a minicode_agent:MinicodeAgent \
  -m anthropic/claude-sonnet-4-5 \
  -l 1
```

For the verified Terminal-Bench 2.1 dataset:

```bash
PYTHONPATH=eval/harbor harbor run \
  -d terminal-bench/terminal-bench-2-1 \
  -a minicode_agent:MinicodeAgent \
  -m anthropic/claude-sonnet-4-5 \
  -l 1
```

## Full evaluation

Run all tasks with multiple attempts per task and higher concurrency:

```bash
PYTHONPATH=eval/harbor harbor run \
  -d terminal-bench/terminal-bench-2-1 \
  -a minicode_agent:MinicodeAgent \
  -m anthropic/claude-sonnet-4-5 \
  -k 5 \
  -n 4 \
  --timeout-multiplier 2
```

Results (pass/fail, per-task logs, trajectories) land under `~/.harbor/jobs/`
(or the directory shown at the end of the run).

## Notes

- Harbor model names use `provider/model`; minicode receives
  `model@provider` internally. The provider's API key is passed through
  (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.).
- Non-Anthropic providers default to the `openai-responses` protocol. To use
  a chat-completions-only endpoint, pass `--ak protocol=openai-chat`.
- Only the task container can reach the model API. Set your key as a normal
  environment variable on the host; Harbor passes it into the container's
  agent phase, and the adapter writes it to a mode-0600 config file under a
  private `/tmp/minicode-home`.
- Per-run settings are easy to tune: `-l/--n-tasks` limits the task count,
  `-t/--task <name>` runs one task, `-n/--n-concurrent` controls parallelism,
  and `--agent-timeout-multiplier` scales the per-task timeout.
- The adapter has no resume/ATIF-trajectory support yet; it only runs
  minicode from a fresh container per task.
