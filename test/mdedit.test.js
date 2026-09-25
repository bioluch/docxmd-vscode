// node --test vscode-extension/test/   (no dependencies)
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext("var window=this.window;" + fs.readFileSync(path.join(__dirname, "../media/mdedit.js"), "utf8"), ctx);
const E = ctx.window.DOCXMDEdit;

// "⁞" marks the caret, "‹…›" the selection, in both input and expected output
function run(src, key) {
  let s = src.indexOf("⁞"), e;
  let t = src.replace("⁞", "");
  if (t.indexOf("‹") >= 0) { s = t.indexOf("‹"); t = t.replace("‹", ""); e = t.indexOf("›"); t = t.replace("›", ""); } else e = s;
  const r = typeof key === "function" ? key(t, s, e) : E.onKey(t, s, e, key);
  if (!r || r.noop) return r;
  const out = r.text != null ? t.slice(0, r.start) + r.text + t.slice(r.end) : t;
  return r.selStart === r.selEnd ? out.slice(0, r.selStart) + "⁞" + out.slice(r.selStart)
    : out.slice(0, r.selStart) + "‹" + out.slice(r.selStart, r.selEnd) + "›" + out.slice(r.selEnd);
}
const ENTER = { key: "Enter" }, TAB = { key: "Tab" }, STAB = { key: "Tab", shift: true };
const noop = (r) => assert.ok(r && r.noop, "expected noop, got " + JSON.stringify(r));

test("Enter continues lists", () => {
  assert.strictEqual(run("- one⁞", ENTER), "- one\n- ⁞");
  assert.strictEqual(run("* a⁞", ENTER), "* a\n* ⁞");
  assert.strictEqual(run("3. three⁞", ENTER), "3. three\n4. ⁞");
  assert.strictEqual(run("1) x⁞", ENTER), "1) x\n2) ⁞");
  assert.strictEqual(run("- [x] done⁞", ENTER), "- [x] done\n- [ ] ⁞");
  assert.strictEqual(run("  - nested⁞", ENTER), "  - nested\n  - ⁞");
  assert.strictEqual(run("- sp⁞lit", ENTER), "- sp\n- ⁞lit");
  assert.strictEqual(run("> - q⁞", ENTER), "> - q\n> - ⁞");
});
test("Enter on an empty item ends / outdents the list", () => {
  assert.strictEqual(run("- a\n- ⁞", ENTER), "- a\n⁞");
  assert.strictEqual(run("- a\n  - ⁞", ENTER), "- a\n- ⁞");
  assert.strictEqual(run("> quote\n> ⁞", ENTER), "> quote\n⁞");
});
test("Enter continues quotes, not code", () => {
  assert.strictEqual(run("> text⁞", ENTER), "> text\n> ⁞");
  assert.strictEqual(run("```\n- x⁞", ENTER), null);
  assert.strictEqual(run("plain⁞", ENTER), null);
  assert.strictEqual(run("-⁞ a", ENTER), null);
});
test("Enter at the end of a table row adds a row", () => {
  assert.strictEqual(run("| a | b |\n| --- | --- |\n| 1 | 2 |⁞", ENTER), "| a | b |\n| --- | --- |\n| 1 | 2 |\n| ⁞ |  |");
});
test("Tab moves between table cells", () => {
  assert.strictEqual(run("| a⁞b | cd |\n|---|---|\n| 1 | 2 |", TAB), "| ab | ‹cd› |\n|---|---|\n| 1 | 2 |");
  assert.strictEqual(run("| ab | cd⁞ |\n|---|---|\n| 1 | 2 |", TAB), "| ab | cd |\n|---|---|\n| ‹1› | 2 |");
  assert.strictEqual(run("| ab | cd |\n|---|---|\n| 1 | 2⁞ |", STAB), "| ab | cd |\n|---|---|\n| ‹1› | 2 |");
  assert.strictEqual(run("| a | b |\n|---|---|\n| 1 | 2⁞ |", TAB), "| a | b |\n|---|---|\n| 1 | 2 |\n| ⁞ |  |");
});
test("Tab / Shift+Tab change list levels", () => {
  assert.strictEqual(run("- a\n- b⁞", TAB), "- a\n  - b⁞");
  assert.strictEqual(run("1. a\n2. b⁞", TAB), "1. a\n   1. b⁞");
  assert.strictEqual(run("- a\n  - b⁞", STAB), "- a\n- b⁞");
  noop(run("- first⁞", TAB));
});
test("Tab outside lists indents", () => {
  assert.strictEqual(run("ab⁞c", TAB), "ab    ⁞c");
  assert.strictEqual(run("‹a\nb›", TAB), "    ‹a\n    b›");
  assert.strictEqual(run("    x⁞", STAB), "x⁞");
});
test("Alt+↑/↓ move lines, Shift+Alt duplicates", () => {
  assert.strictEqual(run("one\ntw⁞o\nthree", { key: "ArrowUp", alt: true }), "tw⁞o\none\nthree");
  assert.strictEqual(run("one\ntw⁞o\nthree", { key: "ArrowDown", alt: true }), "one\nthree\ntw⁞o");
  assert.strictEqual(run("a⁞b", { key: "ArrowDown", alt: true, shift: true }), "ab\na⁞b");
});
test("Ctrl+/ toggles an HTML comment", () => {
  assert.strictEqual(run("te⁞xt", { key: "/", ctrl: true }), "‹<!-- text -->›");
  assert.strictEqual(run("<!-- te⁞xt -->", { key: "/", ctrl: true }), "‹text›");
});
test("pair characters wrap the selection", () => {
  assert.strictEqual(run("a ‹word› b", { key: "*" }), "a *‹word›* b");
  assert.strictEqual(run("a ‹word› b", { key: "=" }), "a ==‹word›== b");
  assert.strictEqual(run("a ‹word› b", { key: "~" }), "a ~~‹word›~~ b");
  assert.strictEqual(run("a w⁞ord", { key: "*" }), null);
});
test("URL pasted on a selection becomes a link", () => {
  assert.strictEqual(run("see ‹docs› now", (t, s, e) => E.pasteLink(t, s, e, "https://x.org/a(b)")), "see [docs](https://x.org/a(b%29)⁞ now");
  assert.strictEqual(run("see ‹docs› now", (t, s, e) => E.pasteLink(t, s, e, "not a url")), null);
});
test("align table", () => {
  const src = "| a | long head |\n|:-|--:|\n| wide cell| 1 |\n|x|22|";
  const r = E.alignTable(src, 0);
  assert.strictEqual(r.text, "| a         | long head |\n| :-------- | --------: |\n| wide cell |         1 |\n| x         |        22 |");
});
test("rich HTML detection", () => {
  assert.ok(E.isRichHtml("<p>Hello <b>x</b></p>"));
  assert.ok(!E.isRichHtml("<div><span style='color:red'>code</span></div>"));
});
