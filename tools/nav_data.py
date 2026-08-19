"""stickdriftcheck.com navigation data — the single source of truth for the toolbar.

This is the ONLY file that differs between sites. `sync_nav.py` is generic and
copies verbatim. Nothing here is computed at runtime by the browser: sync_nav
renders it into the static HTML of every page.

This repo has no build step and ships every tool page twice — `/rumble-test.html`
and `/rumble-test/index.html`, byte-identical — so a five-link nav was copied
eleven times for five destinations. sync_nav derives each file's canonical URL
from its own path (`/x.html` and `/x/index.html` both -> `/x`), which is what
lets both members of a twin pair be stamped from one list and stay identical.

Tier rule (portfolio spec, ngineer420.github.io#13): a page is tier 1 only if it
answers a *different question*. Every tool in TOOLS does — a deadzone visualiser
and a rumble pulse are not the same measurement with a parameter changed.

The controller pages are the other side of that rule: /xbox-controller-test/
and its siblings run the same drift + button + trigger engine with the hardware
fixed, so they are the stick drift test with a parameter baked in and they are
tier 2. They never appear in the rail or in the sheet body; they attach to their
parent tier-1 tool through VARIANTS, which is what puts real <a href> sibling
chips in the tool's own panel and stamps aria-current="true" on the parent so
the rail does not render unselected on a console page.
"""

# Noun used in the menu trigger: "All 5 tests".
NOUN = "tests"

# Tier-1 tools, in rail order (rail is capped at 8 — this site has 5).
#   label -> rail chip text, <= 18 chars
#   long  -> anchor text in the sheet and in any footer/in-body list
#   group -> sheet grouping key, only used once a site passes 8 destinations
TOOLS = [
    {"href": "/stick-drift-test/",       "label": "Stick Drift", "long": "Stick Drift Test",       "group": "sticks",   "tier": 1},
    {"href": "/deadzone-visualizer/",    "label": "Deadzone",    "long": "Deadzone Visualizer",    "group": "sticks",   "tier": 1},
    {"href": "/controller-button-test/", "label": "Buttons",     "long": "Controller Button Test", "group": "buttons",  "tier": 1},
    {"href": "/trigger-test/",           "label": "Triggers",    "long": "Trigger Test",           "group": "buttons",  "tier": 1},
    {"href": "/rumble-test/",            "label": "Rumble",      "long": "Rumble Test",            "group": "feedback", "tier": 1},
]

# Sheet groups, in order. Unused at <= 8 destinations (the sheet renders flat,
# because group headings are noise at that size) — kept so the arrangement is
# already decided the day this site gains a ninth test.
GROUPS = [
    ("sticks",   "Sticks"),
    ("buttons",  "Buttons & triggers"),
    ("feedback", "Feedback"),
]

# One hub link at the bottom of the sheet per tier-2 family. The console family's
# parent is /stick-drift-test/, which is already the first item in the rail and
# the sheet, so a hub row pointing at it would be the same destination listed
# twice with aria-current on both. The chips inside the tool are the route.
HUBS = []

# Tier-2: the controller landing pages. Same engine, hardware fixed, so they
# are deliberately absent from the rail and the sheet body. `bytes` is a
# portfolio-wide field for the size-variant sites that first needed these chips;
# there is no byte target here, and None renders the attribute empty.
#
# Order is by console family, and Joy-Con sits next to the Switch Pro rather
# than at the end: the two are the pair a Nintendo owner has to choose between,
# and they are the one pair on this list where picking the wrong chip gives you
# a page about a different repair programme.
VARIANTS = {
    "parent": "/stick-drift-test/",
    "label": "Test by controller",
    "aria": "Controller-specific drift tests",
    "items": [
        {"href": "/xbox-controller-test/",        "label": "Xbox",       "bytes": None},
        {"href": "/ps5-controller-test/",         "label": "PS5",        "bytes": None},
        {"href": "/ps4-controller-test/",         "label": "PS4",        "bytes": None},
        {"href": "/switch-pro-controller-test/",  "label": "Switch Pro", "bytes": None},
        {"href": "/joy-con-drift-test/",          "label": "Joy-Con",    "bytes": None},
    ],
}

# Long anchor text for a footer crawl list, if the site has one. This one does
# not, and the spec says not to add one where none exists: the rail carries all
# five destinations visibly on every page, and each tool page already ends with
# a "Related tools" list of the other four.
FOOTER = []

# One-time --migrate: what the legacy markup looked like and where the marker
# pairs go. Per-site, because the legacy markup is per-site. Ops run in order.
MIGRATE = [
    # The old tab strip, which lived *inside* <main> — a second nav layer under
    # the header, hand-copied into eleven files, and 99px of it clipped at
    # 390px with no fade: "Triggers" cut mid-word and "Rumble" gone entirely.
    {"op": "strip", "pattern": r'\n  <nav class="tabbar".*?\n  </nav>\n'},
    # The toolbar is a direct child of <body>, immediately after </header>.
    {"op": "insert_after", "region": "nav", "pattern": r"</header>", "indent": ""},
]
