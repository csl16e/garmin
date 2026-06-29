#!/usr/bin/env python3
"""
Embed garmin/data.json into index.html between DATA_START / DATA_END sentinels.
Run after sync_garmin.py to refresh the dashboard.
"""
import json
import sys
from pathlib import Path

DATA_FILE = Path("garmin/data.json")
HTML_FILE = Path("index.html")
START_SENTINEL = "// DATA_START\n"
END_SENTINEL = "\n// DATA_END"


def main():
    if not DATA_FILE.exists():
        sys.exit(f"ERROR: {DATA_FILE} not found. Run sync_garmin.py first.")

    data = json.loads(DATA_FILE.read_text())
    data_js = "const GARMIN_DATA = " + json.dumps(data, separators=(",", ":"), default=str)

    src = HTML_FILE.read_text(encoding="utf-8")

    start_idx = src.find(START_SENTINEL)
    end_idx   = src.find(END_SENTINEL)
    if start_idx == -1 or end_idx == -1:
        sys.exit("ERROR: DATA_START / DATA_END sentinels not found in index.html")

    new_src = (
        src[: start_idx + len(START_SENTINEL)]
        + data_js
        + src[end_idx:]
    )

    HTML_FILE.write_text(new_src, encoding="utf-8")

    w = len(data.get("wellness", []))
    a = len(data.get("activities", []))
    print(f"Rebuilt index.html — {w} wellness days, {a} activities ({len(data_js)//1024} KB)")


if __name__ == "__main__":
    main()
