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
  // $…$ inline math (Pandoc/Typora rules): no space after the opening $, none before
  // the closing $, and no digit right after it — so "$5 and $10" stays plain text.
  const INLINE_DOLLAR = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/;
  if (window.marked && window.katex) {
    marked.use({ extensions: [
      { name: "mathBlock", level: "block",
        start(src) { const m = src.match(/\\\[|\$\$/); return m ? m.index : undefined; },
        tokenizer(src) { const m = /^\\\[([\s\S]+?)\\\]/.exec(src) || /^\$\$([\s\S]+?)\$\$/.exec(src); if (m) return { type: "mathBlock", raw: m[0], text: m[1] }; },
        renderer(t) { const ph = mathPlaceholder(t.text, true); return ph != null ? ph : "<pre>" + escapeHtml(t.raw) + "</pre>"; } },
      { name: "mathInline", level: "inline",
        start(src) { const m = src.match(/\\\(|(?<!\\)\$(?=\S)/); return m ? m.index : undefined; },
        tokenizer(src) { const m = /^\\\(([\s\S]+?)\\\)/.exec(src) || INLINE_DOLLAR.exec(src); if (m) return { type: "mathInline", raw: m[0], text: m[1] }; },
        renderer(t) { const ph = mathPlaceholder(t.text, false); return ph != null ? ph : escapeHtml(t.raw); } }
    ] });
  }
  // Shared Markdown extensions + numbering hooks (md2docx.js): boxes, callouts, alerts,
  // :::table-*, footnotes, figure/table captions, @refs, [TOC], numbered headings
  if (window.marked && window.MD2DOCX && MD2DOCX.markedConfig) marked.use(MD2DOCX.markedConfig());

  // Tables: right-align all-numeric columns without explicit alignment (same rule as DOCX)
  function enhanceTables(root) {
    $$("table", root).forEach((tb) => {
      const merged = $$("th,td", tb).some((c) => c.colSpan > 1 || c.rowSpan > 1);
      const head = tb.tHead && tb.tHead.rows[0];
      const rows = Array.from(tb.tBodies).flatMap((b) => Array.from(b.rows));
      if (head && rows.length && !merged && window.MD2DOCX && MD2DOCX.isNumericCell) {
        const explicit = (c) => c.getAttribute("align") || (c.style && c.style.textAlign);
        Array.from(head.cells).forEach((hc, i) => {
          if (explicit(hc)) return;
          if (rows.every((r) => r.cells[i] && !explicit(r.cells[i]) && MD2DOCX.isNumericCell(r.cells[i].textContent))) {
            hc.classList.add("num"); rows.forEach((r) => r.cells[i].classList.add("num"));
          }
        });
      }
      if (!tb.parentElement.classList.contains("tbl-wrap")) {
        const w = document.createElement("div"); w.className = "tbl-wrap"; tb.parentNode.insertBefore(w, tb); w.appendChild(tb);
      }
    });
    requestAnimationFrame(() => $$(".tbl-wrap", root).forEach((w) => w.classList.toggle("scroll", w.scrollWidth > w.clientWidth + 1)));
  }

  /* ---------- preview ---------- */
  function render() {
    let html;
    mathStore = [];
    try { html = marked.parse(ta.value || ""); } catch (e) { html = "<p>" + escapeHtml(e.message || "") + "</p>"; }
    preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "id", "class", "align", "data-k"], ADD_TAGS: ["input"] });
    if (mathStore.length) $$(".katex-ph", preview).forEach((ph) => { const i = +ph.getAttribute("data-k"); if (mathStore[i] != null) ph.innerHTML = mathStore[i]; });
    enhanceTables(preview);
    $$("h1,h2,h3,h4,h5,h6", preview).forEach((h, i) => { if (!h.id) h.id = "h-" + i; });
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
    if (findState.active) runFind(false); else schedulePaint();
  }

  // Internal links (TOC, @refs, footnotes) scroll inside the preview
  preview.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    const t = document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    if (!t || !preview.contains(t)) return;
    e.preventDefault(); t.scrollIntoView({ behavior: "smooth", block: "start" });
  });

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
    } else if (msg.type === "importDocx") {
      importDocx(msg.dataBase64);
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
      // No key (prompt cancelled): the host already shows a warning with "Get a free key" / "Open Settings"
      if (!/No DeepL API key/i.test(String(e && e.message))) vscode.postMessage({ type: "error", text: "Translate failed: " + (e && e.message) });
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
  // x² / x₂: wrap in <sup>/<sub>; again → unwrap; the other tag → switch
  function toggleTag(tag) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
    const open = "<" + tag + ">", close = "</" + tag + ">";
    const other = tag === "sup" ? "sub" : "sup";
    const inner = (x, o, c) => x.length >= o.length + c.length && x.startsWith(o) && x.endsWith(c) ? x.slice(o.length, x.length - c.length) : null;
    let t = inner(sel, open, close);
    if (t != null) { replaceSel(t); return; }
    if (v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
      ta.setSelectionRange(s - open.length, e + close.length); replaceSel(sel); return;
    }
    t = inner(sel, "<" + other + ">", "</" + other + ">");
    if (t != null) { replaceSel(open + t + close); return; }
    wrap(open, close, "2");
  }

  /* ---------- popovers: symbols (Ω) and callout menu ---------- */
  let popEl = null;
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener("mousedown", onOutside, true); } }
  function onOutside(e) { if (popEl && !popEl.contains(e.target) && !e.target.closest('[data-cmd="symbols"],[data-cmd="callout"]')) closePop(); }
  function openPop(cmd, html, onPick) {
    const same = popEl && popEl.dataset.cmd === cmd;
    closePop(); if (same) return;
    const btn = $('[data-cmd="' + cmd + '"]');
    popEl = document.createElement("div"); popEl.className = "popover"; popEl.dataset.cmd = cmd; popEl.innerHTML = html;
    document.body.appendChild(popEl);
    const r = btn.getBoundingClientRect();
    popEl.style.top = (r.bottom + 6) + "px";
    popEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popEl.offsetWidth - 8)) + "px";
    popEl.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
    popEl.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) onPick(b.dataset.pick); });
    document.addEventListener("mousedown", onOutside, true);
  }
  const SYM_GROUPS = [["Greek", "α β γ δ ε θ λ μ π ρ σ τ φ ω Δ Σ Ω"], ["Operators", "± × ÷ · ≈ ≠ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ ∇ ∝ °"],
    ["Arrows & logic", "→ ← ↔ ⇒ ⇔ ↑ ↓ ∈ ∉ ⊂ ∪ ∩ ∀ ∃"], ["Indices", "⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉"], ["Units", "°C µm µg mmHg ‰ Ω"]];
  const SYM_TEX = { "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\varepsilon", "θ": "\\theta", "λ": "\\lambda",
    "μ": "\\mu", "π": "\\pi", "ρ": "\\rho", "σ": "\\sigma", "τ": "\\tau", "φ": "\\varphi", "ω": "\\omega", "Δ": "\\Delta", "Σ": "\\Sigma",
    "Ω": "\\Omega", "±": "\\pm", "×": "\\times", "÷": "\\div", "·": "\\cdot", "≈": "\\approx", "≠": "\\neq", "≤": "\\leq", "≥": "\\geq",
    "∞": "\\infty", "√": "\\sqrt{}", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∂": "\\partial", "∇": "\\nabla", "∝": "\\propto",
    "°": "^\\circ", "→": "\\rightarrow", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇔": "\\Leftrightarrow",
    "↑": "\\uparrow", "↓": "\\downarrow", "∈": "\\in", "∉": "\\notin", "⊂": "\\subset", "∪": "\\cup", "∩": "\\cap", "∀": "\\forall", "∃": "\\exists" };
  "⁰¹²³⁴⁵⁶⁷⁸⁹".split("").forEach((c, i) => { SYM_TEX[c] = "^{" + i + "}"; });
  "₀₁₂₃₄₅₆₇₈₉".split("").forEach((c, i) => { SYM_TEX[c] = "_{" + i + "}"; });
  const recent = () => { try { return JSON.parse(store.get("docxmd:symRecent", "[]")) || []; } catch (e) { return []; } };
  function openSymbols() {
    const latex = store.get("docxmd:symLatex", "0") === "1";
    const b = (c) => '<button class="sym" data-pick="' + esc(c) + '" title="' + esc(latex && SYM_TEX[c] ? SYM_TEX[c] : c) + '">' + esc(c) + "</button>";
    const r = recent();
    const html = '<div class="pop-head"><b>Symbols</b><label class="pop-opt"><input type="checkbox" id="symLatex"' + (latex ? " checked" : "") + "> Insert as LaTeX</label></div>" +
      (r.length ? '<div class="sym-group"><span>Recent</span><div class="sym-row">' + r.map(b).join("") + "</div></div>" : "") +
      SYM_GROUPS.map((g) => '<div class="sym-group"><span>' + g[0] + '</span><div class="sym-row">' + g[1].split(" ").map(b).join("") + "</div></div>").join("");
    openPop("symbols", html, (c) => {
      const tex = store.get("docxmd:symLatex", "0") === "1" && SYM_TEX[c];
      ta.focus(); replaceSel(tex ? SYM_TEX[c] + (/[a-z]$/i.test(SYM_TEX[c]) ? " " : "") : c);
      const rr = recent().filter((x) => x !== c); rr.unshift(c); store.set("docxmd:symRecent", JSON.stringify(rr.slice(0, 8)));
    });
    const cb = popEl && popEl.querySelector("#symLatex");
    if (cb) cb.addEventListener("change", () => { store.set("docxmd:symLatex", cb.checked ? "1" : "0"); closePop(); openSymbols(); });
  }
  function openCallouts() {
    const C = (window.MD2DOCX && MD2DOCX.CALLOUTS) || {};
    const html = '<div class="pop-head"><b>Callout block</b></div>' + ["info", "note", "tip", "success", "important", "warning", "danger"].filter((k) => C[k]).map((k) =>
      '<button class="pop-item" data-pick="' + k + '"><i style="background:#' + C[k].color + '"></i>' + C[k].icon + " " + esc(C[k].title.en) + " <code>:::" + k + "</code></button>").join("");
    openPop("callout", html, (k) => {
      closePop();
      const v = ta.value; let s = ta.selectionStart, e = ta.selectionEnd;
      if (s !== e) { s = v.lastIndexOf("\n", s - 1) + 1; const le = v.indexOf("\n", e); e = le === -1 ? v.length : le; }
      const body = v.slice(s, e).trim() || C[k].title.en;
      const pre = s > 0 && v[s - 1] !== "\n" ? "\n\n" : (s > 1 && v[s - 2] !== "\n" ? "\n" : "");
      ta.focus(); ta.setSelectionRange(s, e);
      replaceSel(pre + ":::" + k + "\n" + body + "\n:::\n");
    });
  }

  const cmds = {
    sup: () => toggleTag("sup"),
    sub: () => toggleTag("sub"),
    symbols: () => openSymbols(),
    callout: () => openCallouts(),
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
  window.addEventListener("resize", () => { updatePos(); paintEditor(); });

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
  function clearHighlights() { $$(".find-hit", preview).forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); }); preview.normalize && preview.normalize(); paintEditor(); }

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
  // Editor backdrop (behind the transparent textarea): tints embedded data-URI
  // images at all times, and marks find matches while the find bar is open.
  function paintEditor() {
    if (mode() === "preview") { if (editorBackdrop) editorBackdrop.innerHTML = ""; return; }
    const v = ta.value;
    const q = findState.active ? findInput.value : "";
    const hasImg = v.indexOf("data:") !== -1;
    if (!q && !hasImg) { if (editorBackdrop) editorBackdrop.innerHTML = ""; return; }
    if (!editorBackdrop) {
      editorBackdrop = document.createElement("div");
      editorBackdrop.className = "find-backdrop";
      editorBackdrop.setAttribute("aria-hidden", "true");
      ta.parentElement.insertBefore(editorBackdrop, ta);
    }
    // Mirror the textarea's box metrics so the marks land exactly on the text.
    const cs = getComputedStyle(ta), s = editorBackdrop.style;
    ["fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "tabSize", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"].forEach((p) => { s[p] = cs[p]; });
    s.width = ta.clientWidth + "px"; s.height = ta.clientHeight + "px";
    const hits = [];
    if (q) {
      const lv = v.toLowerCase(), lq = q.toLowerCase();
      let i = 0, from = 0;
      while ((i = lv.indexOf(lq, from)) !== -1) { hits.push([i, i + q.length]); from = i + q.length; }
    }
    const cur = findState.hits.length ? ((findState.idx % findState.hits.length) + findState.hits.length) % findState.hits.length : -1;
    editorBackdrop.innerHTML = window.MD2DOCX && MD2DOCX.backdropHtml ? MD2DOCX.backdropHtml(v, hits, q ? cur : -1, escapeHtml).html : "";
    editorBackdrop.scrollTop = ta.scrollTop; editorBackdrop.scrollLeft = ta.scrollLeft;
  }
  let paintTimer = null;
  function schedulePaint() { clearTimeout(paintTimer); paintTimer = setTimeout(paintEditor, 120); }


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
    else if (mod && e.key === ".") { e.preventDefault(); cmds.sup(); }
    else if (mod && e.key === ",") { e.preventDefault(); cmds.sub(); }
    else if (e.key === "Escape" && popEl) closePop();
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
    if (!window.MD2DOCX || typeof window.MD2DOCX.toBlob !== "function") {
      vscode.postMessage({ type: "error", text: "DOCX engine failed to load. Reinstall the extension and run “Developer: Reload Window”." });
      return;
    }
    const btn = $("#exportBtn"); btn.disabled = true; const label = btn.textContent; btn.textContent = "…";
    try {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const blob = await window.MD2DOCX.toBlob(md, { quoteColor: accent });
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
  /* ---------- Word (.docx) → Markdown (same pipeline as the PWA) ---------- */
  // Flatten block elements inside table cells so GFM tables import on one line
  function cleanDocxHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    tpl.content.querySelectorAll("td p, th p").forEach((p) => {
      const table = p.closest("table");
      if (table && table.hasAttribute("data-docxmd-quote")) return; // becomes a blockquote
      const cell = p.parentNode;
      if (p.previousElementSibling) cell.insertBefore(table && table.hasAttribute("data-docxmd-html") ? document.createElement("br") : document.createTextNode(" "), p);
      while (p.firstChild) cell.insertBefore(p.firstChild, p);
      p.remove();
    });
    return tpl.innerHTML;
  }
  async function importDocx(b64) {
    try {
      if (!window.mammoth || !window.TurndownService) throw new Error("import libraries failed to load");
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const ab = u8.buffer;
      const result = await mammoth.convertToHtml({ arrayBuffer: ab },
        { styleMap: ["p[style-name='Quote'] => blockquote", "p[style-name='Intense Quote'] => blockquote"] });
      const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", strongDelimiter: "**", hr: "---" });
      if (window.turndownPluginGfm) td.use(window.turndownPluginGfm.gfm);
      td.keep(["sub", "sup"]);
      let html = result.value || "";
      if (window.DOCXFMT) { DOCXFMT.tableRule(td); html = DOCXFMT.apply(html, await DOCXFMT.extract(ab)); }
      const md = td.turndown(cleanDocxHtml(html)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
      ta.value = md; render();
      vscode.postMessage({ type: "imported", text: md });
    } catch (e) {
      vscode.postMessage({ type: "error", text: "DOCX import failed: " + (e && e.message) });
    }
  }

  vscode.postMessage({ type: "ready" });
})();
