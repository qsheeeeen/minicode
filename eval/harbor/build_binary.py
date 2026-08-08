#!/usr/bin/env python3
"""Build the minicode standalone binary used by the Terminal-Bench adapter.

Usage:
    python3 eval/harbor/build_binary.py
"""

from _build import build_standalone_binary

if __name__ == "__main__":
    print(build_standalone_binary())
