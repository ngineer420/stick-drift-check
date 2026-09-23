#!/usr/bin/env python3
"""Add a <lastmod> to every URL in sitemap.xml, from the file's mtime.

    python3 tools/build_sitemap.py            # rewrite sitemap.xml
    python3 tools/build_sitemap.py --check    # exit 1 if sitemap.xml is stale

WHY THIS EXISTS. The URL list, the <changefreq> and the <priority> in
sitemap.xml are hand-curated and stay that way. Only <lastmod> is computed, and
it is computed from the modification time of the file that each <loc> serves.
A crawler that sees no <lastmod> must guess how often to come back; a crawler
that sees a real one re-crawls the pages that changed and leaves the rest alone.

Each <loc> maps to a file under the repository root:

    https://example.com/            ->  index.html
    https://example.com/foo/        ->  foo/index.html
    https://example.com/foo         ->  foo.html, else foo/index.html
    https://example.com/foo.html    ->  foo.html

The script is idempotent. Run it last, after every other generator, because it
reads the mtimes the other generators leave behind. A <loc> whose file is
missing keeps whatever <lastmod> it already had, and the script reports it.
"""

import argparse
import re
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


def lastmod_for(path):
    return date.fromtimestamp(path.stat().st_mtime).isoformat()


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
        # Put <lastmod> straight after <loc>, which is the order the sitemap
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
