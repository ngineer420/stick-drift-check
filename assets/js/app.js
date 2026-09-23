/* stickdriftcheck.com — controller tester engine
   100% client-side. Uses the Gamepad API, and this file sends nothing anywhere.
   Single requestAnimationFrame poll loop; no per-frame allocations that leak.

   One engine, five pages. Each tool page (/stick-drift-test/,
   /deadzone-visualizer/, /controller-button-test/, /trigger-test/,
   /rumble-test/) ships only the panels it needs, so every section below is
   optional: if its markup is absent the engine simply skips it. The theme
   toggle and footer year live in theme.js, which every page loads.

   Which stick pads get drawn is decided by the *device*, not the page: a pad
   that reports two axes drives one stick card and the other is hidden, never
   plotted and never given a verdict. A page can add Joy-Con handling on top of
   that with `data-layout="single-joycon"` on <body>, which names the lone stick
   from pad.id and offers the sideways/vertical orientation toggle.

   A finished drift check goes out as an "sdc:drift" window event, and a null
   detail says that no result is on screen. history.js listens on the drift
   pages, and it sends a result to sch3ma only when the visitor presses Save. */
(function () {
  "use strict";

  /* ---------- constants ---------- */
  const PAD_MAX_OFFSET = 78;      // px the dot travels from center at |axis| = 1
  const DRIFT_THRESHOLD = 0.08;   // resting magnitude above this = drift
  const CALIB_MS = 3000;          // calibration sampling window

  // Standard-mapping button labels (https://w3c.github.io/gamepad/#remapping).
  // Read Xbox / PlayStation / Nintendo, in that order — the page prints that
  // legend above the grid. The third slot exists because Nintendo's A and B
  // are physically swapped relative to Xbox's, so index 0 is the Xbox A, the
  // PlayStation Cross *and* the Nintendo B: a Switch owner reading a two-name
  // label sees the wrong letter light up and assumes the test is broken.
  // Deliberately one list, not a per-console map keyed off pad.id: under
  // non-standard mapping the index-to-button correspondence is unknown, and a
  // console-specific label would then be confidently wrong rather than generic.
  const STD_BUTTONS = [
    "A / Cross / B", "B / Circle / A", "X / Square / Y", "Y / Triangle / X",
    "LB / L1 / L", "RB / R1 / R", "LT / L2 / ZL", "RT / R2 / ZR",
    "Back / Share / Minus", "Start / Options / Plus", "L3 (left click)", "R3 (right click)",
    "D-Pad Up", "D-Pad Down", "D-Pad Left", "D-Pad Right", "Guide / Home"
  ];
  const AXIS_LABELS = ["Left stick X", "Left stick Y", "Right stick X", "Right stick Y"];

  /* ---------- element refs ---------- */
  const promptEl = document.getElementById("prompt");
  const testerEl = document.getElementById("tester");
  const deviceNameEl = document.getElementById("device-name");
  const deviceMetaEl = document.getElementById("device-meta");
  const selectWrap = document.getElementById("device-select-wrap");
  const selectEl = document.getElementById("device-select");

  const calibBtn = document.getElementById("calib-btn");
  const calibReset = document.getElementById("calib-reset");
  const calibMsg = document.getElementById("calib-msg");
  const calibProgress = document.getElementById("calib-progress");
  const calibProgressBar = calibProgress ? calibProgress.querySelector("span") : null;

  const deadzoneInput = document.getElementById("deadzone");
  const deadzoneValue = document.getElementById("deadzone-value");

  const btnGrid = document.getElementById("btn-grid");
  const triggerList = document.getElementById("trigger-list");
  const axisBody = document.getElementById("axis-body");
  const rumbleBtn = document.getElementById("rumble-btn");
  const rumbleNote = document.getElementById("rumble-note");
  const consoleHint = document.getElementById("console-hint");
  // Set on the console landing pages, so a page never offers itself.
  const pageConsole = consoleHint ? consoleHint.getAttribute("data-console") : null;

  // Only /joy-con-drift-test/ sets this. It does not decide how many pads are
  // drawn — axis count does that everywhere — it decides that the lone pad is
  // named from pad.id and that the orientation toggle is offered.
  const singleJoycon = document.body.getAttribute("data-layout") === "single-joycon";

  // The page's one live region. Every tool page ships exactly one, and the
  // engine is its only writer.
  const liveStatus = document.getElementById("live-status");

  const orientWrap = document.getElementById("orient");
  const orientBtns = orientWrap
    ? Array.prototype.slice.call(orientWrap.querySelectorAll("[data-orient]"))
    : [];

  const STICK_NAMES = ["left", "right"];
  const sticksWrap = document.querySelector(".sticks");
  const sticks = {
    left: buildStickRefs("left"),
    right: buildStickRefs("right")
  };

  function buildStickRefs(name) {
    const pad = document.querySelector('.stick-pad[data-stick="' + name + '"]');
    if (!pad) return null;
    const card = pad.closest(".stick-card");
    return {
      pad,
      dot: pad.querySelector("[data-dot]"),
      dz: pad.querySelector("[data-dz]"),
      card,
      title: card.querySelector("h3 span"),
      x: card.querySelector("[data-x]"),
      y: card.querySelector("[data-y]"),
      result: card.querySelector("[data-result]")
    };
  }

  /* ---------- text writes and announcements ----------

     The poll loop runs at the display refresh rate. A live region wired
     straight to it repeats the same sentence sixty times a second, which is
     not information, it is a stuck horn. So every text write in this file
     goes through setText or setHtml. Both keep the last string per element
     and touch the DOM only when the new string differs, so an unchanged value
     writes nothing at all and an assistive technology hears it once.

     What the region carries is a verdict — "Left stick: drift, offset 0.153"
     — never the raw per-frame coordinates. The coordinate readouts, the
     trigger values and the axis table are marked aria-live="off" and are read
     on demand instead. */
  const lastWritten = new WeakMap();

  function setText(el, text) {
    if (!el) return false;
    const prev = lastWritten.has(el) ? lastWritten.get(el) : el.textContent;
    lastWritten.set(el, text);
    if (prev === text) return false;
    el.textContent = text;
    return true;
  }

  function setHtml(el, html) {
    if (!el) return false;
    const prev = lastWritten.has(el) ? lastWritten.get(el) : el.innerHTML;
    lastWritten.set(el, html);
    if (prev === html) return false;
    el.innerHTML = html;
    return true;
  }

  // Write the live region. Named for what it does to a screen reader, because
  // announceDrift() below publishes an event and means something else.
  function speak(text) {
    return setText(liveStatus, text);
  }

  // A one-shot the visitor asked for. The diff above is right for a polled
  // reading, and wrong here: pressing "Test rumble" twice really is two
  // events, so this clears the region first and repeats the sentence.
  function speakAgain(text) {
    if (!liveStatus) return;
    liveStatus.textContent = "";
    liveStatus.textContent = text;
    lastWritten.set(liveStatus, text);
  }

  // Record a string as already announced, without writing it. Used when a pad
  // arrives: the resting state is the state the visitor is already in, so it
  // is the baseline, not news.
  function seedLive(text) {
    if (liveStatus) lastWritten.set(liveStatus, text);
  }

  // A numeric node that changes every frame must never be announced, even if
  // a later edit nests it inside the live region.
  function muteLive(el) {
    if (el) el.setAttribute("aria-live", "off");
  }

  /* ---------- state ---------- */
  let selectedIndex = null;          // user-pinned gamepad index, or null = auto
  let deadzone = deadzoneInput ? parseFloat(deadzoneInput.value) : 0.08;
  let uiSignature = "";              // rebuild dynamic UI only when this changes
  let btnCells = [];                 // built button cells
  let triggerRows = [];              // { fill, val, index }
  let axisRows = [];                 // <td> value cells

  // Which stick cards the *connected pad* actually drives, and off which axis
  // pair. Rebuilt only when the device signature changes, never per frame.
  let stickPlan = [];
  let stickNoun = "both sticks";     // calibration copy, singular when it is
  let joySide = null;                // "L" | "R" | null, read from pad.id
  let orientation = "vertical";      // "vertical" | "sideways"

  // Which verdict this page's live region reports. One purpose per page, so
  // two panels never fight over the same region. Order matters: a console
  // page ships the button and the trigger panel as well as the drift check,
  // and the drift verdict is what that page is for.
  const LIVE_MODE = calibBtn ? "drift"
    : deadzoneInput ? "deadzone"
    : btnGrid ? "buttons"
    : triggerList ? "triggers"
    : rumbleBtn ? "rumble"
    : null;

  let liveSeeded = false;            // false until the first frame after a rebuild

  const drift = { left: null, right: null }; // { magnitude, x, y } or null

  const calib = {
    active: false,
    start: 0,
    samples: 0,
    sum: { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } }
  };

  /* ---------- gamepad access ---------- */
  function getPads() {
    return navigator.getGamepads ? navigator.getGamepads() : [];
  }

  function connectedPads() {
    const out = [];
    const pads = getPads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) out.push(pads[i]);
    }
    return out;
  }

  function getActivePad() {
    const pads = getPads();
    if (selectedIndex !== null && pads[selectedIndex] && pads[selectedIndex].connected) {
      return pads[selectedIndex];
    }
    // auto: first connected
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }

  function hasAxis(pad, i) {
    return typeof pad.axes[i] === "number";
  }

  // NaN, never 0, for an axis the pad does not have.
  //
  // Returning 0 here is the bug this file existed with: a single Joy-Con
  // reports two axes, so axes[2] and axes[3] came back 0, the right stick was
  // drawn resting at a flawless 0.000 / 0.000, and the drift check then handed
  // it a PASS. A clean verdict on hardware that is not attached is worse than
  // no verdict — it is the one answer the visitor came here to trust. Callers
  // now ask hasAxis() first (see buildStickPlan) and simply do not draw or
  // measure a stick the device never reported.
  function axisVal(pad, i) {
    const v = pad.axes[i];
    return typeof v === "number" ? v : NaN;
  }

  /* ---------- connection events ---------- */
  window.addEventListener("gamepadconnected", refreshDeviceList);
  window.addEventListener("gamepaddisconnected", (e) => {
    if (selectedIndex === e.gamepad.index) selectedIndex = null;
    refreshDeviceList();
  });

  function refreshDeviceList() {
    if (!selectWrap || !selectEl) return;
    const pads = connectedPads();
    if (pads.length > 1) {
      selectWrap.hidden = false;
      // rebuild options
      selectEl.textContent = "";
      pads.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = String(p.index);
        opt.textContent = "#" + p.index + " · " + shortName(p.id);
        if (selectedIndex === p.index) opt.selected = true;
        selectEl.appendChild(opt);
      });
    } else {
      selectWrap.hidden = true;
    }
  }

  if (selectEl) {
    selectEl.addEventListener("change", () => {
      const v = parseInt(selectEl.value, 10);
      selectedIndex = Number.isNaN(v) ? null : v;
      uiSignature = ""; // force rebuild for the newly selected pad
    });
  }

  function shortName(id) {
    if (!id) return "Gamepad";
    // Trim vendor/product hex noise like "(Vendor: 054c Product: 09cc)"
    return id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:[^)]*\)/i, "")
             .replace(/\s*\(STANDARD GAMEPAD\)/i, "")
             .trim() || "Gamepad";
  }

  /* ---------- console detection ----------
     pad.id is the only place a browser names the hardware, and every engine
     spells it differently: Chrome writes "Name (STANDARD GAMEPAD Vendor: 054c
     Product: 0ce6)", Firefox writes "054c-0ce6-Name", Safari writes a plain
     product string with no IDs at all. So: read a vendor/product pair if one is
     there, fall back to product words if it is not, and show nothing when
     neither is conclusive — a wrong console banner is worse than no banner.

     This is deliberately a second, separate reader from signatureFor() below.
     That one is a UI cache key (index|mapping|buttons|axes) and never looks at
     pad.id, which is exactly why it cannot be reused here. */
  const CONSOLES = [
    {
      key: "ps5", name: "DualSense", article: "a", href: "/ps5-controller-test/",
      link: "PS5 controller test",
      // 0ce6 DualSense, 0df2 DualSense Edge, 0e5f Access controller.
      ids: { "054c": ["0ce6", "0df2", "0e5f"] },
      words: /dualsense|\bps5\b/
    },
    {
      key: "ps4", name: "DualShock 4", article: "a", href: "/ps4-controller-test/",
      link: "PS4 controller test",
      // 05c4 DS4 v1, 09cc DS4 v2, 0ba0 USB wireless adaptor. 0268 (DualShock 3)
      // is left out on purpose: there is no PS3 page to send it to.
      ids: { "054c": ["05c4", "09cc", "0ba0"] },
      words: /dualshock|\bds4\b|\bps4\b/
    },
    {
      // Ahead of the Pro Controller on purpose: both are vendor 057e, and the
      // Pro entry claims that vendor with "*", so the specific product ids have
      // to get their look-in first or every Joy-Con is announced as a Pro.
      key: "joycon", name: "Joy-Con", article: "a", href: "/joy-con-drift-test/",
      link: "Joy-Con drift test",
      // 2006 Joy-Con (L), 2007 Joy-Con (R), 200e the charging grip pair.
      ids: { "057e": ["2006", "2007", "200e"] },
      words: /joy-?con/
    },
    {
      key: "switch", name: "Switch Pro Controller", article: "a", href: "/switch-pro-controller-test/",
      link: "Switch Pro controller test",
      // Nintendo ships almost nothing else a browser sees as a gamepad, so the
      // vendor alone is enough; "*" means any product under this vendor.
      ids: { "057e": ["*"] },
      words: /pro controller|nintendo|switch/
    },
    {
      key: "xbox", name: "Xbox controller", article: "an", href: "/xbox-controller-test/",
      link: "Xbox controller test",
      // Same reasoning: a Microsoft-vendor gamepad is an Xbox pad.
      ids: { "045e": ["*"] },
      words: /xbox|xinput/
    }
  ];

  function vendorProduct(id) {
    let m = /vendor:\s*([0-9a-f]{4})[^)]*?product:\s*([0-9a-f]{4})/i.exec(id);
    if (!m) m = /^([0-9a-f]{4})-([0-9a-f]{4})-/i.exec(id); // Firefox
    return m ? [m[1].toLowerCase(), m[2].toLowerCase()] : null;
  }

  function consoleFor(pad) {
    const id = pad && pad.id ? pad.id : "";
    if (!id) return null;
    const vp = vendorProduct(id);
    if (vp) {
      for (let i = 0; i < CONSOLES.length; i++) {
        const products = CONSOLES[i].ids[vp[0]];
        if (products && (products[0] === "*" || products.indexOf(vp[1]) !== -1)) {
          return CONSOLES[i];
        }
      }
    }
    const lower = id.toLowerCase();
    for (let i = 0; i < CONSOLES.length; i++) {
      if (CONSOLES[i].words.test(lower)) return CONSOLES[i];
    }
    return null;
  }

  /* Which half of the pair this is. Chrome writes "Joy-Con (L) (STANDARD
     GAMEPAD Vendor: 057e Product: 2006)", Firefox "057e-2006-Joy-Con (L)" and
     Safari a bare "Joy-Con (L)", so the product id is tried first and the
     "(L)"/"(R)" suffix is the fallback for engines that omit it. Null when the
     pad is not a Joy-Con or the id will not say — the page then calls the stick
     just "Stick" rather than guessing a side onto it. */
  function joyconSide(pad) {
    const id = pad && pad.id ? pad.id.toLowerCase() : "";
    if (!id) return null;
    const vp = vendorProduct(id);
    if (vp && vp[0] === "057e") {
      if (vp[1] === "2006") return "L";
      if (vp[1] === "2007") return "R";
    }
    if (!/joy-?con/.test(id)) return null;
    if (/\(l\)|\bleft\b/.test(id)) return "L";
    if (/\(r\)|\bright\b/.test(id)) return "R";
    return null;
  }

  let hintKey = null; // last rendered console key, so the banner is built once

  function updateConsoleHint(pad) {
    if (!consoleHint) return;
    const c = pad ? consoleFor(pad) : null;
    const key = c ? c.key : "";
    if (key === hintKey) return;
    hintKey = key;
    consoleHint.textContent = "";
    if (!c || c.key === pageConsole) {
      consoleHint.hidden = true;
      return;
    }
    const lead = document.createElement("span");
    lead.textContent = "Looks like " + c.article + " " + c.name + " \u2014 ";
    const a = document.createElement("a");
    a.href = c.href;
    a.textContent = "see the " + c.link;
    consoleHint.appendChild(lead);
    consoleHint.appendChild(a);
    consoleHint.hidden = false;
  }

  /* ---------- which sticks this device actually has ----------
     The signature already includes pad.axes.length, so this runs exactly when
     the device changes and its result is read on every frame after that. */
  function buildStickPlan(pad) {
    const plan = [];
    if (sticks.left && hasAxis(pad, 0) && hasAxis(pad, 1)) {
      plan.push({ name: "left", refs: sticks.left, ax: 0, ay: 1 });
    }
    if (sticks.right && hasAxis(pad, 2) && hasAxis(pad, 3)) {
      plan.push({ name: "right", refs: sticks.right, ax: 2, ay: 3 });
    }
    return plan;
  }

  function stickHeading(name, solo) {
    if (!solo) return name === "left" ? "Left stick" : "Right stick";
    if (joySide) return "Joy-Con (" + joySide + ") stick";
    return "Stick";
  }

  function applyStickPlan(pad) {
    stickPlan = buildStickPlan(pad);
    joySide = joyconSide(pad);
    const solo = stickPlan.length === 1;
    stickNoun = solo ? "the stick" : "both sticks";

    const live = { left: false, right: false };
    for (let i = 0; i < stickPlan.length; i++) {
      const e = stickPlan[i];
      live[e.name] = true;
      e.refs.card.hidden = false;
      setText(e.refs.title, stickHeading(e.name, solo));
    }
    for (let i = 0; i < STICK_NAMES.length; i++) {
      const n = STICK_NAMES[i];
      if (sticks[n] && !live[n]) sticks[n].card.hidden = true;
    }
    if (sticksWrap) sticksWrap.classList.toggle("is-solo", solo);
    // The toggle is meaningless on a two-stick pad, which is held one way.
    if (orientWrap) orientWrap.hidden = !(singleJoycon && solo);
  }

  /* ---------- orientation ----------
     A Joy-Con held as a mini controller sits a quarter turn away from the frame
     its axes are reported in, and the two halves turn opposite ways to get
     there: the (L) rotates anticlockwise into that grip and the (R) clockwise.
     So "up" on the player's thumb arrives as +X on an (L) and -X on an (R), and
     a tester that plots the raw pair draws every sideways push ninety degrees
     out. Rotating is measurement-safe — |(x, y)| does not change under a
     rotation, so PASS/DRIFT and the offset are identical either way; what moves
     is the direction of the dot and the sign of the printed X and Y, which is
     the whole point of the control. Unknown side is treated as an (L). */
  const rotated = { x: 0, y: 0 };  // reused every frame; never allocate in render

  function rotatePair(x, y) {
    if (orientation !== "sideways") {
      rotated.x = x; rotated.y = y;
    } else if (joySide === "R") {
      rotated.x = -y; rotated.y = x;
    } else {
      rotated.x = y; rotated.y = -x;
    }
    return rotated;
  }

  function setOrientation(next) {
    orientation = next === "sideways" ? "sideways" : "vertical";
    for (let i = 0; i < orientBtns.length; i++) {
      const btn = orientBtns[i];
      btn.setAttribute("aria-pressed",
        btn.getAttribute("data-orient") === orientation ? "true" : "false");
    }
    // A measurement taken in the other orientation prints x/y for axes that are
    // no longer the ones on screen, so it is retired rather than re-drawn — and
    // a window flipped halfway through would average two different frames
    // together, so that is thrown away too rather than finished.
    if (calib.active || drift.left || drift.right) resetDriftResults();
  }

  for (let i = 0; i < orientBtns.length; i++) {
    orientBtns[i].addEventListener("click", function () {
      setOrientation(this.getAttribute("data-orient"));
    });
  }

  /* ---------- dynamic UI build ---------- */
  function signatureFor(pad) {
    return pad.index + "|" + pad.mapping + "|" + pad.buttons.length + "|" + pad.axes.length;
  }

  function buildUI(pad) {
    const standard = pad.mapping === "standard";

    // --- sticks: draw only the ones the device reports ---
    applyStickPlan(pad);

    // --- buttons ---
    btnCells = [];
    if (btnGrid) {
      btnGrid.textContent = "";
      for (let i = 0; i < pad.buttons.length; i++) {
        // Triggers (6/7 in standard) get their own analog bars below; still list them here for state.
        const label = standard && STD_BUTTONS[i] ? STD_BUTTONS[i] : "Button " + i;
        const cell = document.createElement("div");
        cell.className = "btn-cell";
        const nameEl = document.createElement("span");
        nameEl.className = "btn-name";
        nameEl.textContent = label;
        const valEl = document.createElement("span");
        valEl.className = "btn-val";
        // An analog trigger reports a new fraction every frame.
        muteLive(valEl);
        cell.appendChild(nameEl);
        cell.appendChild(valEl);
        btnGrid.appendChild(cell);
        btnCells.push({ cell, valEl, label });
      }
    }

    // --- triggers ---
    triggerRows = [];
    if (triggerList) {
      triggerList.textContent = "";
      const triggerDefs = standard
        ? [{ i: 6, label: "LT / L2 / ZL" }, { i: 7, label: "RT / R2 / ZR" }]
        : [];
      // Fallback: if not standard but there are >= 8 buttons, still try 6/7 as triggers.
      if (!standard && pad.buttons.length > 7) {
        triggerDefs.push({ i: 6, label: "Trigger (btn 6)" }, { i: 7, label: "Trigger (btn 7)" });
      }
      if (triggerDefs.length === 0) {
        const p = document.createElement("p");
        p.style.cssText = "margin:0;color:var(--text-faint);font-size:13px;";
        p.textContent = "This controller does not expose analog triggers in standard mapping.";
        triggerList.appendChild(p);
      } else {
        triggerDefs.forEach((def) => {
          const row = document.createElement("div");
          row.className = "trigger-row";
          const lab = document.createElement("span");
          lab.className = "t-label";
          lab.textContent = def.label;
          const bar = document.createElement("div");
          bar.className = "trigger-bar";
          const fill = document.createElement("span");
          bar.appendChild(fill);
          const val = document.createElement("span");
          val.className = "t-val";
          val.textContent = "0.00";
          muteLive(val);
          row.appendChild(lab);
          row.appendChild(bar);
          row.appendChild(val);
          triggerList.appendChild(row);
          triggerRows.push({ fill, val, index: def.i, label: def.label });
        });
      }
    }

    // --- axis table ---
    axisRows = [];
    if (axisBody) {
      axisBody.textContent = "";
      for (let i = 0; i < pad.axes.length; i++) {
        const tr = document.createElement("tr");
        const th = document.createElement("td");
        th.textContent = "Axis " + i;
        const map = document.createElement("td");
        map.style.color = "var(--text-faint)";
        map.textContent = standard && AXIS_LABELS[i] ? AXIS_LABELS[i] : "—";
        const val = document.createElement("td");
        val.className = "num";
        val.textContent = "0.000";
        muteLive(val);
        tr.appendChild(th);
        tr.appendChild(map);
        tr.appendChild(val);
        axisBody.appendChild(tr);
        axisRows.push(val);
      }
    }

    // rumble capability note
    updateRumbleNote(pad);

    // deadzone rings + reset drift results for a fresh device
    applyDeadzoneRing();
    resetDriftResults();

    // The next frame states the baseline instead of announcing it: a pad that
    // has just arrived is resting, and "no buttons pressed" is not news.
    liveSeeded = false;
  }

  function updateRumbleNote(pad) {
    if (!rumbleBtn || !rumbleNote) return;
    const act = pad.vibrationActuator;
    const supported = act && (typeof act.playEffect === "function" || typeof act.pulse === "function");
    rumbleBtn.disabled = !supported;
    setText(rumbleNote, supported
      ? "Sends a short vibration if your controller is currently connected."
      : "Rumble is not supported by this controller/browser combination.");
  }

  /* ---------- deadzone ---------- */
  function applyDeadzoneRing() {
    const px = deadzone * PAD_MAX_OFFSET * 2;
    for (let i = 0; i < STICK_NAMES.length; i++) {
      const s = sticks[STICK_NAMES[i]];
      if (!s) continue;
      s.dz.style.width = px + "px";
      s.dz.style.height = px + "px";
    }
  }
  if (deadzoneInput) {
    deadzoneInput.addEventListener("input", () => {
      deadzone = parseFloat(deadzoneInput.value);
      setText(deadzoneValue, deadzone.toFixed(2));
      applyDeadzoneRing();
    });
  }
  setText(deadzoneValue, deadzone.toFixed(2));

  /* ---------- calibration / drift ---------- */
  if (calibBtn) {
    calibBtn.addEventListener("click", () => {
      if (!getActivePad()) return;
      calib.active = true;
      calib.start = performance.now();
      calib.samples = 0;
      calib.sum.left.x = calib.sum.left.y = 0;
      calib.sum.right.x = calib.sum.right.y = 0;
      calibBtn.disabled = true;
      calibReset.hidden = true;
      calibProgress.hidden = false;
      calibProgressBar.style.width = "0%";
      setText(calibMsg, "Measuring resting position — keep " + stickNoun + " fully released…");
      for (let i = 0; i < stickPlan.length; i++) setResult(stickPlan[i].name, "measuring");
      announceDrift(null);
      speak("Measuring the resting position. Keep " + stickNoun + " fully released.");
    });
  }

  if (calibReset) calibReset.addEventListener("click", resetDriftResults);

  function finalizeCalibration() {
    calib.active = false;
    calibProgress.hidden = true;
    calibBtn.disabled = false;
    setText(calibBtn, "Re-run check");
    calibReset.hidden = false;
    setText(calibMsg, "Drift check complete. Re-run it any time, or nudge a stick to watch it live.");

    // A stick that is not in the plan gets no result at all, rather than the
    // average of a column of zeros that would read as a spotless PASS.
    const n = Math.max(1, calib.samples);
    drift.left = drift.right = null;
    for (let i = 0; i < stickPlan.length; i++) {
      const name = stickPlan[i].name;
      drift[name] = magnitudeResult(calib.sum[name].x / n, calib.sum[name].y / n);
    }
    renderDriftResult("left");
    renderDriftResult("right");
    announceDrift(getActivePad());
    speak(driftVerdict());
  }

  // Tell history.js what it may offer to save. The detail is null whenever no
  // finished result is on screen, so a result from before a reset, a re-run or
  // an orientation flip can never be saved.
  function announceDrift(pad) {
    const detail = pad && (drift.left || drift.right) ? {
      left: drift.left,
      right: drift.right,
      deadzone,
      threshold: DRIFT_THRESHOLD,
      pad: pad.id,
      padName: shortName(pad.id)
    } : null;
    window.dispatchEvent(new CustomEvent("sdc:drift", { detail }));
  }

  // The spoken form of the two result cards: a verdict per measured stick and
  // the offset that earned it. A stick the device never reported is left out
  // rather than announced as a spotless pass.
  function driftVerdict() {
    const parts = [];
    for (let i = 0; i < stickPlan.length; i++) {
      const name = stickPlan[i].name;
      const d = drift[name];
      if (!d) continue;
      parts.push(
        stickHeading(name, stickPlan.length === 1) + ": " +
        (d.magnitude > DRIFT_THRESHOLD ? "drift" : "no drift") +
        ", offset " + d.magnitude.toFixed(3) + "."
      );
    }
    if (!parts.length) return "Drift check complete, but no stick was measured.";
    return "Drift check complete. " + parts.join(" ");
  }

  function magnitudeResult(x, y) {
    return { x, y, magnitude: Math.hypot(x, y) };
  }

  function renderDriftResult(name) {
    const el = sticks[name] && sticks[name].result;
    if (!el) return;
    const d = drift[name];
    if (!d) { setResult(name, "idle"); return; }
    const isDrift = d.magnitude > DRIFT_THRESHOLD;
    el.className = "stick-result " + (isDrift ? "drift" : "pass");
    setHtml(el, (isDrift ? "DRIFT" : "PASS") +
      ' <span class="offset" aria-live="off">· offset ' + d.magnitude.toFixed(3) +
      " (x " + d.x.toFixed(3) + ", y " + d.y.toFixed(3) + ")</span>");
  }

  function setResult(name, mode) {
    const el = sticks[name] && sticks[name].result;
    if (!el) return;
    el.className = "stick-result";
    setText(el, mode === "measuring" ? "Measuring…" : "Not yet checked");
  }

  function resetDriftResults() {
    drift.left = null;
    drift.right = null;
    calib.active = false;
    if (calibProgress) calibProgress.hidden = true;
    if (calibBtn) {
      calibBtn.disabled = false;
      setText(calibBtn, "Start drift check");
    }
    if (calibReset) calibReset.hidden = true;
    setText(calibMsg, "Let go of " + stickNoun + " completely, then start the check. We'll measure the resting position for a few seconds.");
    setResult("left", "idle");
    setResult("right", "idle");
    announceDrift(null);
    if (LIVE_MODE === "drift" && liveSeeded) speak("Drift check reset. Start the check when both sticks are released.");
  }

  /* ---------- rumble ---------- */
  if (rumbleBtn) {
    rumbleBtn.addEventListener("click", () => {
      const pad = getActivePad();
      if (!pad) return;
      const act = pad.vibrationActuator;
      if (!act) return;
      speakAgain("Rumble pulse sent. Feel for both motors.");
      try {
        if (typeof act.playEffect === "function") {
          act.playEffect("dual-rumble", {
            startDelay: 0,
            duration: 450,
            weakMagnitude: 0.9,
            strongMagnitude: 0.9
          }).catch(() => {});
        } else if (typeof act.pulse === "function") {
          act.pulse(0.9, 450);
        }
      } catch { /* ignore — degrade gracefully */ }
    });
  }

  /* ---------- per-frame render ---------- */
  function updateStick(name, x, y, pressed) {
    const s = sticks[name];
    if (!s) return;
    s.dot.style.transform =
      "translate(" + (x * PAD_MAX_OFFSET) + "px," + (y * PAD_MAX_OFFSET) + "px)";
    if (pressed) s.dot.classList.add("pressed");
    else s.dot.classList.remove("pressed");
    setText(s.x, x.toFixed(3));
    setText(s.y, y.toFixed(3));
  }

  function render(pad) {
    const standard = pad.mapping === "standard";

    // stick clicks in standard mapping
    const lPressed = standard && pad.buttons[10] ? pad.buttons[10].pressed : false;
    const rPressed = standard && pad.buttons[11] ? pad.buttons[11].pressed : false;

    // One pass over the sticks the device reported: plot, and — in the same
    // pass, off the same rotated pair — feed the calibration sum, so what is
    // measured is always exactly what is drawn.
    for (let i = 0; i < stickPlan.length; i++) {
      const e = stickPlan[i];
      const p = rotatePair(axisVal(pad, e.ax), axisVal(pad, e.ay));
      updateStick(e.name, p.x, p.y, e.name === "left" ? lPressed : rPressed);
      if (calib.active) {
        const sum = calib.sum[e.name];
        sum.x += p.x;
        sum.y += p.y;
      }
    }

    // buttons
    for (let i = 0; i < btnCells.length; i++) {
      const b = pad.buttons[i];
      if (!b) continue;
      const on = b.pressed || b.value > 0.15;
      const cell = btnCells[i].cell;
      if (on) cell.classList.add("on");
      else cell.classList.remove("on");
      setText(btnCells[i].valEl, b.value > 0 && b.value < 1
        ? b.value.toFixed(2)
        : (on ? "on" : ""));
    }

    // triggers
    for (let t = 0; t < triggerRows.length; t++) {
      const b = pad.buttons[triggerRows[t].index];
      const v = b ? b.value : 0;
      triggerRows[t].fill.style.width = (v * 100).toFixed(1) + "%";
      setText(triggerRows[t].val, v.toFixed(2));
    }

    // axis table
    for (let a = 0; a < axisRows.length; a++) {
      const v = axisVal(pad, a);
      // Raw, unrotated: this table is the axis indices as the browser reports
      // them, which is what makes it useful for reading an odd mapping.
      setText(axisRows[a], v === v ? v.toFixed(3) : "—");
    }

    // The live region, last, so it reads the state this frame just drew.
    // "drift" pages announce on the calibration events only; the rest carry a
    // coarse state sentence that changes a handful of times per interaction,
    // never once per frame.
    if (LIVE_MODE && LIVE_MODE !== "drift" && LIVE_MODE !== "rumble") {
      const state = liveStateFor(pad);
      if (!liveSeeded) {
        liveSeeded = true;
        seedLive(state);
      } else {
        speak(state);
      }
    } else if (!liveSeeded) {
      liveSeeded = true;
    }

    // calibration window (the per-stick sums were taken in the loop above)
    if (calib.active) {
      calib.samples++;
      const elapsed = performance.now() - calib.start;
      calibProgressBar.style.width = Math.min(100, (elapsed / CALIB_MS) * 100) + "%";
      if (elapsed >= CALIB_MS) finalizeCalibration();
    }
  }

  /* ---------- the page's spoken state ----------

     Coarse on purpose. "Left stick outside the deadzone" flips when the stick
     crosses the ring, which is the event worth hearing; "left stick at 0.134"
     would change every frame and tell a listener nothing it can act on. */
  function liveStateFor(pad) {
    if (LIVE_MODE === "deadzone") {
      const parts = ["Deadzone radius " + deadzone.toFixed(2) + "."];
      const solo = stickPlan.length === 1;
      for (let i = 0; i < stickPlan.length; i++) {
        const e = stickPlan[i];
        const q = rotatePair(axisVal(pad, e.ax), axisVal(pad, e.ay));
        parts.push(
          stickHeading(e.name, solo) + " " +
          (Math.hypot(q.x, q.y) > deadzone ? "outside" : "inside") + " the deadzone."
        );
      }
      return parts.join(" ");
    }

    if (LIVE_MODE === "buttons") {
      const names = [];
      for (let i = 0; i < btnCells.length; i++) {
        const b = pad.buttons[i];
        if (b && (b.pressed || b.value > 0.15)) names.push(btnCells[i].label);
      }
      return names.length ? "Pressed: " + names.join(", ") + "." : "No button pressed.";
    }

    if (LIVE_MODE === "triggers") {
      if (!triggerRows.length) {
        return "This controller exposes no analog trigger.";
      }
      const parts = [];
      for (let t = 0; t < triggerRows.length; t++) {
        const b = pad.buttons[triggerRows[t].index];
        const v = b ? b.value : 0;
        parts.push(
          triggerRows[t].label + " " +
          (v < 0.02 ? "released" : v > 0.98 ? "fully pressed" : "part pressed") + "."
        );
      }
      return parts.join(" ");
    }

    return "";
  }

  /* ---------- main loop (single rAF) ---------- */
  function loop() {
    const pad = getActivePad();
    if (pad) {
      if (promptEl.hidden === false) promptEl.hidden = true;
      if (testerEl.hidden === true) testerEl.hidden = false;

      const sig = signatureFor(pad);
      if (sig !== uiSignature) {
        uiSignature = sig;
        setText(deviceNameEl, shortName(pad.id));
        setText(deviceMetaEl,
          " · " + (pad.mapping === "standard" ? "standard mapping" : "non-standard mapping") +
          " · " + pad.buttons.length + " buttons · " + pad.axes.length + " axes");
        buildUI(pad);
        updateConsoleHint(pad);
        refreshDeviceList();
      }
      render(pad);
    } else {
      if (promptEl.hidden === true) promptEl.hidden = false;
      if (testerEl.hidden === false) testerEl.hidden = true;
      uiSignature = "";
      updateConsoleHint(null);
      if (calib.active) resetDriftResults();
      if (liveSeeded) {
        liveSeeded = false;
        speak("No controller detected. Connect one and press any button.");
      }
    }
    requestAnimationFrame(loop);
  }

  // Kick off — but only on pages that actually host a tester shell. The hub,
  // the articles and the legal pages load theme.js only, so this is defensive
  // rather than load-bearing.
  if (!promptEl || !testerEl) return;

  // Some browsers only surface pads after an input event; the loop simply keeps
  // polling, so the prompt clears the moment one appears.
  refreshDeviceList();
  requestAnimationFrame(loop);
})();
