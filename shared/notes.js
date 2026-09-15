(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarNotes = api;
})(globalThis, function () {
  "use strict";
  // Bullet lists in notes: typing "- " or "* " at the start of a line becomes a bullet,
  // Enter continues the list, Enter on an empty bullet ends it.
  const BULLET = "\u2022 ";
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
    const onKeyDown = (ev) => {
      if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing) return;
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
