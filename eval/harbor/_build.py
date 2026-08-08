"""Build the minicode standalone binary used by the Harbor eval adapter.

Kept free of any harbor imports so it can be run standalone:

    python3 eval/harbor/build_binary.py

The binary is cached in ``eval/harbor/.cache/`` (gitignored) and reused across
trials. It is built for the host OS/architecture, so run Harbor on a Linux x64
host (or otherwise match the Docker image platform).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = Path(__file__).resolve().parent / ".cache"
BINARY_PATH = CACHE_DIR / "minicode"
STUB_DIR = Path(__file__).resolve().parent / "stubs" / "react-devtools-core"


def _source_newer_than(binary: Path) -> bool:
    """True when any bundled source/stub is newer than the cached binary."""
    newest_source = 0.0
    for root in (REPO_ROOT / "src", STUB_DIR):
        for path in root.rglob("*"):
            if path.is_file():
                try:
                    newest_source = max(newest_source, path.stat().st_mtime)
                except OSError:
                    continue
    return newest_source > binary.stat().st_mtime


def ensure_devtools_stub() -> None:
    """Make ink's optional peer resolvable for the standalone build."""
    stub_target = REPO_ROOT / "node_modules" / "react-devtools-core"
    stub_target.mkdir(parents=True, exist_ok=True)
    for name in ("package.json", "index.js"):
        (stub_target / name).write_text((STUB_DIR / name).read_text())


def build_standalone_binary() -> Path:
    """Build the binary once; later calls return the cached copy."""
    if BINARY_PATH.exists() and not _source_newer_than(BINARY_PATH):
        return BINARY_PATH

    if shutil.which("bun") is None:
        raise RuntimeError(
            "bun is required to build the minicode eval binary; install it first"
        )

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    ensure_devtools_stub()

    tmp = BINARY_PATH.with_suffix(".tmp")
    subprocess.run(
        [
            "bun",
            "build",
            "--compile",
            "--minify",
            "src/main.ts",
            "--outfile",
            str(tmp),
        ],
        cwd=REPO_ROOT,
        check=True,
    )
    tmp.replace(BINARY_PATH)
    return BINARY_PATH


if __name__ == "__main__":
    print(build_standalone_binary())
