#!/usr/bin/env node
/* One-time project setup on sch3ma, run with the project's secret key. Safe to re-run:
   PUT creates a collection and refuses one that exists, so a re-run reports each collection
   as already there and goes on to the settings below, which every run rewrites.

     SCH3MA_PROJECT=prj_… SCH3MA_SECRET=sk_live_… node tools/sch3ma_setup.mjs

   Two collections. Only the visitor who saved a row can read, change or delete it.
   `controllers` holds one row per controller a visitor names. `checks` holds one row per
   saved drift check. Deleting a controller deletes its checks, and each new check bumps its
   controller's updated_at, so the page lists the most recently checked controller first.
   The first save gives the browser an anonymous identity, and that identity owns both rows.

   It also sets how the sign-in mail reads and where its link points. The link opens
   /signin.html rather than auth.sch3ma.com, so a person reading the mail sees
   stickdriftcheck.com. The same page finishes the sign-in and returns the visitor to the
   page where they asked for the link.

   After the run, put the project id and the publishable key in assets/js/sch3ma.js, in
   place of the two PENDING values. Until then the site hides the history and sends nothing. */

const project = process.env.SCH3MA_PROJECT;
const secret = process.env.SCH3MA_SECRET;
if (!project || !secret) {
  console.error("Set SCH3MA_PROJECT and SCH3MA_SECRET.");
  process.exit(1);
}
const base = `https://admin.sch3ma.com/${project}`;

const OWNER = "owner:visitor";
const RULES = { read: OWNER, create: "authenticated", update: OWNER, delete: OWNER };

const CONTROLLERS = {
  prefix: "ctl",
  rules: RULES,
  fields: {
    name: { type: "text", required: true, maxLength: 40 },
    // The Gamepad id. It names a model, not one physical controller, which is why the
    // visitor names each controller.
    pad: { type: "text", maxLength: 120 },
    visitor: { type: "reference", to: "users" },
  },
};
const CHECKS = {
  prefix: "chk",
  rules: RULES,
  fields: {
    // cascade: deleting a controller deletes its checks. touch: a new check bumps the
    // controller's updated_at, which is the order the page lists controllers in.
    controller: { type: "reference", to: "controllers", required: true, on_delete: "cascade", touch: true },
    left_x: { type: "number" },
    left_y: { type: "number" },
    left_mag: { type: "number" },
    // Null on a pad with one stick, such as a single Joy-Con.
    right_x: { type: "number" },
    right_y: { type: "number" },
    right_mag: { type: "number" },
    deadzone: { type: "number" },
    threshold: { type: "number" },
    visitor: { type: "reference", to: "users" },
  },
};
const ORIGINS = ["https://stickdriftcheck.com"];
const IDENTITY = {
  anonymous: true,
  on_email_conflict: "signin",
  // The link hop lands on /signin.html too. That page completes the sign-in, merges this
  // browser's anonymous history into the email's, and returns the visitor to the page
  // they asked from.
  landing_url: "https://stickdriftcheck.com/signin.html",
  // sch3ma doc 03 §08. The name costs no DNS work: the address stays sch3ma's own, so the
  // From domain still matches the signature. There is no support inbox, so reply_to is null.
  sender: { name: "Stick Drift Check", reply_to: null },
  // Copy, never markup. sch3ma escapes every value into the message. The two kinds of link
  // last an hour and a week, so each has its own line.
  template: {
    product: "Stick Drift Check",
    subject: "Your Stick Drift Check sign-in link",
    activation_subject: "Confirm your email for Stick Drift Check",
    body: "Open this link to sign in and see the drift history of your controllers on this device. It works once and expires in an hour.",
    activation_body: "Open this link to confirm your email and keep the drift history of your controllers on every device. It works once and is good for seven days.",
    button: "Sign in to Stick Drift Check",
    color: "#9327d6",
    logo_url: null,
  },
  // The link points here, not at auth.sch3ma.com. The token rides the URL fragment, which a
  // browser never sends to a server, so it reaches nothing but the host that issued it.
  callback_url: "https://stickdriftcheck.com/signin.html",
};

async function call(method, path, body) {
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
}

// The two-call rule: a first call answers a report and a token, the second commits.
async function twoCall(method, path, body, made) {
  const first = made ?? (await call(method, path, body));
  if (first.status === 201) return first;
  if (first.status !== 200 || !first.json || !first.json.report) throw new Error(`${method} ${path}: ${first.status} ${first.text}`);
  const second = await call(method, `${path}?_confirm=${encodeURIComponent(first.json.report.confirm_token)}`, body);
  if (second.status !== 200) throw new Error(`${method} ${path} (confirm): ${second.status} ${second.text}`);
  return second;
}

// controllers first: checks.controller names it, and sch3ma refuses a reference to a
// collection that does not exist yet.
for (const [name, def] of [["controllers", CONTROLLERS], ["checks", CHECKS]]) {
  // A collection PUT creates and never replaces, so a second run answers 409. That is the
  // collection standing where this script wants it, which is what the run asked for.
  const first = await call("PUT", `/_schemas/${name}`, def);
  if (first.status === 409 && first.json?.error?.code === "collection_exists") {
    console.log(`${name}: exists`);
    continue;
  }
  const r = await twoCall("PUT", `/_schemas/${name}`, def, first);
  console.log(`${name}: ${r.status}`);
}
// The allowlist goes before the identity settings: sch3ma refuses a landing URL whose
// origin is not on the list.
console.log(`origins: ${(await twoCall("PUT", "/_origins", { origins: ORIGINS })).status}`);
const identity = await call("PATCH", "/_identity", IDENTITY);
console.log(`identity: ${identity.status} ${identity.text}`);
