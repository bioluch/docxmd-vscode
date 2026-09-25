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

// ---- text style (0.3.0) ----
const apply = (t, r) => (r ? t.slice(0, r.start) + r.text + t.slice(r.end) : t);
test("styleSpan wraps the selection and keeps only its text selected", () => {
  const t = "Hello world here", r = E.styleSpan(t, 6, 11, "color", "#FF0000");
  const u = apply(t, r);
  assert.strictEqual(u, 'Hello <span style="color:#FF0000">world</span> here');
  assert.strictEqual(u.slice(r.selStart, r.selEnd), "world");
});
test("styleSpan updates the span around exactly the selection (no nesting) and removes it when empty", () => {
  let t = 'Hello <span style="color:#FF0000">world</span> here';
  const s = t.indexOf("world");
  let r = E.styleSpan(t, s, s + 5, "font-size", "14pt"); t = apply(t, r);
  assert.strictEqual(t, 'Hello <span style="color:#FF0000;font-size:14pt">world</span> here');
  r = E.styleSpan(t, r.selStart, r.selEnd, "color", ""); t = apply(t, r);
  r = E.styleSpan(t, r.selStart, r.selEnd, "font-size", ""); t = apply(t, r);
  assert.strictEqual(t, "Hello world here");
});
test("styleSpan works line by line: list markers, table cells, no code", () => {
  const t = "- one\n\n| a | b |\n|---|---|\n\n```\ncode\n```\n";
  const u = apply(t, E.styleSpan(t, 0, t.length, "font-size", "8pt"));
  assert.ok(u.startsWith('- <span style="font-size:8pt">one</span>'));
  assert.ok(u.includes('| <span style="font-size:8pt">a</span> | <span style="font-size:8pt">b</span> |'));
  assert.ok(u.includes("|---|---|") && u.includes("```\ncode\n```"));
});
test("setFrontMatter creates, changes and removes document settings", () => {
  let t = "# T\n", r = E.setFrontMatter(t, "font-size", "12pt", 0, 0); t = apply(t, r);
  assert.strictEqual(t, "---\nfont-size: 12pt\n---\n\n# T\n");
  r = E.setFrontMatter(t, "font", "Times New Roman", 0, 0); t = apply(t, r);
  assert.ok(t.includes("font: Times New Roman"));
  t = apply(t, E.setFrontMatter(t, "font", "", 0, 0));
  t = apply(t, E.setFrontMatter(t, "font-size", "", 0, 0));
  assert.strictEqual(t, "# T\n");
});
