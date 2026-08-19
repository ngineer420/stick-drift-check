/* stickdriftcheck.com — controller tester engine
   100% client-side. Uses the Gamepad API. Nothing is uploaded.
   Single requestAnimationFrame poll loop; no per-frame allocations that leak.

   One engine, five pages. Each tool page (/stick-drift-test/,
   /deadzone-visualizer/, /controller-button-test/, /trigger-test/,
   /rumble-test/) ships only the panels it needs, so every section below is
   optional: if its markup is absent the engine simply skips it. The theme
   toggle and footer year live in theme.js, which every page loads. */
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

  const sticks = {
    left: buildStickRefs("left"),
    right: buildStickRefs("right")
  };
  const hasSticks = !!(sticks.left && sticks.right);

  function buildStickRefs(name) {
    const pad = document.querySelector('.stick-pad[data-stick="' + name + '"]');
    if (!pad) return null;
    return {
      pad,
      dot: pad.querySelector("[data-dot]"),
      dz: pad.querySelector("[data-dz]"),
      card: pad.closest(".stick-card"),
      x: pad.closest(".stick-card").querySelector("[data-x]"),
      y: pad.closest(".stick-card").querySelector("[data-y]"),
      result: pad.closest(".stick-card").querySelector("[data-result]")
    };
  }

  /* ---------- state ---------- */
  let selectedIndex = null;          // user-pinned gamepad index, or null = auto
  let deadzone = deadzoneInput ? parseFloat(deadzoneInput.value) : 0.08;
  let uiSignature = "";              // rebuild dynamic UI only when this changes
  let btnCells = [];                 // built button cells
  let triggerRows = [];              // { fill, val, index }
  let axisRows = [];                 // <td> value cells

  const drift = { left: null, right: null }; // { magnitude, x, y } or null

  const calib = {
    active: false,
    start: 0,
    samples: 0,
    sum: { lx: 0, ly: 0, rx: 0, ry: 0 }
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

  function axisVal(pad, i) {
    const v = pad.axes[i];
    return typeof v === "number" ? v : 0;
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
      key: "switch", name: "Switch Pro Controller", article: "a", href: "/switch-pro-controller-test/",
      link: "Switch Pro controller test",
      // Nintendo ships almost nothing else a browser sees as a gamepad, so the
      // vendor alone is enough; "*" means any product under this vendor.
      ids: { "057e": ["*"] },
      words: /pro controller|joy-?con|nintendo|switch/
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

  /* ---------- dynamic UI build ---------- */
  function signatureFor(pad) {
    return pad.index + "|" + pad.mapping + "|" + pad.buttons.length + "|" + pad.axes.length;
  }

  function buildUI(pad) {
    const standard = pad.mapping === "standard";

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
        cell.appendChild(nameEl);
        cell.appendChild(valEl);
        btnGrid.appendChild(cell);
        btnCells.push({ cell, valEl });
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
          row.appendChild(lab);
          row.appendChild(bar);
          row.appendChild(val);
          triggerList.appendChild(row);
          triggerRows.push({ fill, val, index: def.i });
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
  }

  function updateRumbleNote(pad) {
    if (!rumbleBtn || !rumbleNote) return;
    const act = pad.vibrationActuator;
    const supported = act && (typeof act.playEffect === "function" || typeof act.pulse === "function");
    rumbleBtn.disabled = !supported;
    rumbleNote.textContent = supported
      ? "Sends a short vibration if your controller is currently connected."
      : "Rumble is not supported by this controller/browser combination.";
  }

  /* ---------- deadzone ---------- */
  function applyDeadzoneRing() {
    if (!hasSticks) return;
    const px = deadzone * PAD_MAX_OFFSET * 2;
    sticks.left.dz.style.width = px + "px";
    sticks.left.dz.style.height = px + "px";
    sticks.right.dz.style.width = px + "px";
    sticks.right.dz.style.height = px + "px";
  }
  if (deadzoneInput) {
    deadzoneInput.addEventListener("input", () => {
      deadzone = parseFloat(deadzoneInput.value);
      if (deadzoneValue) deadzoneValue.textContent = deadzone.toFixed(2);
      applyDeadzoneRing();
    });
  }
  if (deadzoneValue) deadzoneValue.textContent = deadzone.toFixed(2);

  /* ---------- calibration / drift ---------- */
  if (calibBtn) {
    calibBtn.addEventListener("click", () => {
      if (!getActivePad()) return;
      calib.active = true;
      calib.start = performance.now();
      calib.samples = 0;
      calib.sum.lx = calib.sum.ly = calib.sum.rx = calib.sum.ry = 0;
      calibBtn.disabled = true;
      calibReset.hidden = true;
      calibProgress.hidden = false;
      calibProgressBar.style.width = "0%";
      calibMsg.textContent = "Measuring resting position — keep both sticks fully released…";
      setResult("left", "measuring");
      setResult("right", "measuring");
    });
  }

  if (calibReset) calibReset.addEventListener("click", resetDriftResults);

  function finalizeCalibration() {
    calib.active = false;
    calibProgress.hidden = true;
    calibBtn.disabled = false;
    calibBtn.textContent = "Re-run check";
    calibReset.hidden = false;
    calibMsg.textContent = "Drift check complete. Re-run it any time, or nudge a stick to watch it live.";

    const n = Math.max(1, calib.samples);
    drift.left = magnitudeResult(calib.sum.lx / n, calib.sum.ly / n);
    drift.right = magnitudeResult(calib.sum.rx / n, calib.sum.ry / n);
    renderDriftResult("left");
    renderDriftResult("right");
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
    el.innerHTML = (isDrift ? "DRIFT" : "PASS") +
      ' <span class="offset">· offset ' + d.magnitude.toFixed(3) +
      " (x " + d.x.toFixed(3) + ", y " + d.y.toFixed(3) + ")</span>";
  }

  function setResult(name, mode) {
    const el = sticks[name] && sticks[name].result;
    if (!el) return;
    el.className = "stick-result";
    if (mode === "measuring") el.textContent = "Measuring…";
    else el.textContent = "Not yet checked";
  }

  function resetDriftResults() {
    drift.left = null;
    drift.right = null;
    calib.active = false;
    if (calibProgress) calibProgress.hidden = true;
    if (calibBtn) {
      calibBtn.disabled = false;
      calibBtn.textContent = "Start drift check";
    }
    if (calibReset) calibReset.hidden = true;
    if (calibMsg) calibMsg.textContent = "Let go of both sticks completely, then start the check. We'll measure the resting position for a few seconds.";
    setResult("left", "idle");
    setResult("right", "idle");
  }

  /* ---------- rumble ---------- */
  if (rumbleBtn) {
    rumbleBtn.addEventListener("click", () => {
      const pad = getActivePad();
      if (!pad) return;
      const act = pad.vibrationActuator;
      if (!act) return;
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
    s.x.textContent = x.toFixed(3);
    s.y.textContent = y.toFixed(3);
  }

  function render(pad) {
    const standard = pad.mapping === "standard";
    const lx = axisVal(pad, 0), ly = axisVal(pad, 1);
    const rx = axisVal(pad, 2), ry = axisVal(pad, 3);

    // stick clicks in standard mapping
    const lPressed = standard && pad.buttons[10] ? pad.buttons[10].pressed : false;
    const rPressed = standard && pad.buttons[11] ? pad.buttons[11].pressed : false;
    updateStick("left", lx, ly, lPressed);
    updateStick("right", rx, ry, rPressed);

    // buttons
    for (let i = 0; i < btnCells.length; i++) {
      const b = pad.buttons[i];
      if (!b) continue;
      const on = b.pressed || b.value > 0.15;
      const cell = btnCells[i].cell;
      if (on) cell.classList.add("on");
      else cell.classList.remove("on");
      btnCells[i].valEl.textContent = b.value > 0 && b.value < 1
        ? b.value.toFixed(2)
        : (on ? "on" : "");
    }

    // triggers
    for (let t = 0; t < triggerRows.length; t++) {
      const b = pad.buttons[triggerRows[t].index];
      const v = b ? b.value : 0;
      triggerRows[t].fill.style.width = (v * 100).toFixed(1) + "%";
      triggerRows[t].val.textContent = v.toFixed(2);
    }

    // axis table
    for (let a = 0; a < axisRows.length; a++) {
      axisRows[a].textContent = axisVal(pad, a).toFixed(3);
    }

    // calibration sampling
    if (calib.active) {
      calib.sum.lx += lx; calib.sum.ly += ly;
      calib.sum.rx += rx; calib.sum.ry += ry;
      calib.samples++;
      const elapsed = performance.now() - calib.start;
      calibProgressBar.style.width = Math.min(100, (elapsed / CALIB_MS) * 100) + "%";
      if (elapsed >= CALIB_MS) finalizeCalibration();
    }
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
        if (deviceNameEl) deviceNameEl.textContent = shortName(pad.id);
        if (deviceMetaEl) {
          deviceMetaEl.textContent =
            " · " + (pad.mapping === "standard" ? "standard mapping" : "non-standard mapping") +
            " · " + pad.buttons.length + " buttons · " + pad.axes.length + " axes";
        }
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
