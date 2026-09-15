(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarCore = api;
})(globalThis, function () {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const toDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const fmtTime = (m) => {
    let h = Math.floor(m / 60), mm = m % 60; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
    return `${h}:${pad(mm)} ${ap}`;
  };
  const fmtHour = (h) => `${h % 12 || 12} ${h >= 12 ? "PM" : "AM"}`;
  const fmtRange = (a, b) => `${fmtTime(a)} \u2013 ${fmtTime(b)}`;
  const fmtLongDate = (s) => { const d = toDate(s); return `${DAYS[d.getDay()]} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
  function layoutColumns(events) {
    const evs = events.map(e => ({ ...e }));
    evs.sort((a, b) => a.start - b.start || b.end - a.end);
    let cluster = null, clusterEnd = -1; const clusters = [];
    for (const e of evs) {
      if (!cluster || e.start >= clusterEnd) { cluster = []; clusters.push(cluster); clusterEnd = e.end; }
      else clusterEnd = Math.max(clusterEnd, e.end);
      cluster.push(e);
    }
    for (const c of clusters) {
      const ends = [];
      for (const e of c) {
        let i = ends.findIndex((end) => end <= e.start);
        if (i < 0) { i = ends.length; ends.push(0); }
        ends[i] = e.end; e._col = i;
      }
      for (const e of c) e._cols = ends.length;
    }
    return evs;
  }
  function describeChanges(evs, seedById) {
    const nowById = new Map(evs.map((e) => [e.id, e]));
    const when = (e) => e.allDay ? `${fmtLongDate(e.date)}, all day` : `${fmtLongDate(e.date)}, ${fmtRange(e.start, e.end)}`;
    const out = [];
    for (const s of seedById.values()) {
      const n = nowById.get(s.id);
      if (!n || n.deleted) { out.push({ kind: "deleted", text: `${s.title || "(No title)"}`, from: when(s) + (n && n.notes ? ` \u00b7 Notes: ${n.notes}` : "") }); continue; }
      const timeChanged = n.date !== s.date || n.allDay !== s.allDay || n.start !== s.start || n.end !== s.end;
      if (timeChanged) out.push({ kind: "moved", text: `${n.title || "(No title)"} \u2192 ${when(n)}`, from: `was ${when(s)}` });
      if (n.title !== s.title) out.push({ kind: "renamed", text: `"${s.title || "(No title)"}" \u2192 "${n.title || "(No title)"}"` });
      if ((n.notes || "") !== (s.notes || "")) out.push({ kind: "notes", text: `${n.title || "(No title)"}`, from: n.notes || "(notes removed)" });
    }
    for (const n of evs) if (!seedById.has(n.id)) out.push({ kind: "added", text: `${n.title || "(No title)"}`, from: when(n) + (n.notes ? ` \u00b7 Notes: ${n.notes}` : "") });
    return out;
  }
  return { pad, toDate, fmtDate, addDays, DAYS, MONTHS, fmtTime, fmtHour, fmtRange, fmtLongDate, layoutColumns, describeChanges };
});
