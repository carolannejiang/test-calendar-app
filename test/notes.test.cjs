const { test } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { attachBullets } = require("../shared/notes");

function notesField(t) {
  const { window } = new JSDOM("<textarea></textarea>");
  t.after(() => window.close());
  const textarea = window.document.querySelector("textarea");
  const detach = attachBullets(textarea);
  const key = (key, options = {}) => {
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
    textarea.dispatchEvent(event);
    return event;
  };
  const enter = (options = {}) => key("Enter", options);
  const tab = (options = {}) => key("Tab", options);
  return { window, textarea, detach, enter, tab };
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

test("tab indents bullet lines and shift+tab unindents them", t => {
  const { textarea, tab } = notesField(t);
  let saved;
  textarea.addEventListener("input", () => { saved = textarea.value; });
  textarea.value = "Intro\n\u2022 One\n\u2022 Two";
  textarea.setSelectionRange(11, 11);
  assert.equal(tab().defaultPrevented, true);
  assert.equal(saved, "Intro\n  \u2022 One\n\u2022 Two");
  assert.equal(textarea.selectionStart, 13);
  tab();
  assert.equal(saved, "Intro\n    \u2022 One\n\u2022 Two");
  tab({ shiftKey: true });
  assert.equal(saved, "Intro\n  \u2022 One\n\u2022 Two");
  tab({ shiftKey: true });
  assert.equal(saved, "Intro\n\u2022 One\n\u2022 Two");
  assert.equal(textarea.selectionStart, 11);
  assert.equal(tab({ shiftKey: true }).defaultPrevented, true);
  assert.equal(textarea.value, "Intro\n\u2022 One\n\u2022 Two");
  textarea.setSelectionRange(6, textarea.value.length);
  tab();
  assert.equal(saved, "Intro\n  \u2022 One\n  \u2022 Two");
  assert.equal(textarea.selectionStart, 6);
  assert.equal(textarea.selectionEnd, textarea.value.length);
  textarea.setSelectionRange(2, 2);
  assert.equal(tab().defaultPrevented, false);
  assert.equal(textarea.value, "Intro\n  \u2022 One\n  \u2022 Two");
  textarea.setSelectionRange(8, 8);
  assert.equal(tab({ ctrlKey: true }).defaultPrevented, false);
});
