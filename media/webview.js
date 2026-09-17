/* DOCXMD — VS Code webview controller (custom editor for Markdown) */
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const ta = $("#source");
  const preview = $("#preview");
  const panes = $("#panes");

  let applying = false;      // true while we apply an update from the document (don't echo back)
  let editTimer = null;

  marked.setOptions({ gfm: true, breaks: false });

  /* ---------- preview ---------- */
  function render() {
    let html;
    try { html = marked.parse(ta.value || ""); } catch (e) { html = "<p>" + (e.message || "") + "</p>"; }
    preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "id", "class"], ADD_TAGS: ["input"] });
    preview.querySelectorAll("li").forEach((li) => {
      const i = li.querySelector('input[type="checkbox"]');
      if (i) { li.classList.add("task-list-item"); i.setAttribute("disabled", ""); }
    });
    preview.querySelectorAll('a[href]').forEach((a) => {
      if (/^https?:/i.test(a.getAttribute("href") || "")) { a.target = "_blank"; a.rel = "noopener"; }
    });
    preview.querySelectorAll("pre code").forEach((c) => {
      const m = (c.className || "").match(/language-([\w-]+)/);
      if (m && !hljs.getLanguage(m[1])) return; // unknown language → leave plain (no hljs warning)
      try { hljs.highlightElement(c); } catch (e) {}
    });
  }

  /* ---------- sync with the VS Code document ---------- */
  function pushEdit() {
    if (applying) return;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => vscode.postMessage({ type: "edit", text: ta.value }), 250);
  }
  ta.addEventListener("input", () => { render(); pushEdit(); });

  window.addEventListener("message", (ev) => {
    const msg = ev.data || {};
    if (msg.type === "update") {
      if (msg.text !== ta.value) {
        const pos = ta.selectionStart;
        applying = true;
        ta.value = msg.text;
        try { ta.setSelectionRange(pos, pos); } catch (e) {}
        applying = false;
        render();
      }
    } else if (msg.type === "requestExport") {
      exportDocx();
    }
  });

  /* ---------- toolbar ---------- */
  function replaceSel(text, reselect) {
    ta.focus();
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (e) {}
    if (!ok) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + text.length;
    }
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function wrap(a, b, ph) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || ph || "";
    replaceSel(a + sel + b);
  }
  function eachLine(fn) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e); if (le === -1) le = v.length;
    const out = v.slice(ls, le).split("\n").map(fn).join("\n");
    ta.selectionStart = ls; ta.selectionEnd = le;
    replaceSel(out);
  }
  const cmds = {
    bold: () => wrap("**", "**", "bold"),
    italic: () => wrap("*", "*", "italic"),
    strike: () => wrap("~~", "~~", "strike"),
    code: () => wrap("`", "`", "code"),
    h1: () => eachLine((l) => "# " + l.replace(/^#{1,6}\s*/, "")),
    h2: () => eachLine((l) => "## " + l.replace(/^#{1,6}\s*/, "")),
    h3: () => eachLine((l) => "### " + l.replace(/^#{1,6}\s*/, "")),
    quote: () => eachLine((l) => "> " + l.replace(/^>\s*/, "")),
    ul: () => eachLine((l) => "- " + l.replace(/^[-*+]\s*/, "")),
    ol: () => { let n = 0; eachLine((l) => (++n) + ". " + l.replace(/^\d+\.\s*/, "")); },
    task: () => eachLine((l) => "- [ ] " + l.replace(/^-\s*\[[ x]\]\s*/, "").replace(/^[-*+]\s*/, "")),
    link: () => wrap("[", "](https://)", "text"),
    table: () => replaceSel("\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n")
  };
  $("#toolbar").addEventListener("click", (e) => {
    const b = e.target.closest(".tb"); if (b && cmds[b.dataset.cmd]) cmds[b.dataset.cmd]();
  });
  ta.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); replaceSel("    "); } });

  /* ---------- view mode + theme (persisted) ---------- */
  const modeSel = $("#mode"), themeSel = $("#theme");
  function setMode(m) { panes.className = "panes mode-" + m; modeSel.value = m; save(); }
  function setTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const light = t === "white";
    $("#hljsLight").disabled = !light; $("#hljsDark").disabled = light;
    themeSel.value = t; save();
  }
  function save() { try { vscode.setState({ mode: modeSel.value, theme: themeSel.value }); } catch (e) {} }
  modeSel.addEventListener("change", () => setMode(modeSel.value));
  themeSel.addEventListener("change", () => setTheme(themeSel.value));

  /* ---------- export ---------- */
  function abToB64(buf) {
    const bytes = new Uint8Array(buf); let bin = ""; const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(bin);
  }
  async function exportDocx() {
    const md = ta.value;
    if (!md.trim()) { vscode.postMessage({ type: "error", text: "Document is empty — nothing to export." }); return; }
    const btn = $("#exportBtn"); btn.disabled = true; const label = btn.textContent; btn.textContent = "…";
    try {
      const blob = await window.MD2DOCX.toBlob(md, {});
      const buf = await blob.arrayBuffer();
      vscode.postMessage({ type: "saveDocx", dataBase64: abToB64(buf) });
    } catch (e) {
      vscode.postMessage({ type: "error", text: "DOCX build failed: " + (e && e.message) });
    } finally { btn.disabled = false; btn.textContent = label; }
  }
  $("#exportBtn").addEventListener("click", exportDocx);

  /* ---------- init ---------- */
  const st = (function () { try { return vscode.getState() || {}; } catch (e) { return {}; } })();
  setTheme(st.theme || "dark");
  setMode(st.mode || "split");
  render();
  vscode.postMessage({ type: "ready" });
})();
