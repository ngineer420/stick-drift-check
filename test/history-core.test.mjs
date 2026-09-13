/* Run with:  node --test test/*.test.mjs
   No package.json, no dependencies — node:test and node:assert only.
   Every date check passes "UTC", so the result is the same on any machine. */

import test from "node:test";
import assert from "node:assert/strict";
import * as H from "../assets/js/history-core.js";

const UTC = "UTC";

function row(created_at, left, right, extra) {
  const r = { created_at, threshold: 0.08, deadzone: 0.08 };
  if (left) Object.assign(r, { left_x: left[0], left_y: left[1], left_mag: left[2] });
  if (right) Object.assign(r, { right_x: right[0], right_y: right[1], right_mag: right[2] });
  return Object.assign(r, extra);
}

/* ============================ the change line ============================ */

test("the newest check states each offset and its change since the one before", () => {
  const prev = row("2026-09-03T09:00:00Z", [0.03, -0.028, 0.041], [0.01, 0.011, 0.015]);
  const cur = row("2026-09-10T15:00:00Z", [0.07, -0.052, 0.087], [0.008, 0.009, 0.012]);
  assert.deepEqual(H.changeLines(cur, prev, new Date("2026-09-10T18:00:00Z"), UTC), [
    "Left stick offset 0.087, up 0.046 since Sep 3 (7 days ago)",
    "Right stick offset 0.012, down 0.003 since Sep 3 (7 days ago)",
  ]);
});

test("the change equals the difference of the two printed offsets", () => {
  // 0.0876 prints as 0.088 and 0.0414 as 0.041, so the change must read 0.047, not 0.046.
  const prev = row("2026-09-01T00:00:00Z", [0, 0, 0.0414]);
  const cur = row("2026-09-02T00:00:00Z", [0, 0, 0.0876]);
  assert.equal(H.offsetText(0.0876), "0.088");
  assert.equal(H.offsetText(0.0414), "0.041");
  assert.equal(H.changeWord(0.0876, 0.0414), "up 0.047");
  assert.match(H.changeLines(cur, prev, new Date("2026-09-02T12:00:00Z"), UTC)[0], /^Stick offset 0\.088, up 0\.047 since/);
});

test("an offset that prints the same says unchanged", () => {
  assert.equal(H.changeWord(0.0871, 0.0868), "unchanged");
  const prev = row("2026-09-11T08:00:00Z", [0, 0, 0.0868], [0, 0, 0.02]);
  const cur = row("2026-09-12T08:00:00Z", [0, 0, 0.0871], [0, 0, 0.02]);
  assert.equal(H.changeLines(cur, prev, new Date("2026-09-12T09:00:00Z"), UTC)[0],
    "Left stick offset 0.087, unchanged since Sep 11 (yesterday)");
});

test("the first check states the offset alone", () => {
  const cur = row("2026-09-12T08:00:00Z", [0.05, 0.02, 0.054], [0.001, 0.002, 0.0022]);
  assert.deepEqual(H.changeLines(cur, null, new Date("2026-09-12T09:00:00Z"), UTC), [
    "Left stick offset 0.054",
    "Right stick offset 0.002",
  ]);
});

test("a stick the earlier check did not measure gets no change clause", () => {
  const prev = row("2026-09-05T08:00:00Z", [0, 0, 0.03]);
  const cur = row("2026-09-12T08:00:00Z", [0, 0, 0.04], [0, 0, 0.01]);
  assert.deepEqual(H.changeLines(cur, prev, new Date("2026-09-12T09:00:00Z"), UTC), [
    "Left stick offset 0.040, up 0.010 since Sep 5 (7 days ago)",
    "Right stick offset 0.010",
  ]);
});

test("a one-stick pad is called Stick, never Left stick", () => {
  const cur = row("2026-09-12T08:00:00Z", [0.1, 0.08, 0.128]);
  assert.deepEqual(H.changeLines(cur, null, new Date("2026-09-12T09:00:00Z"), UTC), ["Stick offset 0.128"]);
  assert.deepEqual(H.sticksOf(cur).map((s) => [s.short, s.label]), [["Stick", "Stick"]]);
  assert.deepEqual(H.sticksOf(row("x", [0, 0, 1], [0, 0, 1])).map((s) => s.label), ["Left stick", "Right stick"]);
});

/* ============================ dates ============================ */

test("days count in calendar days, not in 24-hour blocks", () => {
  const now = new Date("2026-09-12T00:30:00Z");
  assert.equal(H.daysAgo("2026-09-11T23:30:00Z", now, UTC), "yesterday");
  assert.equal(H.daysAgo("2026-09-12T00:10:00Z", now, UTC), "today");
  assert.equal(H.daysAgo("2026-09-02T12:00:00Z", now, UTC), "10 days ago");
  // In Los Angeles both instants fall on Sep 11.
  assert.equal(H.daysAgo("2026-09-11T23:30:00Z", now, "America/Los_Angeles"), "today");
  assert.equal(H.shortDate("2026-09-11T23:30:00Z", now, "America/Los_Angeles"), "Sep 11");
});

test("a server clock ahead of the visitor's never reads as the future", () => {
  assert.equal(H.daysAgo("2026-09-13T10:00:00Z", new Date("2026-09-12T10:00:00Z"), UTC), "today");
});

test("a date from an earlier year carries the year", () => {
  const now = new Date("2026-01-02T10:00:00Z");
  assert.equal(H.shortDate("2025-12-30T10:00:00Z", now, UTC), "Dec 30, 2025");
  assert.equal(H.shortDate("2026-01-01T10:00:00Z", now, UTC), "Jan 1");
  const prev = row("2025-12-30T10:00:00Z", [0, 0, 0.02]);
  const cur = row("2026-01-02T09:00:00Z", [0, 0, 0.03]);
  assert.equal(H.changeLines(cur, prev, now, UTC)[0], "Stick offset 0.030, up 0.010 since Dec 30, 2025 (3 days ago)");
});

test("a row stamp prints date and time with plain spaces", () => {
  assert.equal(H.stampText("2026-09-12T14:05:00Z", UTC), "Sep 12, 2026, 2:05 PM");
});

/* ============================ what Save sends ============================ */

test("checkBody sends both sticks, the deadzone and the threshold", () => {
  const body = H.checkBody({
    left: { x: 0.081, y: -0.047, magnitude: Math.hypot(0.081, -0.047) },
    right: { x: 0.004, y: 0.002, magnitude: Math.hypot(0.004, 0.002) },
    deadzone: 0.08,
    threshold: 0.08,
  });
  assert.deepEqual(Object.keys(body).sort(),
    ["deadzone", "left_mag", "left_x", "left_y", "right_mag", "right_x", "right_y", "threshold"]);
  assert.equal(body.left_x, 0.081);
  assert.equal(body.left_mag, Math.hypot(0.081, -0.047));
});

test("checkBody leaves out a stick the pad does not have", () => {
  const body = H.checkBody({ left: { x: 0.1, y: 0, magnitude: 0.1 }, right: null, deadzone: 0.08, threshold: 0.08 });
  assert.equal("right_mag" in body, false);
  assert.equal("right_x" in body, false);
  assert.equal(body.left_mag, 0.1);
});

test("the verdict uses the stored threshold, and the page's when none is stored", () => {
  assert.equal(H.verdict(0.08, 0.08), "PASS");
  assert.equal(H.verdict(0.0801, 0.08), "DRIFT");
  assert.equal(H.verdict(0.09, 0.1), "PASS");
  assert.equal(H.verdict(0.09, null), "DRIFT");
});

/* ============================ controller names ============================ */

test("names are trimmed, single-spaced and cut at 40 code points", () => {
  assert.equal(H.cleanName("  Blue   DualSense \n"), "Blue DualSense");
  assert.equal(H.cleanName("x".repeat(60)).length, H.NAME_MAX);
  const emoji = H.cleanName("🎮".repeat(45));
  assert.equal(Array.from(emoji).length, H.NAME_MAX);
  assert.equal(emoji, "🎮".repeat(40));
  assert.equal(Array.from(H.cleanPad("p".repeat(200))).length, H.PAD_MAX);
});

test("a saved name matches whatever case the visitor types", () => {
  const list = [{ id: "ctl_2", name: "White DualSense" }, { id: "ctl_1", name: "Blue DualSense" }];
  assert.equal(H.findByName(list, " blue dualsense ").id, "ctl_1");
  assert.equal(H.findByName(list, "Green"), null);
  assert.equal(H.findByName(list, "   "), null);
});

test("the suggested name prefers a controller saved with the same pad", () => {
  const pad = "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)";
  const list = [
    { id: "ctl_3", name: "Xbox pad", pad: "Xbox Wireless Controller" },
    { id: "ctl_2", name: "White DualSense", pad },
    { id: "ctl_1", name: "Blue DualSense", pad },
  ];
  assert.equal(H.suggestName(list, pad, "DualSense Wireless Controller"), "White DualSense");
  assert.equal(H.suggestName(list, pad, "DualSense Wireless Controller", list[2]), "Blue DualSense");
  assert.equal(H.suggestName(list, pad, "DualSense Wireless Controller", list[0]), "White DualSense");
  assert.equal(H.suggestName([], pad, "DualSense Wireless Controller"), "DualSense Wireless Controller");
  assert.equal(H.suggestName(list, "Unknown pad", "An extremely long generic USB gamepad name from a vendor"),
    "An extremely long generic USB gamepad na");
});
