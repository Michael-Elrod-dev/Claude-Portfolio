#!/usr/bin/env python3
"""
Fetch the current memo from S3 and write it to memo-local.json.

Usage:
    python infra/fetch-memo.py
    python infra/fetch-memo.py --print      # also pretty-print to stdout
    python infra/fetch-memo.py --out path/to/file.json
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import boto3
except ImportError:
    sys.exit("boto3 not found. Run: pip install boto3")

BUCKET = "claude-portfolio-369382711663"
KEY = "memo.json"
DEFAULT_OUT = Path(__file__).parent.parent / "memo-local.json"


def main():
    parser = argparse.ArgumentParser(description="Fetch Claude Portfolio memo from S3")
    parser.add_argument("--print", action="store_true", dest="do_print",
                        help="Pretty-print memo to stdout in addition to writing the file")
    parser.add_argument("--out", default=str(DEFAULT_OUT), metavar="PATH",
                        help=f"Output path (default: {DEFAULT_OUT})")
    args = parser.parse_args()

    print(f"Fetching s3://{BUCKET}/{KEY} ...")
    s3 = boto3.client("s3", region_name="us-east-1")
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=KEY)
    except s3.exceptions.NoSuchKey:
        sys.exit(f"No memo found at s3://{BUCKET}/{KEY}. Has the bot run yet?")
    except Exception as e:
        sys.exit(f"S3 error: {e}")

    raw = obj["Body"].read().decode("utf-8")
    memo = json.loads(raw)

    out_path = Path(args.out)
    out_path.write_text(json.dumps(memo, indent=2), encoding="utf-8")
    print(f"Saved -> {out_path}")

    if args.do_print:
        print()
        _pretty_print(memo)


def _pretty_print(memo: dict):
    print(f"Last updated: {memo.get('lastUpdated', 'unknown')}")
    print()

    open_theses = memo.get("openTheses", [])
    print(f"-- Open Theses ({len(open_theses)}) " + "-" * 40)
    for t in open_theses:
        print(f"\n  {t['ticker']}  (opened {t.get('openedRun', '?')})")
        print(f"    {t['thesis']}")
        watch = t.get("watchFor", [])
        if watch:
            print(f"    Watch: {', '.join(watch)}")

    closed_theses = memo.get("closedTheses", [])
    if closed_theses:
        print(f"\n-- Closed Theses ({len(closed_theses)}) " + "-" * 40)
        for t in closed_theses:
            print(f"\n  {t['ticker']}  (closed {t.get('closedRun', '?')})")
            print(f"    {t.get('outcome', '')}")

    watchlist = memo.get("watchlist", [])
    if watchlist:
        print(f"\n-- Watchlist " + "-" * 40)
        print(f"  {', '.join(watchlist)}")

    observations = memo.get("generalObservations", "")
    if observations:
        print(f"\n-- General Observations " + "-" * 40)
        import textwrap
        print(textwrap.fill(observations, width=80, initial_indent="  ", subsequent_indent="  "))

    print()


if __name__ == "__main__":
    main()
