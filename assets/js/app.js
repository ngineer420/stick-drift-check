/* stickdriftcheck.com — controller stick drift tester
   100% client-side. Uses the Gamepad API. Nothing is uploaded.
   Single requestAnimationFrame poll loop; no per-frame allocations that leak. */
(function () {
  "use strict";

  /* ---------- theme ---------- */
  const THEME_KEY = "sdc-theme";
  (function initTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored) document.documentElement.setAttribute("data-theme", stored);
    } catch {}
    const btn = document.getElementById("theme-toggle");
    if (btn) {
      btn.addEventListener("click", () => {
        const current =
          document.documentElement.getAttribute("data-theme") ||
          (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        const next = current === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try { localStorage.setItem(THEME_KEY, next); } catch {}
      });
    }
  })();

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- constants ---------- */
  const PAD_MAX_OFFSET = 78;      // px the dot travels from center at |axis| = 1
  const DRIFT_THRESHOLD = 0.08;   // resting magnitude above this = drift
  const CALIB_MS = 3000;          // calibration sampling window

  // Standard-mapping button labels (https://w3c.github.io/gamepad/#remapping)
  const STD_BUTTONS = [
    "A / Cross", "B / Circle", "X / Square", "Y / Triangle",
    "LB / L1", "RB / R1", "LT / L2", "RT / R2",
    "Back / Share", "Start / Options", "L3 (left click)", "R3 (right click)",
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
  const calibProgressBar = calibProgress.querySelector("span");

  const deadzoneInput = document.getElementById("deadzone");
  const deadzoneValue = document.getElementById("deadzone-value");

  const btnGrid = document.getElementById("btn-grid");
  const triggerList = document.getElementById("trigger-list");
  const axisBody = document.getElementById("axis-body");
  const rumbleBtn = document.getElementById("rumble-btn");
  const rumbleNote = document.getElementById("rumble-note");

  const sticks = {
    left: buildStickRefs("left"),
    right: buildStickRefs("right")
  };

  function buildStickRefs(name) {
    const pad = document.querySelector('.stick-pad[data-stick="' + name + '"]');
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
  let deadzone = parseFloat(deadzoneInput.value);
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

  selectEl.addEventListener("change", () => {
    const v = parseInt(selectEl.value, 10);
    selectedIndex = Number.isNaN(v) ? null : v;
    uiSignature = ""; // force rebuild for the newly selected pad
  });

  function shortName(id) {
    if (!id) return "Gamepad";
    // Trim vendor/product hex noise like "(Vendor: 054c Product: 09cc)"
    return id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:[^)]*\)/i, "")
             .replace(/\s*\(STANDARD GAMEPAD\)/i, "")
             .trim() || "Gamepad";
  }

  /* ---------- dynamic UI build ---------- */
  function signatureFor(pad) {
    return pad.index + "|" + pad.mapping + "|" + pad.buttons.length + "|" + pad.axes.length;
  }

  function buildUI(pad) {
    const standard = pad.mapping === "standard";

    // --- buttons ---
    btnGrid.textContent = "";
    btnCells = [];
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

    // --- triggers ---
    triggerList.textContent = "";
    triggerRows = [];
    const triggerDefs = standard
      ? [{ i: 6, label: "LT / L2" }, { i: 7, label: "RT / R2" }]
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

    // --- axis table ---
    axisBody.textContent = "";
    axisRows = [];
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

    // rumble capability note
    updateRumbleNote(pad);

    // deadzone rings + reset drift results for a fresh device
    applyDeadzoneRing();
    resetDriftResults();
  }

  function updateRumbleNote(pad) {
    const act = pad.vibrationActuator;
    const supported = act && (typeof act.playEffect === "function" || typeof act.pulse === "function");
    rumbleBtn.disabled = !supported;
    rumbleNote.textContent = supported
      ? "Sends a short vibration if your controller is currently connected."
      : "Rumble is not supported by this controller/browser combination.";
  }

  /* ---------- deadzone ---------- */
  function applyDeadzoneRing() {
    const px = deadzone * PAD_MAX_OFFSET * 2;
    sticks.left.dz.style.width = px + "px";
    sticks.left.dz.style.height = px + "px";
    sticks.right.dz.style.width = px + "px";
    sticks.right.dz.style.height = px + "px";
  }
  deadzoneInput.addEventListener("input", () => {
    deadzone = parseFloat(deadzoneInput.value);
    deadzoneValue.textContent = deadzone.toFixed(2);
    applyDeadzoneRing();
  });
  deadzoneValue.textContent = deadzone.toFixed(2);

  /* ---------- calibration / drift ---------- */
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

  calibReset.addEventListener("click", resetDriftResults);

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
    const d = drift[name];
    const el = sticks[name].result;
    if (!d) { setResult(name, "idle"); return; }
    const isDrift = d.magnitude > DRIFT_THRESHOLD;
    el.className = "stick-result " + (isDrift ? "drift" : "pass");
    el.innerHTML = (isDrift ? "DRIFT" : "PASS") +
      ' <span class="offset">· offset ' + d.magnitude.toFixed(3) +
      " (x " + d.x.toFixed(3) + ", y " + d.y.toFixed(3) + ")</span>";
  }

  function setResult(name, mode) {
    const el = sticks[name].result;
    el.className = "stick-result";
    if (mode === "measuring") el.textContent = "Measuring…";
    else el.textContent = "Not yet checked";
  }

  function resetDriftResults() {
    drift.left = null;
    drift.right = null;
    calib.active = false;
    calibProgress.hidden = true;
    calibBtn.disabled = false;
    calibBtn.textContent = "Start drift check";
    calibReset.hidden = true;
    calibMsg.textContent = "Let go of both sticks completely, then start the check. We'll measure the resting position for a few seconds.";
    setResult("left", "idle");
    setResult("right", "idle");
  }

  /* ---------- rumble ---------- */
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

  /* ---------- per-frame render ---------- */
  function updateStick(name, x, y, pressed) {
    const s = sticks[name];
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
        deviceNameEl.textContent = shortName(pad.id);
        deviceMetaEl.textContent =
          " · " + (pad.mapping === "standard" ? "standard mapping" : "non-standard mapping") +
          " · " + pad.buttons.length + " buttons · " + pad.axes.length + " axes";
        buildUI(pad);
        refreshDeviceList();
      }
      render(pad);
    } else {
      if (promptEl.hidden === true) promptEl.hidden = false;
      if (testerEl.hidden === false) testerEl.hidden = true;
      uiSignature = "";
      if (calib.active) resetDriftResults();
    }
    requestAnimationFrame(loop);
  }

  // Kick off. Some browsers only surface pads after an input event; the loop
  // simply keeps polling, so the prompt clears the moment one appears.
  refreshDeviceList();
  requestAnimationFrame(loop);
})();
