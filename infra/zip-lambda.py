#!/usr/bin/env python3
"""
Cross-platform replacement for the `zip` command used by deploy.sh.

Walks the source directory, zips its contents (not the directory itself)
into the destination path, applying the same exclude rules the original
`zip --exclude=...` invocations used.

Usage:
  python infra/zip-lambda.py <src_dir> <out_zip>
"""

import fnmatch
import os
import sys
import zipfile


# Patterns matched against a file's basename — the "*.test.js" / "run-*.js"
# style excludes from deploy.sh.
BASENAME_EXCLUDES = [
    ".env",
    ".env.*",
    "*.test.js",
    "run-*.js",
    ".eslintrc*",
    "eslint.config*",
]

# Path-prefix excludes — directories or files whose normalized POSIX path
# starts with one of these strings (or matches the pattern at any depth)
# is dropped. These mirror the deploy.sh `--exclude=*.git*` and the
# `node_modules/...` excludes.
PATH_PREFIX_EXCLUDES = [
    ".git",
    "node_modules/.bin",
]

# Patterns matched against any path segment — handles deploy.sh's
# `--exclude=node_modules/eslint*` etc., which in shell zip is a glob over
# the whole path. Easier to just check each segment.
SEGMENT_GLOB_EXCLUDES = [
    "eslint*",
    "@humanwhocodes*",
    "@eslint*",
    "@eslint-community*",
]


def excluded(rel_path: str) -> bool:
    norm = rel_path.replace("\\", "/")
    parts = norm.split("/")
    base = parts[-1]

    if any(fnmatch.fnmatch(base, pat) for pat in BASENAME_EXCLUDES):
        return True

    for prefix in PATH_PREFIX_EXCLUDES:
        if norm == prefix or norm.startswith(prefix + "/"):
            return True

    # Only check segment globs *inside* node_modules so we don't accidentally
    # drop a top-level "@eslint" symlink the user might have for some reason.
    if "node_modules" in parts:
        idx = parts.index("node_modules")
        for seg in parts[idx + 1 :]:
            if any(fnmatch.fnmatch(seg, pat) for pat in SEGMENT_GLOB_EXCLUDES):
                return True

    return False


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2

    src = os.path.abspath(sys.argv[1])
    dst = os.path.abspath(sys.argv[2])
    if not os.path.isdir(src):
        print(f"Source not a directory: {src}", file=sys.stderr)
        return 2

    file_count = 0
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(src):
            rel_root = os.path.relpath(root, src)
            rel_root = "" if rel_root == "." else rel_root.replace("\\", "/")

            # Prune directories in-place so we don't descend into excluded dirs.
            kept_dirs = []
            for d in dirs:
                rel_d = f"{rel_root}/{d}" if rel_root else d
                if not excluded(rel_d):
                    kept_dirs.append(d)
            dirs[:] = kept_dirs

            for f in files:
                rel = f"{rel_root}/{f}" if rel_root else f
                if excluded(rel):
                    continue
                z.write(os.path.join(root, f), rel)
                file_count += 1

    size = os.path.getsize(dst)
    print(f"  Wrote {file_count} files, {size:,} bytes -> {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
