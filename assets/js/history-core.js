/* stickdriftcheck.com — the drift history, without the DOM and without the network.
   history.js renders what these functions return, and test/history-core.test.mjs pins the
   wording. Every date here is a server-set created_at, never the visitor's clock: that
   date is what makes the record worth showing for a warranty claim or a resale.

   Functions that print a date take an optional IANA time zone. The page passes none and
   gets the visitor's own zone. The tests pass "UTC". */

export const NAME_MAX = 40;         // controllers.name maxLength, tools/sch3ma_setup.mjs
export const PAD_MAX = 120;         // controllers.pad maxLength
export const DEFAULT_THRESHOLD = 0.08; // DRIFT_THRESHOLD in app.js

const STICKS = ["left", "right"];
const DAY_MS = 86400000;

/* ---------- what Save sends ---------- */

// The fields of one `checks` row, less the controller reference. A stick the pad does not
// have is left out, so it stores null rather than a zero that reads as a perfect stick.
export function checkBody(result) {
  const body = { deadzone: result.deadzone, threshold: result.threshold };
  for (const name of STICKS) {
    const d = result[name];
    if (!d || !Number.isFinite(d.magnitude)) continue;
    body[name + "_x"] = d.x;
    body[name + "_y"] = d.y;
    body[name + "_mag"] = d.magnitude;
  }
  return body;
}

// Cut by code point, not by UTF-16 unit, because sch3ma counts maxLength in code points and
// a cut through an emoji would store half of it.
function clip(text, max) {
  return Array.from(text).slice(0, max).join("");
}

export function cleanName(name) {
  return clip(String(name || "").replace(/\s+/g, " ").trim(), NAME_MAX);
}

export function cleanPad(pad) {
  return clip(String(pad || "").trim(), PAD_MAX);
}

/* ---------- controllers ---------- */

// Names match trimmed and case-blind, so "blue dualsense" saves into "Blue DualSense".
export function findByName(controllers, name) {
  const key = cleanName(name).toLowerCase();
  if (!key) return null;
  for (const c of controllers) {
    if (String(c.name).toLowerCase() === key) return c;
  }
  return null;
}

// The name to put in the field. A Gamepad id names a model, not one physical controller,
// so this is a guess the visitor can overwrite: the controller on screen if it was saved
// with this pad, then the most recently checked one saved with it, then the browser's own
// model name.
export function suggestName(controllers, pad, padName, preferred) {
  if (pad && preferred && preferred.pad === pad) return preferred.name;
  if (pad) {
    for (const c of controllers) {
      if (c.pad === pad) return c.name;
    }
  }
  return cleanName(padName);
}

/* ---------- reading a stored check ---------- */

export function stickOf(row, name) {
  const mag = row ? row[name + "_mag"] : null;
  if (typeof mag !== "number") return null;
  return { x: row[name + "_x"], y: row[name + "_y"], magnitude: mag };
}

// The sticks a row carries, with the label the page gives each. A one-stick pad such as a
// lone Joy-Con stores its reading as "left", and calling that the left stick would name a
// stick the controller does not have.
export function sticksOf(row) {
  const out = [];
  for (const name of STICKS) {
    const stick = stickOf(row, name);
    if (stick) out.push({ name, stick });
  }
  const solo = out.length === 1;
  for (const e of out) {
    e.short = solo ? "Stick" : e.name === "left" ? "Left" : "Right";
    e.label = solo ? "Stick" : e.short + " stick";
  }
  return out;
}

export function verdict(magnitude, threshold) {
  const limit = typeof threshold === "number" ? threshold : DEFAULT_THRESHOLD;
  return magnitude > limit ? "DRIFT" : "PASS";
}

/* ---------- numbers ---------- */

// Offsets print to three decimals. A change is counted in those same thousandths, so it
// always equals the difference of the two offsets on screen.
function thousandths(v) {
  return Math.round(v * 1000);
}

function fixed3(n) {
  return (n / 1000).toFixed(3);
}

export function offsetText(magnitude) {
  return fixed3(thousandths(magnitude));
}

// "up 0.046", "down 0.012" or "unchanged".
export function changeWord(current, previous) {
  const d = thousandths(current) - thousandths(previous);
  if (d === 0) return "unchanged";
  return (d > 0 ? "up " : "down ") + fixed3(Math.abs(d));
}

/* ---------- dates ---------- */

function dateParts(date, timeZone) {
  const out = {};
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });
  for (const p of f.formatToParts(date)) out[p.type] = Number(p.value);
  return out;
}

function dayNumber(date, timeZone) {
  const p = dateParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
}

// ICU puts a narrow no-break space before AM and PM. A plain space reads the same and
// compares the same in every engine.
function plain(text) {
  return text.replace(/[\u202f\u00a0]/g, " ");
}

// "Sep 3", or "Dec 30, 2025" when the check is from an earlier year than `now`.
export function shortDate(iso, now, timeZone) {
  const date = new Date(iso);
  const opts = { timeZone, month: "short", day: "numeric" };
  if (dateParts(date, timeZone).year !== dateParts(now, timeZone).year) opts.year = "numeric";
  return plain(new Intl.DateTimeFormat("en-US", opts).format(date));
}

// "today", "yesterday" or "7 days ago", counted in calendar days where the visitor is.
export function daysAgo(iso, now, timeZone) {
  const days = dayNumber(now, timeZone) - dayNumber(new Date(iso), timeZone);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return days + " days ago";
}

// "Sep 12, 2026, 2:05 PM", the stamp on one row of the list.
export function stampText(iso, timeZone) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return plain(f.format(new Date(iso)));
}

/* ---------- the line the history leads with ---------- */

// One line per stick on the newest check:
//
//   "Left stick offset 0.087, up 0.046 since Sep 3 (7 days ago)"
//
// With no earlier check, or an earlier check that did not measure this stick, the line
// states the offset alone.
export function changeLines(row, previous, now, timeZone) {
  return sticksOf(row).map(({ name, label, stick }) => {
    let line = label + " offset " + offsetText(stick.magnitude);
    const before = stickOf(previous, name);
    if (before) {
      line += ", " + changeWord(stick.magnitude, before.magnitude) +
        " since " + shortDate(previous.created_at, now, timeZone) +
        " (" + daysAgo(previous.created_at, now, timeZone) + ")";
    }
    return line;
  });
}
