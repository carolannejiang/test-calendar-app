(() => {
  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const { pad, toDate, fmtDate, addDays, DAYS, MONTHS, fmtTime, fmtHour, fmtRange, fmtLongDate, layoutColumns, describeChanges } = CalendarCore;
  const { parseSubmission, packEvent, unpackEvent, encodePayload, decodePayload, COLORS, isDate } = CalendarSubmission;
  const { submissionKey, sameResponse, mergeSubmissions, sortSubmissions } = CalendarReview;
  const { attachBullets } = CalendarNotes;
  const hm = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const mins = (v, dflt) => typeof v === "number" ? v : (typeof v === "string" && v.includes(":") ? hm(v) : dflt);
  let HOUR = 48;
  const DAY_START = hm(SCENARIO.dayStart || "00:00"), DAY_END = hm(SCENARIO.dayEnd || "24:00");
  const HOURS = (DAY_END - DAY_START) / 60;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const snap = (m, step) => Math.round(m / step) * step;
  const uid = () => "n" + Math.random().toString(36).slice(2, 8);

  function normalize(e) {
    const out = { id: e.id || uid(), title: e.title || "", notes: e.notes || "", location: e.location || "", detail: e.detail || "", date: e.date, allDay: false, deleted: !!e.deleted,
      start: mins(e.start, 540), end: mins(e.end, 600),
      color: COLORS.includes(e.color) ? e.color : "blue" };
    out.start = clamp(out.start, DAY_START, DAY_END - 15);
    out.end = clamp(out.end, out.start + 15, DAY_END);
    return out;
  }
  const clone = (evs) => evs.map((e) => ({ ...e }));
  const SEED = SCENARIO.events.map(normalize);
  const SEED_BY_ID = new Map(SEED.map((e) => [e.id, e]));
  const isMoved = (e) => { const s0 = state.compareSeed && SEED_BY_ID.get(e.id); return !!s0 && (e.date !== s0.date || e.start !== s0.start || e.end !== s0.end); };

  // ---------- storage ----------
  const KEY = "cal-test:" + SCENARIO.name;
  const REVIEW_KEY = "cal-test:review:" + SCENARIO.name;
  const local = CalendarStorage.createStorage(() => localStorage, () => { $("#storageNotice").hidden = false; });
  const session = CalendarStorage.createStorage(() => sessionStorage);
  const load = k => { try { return JSON.parse(local.get(k)); } catch { return null; } };
  const store = (k, v) => local.set(k, JSON.stringify(v));
  function loadDraft() {
    const draft = load(KEY);
    if (!draft) return null;
    try {
      const events = draft.events.map(normalize);
      const parsed = parseSubmission({ v: 1, c: draft.candidate, s: SCENARIO.name, t: new Date().toISOString(),
        e: events.map(packEvent), d: draft.dayNotes, o: draft.openedAt, a: draft.activeSec });
      return { candidate: parsed.c, events, dayNotes: parsed.d, openedAt: parsed.o, activeSec: parsed.a };
    } catch { return null; }
  }

  function makeCandidateId() {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = "";
    const r = new Uint8Array(6); crypto.getRandomValues(r);
    for (const b of r) s += A[b % A.length]; return s;
  }

  // ---------- state ----------
  const GATE_KEY = "cal-test:opened:" + SCENARIO.name;
  if (location.hash === "#reset") { local.remove(KEY); local.remove(GATE_KEY); location.hash = ""; }
  const isReviewUrl = /^#review/.test(location.hash) || new URLSearchParams(location.search).has("review");
  let gated = !!SCENARIO.openPasswordHash && local.get(GATE_KEY) !== "1";

  const scenarioDate = toDate(SCENARIO.today);
  const SCENARIO_WEEK = addDays(scenarioDate, -scenarioDate.getDay());
  const saved = loadDraft();
  const state = {
    candidate: (saved && saved.candidate) || makeCandidateId(),
    events: saved && Array.isArray(saved.events) ? saved.events.map(normalize) : clone(SEED),
    weekStart: new Date(SCENARIO_WEEK),
    compareSeed: true,
    readOnly: false,
    selected: null,
    dayNotes: (saved && saved.dayNotes) || {},
    openedAt: (saved && saved.openedAt) || (gated ? null : new Date().toISOString()),
    activeSec: (saved && saved.activeSec) || 0,
  };
  function persist() { if (!state.readOnly) store(KEY, { candidate: state.candidate, events: state.events, dayNotes: state.dayNotes, openedAt: state.openedAt, activeSec: state.activeSec }); }
  persist();

  // time on page: counts seconds while the tab is visible, saved every few seconds
  const fmtClock = (sec) => { const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s2 = sec % 60; return h ? `${h}:${pad(m)}:${pad(s2)}` : `${m}:${pad(s2)}`; };
  const drawTimer = () => { $("#timerText").textContent = fmtClock(state.activeSec); };
  drawTimer();
  const TIMER_KEY = "cal-test:timer-hidden";
  let timerHidden = local.get(TIMER_KEY) === "1";
  const applyTimerVisibility = () => { $("#timer").hidden = timerHidden || state.readOnly; $("#timerToggle").textContent = timerHidden ? "Show timer" : "Hide timer"; };
  applyTimerVisibility();
  $("#timerToggle").addEventListener("click", () => { timerHidden = !timerHidden; local.set(TIMER_KEY, timerHidden ? "1" : "0"); applyTimerVisibility(); });
  setInterval(() => {
    if (state.readOnly || gated || document.visibilityState !== "visible") return;
    state.activeSec++; drawTimer(); if (state.activeSec % 5 === 0) persist();
  }, 1000);
  document.addEventListener("visibilitychange", () => persist());
  window.addEventListener("pagehide", () => persist());
  const fmtDur = (sec) => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s2 = sec % 60; return h ? `${h}h ${pad(m)}m` : `${m}m ${pad(s2)}s`; };

  // ---------- DOM refs ----------
  const cal = $("#cal"), grid = $("#grid"), dayHeads = $("#dayHeads");
  const popup = $("#popup");
  const popTitle = $("#popTitle"), popDate = $("#popDate"), popStart = $("#popStart"), popEnd = $("#popEnd"), popNotes = $("#popNotes");
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1800); }

  for (let m = DAY_START; m < DAY_END; m += 15) {
    popStart.add(new Option(fmtTime(m), m)); if (m > DAY_START) popEnd.add(new Option(fmtTime(m), m));
  }
  popEnd.add(new Option(fmtTime(DAY_END), DAY_END));

  // ---------- rendering ----------
  function fitHours() {
    const head = cal.querySelector(".head");
    const foot = $("#dayNotes"), footTitle = $("#dayNotesTitle");
    const avail = cal.clientHeight - (head ? head.offsetHeight : 0) - (foot ? foot.offsetHeight : 0) - (footTitle ? footTitle.offsetHeight : 0);
    const next = Math.max(36, Math.floor(avail / HOURS));
    if (next === HOUR) return false;
    HOUR = next; cal.style.setProperty("--hour", HOUR + "px"); return true;
  }
  window.addEventListener("resize", () => render());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => render());
  function evNode(e, isDragGhost) {
    const n = document.createElement("div");
    n.className = `ev c-${e.color}` + (isDragGhost ? " ghost" : "") + (state.selected === e.id ? " selected" : "") + (e.deleted ? " deleted" : isMoved(e) ? " moved" : "");
    n.dataset.id = e.id; n.tabIndex = state.readOnly ? -1 : 0; n.setAttribute("role", "button");
    const title = e.title || "(No title)";
    if (e.allDay) {
      n.classList.add("allday-ev"); n.innerHTML = `<span class="t"></span>`; n.querySelector(".t").textContent = title;
      n.title = title;
    } else {
      const dur = e.end - e.start;
      n.style.top = ((e.start - DAY_START) / 60 * HOUR) + "px";
      n.style.height = Math.max(dur / 60 * HOUR - 1, 12) + "px";
      const px = dur / 60 * HOUR;
      const extra = [e.location, e.detail].filter(Boolean).join(" \u00b7 ");
      const threeLines = !!extra && px >= 38;
      if (px < 20) n.classList.add("tiny"); else if (px < 36) n.classList.add("short"); else if (threeLines && px < 56) n.classList.add("dense");
      if (e._cols > 1) { const w = 100 / e._cols; n.style.left = `calc(${w * e._col}% + 2px)`; n.style.width = `calc(${w}% - 5px)`; n.style.right = "auto"; }
      n.innerHTML = `<span class="t"></span><span class="w"></span>${threeLines ? `<span class="d"></span>` : ""}<div class="resize"></div>`;
      n.querySelector(".t").textContent = title; n.querySelector(".w").textContent = fmtRange(e.start, e.end);
      if (threeLines) n.querySelector(".d").textContent = extra;
      n.title = `${title}\n${fmtRange(e.start, e.end)}` + (extra ? `\n${extra}` : "") + (e.notes ? `\n\n${e.notes}` : "");
    }
    return n;
  }

  const NOTES_H_KEY = "cal-test:notes-height";
  (function initNotesResize() {
    const saved = parseInt(local.get(NOTES_H_KEY), 10);
    if (saved) cal.style.setProperty("--notes-h", saved + "px");
    const title = $("#dayNotesTitle"); let rs = null;
    let raf = 0, pendingH = 0;
    const applyH = () => { raf = 0; cal.style.setProperty("--notes-h", pendingH + "px"); if (fitHours()) renderOnce(); };
    title.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const ta = $("#dayNotes textarea"); if (!ta) return;
      rs = { y0: ev.clientY, h0: ta.offsetHeight }; title.setPointerCapture(ev.pointerId); ev.preventDefault();
      cal.classList.add("notes-resizing");
    });
    title.addEventListener("pointermove", (ev) => {
      if (!rs) return;
      pendingH = clamp(rs.h0 + (rs.y0 - ev.clientY), 40, Math.max(40, cal.clientHeight - 320));
      if (!raf) raf = requestAnimationFrame(applyH);
    });
    const end = () => {
      if (!rs) return; rs = null; cal.classList.remove("notes-resizing");
      if (raf) { cancelAnimationFrame(raf); applyH(); }
      local.set(NOTES_H_KEY, parseInt(cal.style.getPropertyValue("--notes-h"), 10)); render();
    };
    title.addEventListener("pointerup", end); title.addEventListener("pointercancel", end);
  })();
  function buildDayNotes() {
    const foot = $("#dayNotes"); foot.innerHTML = `<div></div>`;
    for (let i = 0; i < 7; i++) {
      const ds = fmtDate(addDays(state.weekStart, i));
      const cell = document.createElement("div"); cell.className = "cell";
      const ta = document.createElement("textarea"); ta.maxLength = 20000; ta.id = "dn-" + ds; ta.dataset.date = ds;
      ta.setAttribute("aria-label", `Your reasoning or notes for ${fmtLongDate(ds)}`);
      attachBullets(ta);
      ta.addEventListener("input", () => { state.dayNotes[ds] = ta.value; persist(); });
      const ex = document.createElement("button"); ex.className = "expand"; ex.type = "button"; ex.title = "Expand"; ex.setAttribute("aria-label", `Expand notes for ${fmtLongDate(ds)}`);
      ex.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>`;
      ex.addEventListener("click", () => openNotesModal(ds));
      cell.appendChild(ta); cell.appendChild(ex); foot.appendChild(cell);
    }
  }
  let notesModalDate = null;
  attachBullets($("#notesModalText"));
  function openNotesModal(ds) {
    notesModalDate = ds;
    $("#notesModalTitle").textContent = `Your reasoning or notes \u00b7 ${fmtLongDate(ds)}`;
    const t = $("#notesModalText"); t.value = state.dayNotes[ds] || ""; t.disabled = state.readOnly;
    $("#notesModal").hidden = false; t.focus();
  }
  function closeNotesModal() { $("#notesModal").hidden = true; notesModalDate = null; fillDayNotes(); }
  $("#notesModalText").addEventListener("input", (ev) => { if (notesModalDate && !state.readOnly) { state.dayNotes[notesModalDate] = ev.target.value; persist(); } });
  $("#notesModalClose").addEventListener("click", closeNotesModal);
  $("#notesModal").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeNotesModal(); });
  function fillDayNotes() {
    for (const ta of $("#dayNotes").querySelectorAll("textarea")) {
      const v = state.dayNotes[ta.dataset.date] || "";
      if (ta.value !== v) ta.value = v;
      ta.disabled = state.readOnly;
    }
  }
  function render(overrideEvents) {
    fillDayNotes();
    renderOnce(overrideEvents);
    if (fitHours()) renderOnce(overrideEvents);
  }
  function renderOnce(overrideEvents) {
    const evs = overrideEvents || state.events;
    const ws = state.weekStart, we = addDays(ws, 6);
    $("#monthTitle").textContent = ws.getMonth() === we.getMonth()
      ? `${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`
      : `${MONTHS[ws.getMonth()].slice(0, 3)} \u2013 ${MONTHS[we.getMonth()].slice(0, 3)} ${we.getFullYear()}`;

    dayHeads.innerHTML = '<div class="tz"></div>';
    dayHeads.firstChild.textContent = SCENARIO.timezone;
    const allDays = $("#allDayHeads");
    allDays.hidden = !evs.some(e => e.allDay && e.date >= fmtDate(ws) && e.date <= fmtDate(we));
    allDays.innerHTML = '<div class="allday-label">All day</div>';
    grid.innerHTML = "";
    const times = document.createElement("div"); times.className = "times"; times.style.height = (HOURS * HOUR) + "px";
    for (let h = Math.ceil(DAY_START / 60) + (DAY_START % 60 === 0 ? 1 : 0); h * 60 < DAY_END; h++) {
      const d = document.createElement("div"); d.style.top = ((h * 60 - DAY_START) / 60 * HOUR) + "px"; d.textContent = fmtHour(h); times.appendChild(d);
    }
    grid.appendChild(times);

    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i), ds = fmtDate(d), isToday = ds === SCENARIO.today, isWeekend = d.getDay() === 0 || d.getDay() === 6;
      const dh = document.createElement("div"); dh.className = "dayhead" + (isToday ? " today" : "");
      dh.innerHTML = `${DAYS[d.getDay()]} <span class="num">${d.getDate()}</span>`; dayHeads.appendChild(dh);

      const col = document.createElement("div"); col.className = "daycol" + (isWeekend ? " weekend" : ""); col.dataset.date = ds; col.style.height = (HOURS * HOUR) + "px";
      const allDayCol = document.createElement("div"); allDayCol.className = "allday";
      for (const e of evs.filter(e => e.allDay && e.date === ds)) allDayCol.appendChild(evNode(e));
      allDays.appendChild(allDayCol);
      const dayEvs = layoutColumns(evs.filter((e) => !e.allDay && e.date === ds));
      for (const e of dayEvs) col.appendChild(evNode(e, e.id === "__ghost"));
      grid.appendChild(col);
    }
    drawNow();
  }

  // Simulated clock: it is 9:00 AM on the Monday of the scenario week when the candidate
  // first opens the app, and runs forward in real time from there.
  const SIM_START = (() => { const d = addDays(state.weekStart, 1); d.setHours(9, 0, 0, 0); return d; })();
  const simNow = () => new Date(SIM_START.getTime() + (Date.now() - Date.parse(state.openedAt)));
  function drawNow() {
    for (const n of grid.querySelectorAll(".nowline, .nowbadge, .nowhair")) n.remove();
    if (state.readOnly || !state.openedAt) return;
    const now = simNow(), min = now.getHours() * 60 + now.getMinutes();
    const col = grid.querySelector(`.daycol[data-date="${fmtDate(now)}"]`);
    if (!col || min < DAY_START || min >= DAY_END) return;
    const top = (min - DAY_START) / 60 * HOUR;
    const hair = document.createElement("div"); hair.className = "nowhair"; hair.style.top = top + "px"; grid.prepend(hair);
    const line = document.createElement("div"); line.className = "nowline"; line.style.top = top + "px"; col.appendChild(line);
    const badge = document.createElement("div"); badge.className = "nowbadge"; badge.style.top = top + "px"; badge.textContent = fmtTime(min);
    grid.querySelector(".times").appendChild(badge);
  }
  setInterval(drawNow, 30000);

  // ---------- pointer interactions ----------
  const drag = { active: false };
  function colAt(x) {
    for (const c of grid.querySelectorAll(".daycol")) { const r = c.getBoundingClientRect(); if (x >= r.left && x < r.right) return c; }
    return null;
  }
  function minuteAt(y) { const r = grid.querySelector(".daycol").getBoundingClientRect(); return clamp(DAY_START + (y - r.top) / HOUR * 60, DAY_START, DAY_END); }
  function evById(id, list) { return (list || state.events).find((e) => e.id === id); }

  cal.addEventListener("pointerdown", (ev) => {
    if (state.readOnly || ev.button !== 0) return;
    if (!popup.hidden) { closePopup(); return; }
    const evEl = ev.target.closest(".ev");
    const col = ev.target.closest(".daycol");
    if (evEl) {
      const e = evById(evEl.dataset.id); if (!e) return;
      if (e.deleted) { ev.preventDefault(); Object.assign(drag, { active: true, kind: "open", id: e.id, moved: false }); return; }
      const isResize = ev.target.classList.contains("resize");
      Object.assign(drag, { active: true, kind: isResize ? "resize" : "move", id: e.id, x0: ev.clientX, y0: ev.clientY, moved: false,
        offset: minuteAt(ev.clientY) - e.start, orig: { ...e }, work: clone(state.events) });
    } else if (col) {
      Object.assign(drag, { active: true, kind: "create", x0: ev.clientX, y0: ev.clientY, moved: false,
        date: col.dataset.date, m0: snap(minuteAt(ev.clientY), 15), work: clone(state.events) });
    } else return;
    ev.preventDefault();
  });

  window.addEventListener("pointermove", (ev) => {
    if (!drag.active) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const col = colAt(ev.clientX);
    if (drag.kind === "create") {
      const m = snap(minuteAt(ev.clientY), 15);
      const a = Math.min(drag.m0, m), b = Math.max(drag.m0, m);
      const g = { id: "__ghost", title: "(No title)", date: drag.date, allDay: false, start: clamp(a, DAY_START, DAY_END - 15), end: clamp(Math.max(b, a + 15), DAY_START + 15, DAY_END), color: "blue" };
      render([...drag.work, g]);
    } else if (drag.kind === "move") {
      const e = evById(drag.id, drag.work); if (!e) return;
      if (col) e.date = col.dataset.date;
      const dur = drag.orig.end - drag.orig.start;
      e.start = clamp(snap(minuteAt(ev.clientY) - drag.offset, 15), DAY_START, DAY_END - dur); e.end = e.start + dur;
      render(drag.work); const n = grid.querySelector(`.ev[data-id="${e.id}"]`); if (n) n.classList.add("dragging");
    } else if (drag.kind === "resize") {
      const e = evById(drag.id, drag.work); if (!e) return;
      e.end = clamp(snap(minuteAt(ev.clientY), 15), e.start + 15, DAY_END);
      render(drag.work);
    }
  });

  window.addEventListener("pointerup", (ev) => {
    if (!drag.active) return;
    const d = { ...drag }; drag.active = false;
    if (d.kind === "open") { openPopup(d.id); return; }
    if (d.kind === "create") {
      if (d.moved) {
        const m = snap(minuteAt(ev.clientY), 15);
        const a = Math.min(d.m0, m), b = Math.max(d.m0, m);
        const e = { id: uid(), title: "", date: d.date, allDay: false, start: clamp(a, DAY_START, DAY_END - 15), end: clamp(Math.max(b, a + 15), DAY_START + 15, DAY_END), color: "blue", notes: "", _new: true };
        state.events.push(e); render(); openPopup(e.id);
      } else {
        const s = clamp(Math.floor(d.m0 / 30) * 30, DAY_START, DAY_END - 30);
        const e = { id: uid(), title: "", date: d.date, allDay: false, start: s, end: Math.min(s + 60, DAY_END), color: "blue", notes: "", _new: true };
        state.events.push(e); render(); openPopup(e.id);
      }
    } else if (d.kind === "move" || d.kind === "resize") {
      if (d.moved) {
        const w = evById(d.id, d.work); const e = evById(d.id);
        if (w && e) { Object.assign(e, { date: w.date, start: w.start, end: w.end }); persist(); }
        render();
      } else { render(); openPopup(d.id); }
    }
  });

  cal.addEventListener("keydown", (ev) => {
    if (state.readOnly) return;
    const el = ev.target.closest(".ev");
    if (el && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openPopup(el.dataset.id); }
  });

  // ---------- popup ----------
  let popId = null;
  function openPopup(id) {
    const e = evById(id); if (!e) return;
    popId = id; state.selected = id;
    $("#popError").hidden = true;
    popDate.min = fmtDate(SCENARIO_WEEK); popDate.max = fmtDate(addDays(SCENARIO_WEEK, 6));
    popTitle.value = e.title; popNotes.value = e.notes || ""; popDate.value = e.date;
    const meta = [e.location, e.detail].filter(Boolean).join(" \u00b7 "); $("#popMeta").textContent = meta; $("#popMeta").hidden = !meta;
    const del = !!e.deleted;
    $("#popDeletedNote").hidden = !del; $("#popSave").hidden = del;
    for (const el of [popTitle, popDate, popStart, popEnd, popNotes]) el.disabled = del || state.readOnly;
    $("#popDelete").title = del ? "Restore" : "Delete"; $("#popDelete").setAttribute("aria-label", del ? "Restore event" : "Delete event");
    $("#popDelete").innerHTML = del
      ? `<svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89.07.14L9 12H6a7 7 0 1 1 7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.96 8.96 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>`
      : `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
    popStart.value = e.start; popEnd.value = e.end;
    popup.hidden = false;
    render();
    const el = cal.querySelector(`.ev[data-id="${id}"]`);
    const r = el ? el.getBoundingClientRect() : { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2 };
    const pw = popup.offsetWidth, ph = popup.offsetHeight;
    let left = r.right + 10; if (left + pw > innerWidth - 12) left = r.left - pw - 10; if (left < 12) left = clamp((innerWidth - pw) / 2, 12, innerWidth - pw - 12);
    let top = clamp(r.top, 12, innerHeight - ph - 12);
    popup.style.left = left + "px"; popup.style.top = top + "px";
    if (!popTitle.disabled) { popTitle.focus(); popTitle.select(); }
  }
  function closePopup(save) {
    if (popup.hidden) return;
    const e = evById(popId);
    if (e && save) {
      if (!isDate(popDate.value) || popDate.value < popDate.min || popDate.value > popDate.max) {
        const err = $("#popError"); err.textContent = "Choose a date within this test week."; err.hidden = false;
        popDate.focus(); return false;
      }
      e.title = popTitle.value.trim(); e.notes = popNotes.value.trim(); e.date = popDate.value || e.date;
      e.start = +popStart.value; e.end = +popEnd.value; if (e.end <= e.start) e.end = Math.min(DAY_END, e.start + 30);
      delete e._new;
      persist(); toast("Saved");
    } else if (e && e._new) {
      state.events = state.events.filter((x) => x.id !== e.id);
    }
    hidePopup();
    return true;
  }
  function hidePopup() { popup.hidden = true; popId = null; state.selected = null; render(); }
  $("#popSave").addEventListener("click", () => closePopup(true));
  $("#popClose").addEventListener("click", () => closePopup(false));
  $("#popDelete").addEventListener("click", () => {
    const e = evById(popId); if (!e) return;
    if (SEED_BY_ID.has(e.id)) {
      e.deleted = !e.deleted; persist();
      hidePopup(); toast(e.deleted ? "Event deleted" : "Event restored");
    } else {
      state.events = state.events.filter((x) => x.id !== popId); persist();
      hidePopup(); toast("Event removed");
    }
  });
  popStart.addEventListener("change", () => { if (+popEnd.value <= +popStart.value) popEnd.value = Math.min(DAY_END, +popStart.value + 60); });
  popup.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target === popTitle) { ev.preventDefault(); closePopup(true); } });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    if (!popup.hidden) closePopup(false);
    $("#submitModal").hidden = true; $("#instrModal").hidden = true;
    if (!$("#notesModal").hidden) closeNotesModal();
  });
  document.addEventListener("pointerdown", (ev) => {
    if (popup.hidden || popup.contains(ev.target) || cal.contains(ev.target)) return;
    closePopup(false);
  });

  // ---------- instructions ----------
  if (SCENARIO.instructions) {
    $("#instrBtn").hidden = false; $("#instrText").textContent = SCENARIO.instructions;
    $("#instrBtn").addEventListener("click", () => { $("#instrModal").hidden = false; });
    $("#instrCloseBtn").addEventListener("click", () => { $("#instrModal").hidden = true; });
    $("#instrModal").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.hidden = true; });
  }

  // ---------- submission codes ----------
  function serialize() {
    const d = {}; for (const [k, v] of Object.entries(state.dayNotes)) if (v && v.trim()) d[k] = v.trim();
    return { v: 1, c: state.candidate, s: SCENARIO.name, t: new Date().toISOString(), o: state.openedAt, a: state.activeSec, d,
      e: state.events.map(packEvent) };
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label + " copied"); }
    catch { const ta = $("#submitCode"); ta.select(); document.execCommand("copy"); toast(label + " copied"); }
  }
  const API = (SCENARIO.apiBase || "").replace(/\/$/, "");
  const hasBackend = () => !!API || /^https?:$/.test(location.protocol);
  async function postSubmission(payload) {
    const r = await fetch(API + "/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  let lastCode = "";
  $("#submitBtn").addEventListener("click", async () => {
    if (!confirm("Submit your response now? Make sure you are finished before continuing.")) return;
    closePopup(false);
    let payload;
    try {
      payload = parseSubmission(serialize());
      lastCode = encodePayload(payload, window.LZString);
    } catch (error) { alert("Could not submit: " + error.message); return; }
    const st = $("#submitStatus");
    const showCode = (on) => { $("#submitBackup").hidden = !on; $("#submitCode").hidden = !on; $("#copyCodeBtn").hidden = !on; };
    $("#submitId").textContent = state.candidate; $("#submitCode").value = lastCode; $("#submitModal").hidden = false;
    st.className = "submit-status"; st.textContent = "Saving\u2026"; showCode(false);
    if (!hasBackend()) { st.className = "submit-status"; st.textContent = "Copy the code below and send it to us. It contains your calendar and your anonymous candidate ID, nothing else."; showCode(true); return; }
    $("#submitBtn").disabled = true;
    try {
      await postSubmission(payload);
      st.className = "submit-status ok"; st.textContent = "\u2713 Submitted. Your response has been sent to the team. Please paste your candidate code to the work trial doc, and you can now close this window.";
    } catch (e) {
      st.className = "submit-status bad"; st.textContent = "We couldn\u2019t save this automatically. Please copy the code below and send it to us."; showCode(true);
    } finally { $("#submitBtn").disabled = false; }
  });
  $("#submitCloseBtn").addEventListener("click", () => { $("#submitModal").hidden = true; });
  $("#submitModal").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.hidden = true; });
  $("#copyCodeBtn").addEventListener("click", () => copy(lastCode, "Code"));

  // ---------- reviewer view ----------
  function renderChanges(evs, label) {
    const container = $("#changes");
    container.replaceChildren();
    if (!evs) return;
    const heading = document.createElement("h3"); heading.textContent = label; container.appendChild(heading);
    const changes = state.compareSeed ? describeChanges(evs, SEED_BY_ID) : [];
    if (!state.compareSeed || !changes.length) {
      const message = document.createElement("div"); message.className = "none";
      message.textContent = state.compareSeed ? "No changes from the starting calendar." :
        "The starting calendar for this scenario is unavailable. Changes cannot be compared.";
      container.appendChild(message);
    }
    const ul = document.createElement("ul"); container.appendChild(ul);
    for (const change of changes) {
      const li = document.createElement("li"); li.className = change.kind;
      li.innerHTML = '<span class="k"></span><span class="txt"></span><span class="from"></span>';
      li.querySelector(".k").textContent = change.kind;
      li.querySelector(".txt").textContent = change.text;
      li.querySelector(".from").textContent = change.from ? " " + change.from : "";
      ul.appendChild(li);
    }
    const notes = Object.entries(state.dayNotes).filter(([, value]) => value.trim()).sort();
    if (notes.length) {
      const heading = document.createElement("h3"); heading.textContent = "Day notes"; container.appendChild(heading);
      const ul = document.createElement("ul"); container.appendChild(ul);
      for (const [date, value] of notes) {
        const li = document.createElement("li"); li.innerHTML = '<b></b><br><span class="from"></span>';
        li.querySelector("b").textContent = fmtLongDate(date);
        li.querySelector(".from").textContent = value;
        ul.appendChild(li);
      }
    }
  }
  function cachedSubmissions() {
    const cached = load(REVIEW_KEY);
    if (!Array.isArray(cached)) return [];
    return cached.flatMap(value => {
      try { return [{ ...parseSubmission(value, { server: value._server === true }), _server: value._server === true }]; }
      catch { return []; }
    });
  }
  const review = { on: false, subs: sortSubmissions(cachedSubmissions()), active: null, cursor: null, loading: false, request: 0, deleted: new Set() };
  const banner = $("#reviewBanner");
  function setWeek(date) {
    const day = toDate(date);
    state.weekStart = addDays(day, -day.getDay());
    buildDayNotes();
  }
  function reviewShowSeed() {
    review.active = null; state.compareSeed = true; state.events = clone(SEED); state.dayNotes = {};
    setWeek(SCENARIO.today); render(); reviewRenderList();
    banner.hidden = false; banner.textContent = "Reviewer view · Starting calendar"; renderChanges(null);
  }
  function reviewShowSub(key, preserveWeek = false) {
    const p = review.subs.find(value => submissionKey(value) === key);
    if (!p) { reviewShowSeed(); return; }
    review.active = key;
    state.compareSeed = p.s === SCENARIO.name;
    state.dayNotes = p.d;
    state.events = p.e.map(tuple => {
      const event = unpackEvent(tuple);
      const original = state.compareSeed ? SEED_BY_ID.get(event.id) : null;
      return { ...event, location: original?.location || "", detail: original?.detail || "" };
    });
    if (!preserveWeek) {
      const dates = [...state.events.map(event => event.date), ...Object.keys(state.dayNotes)].sort();
      setWeek(state.compareSeed ? SCENARIO.today : dates[0] || SCENARIO.today);
    }
    render(); reviewRenderList();
    banner.hidden = false;
    const elapsed = p.o ? (Date.parse(p.t) - Date.parse(p.o)) / 1000 : null;
    const timing = p.o ? ` · reported active time ${fmtDur(p.a)}` + (elapsed >= 0 ? `, ${fmtDur(elapsed)} from first open to submit` : "") : "";
    const dateLabel = p.receivedAt ? "received" : "submitted";
    banner.textContent = `Reviewer view · Candidate ${p.c} · ${dateLabel} ${new Date(p.receivedAt || p.t).toLocaleString()}${timing}` +
      (state.compareSeed ? "" : ` · scenario "${p.s}"`);
    renderChanges(state.events, `Changes · candidate ${p.c}`);
  }
  const PW_KEY = "cal-test:reviewer-pw";
  const reviewerPw = () => session.get(PW_KEY) || "";
  function updateReview(submissions) {
    const selected = review.subs.find(p => submissionKey(p) === review.active);
    review.subs = submissions.filter(p => !review.deleted.has(submissionKey(p)));
    store(REVIEW_KEY, review.subs);
    if (!review.on) return;
    const active = review.subs.find(p => submissionKey(p) === review.active) ||
      (selected && !selected.id && review.subs.find(p => sameResponse(p, selected)));
    if (active) reviewShowSub(submissionKey(active), true);
    else reviewShowSeed();
  }
  async function loadServerSubs(more = false) {
    if (review.loading || !review.on || (more && !review.cursor)) return;
    const status = $("#serverStatus"), refresh = $("#serverRefresh"), moreButton = $("#serverMore");
    if (!hasBackend()) { status.textContent = "No server on this page: paste codes above."; refresh.hidden = true; return; }
    review.loading = true;
    const request = ++review.request;
    status.className = "server-status"; status.textContent = "Loading submissions…";
    refresh.hidden = false; refresh.disabled = true; moreButton.disabled = true;
    try {
      const query = more ? "?cursor=" + encodeURIComponent(review.cursor) : "";
      const response = await fetch(API + "/api/submissions" + query, { headers: { "X-Reviewer-Password": reviewerPw() } });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      if (!Array.isArray(body.submissions) || (body.cursor != null && typeof body.cursor !== "string")) throw new Error("Invalid server response");
      let skipped = Number.isInteger(body.skipped) ? body.skipped : 0;
      const incoming = body.submissions.flatMap(value => {
        try { return [{ ...parseSubmission(value, { server: true }), _server: true }]; }
        catch { skipped++; return []; }
      });
      if (request !== review.request || !review.on) return;
      review.cursor = body.cursor || null;
      updateReview(mergeSubmissions(review.subs, incoming, { replaceServer: !more }));
      const count = review.subs.filter(p => p._server).length;
      status.textContent = `${count} server submission${count === 1 ? "" : "s"} loaded` + (skipped ? ` · ${skipped} unreadable submission${skipped === 1 ? "" : "s"} skipped` : "");
      moreButton.hidden = !review.cursor;
    } catch (error) {
      if (request !== review.request || !review.on) return;
      status.className = "server-status bad";
      status.textContent = `Couldn’t load from server: ${error.message}`;
    } finally {
      if (request === review.request) { review.loading = false; refresh.disabled = false; moreButton.disabled = false; }
    }
  }
  async function deleteServerSub(p) {
    const response = await fetch(API + "/api/submissions?id=" + encodeURIComponent(p.id), { method: "DELETE", headers: { "X-Reviewer-Password": reviewerPw() } });
    const body = await response.json();
    if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
  }
  $("#subSearch").addEventListener("input", reviewRenderList);
  $("#serverRefresh").addEventListener("click", () => loadServerSubs());
  $("#serverMore").addEventListener("click", () => loadServerSubs(true));
  function reviewRenderList() {
    const ul = $("#subList"); ul.replaceChildren();
    const query = $("#subSearch").value.trim().toUpperCase();
    const shown = review.subs.filter(p => p.c.includes(query));
    $("#subEmpty").hidden = !(query && review.subs.length && !shown.length);
    shown.forEach(p => {
      const key = submissionKey(p);
      const li = document.createElement("li");
      const button = document.createElement("button"); button.className = "submission" + (key === review.active ? " active" : "");
      button.setAttribute("aria-pressed", String(key === review.active));
      button.innerHTML = '<span><b></b> <small></small></span>';
      button.querySelector("b").textContent = p.c;
      button.querySelector("small").textContent = new Date(p.receivedAt || p.t).toLocaleDateString() + (p.o ? ` · ${fmtDur(p.a)}` : "");
      const remove = document.createElement("button"); remove.className = "x"; remove.textContent = "✕";
      remove.title = p._server ? "Delete from the server" : "Remove from this list";
      remove.setAttribute("aria-label", `${remove.title}: candidate ${p.c}`);
      remove.addEventListener("click", async () => {
        if (p._server) {
          if (!confirm(`Delete candidate ${p.c}'s submission from the server? This cannot be undone.`)) return;
          remove.disabled = true;
          try { await deleteServerSub(p); }
          catch (error) { alert("Could not delete: " + error.message); remove.disabled = false; return; }
        }
        // A concurrent refresh may have reordered or reintroduced the record.
        review.deleted.add(key);
        updateReview(review.subs.filter(value => submissionKey(value) !== key));
      });
      button.addEventListener("click", () => reviewShowSub(key));
      li.append(button, remove); ul.appendChild(li);
    });
  }
  function reviewLoadCode(text) {
    const payload = decodePayload(text, window.LZString);
    review.deleted.delete(submissionKey(payload));
    updateReview(mergeSubmissions(review.subs, [payload]));
    const match = review.subs.find(p => submissionKey(p) === submissionKey(payload) || sameResponse(p, payload));
    reviewShowSub(submissionKey(match));
  }
  const PW_OK_KEY = "cal-test:reviewer-ok";
  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  function reviewerUnlocked() {
    const h = SCENARIO.reviewerPasswordHash;
    if (!h) return !hasBackend() || !!reviewerPw();
    return session.get(PW_OK_KEY) === h;
  }
  let closePasswordPrompt = null;
  function showPasswordPrompt({ modal, input, error, submit, cancel, verify, onSuccess, onCancel }) {
    closePasswordPrompt?.();
    const controller = new AbortController();
    const { signal } = controller;
    let pending = false;
    const close = () => {
      controller.abort();
      modal.hidden = true;
      submit.disabled = false;
      closePasswordPrompt = null;
    };
    closePasswordPrompt = close;
    input.value = ""; error.hidden = true; modal.hidden = false; input.focus();
    const attempt = async () => {
      if (pending || signal.aborted) return;
      pending = true; submit.disabled = true; error.hidden = true;
      const password = input.value;
      try {
        if (!crypto.subtle) throw new Error("Password check needs a secure (https) connection.");
        if (!await verify(password)) throw new Error("That password is not correct.");
      } catch (failure) {
        if (!signal.aborted) {
          error.textContent = failure.message; error.hidden = false;
          input.focus(); input.select();
        }
        return;
      } finally {
        pending = false;
        if (!signal.aborted) submit.disabled = false;
      }
      if (signal.aborted) return;
      close(); onSuccess(password);
    };
    const dismiss = () => { close(); onCancel?.(); };
    submit.addEventListener("click", attempt, { signal });
    cancel?.addEventListener("click", dismiss, { signal });
    input.addEventListener("keydown", event => {
      if (event.key === "Enter") { event.preventDefault(); attempt(); }
      if (event.key === "Escape" && cancel) { event.preventDefault(); dismiss(); }
    }, { signal });
  }
  function askReviewerPassword(then) {
    const hash = SCENARIO.reviewerPasswordHash;
    showPasswordPrompt({
      modal: $("#pwModal"), input: $("#pwInput"), error: $("#pwErr"), submit: $("#pwUnlock"), cancel: $("#pwCancel"),
      verify: async password => !hash || await sha256Hex(password) === hash,
      onSuccess: password => {
        if (hash) session.set(PW_OK_KEY, hash);
        session.set(PW_KEY, password); then();
      },
      onCancel: () => {
        const url = new URL(location.href); url.hash = ""; url.searchParams.delete("review");
        history.replaceState(null, "", url);
        if (gated) showGate();
      },
    });
  }
  function showGate() {
    showPasswordPrompt({
      modal: $("#gateModal"), input: $("#gateInput"), error: $("#gateErr"), submit: $("#gateStart"),
      verify: async password => await sha256Hex(password) === SCENARIO.openPasswordHash,
      onSuccess: () => {
        gated = false; local.set(GATE_KEY, "1");
        if (!state.openedAt) state.openedAt = new Date().toISOString();
        persist(); render();
      },
    });
  }
  function enterReview(code) {
    if (review.on) { if (code) reviewLoadCode(code); return; }
    if (!reviewerUnlocked()) { askReviewerPassword(() => enterReview(code)); return; }
    closePopup(false);
    review.on = true; state.readOnly = true;
    closePasswordPrompt?.();
    $("#reviewNavigation").hidden = false;
    $("#submitModal").hidden = true;
    document.body.classList.add("readonly");
    $("#reviewSide").hidden = false; $("#candidateChip").hidden = true; $("#submitBtn").hidden = true; $("#instrBtn").hidden = true; $("#timer").hidden = true; $("#timerToggle").hidden = true;
    if (code) { try { reviewLoadCode(code); } catch { reviewShowSeed(); } } else reviewShowSeed();
    loadServerSubs();
  }
  function exitReview() {
    if (!review.on) return;
    review.on = false; review.request++; review.loading = false;
    state.readOnly = false; state.compareSeed = true;
    $("#reviewNavigation").hidden = true;
    document.body.classList.remove("readonly");
    $("#reviewSide").hidden = true; $("#candidateChip").hidden = false; $("#submitBtn").hidden = false; $("#instrBtn").hidden = !SCENARIO.instructions; $("#timerToggle").hidden = false; applyTimerVisibility();
    banner.hidden = true;
    const sv = loadDraft();
    state.events = sv && Array.isArray(sv.events) ? sv.events.map(normalize) : clone(SEED);
    state.dayNotes = (sv && sv.dayNotes) || {};
    setWeek(SCENARIO.today);
    gated = !!SCENARIO.openPasswordHash && local.get(GATE_KEY) !== "1";
    if (gated) showGate();
    render();
  }
  $("#reviewLoad").addEventListener("click", () => {
    const err = $("#reviewErr"); err.hidden = true;
    try { reviewLoadCode($("#reviewInput").value); $("#reviewInput").value = ""; }
    catch (error) { err.textContent = "Could not read that code: " + error.message; err.hidden = false; }
  });
  $("#reviewSeed").addEventListener("click", reviewShowSeed);
  $("#exitReview").addEventListener("click", (event) => {
    event.preventDefault();
    const url = new URL(location.href); url.hash = ""; url.searchParams.delete("review");
    history.replaceState(null, "", url); exitReview();
  });
  for (const [selector, days] of [["#previousWeek", -7], ["#nextWeek", 7]]) {
    $(selector).addEventListener("click", () => { state.weekStart = addDays(state.weekStart, days); buildDayNotes(); render(); });
  }
  function routeFromHash() {
    const match = location.hash.match(/^#review=(.+)$/);
    const reviewing = !!match || location.hash === "#review" || new URLSearchParams(location.search).has("review");
    if (reviewing) {
      try { enterReview(match && match[1]); }
      catch (error) { $("#reviewErr").textContent = error.message; $("#reviewErr").hidden = false; }
      if (match) history.replaceState(null, "", location.href.split("#")[0] + "#review");
    } else if (review.on) exitReview();
  }

  $("#candidateId").textContent = state.candidate;
  buildDayNotes(); render();
  if (gated && !isReviewUrl) showGate();
  routeFromHash();
  window.addEventListener("hashchange", routeFromHash);

})();
