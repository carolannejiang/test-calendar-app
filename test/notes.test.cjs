const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { attachBullets } = require("../shared/notes");

function notesField(t) {
  const { window } = new JSDOM("<textarea></textarea>");
  t.after(() => window.close());
  const textarea = window.document.querySelector("textarea");
  const detach = attachBullets(textarea);
  const enter = (options = {}) => {
    const event = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...options });
    textarea.dispatchEvent(event);
    return event;
  };
  return { window, textarea, detach, enter };
}

test("notes module converts, continues, and ends indented bullets", t => {
  const { window, textarea, enter } = notesField(t);
  let saved;
  textarea.addEventListener("input", () => { saved = textarea.value; });
  textarea.value = "Intro\n  - Reason";
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(saved, "Intro\n  • Reason");
  assert.equal(enter().defaultPrevented, true);
  assert.equal(saved, "Intro\n  • Reason\n  • ");
  enter();
  assert.equal(saved, "Intro\n  • Reason\n");
  assert.equal(textarea.selectionStart, textarea.value.length);
});

test("notes module preserves manual input and can detach its handlers", t => {
  const { window, textarea, detach, enter } = notesField(t);
  textarea.value = "• alpha beta";
  textarea.setSelectionRange(7, 12);
  assert.equal(enter({ shiftKey: true }).defaultPrevented, false);
  assert.equal(enter({ isComposing: true }).defaultPrevented, false);
  enter();
  assert.equal(textarea.value, "• alpha\n• ");
  detach();
  assert.equal(enter().defaultPrevented, false);
  textarea.value = "- untouched";
  textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(textarea.value, "- untouched");
});
