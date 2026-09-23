#!/usr/bin/env python3
"""Add a <lastmod> to every URL in sitemap.xml, from the file's last commit.

    python3 tools/build_sitemap.py            # rewrite sitemap.xml
    python3 tools/build_sitemap.py --check    # exit 1 if sitemap.xml is stale

WHY THIS EXISTS. The URL list, the <changefreq> and the <priority> in
sitemap.xml are hand-curated and stay that way. Only <lastmod> is computed. A
crawler that sees no <lastmod> must guess how often to come back; a crawler that
sees a real one re-crawls the pages that changed and leaves the rest alone.

WHY NOT MTIME. The obvious source is the file's modification time, and it is
wrong. `git clone` and `git pull` set the mtime of every file they write to the
moment they write it, so a fresh checkout dates the whole site today. That is
both a false claim to a crawler and a --check that can never pass twice. The
last commit that touched the file is the date the CONTENT changed, it is the
same on every machine, and it is what this script uses.

A file git does not track has no commit date, so it falls back to its mtime.
That covers a page added but not yet committed.

Each <loc> maps to a file under the repository root:

    https://example.com/            ->  index.html
    https://example.com/foo/        ->  foo/index.html
    https://example.com/foo         ->  foo.html, else foo/index.html
    https://example.com/foo.html    ->  foo.html

The script is idempotent. Run it last, after every other generator, and commit
the result in the same commit as the pages it dates: the dates it writes are
the dates of the PREVIOUS commit to each file, which is correct for every page
this commit does not touch and one commit behind for every page it does. Run it
again in the next commit and the site catches up. A page whose <loc> has no
file keeps whatever <lastmod> it had, and the script says so on stderr.
"""

import argparse
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITEMAP = ROOT / "sitemap.xml"

URL_RE = re.compile(r"<url>(.*?)</url>", re.S)
LOC_RE = re.compile(r"<loc>\s*(.*?)\s*</loc>")
LASTMOD_RE = re.compile(r"[ \t]*<lastmod>.*?</lastmod>[ \t]*\n?", re.S)


def path_for(loc):
    """Return the repository file that serves this URL, or None."""
    rel = re.sub(r"^https?://[^/]+/?", "", loc).split("?")[0].split("#")[0]
    if not rel:
        return ROOT / "index.html"
    candidates = []
    if rel.endswith("/"):
        candidates.append(ROOT / rel / "index.html")
    elif rel.endswith(".html"):
        candidates.append(ROOT / rel)
    else:
        candidates.append(ROOT / (rel + ".html"))
        candidates.append(ROOT / rel / "index.html")
    for c in candidates:
        if c.is_file():
            return c
    return None


_cache = {}


def lastmod_for(path):
    key = str(path)
    if key not in _cache:
        _cache[key] = _git_date(path) or date.fromtimestamp(path.stat().st_mtime).isoformat()
    return _cache[key]


def _git_date(path):
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", str(path.relative_to(ROOT))],
            cwd=ROOT, capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    stamp = out.stdout.strip()
    return stamp if re.fullmatch(r"\d{4}-\d{2}-\d{2}", stamp) else None


def render(text):
    missing = []

    def one(m):
        block = m.group(1)
        loc_m = LOC_RE.search(block)
        if not loc_m:
            return m.group(0)
        path = path_for(loc_m.group(1))
        if path is None:
            missing.append(loc_m.group(1))
            return m.group(0)
        stripped = LASTMOD_RE.sub("", block)
        # <lastmod> goes straight after <loc>, which is the order the sitemap
        # protocol documents and the order a human reads.
        indent = re.search(r"\n([ \t]*)<loc>", stripped)
        pad = indent.group(1) if indent else "    "
        out = stripped.replace(
            loc_m.group(0),
            "%s\n%s<lastmod>%s</lastmod>" % (loc_m.group(0), pad, lastmod_for(path)),
            1,
        )
        return "<url>%s</url>" % out

    return URL_RE.sub(one, text), missing


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="exit 1 if sitemap.xml is stale")
    args = ap.parse_args()

    current = SITEMAP.read_text(encoding="utf-8")
    wanted, missing = render(current)

    for loc in missing:
        print("warning: no file for %s" % loc, file=sys.stderr)

    if args.check:
        if wanted != current:
            print("sitemap.xml is stale - run: python3 tools/build_sitemap.py", file=sys.stderr)
            return 1
        print("sitemap.xml is up to date (%d urls)" % len(URL_RE.findall(current)))
        return 1 if missing else 0

    if wanted != current:
        SITEMAP.write_text(wanted, encoding="utf-8")
        print("wrote sitemap.xml (%d urls)" % len(URL_RE.findall(wanted)))
    else:
        print("sitemap.xml unchanged (%d urls)" % len(URL_RE.findall(wanted)))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
