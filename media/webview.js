/* DOCXMD — VS Code webview controller (custom editor for Markdown)
   Ports the PWA editor features: formatting, alignment, image paste/drop,
   find & replace (with highlight), status bar + quick navigation, HELP. */
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const ta = $("#source");
  const preview = $("#preview");
  const panes = $("#panes");

  let applying = false;      // true while we apply an update from the document (don't echo back)
  let editTimer = null;

  marked.setOptions({ gfm: true, breaks: false });

  function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

  // LaTeX math (KaTeX): catch \(…\) / \[…\] / $$…$$ with marked extensions and
  // inject the rendered HTML after DOMPurify (trusted output).
  let mathStore = [];
  function mathPlaceholder(tex, display) {
    if (!window.katex) return null;
    let html;
    try { html = katex.renderToString(String(tex).trim(), { displayMode: display, throwOnError: false, strict: false }); }
    catch (e) { return null; }
    const i = mathStore.length; mathStore.push(html);
    return display ? '<div class="katex-ph" data-k="' + i + '"></div>' : '<span class="katex-ph" data-k="' + i + '"></span>';
  }
  if (window.marked && window.katex) {
    marked.use({ extensions: [
      { name: "mathBlock", level: "block",
        start(src) { const m = src.match(/\\\[|\$\$/); return m ? m.index : undefined; },
        tokenizer(src) { const m = /^\\\[([\s\S]+?)\\\]/.exec(src) || /^\$\$([\s\S]+?)\$\$/.exec(src); if (m) return { type: "mathBlock", raw: m[0], text: m[1] }; },
        renderer(t) { const ph = mathPlaceholder(t.text, true); return ph != null ? ph : "<pre>" + escapeHtml(t.raw) + "</pre>"; } },
      { name: "mathInline", level: "inline",
        start(src) { const m = src.match(/\\\(/); return m ? m.index : undefined; },
        tokenizer(src) { const m = /^\\\(([\s\S]+?)\\\)/.exec(src); if (m) return { type: "mathInline", raw: m[0], text: m[1] }; },
        renderer(t) { const ph = mathPlaceholder(t.text, false); return ph != null ? ph : escapeHtml(t.raw); } }
    ] });
  }

  /* ---------- preview ---------- */
  function render() {
    let html;
    mathStore = [];
    try { html = marked.parse(ta.value || ""); } catch (e) { html = "<p>" + escapeHtml(e.message || "") + "</p>"; }
    preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "id", "class", "align", "data-k"], ADD_TAGS: ["input"] });
    if (mathStore.length) $$(".katex-ph", preview).forEach((ph) => { const i = +ph.getAttribute("data-k"); if (mathStore[i] != null) ph.innerHTML = mathStore[i]; });
    $$("li", preview).forEach((li) => {
      const i = li.querySelector('input[type="checkbox"]');
      if (i) { li.classList.add("task-list-item"); i.setAttribute("disabled", ""); }
    });
    $$('a[href]', preview).forEach((a) => {
      if (/^https?:/i.test(a.getAttribute("href") || "")) { a.target = "_blank"; a.rel = "noopener"; }
    });
    $$("pre code", preview).forEach((c) => {
      const m = (c.className || "").match(/language-([\w-]+)/);
      if (m && !hljs.getLanguage(m[1])) return;
      try { hljs.highlightElement(c); } catch (e) {}
    });
    updateStats();
    if (findState.active) runFind(false);
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
    } else if (msg.type === "deeplResult") {
      const p = __tlPending[msg.id];
      if (p) { delete __tlPending[msg.id]; msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.translations || []); }
    }
  });

  /* ---------- translation (DeepL via the extension host) ---------- */
  let __tlSeq = 0; const __tlPending = {};
  window.__deeplTransport = function (chunk, target, source) {
    return new Promise((resolve, reject) => {
      const id = ++__tlSeq; __tlPending[id] = { resolve, reject };
      vscode.postMessage({ type: "deepl", id: id, text: chunk, target: target, source: source });
    });
  };
  const tlSel = $("#translate");
  if (tlSel) tlSel.addEventListener("change", async () => {
    const target = tlSel.value; tlSel.value = "";
    if (!target || !window.MDTranslate) return;
    const md = ta.value;
    if (!md.trim()) { vscode.postMessage({ type: "info", text: "Nothing to translate." }); return; }
    tlSel.disabled = true;
    try {
      const out = await MDTranslate.run(md, { target: target, provider: "deepl" });
      vscode.postMessage({ type: "openTranslated", text: out, lang: target });
    } catch (e) {
      vscode.postMessage({ type: "error", text: "Translate failed: " + (e && e.message) });
    } finally { tlSel.disabled = false; }
  });

  /* ---------- editing helpers ---------- */
  function replaceSel(text) {
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
  // Alignment: wrap the block in <div align="…"> (toggle off with the active one / left).
  const ALIGN_WRAP = /^\s*<div align="(left|right|center|justify)">\s*\n([\s\S]*?)\n\s*<\/div>\s*$/;
  function alignBlock(kind) {
    const v = ta.value;
    let s = ta.selectionStart, e = ta.selectionEnd;
    s = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e); e = le === -1 ? v.length : le;
    const block = v.slice(s, e);
    const m = block.match(ALIGN_WRAP);
    const existing = m ? m[1] : null;
    const inner = (m ? m[2] : block).trim();
    if (!inner) return;
    const out = (kind === "left" || existing === kind) ? inner : '<div align="' + kind + '">\n\n' + inner + '\n\n</div>';
    ta.focus(); ta.setSelectionRange(s, e); replaceSel(out);
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
    table: () => replaceSel("\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n"),
    alignLeft: () => alignBlock("left"),
    alignCenter: () => alignBlock("center"),
    alignRight: () => alignBlock("right"),
    alignJustify: () => alignBlock("justify")
  };
  $("#toolbar").addEventListener("click", (e) => {
    const b = e.target.closest(".tb"); if (b && cmds[b.dataset.cmd]) cmds[b.dataset.cmd]();
  });
  ta.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); replaceSel("    "); } });

  /* ---------- images: paste & drag-drop → embed as data-URI ---------- */
  function humanSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function insertImageFile(file) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onerror = () => resolve();
      r.onload = () => {
        const alt = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[\[\]\(\)\r\n]/g, " ").trim() || "image";
        const s = ta.selectionStart;
        const atLineStart = s === 0 || ta.value[s - 1] === "\n";
        replaceSel((atLineStart ? "" : "\n") + "![" + alt + "](" + r.result + ")\n");
        vscode.postMessage({ type: "info", text: "Image embedded (" + humanSize(file.size) + ")" });
        resolve();
      };
      r.readAsDataURL(file);
    });
  }
  const isImageFile = (f) => f && /^image\//.test(f.type || "");
  ta.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imgs = [];
    for (const it of items) { if (it.kind === "file" && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (!imgs.length) return;
    e.preventDefault(); imgs.forEach(insertImageFile);
  });
  ["dragover", "drop"].forEach((ev) => panes.addEventListener(ev, (e) => e.preventDefault()));
  panes.addEventListener("drop", async (e) => {
    const files = e.dataTransfer && e.dataTransfer.files; if (!files || !files.length) return;
    if (isImageFile(files[0])) { for (const f of files) if (isImageFile(f)) await insertImageFile(f); }
  });

  /* ---------- status bar + quick navigation ---------- */
  function updateStats() {
    const md = ta.value;
    const words = (md.match(/\S+/g) || []).length;
    $("#stWords").textContent = words;
    $("#stChars").textContent = md.length;
    $("#stLines").textContent = md ? md.split("\n").length : 0;
    $("#stRead").textContent = Math.max(1, Math.ceil(words / 200));
    updatePos();
  }
  function mode() { return panes.className.replace("panes mode-", ""); }
  function activeScroller() { return mode() === "preview" ? preview : ta; }
  function updatePos() {
    const sc = activeScroller();
    const max = sc.scrollHeight - sc.clientHeight;
    const pct = max > 0 ? Math.round((sc.scrollTop / max) * 100) : 0;
    $("#stPos").textContent = pct + "%";
    $("#posfill").style.width = pct + "%";
  }
  function scrollToFraction(f) {
    const sc = activeScroller();
    const max = sc.scrollHeight - sc.clientHeight;
    sc.scrollTo({ top: Math.max(0, Math.min(1, f)) * max, behavior: "smooth" });
  }
  $("#navTop").addEventListener("click", () => scrollToFraction(0));
  $("#navBottom").addEventListener("click", () => scrollToFraction(1));
  $("#posbar").addEventListener("click", (e) => { const r = e.currentTarget.getBoundingClientRect(); scrollToFraction((e.clientX - r.left) / r.width); });
  ta.addEventListener("scroll", () => { if (editorBackdrop) { editorBackdrop.scrollTop = ta.scrollTop; editorBackdrop.scrollLeft = ta.scrollLeft; } if (mode() !== "preview") updatePos(); });
  preview.addEventListener("scroll", () => { if (mode() === "preview") updatePos(); });
  window.addEventListener("resize", () => { updatePos(); if (findState.active) paintEditor(); });

  /* ---------- find & replace ---------- */
  const findbar = $("#findbar"), findInput = $("#findInput"), replaceInput = $("#replaceInput"), findCount = $("#findCount");
  const findState = { active: false, hits: [], idx: -1, positioned: false };
  let editorBackdrop = null;
  function toggleFind(force) {
    findState.active = force != null ? force : !findState.active;
    findbar.classList.toggle("show", findState.active);
    $("#findBtn").classList.toggle("active", findState.active);
    if (findState.active) { findState.idx = -1; findState.positioned = false; findInput.focus(); findInput.select(); runFind(false); }
    else { clearHighlights(); }
  }
  function clearHighlights() { $$(".find-hit", preview).forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); }); preview.normalize && preview.normalize(); if (editorBackdrop) editorBackdrop.innerHTML = ""; }

  function paintPreview(scrollCurrent) {
    clearHighlights();
    const q = findInput.value;
    if (!q || !findState.active || mode() === "source") return;
    const lq = q.toLowerCase(), targets = [];
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.parentNode) return NodeFilter.FILTER_REJECT;
        const tag = n.parentNode.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
        return n.nodeValue.toLowerCase().indexOf(lq) !== -1 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node; while ((node = walker.nextNode())) targets.push(node);
    const marks = [];
    targets.forEach((textNode) => {
      const text = textNode.nodeValue, lower = text.toLowerCase(), frag = document.createDocumentFragment();
      let i = 0, from = 0;
      while ((i = lower.indexOf(lq, from)) !== -1) {
        if (i > from) frag.appendChild(document.createTextNode(text.slice(from, i)));
        const mark = document.createElement("mark"); mark.className = "find-hit"; mark.textContent = text.slice(i, i + q.length);
        frag.appendChild(mark); marks.push(mark); from = i + q.length;
      }
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
    if (marks.length && findState.idx >= 0) {
      const cur = marks[((findState.idx % marks.length) + marks.length) % marks.length];
      if (cur) {
        cur.classList.add("find-current");
        if (scrollCurrent) {
          const pv = preview, cRect = pv.getBoundingClientRect(), mRect = cur.getBoundingClientRect();
          pv.scrollTop = Math.max(0, pv.scrollTop + (mRect.top - cRect.top) - pv.clientHeight * 0.35);
        }
      }
    }
  }

  let findMirror = null;
  function caretOffsetY(index) {
    if (!findMirror) { findMirror = document.createElement("div"); findMirror.setAttribute("aria-hidden", "true"); document.body.appendChild(findMirror); }
    const cs = getComputedStyle(ta), m = findMirror.style; m.cssText = "";
    ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "tabSize", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].forEach((p) => { m[p] = cs[p]; });
    m.position = "absolute"; m.visibility = "hidden"; m.whiteSpace = "pre-wrap"; m.overflowWrap = "break-word"; m.wordWrap = "break-word";
    m.boxSizing = "border-box"; m.width = ta.clientWidth + "px"; m.top = "0"; m.left = "-9999px";
    findMirror.textContent = ta.value.slice(0, index);
    const marker = document.createElement("span"); marker.textContent = "​"; findMirror.appendChild(marker);
    return marker.offsetTop;
  }
  function paintEditor() {
    if (!findState.active || mode() === "preview") { if (editorBackdrop) editorBackdrop.innerHTML = ""; return; }
    if (!editorBackdrop) {
      editorBackdrop = document.createElement("div"); editorBackdrop.className = "find-backdrop"; editorBackdrop.setAttribute("aria-hidden", "true");
      ta.parentElement.insertBefore(editorBackdrop, ta);
    }
    const cs = getComputedStyle(ta), s = editorBackdrop.style;
    ["fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "tabSize", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"].forEach((p) => { s[p] = cs[p]; });
    s.width = ta.clientWidth + "px"; s.height = ta.clientHeight + "px";
    const q = findInput.value;
    if (!q) { editorBackdrop.innerHTML = ""; return; }
    const v = ta.value, lv = v.toLowerCase(), lq = q.toLowerCase();
    const cur = findState.hits.length ? ((findState.idx % findState.hits.length) + findState.hits.length) % findState.hits.length : -1;
    let html = "", from = 0, i = 0, n = 0;
    while ((i = lv.indexOf(lq, from)) !== -1) {
      html += escapeHtml(v.slice(from, i));
      html += '<mark class="find-hit' + (n === cur ? " find-current" : "") + '">' + escapeHtml(v.slice(i, i + q.length)) + "</mark>";
      from = i + q.length; n++;
    }
    html += escapeHtml(v.slice(from)) + "\n";
    editorBackdrop.innerHTML = html;
    editorBackdrop.scrollTop = ta.scrollTop; editorBackdrop.scrollLeft = ta.scrollLeft;
  }

  function runFind(jump, keepInputFocus) {
    const q = findInput.value, v = ta.value;
    findState.hits = [];
    if (q) { let i = 0; const lq = q.toLowerCase(), lv = v.toLowerCase(); while ((i = lv.indexOf(lq, i)) !== -1) { findState.hits.push(i); i += Math.max(q.length, 1); } }
    if (!findState.hits.length) { findState.idx = -1; findCount.textContent = q ? "No matches" : ""; paintPreview(false); paintEditor(); return; }
    if (findState.idx < 0 || findState.idx >= findState.hits.length) findState.idx = 0;
    findCount.textContent = (findState.idx + 1) + " / " + findState.hits.length;
    if (jump && mode() !== "preview") {
      const start = findState.hits[findState.idx];
      ta.setSelectionRange(start, start + q.length);
      if (!keepInputFocus) ta.focus();
      ta.scrollTop = Math.max(0, caretOffsetY(start) - ta.clientHeight * 0.35);
    }
    paintPreview(jump); paintEditor();
  }
  function stepFind(reverse) {
    runFind(false);
    if (!findState.hits.length) return;
    if (findState.positioned) findState.idx = reverse ? (findState.idx - 1 + findState.hits.length) % findState.hits.length : (findState.idx + 1) % findState.hits.length;
    else findState.positioned = true;
    runFind(true);
  }
  function replaceCurrent() {
    const q = findInput.value; if (!q) return;
    const r = replaceInput.value; runFind(false);
    if (!findState.hits.length) { findCount.textContent = "No matches"; return; }
    if (findState.idx < 0 || findState.idx >= findState.hits.length) findState.idx = 0;
    const v = ta.value, start = findState.hits[findState.idx];
    ta.value = v.slice(0, start) + r + v.slice(start + q.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    const from = start + r.length; runFind(false);
    if (!findState.hits.length) { findCount.textContent = "No matches"; replaceInput.focus(); return; }
    const next = findState.hits.findIndex((p) => p >= from);
    findState.idx = next === -1 ? 0 : next; findState.positioned = true;
    runFind(true, true); replaceInput.focus();
  }
  findInput.addEventListener("input", () => { findState.idx = -1; findState.positioned = false; runFind(true, true); });
  findInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey); } });
  replaceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); replaceCurrent(); } });
  $("#findNext").addEventListener("click", () => stepFind(false));
  $("#findPrev").addEventListener("click", () => stepFind(true));
  $("#findClose").addEventListener("click", () => toggleFind(false));
  $("#replaceAllBtn").addEventListener("click", () => {
    const q = findInput.value; if (!q) return;
    const r = replaceInput.value, v = ta.value, lq = q.toLowerCase(), lv = v.toLowerCase();
    let out = "", i = 0, from = 0, count = 0;
    while ((i = lv.indexOf(lq, from)) !== -1) { out += v.slice(from, i) + r; from = i + q.length; count++; }
    out += v.slice(from);
    if (count) { ta.value = out; ta.dispatchEvent(new Event("input", { bubbles: true })); }
    findState.idx = -1; findState.positioned = false; runFind(false);
  });
  $("#findBtn").addEventListener("click", () => toggleFind());
  $("#helpBtn").addEventListener("click", () => vscode.postMessage({ type: "openExternal", url: "https://docxmd.pp.ua/?help=1" }));
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); toggleFind(true); }
    else if (e.key === "Escape" && findState.active) toggleFind(false);
  });

  /* ---------- view mode + theme (persisted) ---------- */
  const modeSel = $("#mode"), themeSel = $("#theme");
  function setMode(m) { panes.className = "panes mode-" + m; modeSel.value = m; if (findState.active) runFind(false); requestAnimationFrame(updatePos); save(); }
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
