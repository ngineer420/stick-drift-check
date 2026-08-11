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
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
