(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarNotes = api;
})(globalThis, function () {
  "use strict";
  // Bullet lists in notes: typing "- " or "* " at the start of a line becomes a bullet,
  // Enter continues the list, Enter on an empty bullet ends it,
  // Tab / Shift+Tab indent and unindent the bullet lines under the selection.
  const BULLET = "\u2022 ";
  const INDENT = "  ";
  function attachBullets(ta) {
    const lineStart = (v, pos) => v.lastIndexOf("\n", pos - 1) + 1;
    const onInput = () => {
      const v = ta.value, pos = ta.selectionStart, ls = lineStart(v, pos);
      let le = v.indexOf("\n", pos); if (le < 0) le = v.length;
      const m = v.slice(ls, le).match(/^(\s*)[-*]\s(.*)$/);
      if (m) {
        const prefixLen = m[1].length + 2;
        ta.value = v.slice(0, ls) + m[1] + BULLET + m[2] + v.slice(le);
        const np = pos - prefixLen + m[1].length + BULLET.length;
        ta.selectionStart = ta.selectionEnd = Math.max(ls + m[1].length + BULLET.length, np);
      }
    };
    const onTab = (ev) => {
      const v = ta.value, start = ta.selectionStart, end = ta.selectionEnd;
      const first = lineStart(v, start);
      let last = v.indexOf("\n", Math.max(start, end - 1)); if (last < 0) last = v.length;
      const lines = v.slice(first, last).split("\n");
      if (!lines.some(line => /^\s*\u2022 /.test(line))) return;
      ev.preventDefault();
      let newStart = start, newEnd = end, offset = first;
      const changed = lines.map(line => {
        if (!/^\s*\u2022 /.test(line)) { offset += line.length + 1; return line; }
        let out = line, delta = 0;
        if (ev.shiftKey) {
          const removed = line.match(/^ {1,2}/);
          if (removed) { out = line.slice(removed[0].length); delta = -removed[0].length; }
        } else { out = INDENT + line; delta = INDENT.length; }
        // Keep the caret on the same text; never move it before the line start.
        if (start > offset) newStart = Math.max(offset, newStart + delta);
        if (end > offset) newEnd = Math.max(offset, newEnd + delta);
        offset += line.length + 1;
        return out;
      });
      ta.value = v.slice(0, first) + changed.join("\n") + v.slice(last);
      ta.selectionStart = newStart; ta.selectionEnd = newEnd;
      ta.dispatchEvent(new ta.ownerDocument.defaultView.Event("input", { bubbles: true }));
    };
    const onKeyDown = (ev) => {
      if (ev.isComposing) return;
      if (ev.key === "Tab" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) { onTab(ev); return; }
      if (ev.key !== "Enter" || ev.shiftKey) return;
      const v = ta.value, pos = ta.selectionStart, ls = lineStart(v, pos);
      let le = v.indexOf("\n", pos); if (le < 0) le = v.length;
      const m = v.slice(ls, le).match(/^(\s*)\u2022 (.*)$/);
      if (!m) return;
      ev.preventDefault();
      if (m[2].trim() === "" && pos >= le) {
        ta.value = v.slice(0, ls) + v.slice(le);
        ta.selectionStart = ta.selectionEnd = ls;
      } else {
        const ins = "\n" + m[1] + BULLET;
        ta.value = v.slice(0, pos) + ins + v.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = pos + ins.length;
      }
      ta.dispatchEvent(new ta.ownerDocument.defaultView.Event("input", { bubbles: true }));
    };
    ta.addEventListener("input", onInput);
    ta.addEventListener("keydown", onKeyDown);
    return () => {
      ta.removeEventListener("input", onInput);
      ta.removeEventListener("keydown", onKeyDown);
    };
  }
  return { attachBullets };
});
