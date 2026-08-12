/* stickdriftcheck.com — shared shell script: theme toggle + footer year.
   Loaded on every page (tools, hub, articles, legal, 404) so the toggle and the
   copyright year are not tied to whichever page happens to load the tester.
   The stored theme is applied before first paint because this file is loaded
   from <head>; everything else waits for DOMContentLoaded. */
(function () {
  "use strict";
  var THEME_KEY = "sdc-theme";

  try {
    var stored = localStorage.getItem(THEME_KEY);
    if (stored) document.documentElement.setAttribute("data-theme", stored);
  } catch (e) {}

  function ready() {
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", function () {
        var current =
          document.documentElement.getAttribute("data-theme") ||
          (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        var next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      });
    }
    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();
    toolbar();
  }

  /* ================================================================== *
   * toolbar v1 — the portfolio navigation pattern.                      *
   * Spec: github.com/ngineer420/ngineer420.github.io/issues/13          *
   * Reference implementation: photoshrink#7.                            *
   *                                                                     *
   * Copied verbatim from the pilot. It lives here rather than in app.js *
   * because app.js is only on the five tool pages, and the chrome has   *
   * to behave the same on the hub, the articles, the legal pages and    *
   * the 404 too — this file is already the one loaded by all of them.   *
   *                                                                     *
   * Pure enhancement: with JS off, <details>/<summary> still discloses  *
   * the sheet, the rail is still a native scroll container of real      *
   * links, the edge fades are still CSS and the scrim is still CSS.     *
   * Only the active-chip centring, Escape and click-outside are lost.   *
   * ================================================================== */
  function toolbar() {
    var bar = document.querySelector(".toolbar");
    if (!bar) return;
    var rail = bar.querySelector(".tb-rail");
    var menu = bar.querySelector("details.tb-menu");

    if (rail) {
      // js-on hands the right-hand fade over to measurement. Until then the
      // CSS keeps it on, so a JS-disabled visitor never gets a chip clipped
      // mid-word with nothing to say there is more of the row.
      rail.classList.add("js-on");
      var fades = function () {
        var max = rail.scrollWidth - rail.clientWidth;
        rail.classList.toggle("can-l", rail.scrollLeft > 1);
        rail.classList.toggle("can-r", rail.scrollLeft < max - 1);
      };
      // Assigning scrollLeft, never scrollIntoView: that also scrolls every
      // ancestor and the document, which on a phone drops the visitor below
      // the header on arrival.
      var current = rail.querySelector("[aria-current]");
      if (current) {
        rail.scrollLeft = Math.max(
          0,
          current.offsetLeft - (rail.clientWidth - current.offsetWidth) / 2
        );
      }
      rail.addEventListener("scroll", fades, { passive: true });
      window.addEventListener("resize", fades);
      fades();
    }

    if (menu) {
      // A disclosure, not a modal: focus is deliberately not trapped, Tab
      // walks the links and straight out the other side.
      window.addEventListener("keydown", function (e) {
        if (e.key !== "Escape" || !menu.open) return;
        menu.open = false;
        var summary = menu.querySelector("summary");
        if (summary) summary.focus();
      });
      document.addEventListener("click", function (e) {
        if (menu.open && !menu.contains(e.target)) menu.open = false;
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
