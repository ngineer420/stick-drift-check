/* stickdriftcheck.com — the drift history, on sch3ma. Loaded as a module on
   /stick-drift-test/ and the five console pages, next to app.js.

   Off until the project in sch3ma.js is set. Until then the panel stays hidden
   and this module sends nothing.

   Nothing goes to sch3ma until the visitor asks:
     Save      sends one finished check under a controller name. The first save
               gives this browser an anonymous identity, and that identity owns
               every row it saves.
     Sign in   sends an email address for a sign-in link, so the same history
               opens on another device.
   A browser that already holds an identity loads its history when the tester
   shows. That is the only request this module makes without a press.

   app.js announces each finished check as an "sdc:drift" window event, with a
   null detail when no result is on screen. This module never reads the pad. */

import { client, configured, hasSession } from "./sch3ma.js";
import * as H from "./history-core.js";

const PAGE = 10;                               // checks per page and per "Show older"
const CURRENT_KEY = "sdc-history-controller";  // the controller shown last

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};

const mount = document.getElementById("drift-history");
const tester = document.getElementById("tester");

const state = {
  db: null,
  session: null,      // the sch3ma session, once this page has one
  result: null,       // the finished check on screen, or null
  saved: false,       // true once that result is in the history
  controllers: null,  // this visitor's controllers, most recently checked first
  current: null,      // the controller whose checks show
  rows: [],           // its checks, newest first
  cursor: null,       // where "Show older" continues, or null at the oldest
  sync: "idle",       // "idle" | "form" | "sent"
  note: "",           // the status line
};

let ui = null;        // the fixed parts of the panel, built once
let syncKey = "";     // the sync line rebuilds only when this changes
let manageKey = "";   // and the delete buttons only when this does
let seq = 0;          // the latest checks request; older answers are dropped

/* ---------- small helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

// Two presses for anything that deletes. The first press asks, and the ask lapses after
// four seconds.
function armed(className, idle, ask, action) {
  const node = el("button", className, idle);
  node.type = "button";
  let timer = 0;
  const reset = () => {
    clearTimeout(timer);
    node.dataset.armed = "";
    node.textContent = idle;
    node.disabled = false;
  };
  node.addEventListener("click", async () => {
    if (node.dataset.armed !== "1") {
      node.dataset.armed = "1";
      node.textContent = ask;
      timer = setTimeout(reset, 4000);
      return;
    }
    clearTimeout(timer);
    node.disabled = true;
    try {
      await action();
    } catch (err) {
      note(reason(err, "That did not work. Try again."));
    }
    reset();
  });
  return node;
}

// sch3ma's own message where there is one, because it names what went wrong.
function reason(err, fallback) {
  return err && err.code && err.message ? err.message : fallback;
}

function note(text) {
  state.note = text;
  render();
}

async function connect() {
  if (!state.db) state.db = await client();
  if (!state.db) throw new Error("The history service did not load.");
  return state.db;
}

function forget() {
  state.session = null;
  state.controllers = null;
  state.current = null;
  state.rows = [];
  state.cursor = null;
  state.sync = "idle";
}

function whenShown(node, fn) {
  if (!node || !node.hidden) { fn(); return; }
  const watch = new MutationObserver(() => {
    if (node.hidden) return;
    watch.disconnect();
    fn();
  });
  watch.observe(node, { attributes: true, attributeFilter: ["hidden"] });
}

/* ---------- requests ---------- */

async function listControllers(db) {
  // Sorted by updated_at: every new check bumps its controller (touch: true on
  // checks.controller), so the most recently checked controller comes first.
  const page = await db.list("controllers", { sort: "-updated_at", limit: 100 });
  return page.data.slice();
}

async function loadChecks(older) {
  const mine = ++seq;
  const controller = state.current;
  const opts = { filter: { controller: controller.id }, sort: "-created_at", limit: PAGE };
  if (older) opts.cursor = state.cursor;
  const page = await state.db.list("checks", opts);
  if (mine !== seq || state.current !== controller) return;
  state.rows = older ? state.rows.concat(page.data) : page.data.slice();
  state.cursor = page.has_more ? page.cursor : null;
}

async function show(controller) {
  state.current = controller;
  state.rows = [];
  state.cursor = null;
  if (!controller) {
    store.del(CURRENT_KEY);
    return;
  }
  store.set(CURRENT_KEY, controller.id);
  await loadChecks(false);
}

async function openHistory() {
  try {
    const db = await connect();
    state.session = await db.session();
    state.controllers = await listControllers(db);
    const wanted = store.get(CURRENT_KEY);
    await show(state.controllers.find((c) => c.id === wanted) || state.controllers[0] || null);
  } catch {
    // A lapsed session, or no network. The drift check still works, and Save still
    // offers to start a history.
    forget();
  }
  render();
}

async function saveCheck() {
  const result = state.result;
  if (!result || state.saved || ui.save.disabled) return;
  const name = H.cleanName(ui.input.value);
  if (!name) {
    note("Name the controller first.");
    ui.input.focus();
    return;
  }
  ui.save.disabled = true;
  note("Saving…");
  try {
    const db = await connect();
    // The first save mints this browser's anonymous identity. It owns the rows below,
    // so nobody else can read them.
    if (!state.session) state.session = await db.session();
    if (!state.controllers) state.controllers = await listControllers(db);
    let controller = H.findByName(state.controllers, name);
    if (!controller) {
      const body = { name };
      const pad = H.cleanPad(result.pad);
      if (pad) body.pad = pad;
      controller = await db.create("controllers", body);
    }
    await db.create("checks", Object.assign({ controller: { id: controller.id } }, H.checkBody(result)));
    state.controllers = [controller].concat(state.controllers.filter((c) => c.id !== controller.id));
    await show(controller);
    if (state.result === result) state.saved = true;
    state.note = "Saved to " + controller.name + ".";
  } catch (err) {
    state.note = reason(err, "The check was not saved. Check the connection, then try again.");
  }
  ui.save.disabled = false;
  render();
}

async function choose(id) {
  const controller = state.controllers.find((c) => c.id === id);
  if (!controller) return;
  state.note = "";
  try {
    await show(controller);
  } catch (err) {
    state.note = reason(err, "The history did not load. Try again.");
  }
  render();
}

async function showOlder() {
  if (!state.cursor) return;
  ui.more.disabled = true;
  try {
    await loadChecks(true);
  } catch (err) {
    state.note = reason(err, "The older checks did not load. Try again.");
  }
  ui.more.disabled = false;
  render();
}

async function removeCheck(row) {
  await state.db.delete("checks", row.id);
  state.rows = state.rows.filter((r) => r.id !== row.id);
  if (state.rows.length === 0 && state.cursor) await loadChecks(false);
  note("Deleted the check from " + H.stampText(row.created_at) + ".");
}

async function removeController() {
  const gone = state.current;
  // sch3ma deletes its checks too: checks.controller cascades on delete.
  await state.db.delete("controllers", gone.id);
  state.controllers = state.controllers.filter((c) => c.id !== gone.id);
  await show(state.controllers[0] || null);
  note("Deleted " + gone.name + " and its checks.");
}

async function eraseAll() {
  // One call deletes every row this identity owns, the identity, and any email on it.
  await state.session.erase("delete");
  forget();
  store.del(CURRENT_KEY);
  note("Deleted your drift history and your sign-in.");
}

async function signOut() {
  try {
    await state.session.signOut();
  } catch {
    /* the history stays saved under the email either way */
  }
  forget();
  note("Signed out. Sign in again to see this history.");
}

/* ---------- the drift result ---------- */

function onDrift(detail) {
  state.result = detail || null;
  state.saved = false;
  state.note = "";
  if (state.result && !ui.input.dataset.edited) {
    ui.input.value = H.suggestName(state.controllers || [], state.result.pad, state.result.padName, state.current);
  }
  if (!state.result && !state.session && state.sync === "form") state.sync = "idle";
  render();
}

/* ---------- rendering ---------- */

function render() {
  mount.hidden = !(state.result || state.session || state.note);
  ui.form.hidden = !(state.result && !state.saved);
  ui.status.textContent = state.note;
  ui.status.hidden = state.note === "";
  renderNames();
  renderBody();
  renderSync();
  renderManage();
}

function renderNames() {
  ui.names.textContent = "";
  const seen = new Set();
  for (const c of state.controllers || []) {
    const key = String(c.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const opt = el("option");
    opt.value = c.name;
    ui.names.append(opt);
  }
}

function renderBody() {
  const loaded = state.controllers !== null;
  ui.body.hidden = !loaded;
  if (!loaded) return;
  ui.empty.hidden = state.current !== null;
  renderPick();
  renderLead();
  renderRows();
  ui.more.hidden = !state.cursor;
}

function renderPick() {
  ui.pick.textContent = "";
  if (!state.current) return;
  if (state.controllers.length > 1) {
    const label = el("label");
    label.append(el("span", "hist-pick-label", "Controller"));
    const select = el("select");
    for (const c of state.controllers) {
      const opt = el("option", "", c.name);
      opt.value = c.id;
      opt.selected = c.id === state.current.id;
      select.append(opt);
    }
    select.addEventListener("change", () => choose(select.value));
    label.append(select);
    ui.pick.append(label);
  } else {
    ui.pick.append(el("span", "hist-pick-label", "Controller"), el("strong", "", state.current.name));
  }
}

function renderLead() {
  ui.lead.textContent = "";
  if (!state.current) return;
  const newest = state.rows[0];
  if (!newest) {
    ui.lead.append(el("p", "hist-first", "No checks are saved for " + state.current.name + "."));
    return;
  }
  const previous = state.rows[1] || null;
  for (const line of H.changeLines(newest, previous, new Date())) ui.lead.append(el("p", "", line + "."));
  if (!previous && !state.cursor) {
    ui.lead.append(el("p", "hist-first", "This is the first saved check for " + state.current.name + "."));
  }
}

function renderRows() {
  ui.list.textContent = "";
  state.rows.forEach((row, i) => {
    const previous = state.rows[i + 1] || null;
    const oldest = !previous && !state.cursor;
    const item = el("li", "hist-row");

    const head = el("div", "hist-row-head");
    const time = el("time", "", H.stampText(row.created_at));
    time.dateTime = row.created_at;
    head.append(time, armed("quiet", "Delete", "Press again to delete", () => removeCheck(row)));

    const sticks = el("ul", "hist-sticks");
    for (const s of H.sticksOf(row)) {
      const word = H.verdict(s.stick.magnitude, row.threshold);
      const li = el("li");
      li.append(el("span", "k", s.short), " ", el("span", "v", H.offsetText(s.stick.magnitude)), " ",
        el("span", "verdict " + word.toLowerCase(), word));
      const before = H.stickOf(previous, s.name);
      const change = before ? H.changeWord(s.stick.magnitude, before.magnitude) : oldest ? "first check" : "";
      if (change) li.append(" ", el("span", "d", change));
      sticks.append(li);
    }

    item.append(head, sticks);
    ui.list.append(item);
  });
}

function renderSync() {
  const s = state.session;
  const key = [state.sync, s ? s.identity : "", s ? s.is_anonymous : "", s && s.email ? s.email : "",
    Boolean(state.result && !state.saved)].join("|");
  if (key === syncKey) return;
  syncKey = key;
  const box = ui.sync;
  box.textContent = "";
  const openForm = () => { state.sync = "form"; state.note = ""; render(); };

  if (state.sync === "form") {
    signInForm(box);
  } else if (state.sync === "sent") {
    box.append(el("span", "", "Check your inbox. Open the link on any device, and this history opens there."));
  } else if (!s) {
    // Before a first save, only a visitor with a history on another device needs this.
    if (state.result && !state.saved) box.append(button("quiet", "Saved checks on another device? Sign in", openForm));
  } else if (s.is_anonymous) {
    box.append(el("span", "", "This history is kept in this browser only."),
      button("", "Keep this history on every device", openForm));
  } else {
    box.append(el("span", "", "This history is kept on every device where you sign in as " + (s.email || "your email") + "."),
      button("quiet", "Sign out", signOut));
  }
  box.hidden = box.childElementCount === 0;
}

function signInForm(box) {
  const form = el("form", "hist-signin");
  const field = el("label", "hist-field");
  const input = el("input");
  input.type = "email";
  input.required = true;
  input.autocomplete = "email";
  input.placeholder = "you@example.com";
  field.append(el("span", "", "Email"), input);
  const send = el("button", "", "Send sign-in link");
  send.type = "submit";
  form.append(field, send, button("quiet", "Cancel", () => { state.sync = "idle"; render(); }));
  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const email = input.value.trim();
    if (!email) { input.focus(); return; }
    send.disabled = true;
    try {
      const db = await connect();
      // The link brings the visitor back to this page, through /signin.html.
      await db.requestSignIn(email);
      state.sync = "sent";
      state.note = "";
    } catch (err) {
      send.disabled = false;
      state.note = reason(err, "The link was not sent. Try again in a few minutes.");
    }
    render();
  });
  box.append(form);
  input.focus();
}

function renderManage() {
  const key = (state.current ? state.current.id : "") + "|" + (state.session ? state.session.identity : "");
  if (key === manageKey) return;
  manageKey = key;
  ui.manage.textContent = "";
  if (state.current) {
    ui.manage.append(armed("quiet", "Delete this controller", "Press again: delete it and its checks", removeController));
  }
  if (state.session) {
    ui.manage.append(armed("quiet", "Delete all my data", "Press again: delete everything", eraseAll));
  }
  ui.manage.hidden = ui.manage.childElementCount === 0;
}

/* ---------- the panel ---------- */

function build() {
  const form = el("form", "hist-save");
  form.noValidate = true;
  const field = el("label", "hist-field");
  const input = el("input");
  input.type = "text";
  input.maxLength = H.NAME_MAX;
  input.autocomplete = "off";
  input.setAttribute("list", "hist-names");
  field.append(el("span", "", "Controller name"), input);
  const names = el("datalist");
  names.id = "hist-names";
  const save = el("button", "primary", "Save this check");
  save.type = "submit";
  const privacy = el("a", "", "What Save stores");
  privacy.href = "/privacy.html#drift-history";
  const explain = el("p", "hist-note", "Save sends this check to sch3ma.com and adds it to this controller's history. Nothing leaves your browser until you press it. ");
  explain.append(privacy);
  form.append(field, names, save, explain);

  const status = el("p", "hist-status");
  status.setAttribute("role", "status");

  const body = el("div", "hist-body");
  const pick = el("div", "hist-pick");
  const lead = el("div", "hist-lead");
  const list = el("ol", "hist-list");
  const more = button("hist-more", "Show older checks", showOlder);
  const empty = el("p", "hist-empty", "No saved checks yet. Run the drift check, then press Save.");
  body.append(pick, lead, list, more, empty);

  const sync = el("div", "hist-sync");
  const manage = el("div", "hist-manage");

  mount.append(el("h2", "", "Drift history"), form, status, body, sync, manage);
  ui = { form, input, names, save, status, body, pick, lead, list, more, empty, sync, manage };

  input.addEventListener("input", () => { input.dataset.edited = "1"; });
  form.addEventListener("submit", (evt) => { evt.preventDefault(); saveCheck(); });
  window.addEventListener("sdc:drift", (evt) => onDrift(evt.detail));
}

function boot() {
  build();
  render();
  // A browser that saved before holds a session, and its history loads once the tester
  // shows. Any other browser sends nothing until the visitor presses Save or Sign in.
  if (hasSession()) whenShown(tester, openHistory);
}

if (mount && configured()) boot();
