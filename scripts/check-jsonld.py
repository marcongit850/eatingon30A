#!/usr/bin/env python3
"""Fail if any built HTML page has JSON-LD that does not parse."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKIP = {"node_modules", ".git", "vendor", ".wrangler", "includes"}
PATTERN = re.compile(r'<script type="application/ld\+json">(.*?)</script>', re.S)


def pages():
    for path in ROOT.rglob("*.html"):
        if any(part in SKIP for part in path.parts):
            continue
        yield path


def main() -> int:
    failures = []
    checked = 0
    for path in pages():
        html = path.read_text(encoding="utf-8")
        blocks = PATTERN.findall(html)
        if not blocks:
            continue
        for index, block in enumerate(blocks, start=1):
            checked += 1
            try:
                json.loads(block)
            except json.JSONDecodeError as error:
                failures.append(f"{path.relative_to(ROOT)} block {index}: {error}")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        print(f"{len(failures)} JSON-LD block(s) failed to parse", file=sys.stderr)
        return 1
    print(f"Parsed {checked} JSON-LD blocks")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
