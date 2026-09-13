/* Run with:  node --test test/*.test.mjs
   The drift history is wired into hand-duplicated pages, so these tests read the HTML
   itself. Every page that runs the drift check loads the history, every /x/index.html
   still matches its /x.html twin, and no copy on those pages still promises that nothing
   is ever uploaded. */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { NAME_MAX, PAD_MAX } from "../assets/js/history-core.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["assets", "tools", "test", "node_modules"]);
const MOUNT = '<div class="panel history" id="drift-history" hidden></div>';
const MODULE = '<script type="module" src="/assets/js/history.js"></script>';

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function htmlFiles(dir = ROOT) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(path));
    else if (entry.name.endsWith(".html")) out.push(relative(ROOT, path));
  }
  return out.sort();
}

function count(text, needle) {
  return text.split(needle).length - 1;
}

const pages = htmlFiles();
const driftPages = pages.filter((p) => read(p).includes('id="calib-btn"'));

test("six drift pages, each shipped twice, run the drift check", () => {
  assert.equal(driftPages.length, 12, driftPages.join(", "));
});

test("every drift page mounts the history inside the tester, after the stick cards", () => {
  for (const page of driftPages) {
    const html = read(page);
    assert.equal(count(html, MOUNT), 1, page + ": mount");
    assert.equal(count(html, MODULE), 1, page + ": module");
    const tester = html.indexOf('<section id="tester"');
    const sticks = html.indexOf('<div class="sticks">');
    const mount = html.indexOf(MOUNT);
    const end = html.indexOf("</section>", tester);
    assert.ok(tester < sticks && sticks < mount && mount < end, page + ": mount position");
    assert.ok(html.indexOf(MODULE) > html.indexOf('<script src="/assets/js/app.js"></script>'), page + ": module after app.js");
  }
});

test("no other page loads the history", () => {
  for (const page of pages) {
    if (driftPages.includes(page)) continue;
    assert.equal(read(page).includes("/assets/js/history.js"), false, page);
  }
});

test("every /x/index.html matches its /x.html twin byte for byte", () => {
  let pairs = 0;
  for (const page of pages) {
    if (!page.endsWith("/index.html")) continue;
    const flat = page.slice(0, -"/index.html".length) + ".html";
    if (!existsSync(join(ROOT, flat))) continue;
    pairs++;
    assert.equal(read(page), read(flat), page + " differs from " + flat);
  }
  assert.equal(pairs, 10, "twin pairs: the six drift pages and the four other tools");
});

test("no copy on a page with Save still says nothing is ever uploaded", () => {
  const promise = /nothing is uploaded|nothing uploaded|Nothing you do|no controller data (ever )?leaves your (device|browser)\./i;
  for (const page of [...driftPages, "index.html", "terms.html", "privacy.html"]) {
    assert.equal(promise.test(read(page)), false, page);
  }
});

test("the Save link lands on the privacy section that lists what is stored", () => {
  const privacy = read("privacy.html");
  assert.ok(privacy.includes('id="drift-history"'));
  for (const word of ["Save this check", "Delete this controller", "Delete all my data", "30 days"]) {
    assert.ok(privacy.includes(word), "privacy.html names " + word);
  }
  assert.ok(read("assets/js/history.js").includes('"/privacy.html#drift-history"'));
});

test("app.js announces the result that history.js listens for", () => {
  assert.ok(read("assets/js/app.js").includes('new CustomEvent("sdc:drift"'));
  assert.ok(read("assets/js/history.js").includes('addEventListener("sdc:drift"'));
});

test("the setup script and the page agree on the field limits", () => {
  const setup = read("tools/sch3ma_setup.mjs");
  assert.equal(Number(/\bname: \{[^}]*maxLength: (\d+)/.exec(setup)[1]), NAME_MAX);
  assert.equal(Number(/\bpad: \{[^}]*maxLength: (\d+)/.exec(setup)[1]), PAD_MAX);
  assert.match(setup, /controller: \{[^}]*on_delete: "cascade"/);
  assert.match(setup, /callback_url: "https:\/\/stickdriftcheck\.com\/signin\.html"/);
});

test("the sign-in page stays out of search and out of the sitemap", () => {
  assert.match(read("signin.html"), /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(read("sitemap.xml").includes("signin"), false);
});
