/* DOCXMD — VS Code webview controller (custom editor for Markdown)
   Ports the PWA editor: formatting, highlights, alignment, callouts, symbols, image
   paste/drop/resize, find & replace (regex / case / whole word), outline, synced
   scrolling, editing in the preview, Document menu (TOC, numbering, footnote,
   caption, statistics, HTML export), status bar + quick navigation, localized UI. */
(function () {
  "use strict";
  const vscode = acquireVsCodeApi();
  const $ = (s) => document.querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const ta = $("#source");
  const preview = $("#preview");
  const panes = $("#panes");

  /* ---------- interface language (same strings as the web app) ---------- */
  const LANG = document.documentElement.getAttribute("data-lang") || "en";
  if (window.I18N) I18N.set(LANG);
  const t = (k, v) => (window.I18N ? I18N.t(k, v) : k);
  function translateUI() {
    $$("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
    $$("[data-tt]").forEach((n) => { n.title = t(n.dataset.tt); n.setAttribute("aria-label", n.title); });
    $$("[data-ttph]").forEach((n) => { n.placeholder = t(n.dataset.ttph); n.setAttribute("aria-label", n.placeholder); });
    document.documentElement.setAttribute("lang", window.I18N ? I18N.lang : "en");
  }
  translateUI();

  let applying = false;      // true while we apply an update from the document (don't echo back)
  let docBase = "";          // webview URI of the document's folder ("" for untitled documents)
  let docName = "document";  // file name without extension (export titles)
  const isRelative = (src) => !!src && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src);
  const resolveRel = (src) => (docBase && isRelative(src) ? docBase + src.replace(/^\.\//, "") : src);
  let editTimer = null;
  const ED = {      // editor preferences (Document menu)
    syntax: () => store.get("docxmd:ed.syntax", "1") === "1",
    lines: () => store.get("docxmd:ed.lineNumbers", "0") === "1",
    pasteHtml: () => store.get("docxmd:ed.pasteHtml", "1") === "1"
  };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  const esc = escapeHtml;
  function info(text) { vscode.postMessage({ type: "info", text }); }

  // Drag-resize images in the preview; the width is written back into the source
  const imgResize = window.DOCXMDImageResize ? DOCXMDImageResize.attach({
    preview,
    getText: () => ta.value,
    applyEdit(start, end, text) { editRange(start, end, text); },
    label: (k) => t(k)
  }) : { refresh() {} };

  marked.setOptions({ gfm: true, breaks: false });

  // LaTeX math (KaTeX): catch \(…\) / \[…\] / $$…$$ with marked extensions and
  // inject the rendered HTML after DOMPurify (trusted output).
  let mathStore = [];
  let mathOutput = "htmlAndMathml";   // "mathml" while building the standalone HTML export
  function mathPlaceholder(tex, display) {
    if (!window.katex) return null;
    let html;
    try { html = katex.renderToString(String(tex).trim(), { displayMode: display, throwOnError: false, strict: false, output: mathOutput }); }
    catch (e) { return null; }
    const i = mathStore.length; mathStore.push(html);
    return display ? '<div class="katex-ph" data-k="' + i + '"></div>' : '<span class="katex-ph" data-k="' + i + '"></span>';
  }
  // $…$ inline math (Pandoc/Typora rules): no space after the opening $, none before
  // the closing $, and no digit right after it — so "$5 and $10" stays plain text.
  const INLINE_DOLLAR = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<![\s\\])\$(?!\d)/;
  if (window.marked && window.katex) {
    marked.use({ extensions: [
      // Display math \[ … \] / $$ … $$ — only where a block can start (line start), never
      // across a blank line, and \] must end its line. Markdown-escaped brackets such as
      // "!\[\](images/…)" or "\[\[file\]\]" (common after a Word import) stay text.
      { name: "mathBlock", level: "block",
        start(src) { const m = src.match(/(?:^|\n)[ \t]{0,3}(?:\\\[|\$\$)/); return m ? m.index + (m[0][0] === "\n" ? 1 : 0) : undefined; },
        tokenizer(src) {
          const m = /^[ \t]{0,3}\\\[((?:(?!\n[ \t]*\n)[\s\S])+?)\\\][ \t]*(?=\n|$)/.exec(src) || /^[ \t]{0,3}\$\$((?:(?!\n[ \t]*\n)[^$])+?)\$\$/.exec(src);
          if (m) return { type: "mathBlock", raw: m[0], text: m[1] };
        },
        renderer(tk) { const ph = mathPlaceholder(tk.text, true); return ph != null ? ph : "<pre>" + escapeHtml(tk.raw) + "</pre>"; } },
      { name: "mathInline", level: "inline",
        start(src) { const m = src.match(/\\\(|(?<!\\)\$/); return m ? m.index : undefined; },
        tokenizer(src) {
          const d = /^\$\$([^$\n]+?)\$\$/.exec(src);      // $$…$$ mid-line: displayed, paragraph kept
          if (d) return { type: "mathInline", raw: d[0], text: d[1], display: true };
          const m = /^\\\(((?:(?!\n[ \t]*\n)[\s\S])+?)\\\)/.exec(src) || INLINE_DOLLAR.exec(src);
          if (m) return { type: "mathInline", raw: m[0], text: m[1] };
        },
        renderer(tk) { const ph = mathPlaceholder(tk.text, !!tk.display); return ph != null ? ph : escapeHtml(tk.raw); } }
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

  /* ---------- editing in the preview (shared with the PWA: previewedit.js) ---------- */
  let tableEdit = null;      // DOCXMDTableEdit (attached below, refreshed after every render)
  // Embedded pictures (data-URIs) live outside the editor text (media/embedfold.js): the textarea
  // holds #embedded-image-N tokens; the VS Code document always gets the full text (docText()).
  const FOLD = window.DOCXMDFold || null, IMGS = FOLD ? FOLD.store() : null;
  const foldText = (x) => (FOLD ? FOLD.fold(x, IMGS) : x);
  const docText = () => (FOLD ? FOLD.expand(ta.value, IMGS) : ta.value);
  const PE = window.DOCXMDPreviewEdit ? DOCXMDPreviewEdit.attach({
    preview,
    getText: () => ta.value,
    editRange: (s, e, text) => editRange(s, e, text),
    render: () => renderNow(),
    enabled: () => store.get("docxmd:previewEdit", "1") === "1" && mode() !== "source",
    t: (k) => t(k),
    toast: (m) => info(m),
    pasteHtml: () => ED.pasteHtml()
  }) : { beforeRender() {}, annotateBlocks() {}, setBlocks() {}, close() {}, hideHandle() {}, busy: () => false };

  // Tables in the preview: column widths, table width, row heights, position, cell alignment
  tableEdit = window.DOCXMDTableEdit ? DOCXMDTableEdit.attach({
    preview, getText: () => ta.value,
    editRange: (s, e, text) => editRange(s, e, text), render: () => renderNow(), pe: PE,
    enabled: () => mode() !== "source" && store.get("docxmd:previewEdit", "1") === "1",
    t: (k, v) => t(k, v), toast: (m) => info(m)
  }) : null;

  // Toolbar text style: font, size, colour — of the selection, or of the whole document
  // (front matter) when nothing is selected; also in Preview mode (media/textstyle.js)
  if (window.DOCXMDTextStyle) DOCXMDTextStyle.attach({
    root: $("#toolbar"), source: ta, pe: PE, previewEl: preview,
    isPreview: () => mode() === "preview",
    editRange: (s, e, text) => editRange(s, e, text),
    render: () => renderNow(),
    afterEdit: () => { if (typeof syncActiveLine === "function") syncActiveLine(); },
    t: (k, v) => t(k, v), toast: (m) => info(m)
  });

  /* ---------- preview ---------- */
  let renderTimer = null;
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 160); }
  function renderNow() { clearTimeout(renderTimer); render(); }
  function render() {
    clearTimeout(renderTimer);
    PE.beforeRender();
    const md = ta.value || "";
    let html;
    mathStore = [];
    const marks = !!(window.MD2DOCX && MD2DOCX.setBlockMarks);
    if (marks) MD2DOCX.setBlockMarks(true);
    try { html = marked.parse(md); } catch (e) { html = "<p>" + escapeHtml(e.message || "") + "</p>"; }
    if (marks) { MD2DOCX.setBlockMarks(false); PE.setBlocks(MD2DOCX.blocks(), md); }
    preview.innerHTML = DOMPurify.sanitize(html, { ADD_ATTR: ["target", "id", "class", "align", "data-k", "data-b"], ADD_TAGS: ["input"] });
    if (window.MD2DOCX && MD2DOCX.applyDocFont) MD2DOCX.applyDocFont(preview, md);   // front matter font / font-size
    PE.annotateBlocks(preview);
    if (mathStore.length) $$(".katex-ph", preview).forEach((ph) => { const i = +ph.getAttribute("data-k"); if (mathStore[i] != null) ph.innerHTML = mathStore[i]; });
    enhanceTables(preview);
    if (tableEdit) tableEdit.refresh();
    imgResize.refresh();       // remembers each image's Markdown src first…
    // embedded pictures: #embedded-image-N → an object URL made once per picture
    if (FOLD) $$("img", preview).forEach((im) => { const s = im.getAttribute("src"); if (FOLD.isToken(s)) { const u = FOLD.urlOf(IMGS, s); if (u) im.src = u; } });
    // …then relative pictures (images/image-001.png) load from the document's folder
    if (docBase) $$("img", preview).forEach((im) => { const s = im.getAttribute("src"); if (isRelative(s)) im.setAttribute("src", resolveRel(s)); });
    const heads = $$("h1,h2,h3,h4,h5,h6", preview);
    heads.forEach((h, i) => { if (!h.id) h.id = "hx-" + i; });
    if (window.MD2DOCX && MD2DOCX.fixPreviewLinks) MD2DOCX.fixPreviewLinks(preview);
    $$("li", preview).forEach((li) => {
      const i = li.querySelector('input[type="checkbox"]');
      if (i && i.closest("li") === li) { li.classList.add("task-list-item"); i.setAttribute("disabled", ""); }
    });
    $$('a[href]', preview).forEach((a) => {
      if (/^https?:/i.test(a.getAttribute("href") || "")) { a.target = "_blank"; a.rel = "noopener"; }
    });
    $$("pre code", preview).forEach((c) => {
      const m = (c.className || "").match(/language-([\w-]+)/);
      if (m && !hljs.getLanguage(m[1])) return;
      try { hljs.highlightElement(c); } catch (e) {}
    });
    buildOutline(heads);
    updateStats();
    if (findState.active) runFind(false); else schedulePaint();
  }

  // Internal links (TOC, @refs, footnotes) scroll inside the preview
  preview.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]'); if (!a) return;
    let id = a.getAttribute("href").slice(1);
    try { id = decodeURIComponent(id); } catch (x) {}
    const tg = document.getElementById(id);
    if (!tg || !preview.contains(tg)) return;
    e.preventDefault(); suppressSync(); tg.scrollIntoView({ behavior: "smooth", block: "start" });
    tg.classList.remove("flash"); void tg.offsetWidth; tg.classList.add("flash");
  });

  /* ---------- sync with the VS Code document ---------- */
  // Every local change is posted with the full text; the host turns it into a minimal
  // edit and never echoes our own text back (see extension.js), so fast typing is
  // not overwritten by a stale round-trip.
  function flushEdit() {
    clearTimeout(editTimer); editTimer = null;
    vscode.postMessage({ type: "edit", text: docText() });
  }
  function pushEdit() {
    if (applying) return;
    clearTimeout(editTimer);
    editTimer = setTimeout(flushEdit, 200);
  }
  ta.addEventListener("input", () => { scheduleRender(); if (ED.syntax() || ED.lines()) paintEditor(); else schedulePaint(); pushEdit(); });
  ta.addEventListener("blur", () => { if (editTimer) flushEdit(); });

  window.addEventListener("message", (ev) => {
    const msg = ev.data || {};
    if (msg.type === "update" && msg.name) docName = msg.name;
    const incoming = msg.type === "update" && typeof msg.text === "string" ? foldText(msg.text) : null;
    if (msg.type === "update" && msg.base != null && msg.base !== docBase) { docBase = msg.base; if (incoming === ta.value) render(); }
    if (msg.type === "imageSaved") { const p = __imgPending[msg.id]; if (p) { delete __imgPending[msg.id]; p(msg.path || null); } return; }
    if (msg.type === "update") {
      if (incoming !== ta.value) {
        // an external change (VS Code undo, another editor, git…) wins over an unsent local burst
        clearTimeout(editTimer); editTimer = null;
        const s = ta.selectionStart, e = ta.selectionEnd, top = ta.scrollTop;
        applying = true;
        ta.value = incoming;
        try { ta.setSelectionRange(Math.min(s, ta.value.length), Math.min(e, ta.value.length)); } catch (x) {}
        ta.scrollTop = top;
        applying = false;
        render();
      }
    } else if (msg.type === "importDocx") {
      importDocx(msg.dataBase64, msg.name || "");
    } else if (msg.type === "requestExport") {
      exportDocx();
    } else if (msg.type === "requestExportHtml") {
      exportHtml();
    } else if (msg.type === "requestFlush") {
      if (editTimer) flushEdit();
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
    if (!md.trim()) { info(t("toast.empty")); return; }
    tlSel.disabled = true;
    try {
      const out = await MDTranslate.run(md, { target: target, provider: "deepl" });
      vscode.postMessage({ type: "openTranslated", text: FOLD ? FOLD.expand(out, IMGS) : out, lang: target });   // a new document gets the real pictures
    } catch (e) {
      // No key (prompt cancelled): the host already shows a warning with "Get a free key" / "Open Settings"
      if (!/No DeepL API key/i.test(String(e && e.message))) vscode.postMessage({ type: "error", text: "Translate failed: " + (e && e.message) });
    } finally { tlSel.disabled = false; }
  });

  /* ---------- editing helpers (every change lands on the textarea's undo stack) ---------- */
  // In Preview mode the editor is display:none, where execCommand does nothing —
  // show it invisibly for the duration of the edit (.edit-shadow in webview.css).
  function withEditor(fn) {
    const hidden = !ta.offsetParent;
    if (hidden) panes.classList.add("edit-shadow");
    try { return fn(); }
    finally { if (hidden) { panes.classList.remove("edit-shadow"); try { ta.blur(); } catch (e) {} } }
  }
  // Chrome fires an "input" event for every line of a multi-line execCommand insert: while we
  // insert, those events are stopped before any handler runs, and exactly one is sent afterwards.
  let bulkEdit = false;
  ta.addEventListener("input", (e) => { if (bulkEdit) e.stopImmediatePropagation(); }, true);
  // Chrome reveals the caret after every line of a multi-line insert / undo and walks all the
  // scrolling ancestors each time — a relayout of the whole page per line (a table edit in a big
  // document took half a minute). Pinned in place (position:fixed at the same spot) the editor
  // has no scrolling ancestors: the same edit takes a fraction of a second.
  let pinDepth = 0, pinSaved = null;
  function pinEditor() {
    if (pinDepth++) return;
    const ta = ta, r = ta.getBoundingClientRect();
    if (!r.width || !r.height) return;
    pinSaved = ta.style.cssText;
    Object.assign(ta.style, { position: "fixed", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", margin: "0", boxSizing: "border-box" });
  }
  function unpinEditor() {
    if (--pinDepth > 0) return;
    pinDepth = 0;
    if (pinSaved == null) return;
    const ta = ta, top = ta.scrollTop;
    ta.style.cssText = pinSaved; pinSaved = null;
    ta.scrollTop = top;
  }
  // Ctrl+Z / Ctrl+Y replay a whole multi-line edit the same way: pinned, one "input" at the end
  ta.addEventListener("keydown", (e) => {
    const k = (e.key || "").toLowerCase();
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !(k === "z" || k === "y")) return;
    pinEditor(); bulkEdit = true;
    setTimeout(() => { bulkEdit = false; unpinEditor(); ta.dispatchEvent(new Event("input", { bubbles: true })); }, 0);
  }, true);
  function replaceSel(text, selectInserted) {
    ta.focus();
    let ok = false;
    const multi = (text.match(/\n/g) || []).length > 2;
    bulkEdit = true;
    if (multi) pinEditor();
    try { ok = document.execCommand("insertText", false, text); } catch (e) {}
    finally { bulkEdit = false; if (multi) unpinEditor(); }
    if (!ok) {
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
      ta.selectionStart = ta.selectionEnd = s + text.length;
    }
    if (selectInserted) { const end = ta.selectionStart; ta.selectionStart = end - text.length; ta.selectionEnd = end; }
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function editRange(s, e, text) {
    // only the part that really changes goes through execCommand: Chrome inserts multi-line text
    // line by line (slow), and a table / style edit usually differs in a few characters
    const old = ta.value.slice(s, e);
    let p = 0; while (p < old.length && p < text.length && old[p] === text[p]) p++;
    let q = 0; while (q < old.length - p && q < text.length - p && old[old.length - 1 - q] === text[text.length - 1 - q]) q++;
    if (p === old.length && p === text.length) return;
    s += p; e -= q; text = text.slice(p, text.length - q);
    withEditor(() => { ta.setSelectionRange(s, e); replaceSel(text); });
  }
  function wrap(a, b, ph) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e) || ph || "";
    replaceSel(a + sel + b);
    if (s === e) { ta.selectionStart = s + a.length; ta.selectionEnd = s + a.length + sel.length; }
  }
  function eachLine(fn) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const ls = v.lastIndexOf("\n", s - 1) + 1;
    let le = v.indexOf("\n", e); if (le === -1) le = v.length;
    const out = v.slice(ls, le).split("\n").map(fn).join("\n");
    ta.selectionStart = ls; ta.selectionEnd = le;
    replaceSel(out);
  }
  const lineStart = (v, i) => v.lastIndexOf("\n", i - 1) + 1;
  function insertBlock(text) {
    const v = ta.value, s = lineStart(v, ta.selectionStart);
    ta.focus(); ta.setSelectionRange(s, s);
    replaceSel((s > 0 && v[s - 2] !== "\n" ? "\n" : "") + text + "\n\n");
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
    let tx = inner(sel, open, close);
    if (tx != null) { replaceSel(tx); return; }
    if (v.slice(s - open.length, s) === open && v.slice(e, e + close.length) === close) {
      ta.setSelectionRange(s - open.length, e + close.length); replaceSel(sel); return;
    }
    tx = inner(sel, "<" + other + ">", "</" + other + ">");
    if (tx != null) { replaceSel(open + tx + close); return; }
    wrap(open, close, "2");
  }
  // ==highlight== in six colours: inside an existing ==…== the same colour removes it,
  // another colour recolours it, "none" removes it.
  const HL_ORDER = ["yellow", "red", "green", "blue", "pink", "gray"];
  function toggleMark(color) {
    const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const open = (c) => "==" + (c && c !== "yellow" ? c + ":" : "");
    const colorOf = (name) => (name && window.MD2DOCX && MD2DOCX.highlightName ? MD2DOCX.highlightName(name) : null);
    const ls = lineStart(v, s); let le = v.indexOf("\n", e); if (le < 0) le = v.length;
    const re = /==(?:([A-Za-zЀ-ӿ]+):)?((?:[^=\n]|=(?!=))+?)==/g;
    let m;
    while ((m = re.exec(v.slice(ls, le)))) {
      const a = ls + m.index, b = a + m[0].length;
      if (s < a || e > b) continue;
      const cur = colorOf(m[1]) || "yellow";
      const inner = m[1] && !colorOf(m[1]) ? m[1] + ":" + m[2] : m[2];
      const out = color === "none" || color === cur ? inner : open(color) + inner + "==";
      ta.focus(); ta.setSelectionRange(a, b); replaceSel(out, true);
      return;
    }
    if (color === "none") return;
    wrap(open(color), "==", t("tb.highlight"));
  }

  /* ---------- popovers: symbols (Ω), callouts, highlight colours, Document menu ---------- */
  let popEl = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; document.removeEventListener("mousedown", onOutside, true); } }
  function onOutside(e) { if (popEl && !popEl.contains(e.target) && !e.target.closest("[data-cmd=symbols],[data-cmd=callout],[data-cmd=highlight],[data-cmd=docmenu]")) closePop(); }
  function openPop(cmd, html, onPick) {
    const same = popEl && popEl.dataset.cmd === cmd;
    closePop(); if (same) return;
    const btn = $('[data-cmd="' + cmd + '"]');
    popEl = document.createElement("div"); popEl.className = "popover"; popEl.dataset.cmd = cmd; popEl.innerHTML = html;
    popEl.setAttribute("role", "menu");
    document.body.appendChild(popEl);
    const r = btn.getBoundingClientRect();
    popEl.style.top = (r.bottom + 6) + "px";
    popEl.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popEl.offsetWidth - 8)) + "px";
    popEl.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });
    popEl.addEventListener("click", (e) => { const b = e.target.closest("[data-pick]"); if (b) onPick(b.dataset.pick); });
    document.addEventListener("mousedown", onOutside, true);
  }
  const SYM_GROUPS = [["sym.greek", "α β γ δ ε θ λ μ π ρ σ τ φ ω Δ Σ Ω"], ["sym.ops", "± × ÷ · ≈ ≠ ≤ ≥ ∞ √ ∑ ∏ ∫ ∂ ∇ ∝ °"],
    ["sym.arrows", "→ ← ↔ ⇒ ⇔ ↑ ↓ ∈ ∉ ⊂ ∪ ∩ ∀ ∃"], ["sym.index", "⁰ ¹ ² ³ ⁴ ⁵ ⁶ ⁷ ⁸ ⁹ ₀ ₁ ₂ ₃ ₄ ₅ ₆ ₇ ₈ ₉"], ["sym.units", "°C µm µg mmHg ‰ Ω"]];
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
    const html = '<div class="pop-head"><b>' + esc(t("tb.symbols")) + '</b><label class="pop-opt"><input type="checkbox" id="symLatex"' + (latex ? " checked" : "") + "> " + esc(t("sym.latex")) + "</label></div>" +
      (r.length ? '<div class="sym-group"><span>' + esc(t("sym.recent")) + '</span><div class="sym-row">' + r.map(b).join("") + "</div></div>" : "") +
      SYM_GROUPS.map((g) => '<div class="sym-group"><span>' + esc(t(g[0])) + '</span><div class="sym-row">' + g[1].split(" ").map(b).join("") + "</div></div>").join("");
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
    const name = (k) => C[k].title[window.I18N ? I18N.lang : "en"] || C[k].title.en;
    const html = '<div class="pop-head"><b>' + esc(t("tb.callout")) + '</b></div>' + ["info", "note", "tip", "success", "important", "warning", "danger"].filter((k) => C[k]).map((k) =>
      '<button class="pop-item" data-pick="' + k + '"><i style="background:#' + C[k].color + '"></i>' + C[k].icon + " " + esc(name(k)) + " <code>:::" + k + "</code></button>").join("");
    openPop("callout", html, (k) => {
      closePop();
      const v = ta.value; let s = ta.selectionStart, e = ta.selectionEnd;
      if (s !== e) { s = v.lastIndexOf("\n", s - 1) + 1; const le = v.indexOf("\n", e); e = le === -1 ? v.length : le; }
      const body = v.slice(s, e).trim() || name(k);
      const pre = s > 0 && v[s - 1] !== "\n" ? "\n\n" : (s > 1 && v[s - 2] !== "\n" ? "\n" : "");
      ta.focus(); ta.setSelectionRange(s, e);
      replaceSel(pre + ":::" + k + "\n" + body + "\n:::\n");
    });
  }
  function openHighlight() {
    const html = '<div class="pop-head"><b>' + esc(t("tb.highlight")) + '</b><span class="kbd">Ctrl+Shift+H</span></div>' +
      HL_ORDER.map((c) => '<button class="pop-item" data-pick="' + c + '"><mark class="hl hl-' + c + '">Aa</mark> ' + esc(t("hl." + c)) +
        " <code>" + (c === "yellow" ? "==…==" : "==" + c + ":…==") + "</code></button>").join("") +
      '<button class="pop-item" data-pick="none"><span class="hl-none">Aa</span> ' + esc(t("hl.none")) + "</button>";
    openPop("highlight", html, (c) => { closePop(); toggleMark(c); });
  }
  // Document menu: structure commands, statistics, HTML export, preview editing
  const docCommands = {
    alignTable() {
      const r = window.DOCXMDEdit && DOCXMDEdit.alignTable(ta.value, ta.selectionStart);
      if (!r) { info(t("toast.alignNone")); return; }
      applyEditAction(r);
    },
    edSyntax() { toggleEd("docxmd:ed.syntax", "1", "ed.syntax"); },
    edLines() { toggleEd("docxmd:ed.lineNumbers", "0", "ed.lineNumbers"); },
    edPasteHtml() { toggleEd("docxmd:ed.pasteHtml", "1", "ed.pasteHtml"); },
    toc() { insertBlock("[TOC]"); },
    numbering() {
      const v = ta.value, re = window.MD2DOCX && MD2DOCX.NUMBERING_RE;
      if (!re) return;
      const m = re.exec(v);
      if (m) {
        let s = m.index, e = m.index + m[0].length;
        if (v[e] === "\n") e++;
        if (v[e] === "\n" && (s === 0 || v[s - 1] === "\n")) e++;
        ta.focus(); ta.setSelectionRange(s, e); replaceSel("");
        info(t("toast.numberingOff"));
      } else {
        ta.focus(); ta.setSelectionRange(0, 0); replaceSel("<!-- docxmd: numbered-headings -->\n\n");
        info(t("toast.numberingOn"));
      }
    },
    footnote() {
      const v = ta.value;
      let n = 1; v.replace(/\[\^(\d+)\]/g, (x, d) => { n = Math.max(n, +d + 1); });
      const pos = ta.selectionEnd;
      ta.focus(); ta.setSelectionRange(pos, pos); replaceSel("[^" + n + "]");
      const ph = t("fn.placeholder");
      const end = ta.value.length, tail = "\n\n[^" + n + "]: " + ph;
      ta.setSelectionRange(end, end); replaceSel((ta.value.endsWith("\n") ? tail.slice(1) : tail) + "\n");
      const at = ta.value.lastIndexOf(ph); ta.setSelectionRange(at, at + ph.length);
    },
    caption() {
      const v = ta.value, s = lineStart(v, ta.selectionStart);
      let e = v.indexOf("\n", s); if (e < 0) e = v.length;
      const line = v.slice(s, e);
      const used = (k) => { let n = 1; v.replace(new RegExp("#" + k + ":" + k + "(\\d+)", "g"), (x, d) => { n = Math.max(n, +d + 1); }); return n; };
      const img = /^(\s*!\[[^\]\n]*\]\([^)\n]*\))(\{[^}\n]*\})?\s*$/.exec(line);
      if (img && !/#fig:/.test(img[2] || "")) {
        ta.focus(); ta.setSelectionRange(s, e);
        replaceSel(img[1] + "{#fig:fig" + used("fig") + (img[2] ? " " + img[2].slice(1, -1) : "") + "}");
        info(t("toast.figCaption"));
      } else insertBlock("Table: " + t("tbl.placeholder") + " {#tbl:tbl" + used("tbl") + "}");
    },
    stats() { showStats(); },
    html() { exportHtml(); },
    sciclean() { vscode.postMessage({ type: "cleanNotation" }); },
    previewEdit() {
      const on = store.get("docxmd:previewEdit", "1") !== "1";
      store.set("docxmd:previewEdit", on ? "1" : "0");
      if (!on) { PE.close(true); PE.hideHandle(); }
      info(t(on ? "toast.previewEditOn" : "toast.previewEditOff"));
    }
  };
  function toggleEd(key, def, label) {
    const on = store.get(key, def) !== "1";
    store.set(key, on ? "1" : "0"); paintEditor();
    info(t(on ? "ed.on" : "ed.off", { what: t(label) }));
  }
  function openDocMenu() {
    const peOn = store.get("docxmd:previewEdit", "1") === "1";
    const item = (k, label, extra) => '<button class="pop-item" data-pick="' + k + '">' + esc(label) + (extra || "") + "</button>";
    const numOn = window.MD2DOCX && MD2DOCX.NUMBERING_RE.test(ta.value);
    const html = '<div class="pop-head"><b>' + esc(t("menu.document")) + "</b></div>" +
      item("toc", t("action.toc")) + item("numbering", t("action.numbering"), numOn ? ' <span class="check">✓</span>' : "") +
      item("footnote", t("action.footnote")) + item("caption", t("action.caption")) +
      item("sciclean", t("action.sciclean")) + item("stats", t("action.stats")) + item("html", t("action.exportHtml")) +
      item("previewEdit", t("action.previewEdit"), peOn ? ' <span class="check">✓</span>' : "") +
      item("alignTable", t("action.alignTable"), ' <span class="kbd">Ctrl+Shift+T</span>') +
      '<div class="pop-head" style="margin-top:.5rem"><b>' + esc(t("menu.editor")) + "</b></div>" +
      item("edSyntax", t("ed.syntax"), ED.syntax() ? ' <span class="check">✓</span>' : "") +
      item("edLines", t("ed.lineNumbers"), ED.lines() ? ' <span class="check">✓</span>' : "") +
      item("edPasteHtml", t("ed.pasteHtml"), ED.pasteHtml() ? ' <span class="check">✓</span>' : "");
    openPop("docmenu", html, (k) => { closePop(); if (docCommands[k]) docCommands[k](); });
  }

  const cmds = {
    highlight: () => openHighlight(),
    cleanNotation: () => vscode.postMessage({ type: "cleanNotation" }),
    sup: () => toggleTag("sup"),
    sub: () => toggleTag("sub"),
    symbols: () => openSymbols(),
    callout: () => openCallouts(),
    docmenu: () => openDocMenu(),
    bold: () => wrap("**", "**", t("tb.bold")),
    italic: () => wrap("*", "*", t("tb.italic")),
    strike: () => wrap("~~", "~~", t("tb.strike")),
    code: () => wrap("`", "`", "code"),
    codeblock: () => wrap("```\n", "\n```", "code"),
    h1: () => eachLine((l) => "# " + l.replace(/^#{1,6}\s*/, "")),
    h2: () => eachLine((l) => "## " + l.replace(/^#{1,6}\s*/, "")),
    h3: () => eachLine((l) => "### " + l.replace(/^#{1,6}\s*/, "")),
    quote: () => eachLine((l) => "> " + l.replace(/^>\s*/, "")),
    ul: () => eachLine((l) => "- " + l.replace(/^[-*+]\s*/, "")),
    ol: () => { let n = 0; eachLine((l) => (++n) + ". " + l.replace(/^\d+\.\s*/, "")); },
    task: () => eachLine((l) => "- [ ] " + l.replace(/^-\s*\[[ x]\]\s*/, "").replace(/^[-*+]\s*/, "")),
    link: () => wrap("[", "](https://)", "text"),
    image: () => wrap("![", "](https://)", "alt"),
    hr: () => replaceSel("\n\n---\n\n"),
    table: () => replaceSel("\n| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n"),
    alignLeft: () => alignBlock("left"),
    alignCenter: () => alignBlock("center"),
    alignRight: () => alignBlock("right"),
    alignJustify: () => alignBlock("justify")
  };
  $("#toolbar").addEventListener("click", (e) => {
    const b = e.target.closest(".tb"); if (b && cmds[b.dataset.cmd]) cmds[b.dataset.cmd]();
  });
  // Smart Markdown editing (media/mdedit.js, shared with the web app): Enter continues
  // lists / quotes / table rows, Tab / Shift+Tab — list levels, table cells, indentation,
  // Alt+↑/↓ move lines, Shift+Alt+↑/↓ duplicate, Ctrl+/ comment, * _ ` = ~ ( [ wrap.
  // Esc, then Tab moves the focus on (keyboard users are not trapped).
  let tabEscape = false, plainPaste = false;
  function applyEditAction(r) {
    if (!r || r.noop) return;
    if (r.text != null) editRange(r.start, r.end, r.text);
    ta.focus();
    ta.setSelectionRange(r.selStart, r.selEnd);
    syncActiveLine();
    const y = caretOffsetY(r.selStart);
    if (y < ta.scrollTop + 10 || y > ta.scrollTop + ta.clientHeight - 40) ta.scrollTop = Math.max(0, y - ta.clientHeight * 0.35);
  }
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { tabEscape = true; return; }
    if (e.key === "Tab" && tabEscape) { tabEscape = false; return; }
    tabEscape = false;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "V" || e.key === "v")) { plainPaste = true; return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "T" || e.key === "t")) { e.preventDefault(); docCommands.alignTable(); return; }
    if (!window.DOCXMDEdit || e.isComposing || e.keyCode === 229) return;
    const r = DOCXMDEdit.onKey(ta.value, ta.selectionStart, ta.selectionEnd, { key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });
    if (!r) return;
    e.preventDefault(); e.stopPropagation();
    applyEditAction(r);
  });

  /* ---------- images: paste & drag-drop ---------- */
  function humanSize(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(0) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  // Saved next to the document (images/image-001.png, via the extension host) unless the
  // document is untitled or docxmd.pastedImages = "embed" → embedded as a data-URI.
  const __imgPending = {}; let __imgSeq = 0;
  const readDataUrl = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onerror = reject; r.onload = () => resolve(r.result); r.readAsDataURL(file); });
  async function insertImageFile(file) {
    let dataUrl;
    try { dataUrl = await readDataUrl(file); } catch (e) { return; }
    const alt = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[\[\]\(\)\r\n]/g, " ").trim() || "image";
    const id = ++__imgSeq;
    const saved = await new Promise((resolve) => {
      __imgPending[id] = resolve;
      vscode.postMessage({ type: "saveImage", id, name: file.name, mime: file.type, dataBase64: String(dataUrl).replace(/^data:[^,]*,/, "") });
      setTimeout(() => { if (__imgPending[id]) { delete __imgPending[id]; resolve(null); } }, 15000);
    });
    const s = ta.selectionStart;
    const atLineStart = s === 0 || ta.value[s - 1] === "\n";
    withEditor(() => replaceSel((atLineStart ? "" : "\n") + "![" + alt + "](" + (saved || foldText(dataUrl)) + ")\n"));
    info(saved ? t("toast.imageSaved", { path: saved }) : t("toast.imageEmbedded", { size: humanSize(file.size) }));
  }
  const isImageFile = (f) => f && /^image\//.test(f.type || "");
  // Copy / cut from the editor: tokens become the real pictures again
  ["copy", "cut"].forEach((ev) => ta.addEventListener(ev, (e) => {
    const a = ta.selectionStart, b = ta.selectionEnd;
    if (!FOLD || a === b || !e.clipboardData) return;
    const sel = ta.value.slice(a, b);
    if (sel.indexOf(FOLD.PREFIX) === -1) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", FOLD.expand(sel, IMGS));
    if (ev === "cut") withEditor(() => replaceSel(""));
  }));
  ta.addEventListener("paste", (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imgs = [];
    for (const it of items) { if (it.kind === "file" && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) imgs.push(f); } }
    if (imgs.length) { e.preventDefault(); (async () => { for (const f of imgs) await insertImageFile(f); })(); return; }
    // text with embedded pictures (data-URIs) → tokens, the pictures go to the store
    const plain0 = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    if (FOLD && FOLD.has(plain0)) { e.preventDefault(); plainPaste = false; replaceSel(foldText(plain0)); return; }
    if (plainPaste) { plainPaste = false; return; }
    if (!window.DOCXMDEdit || !e.clipboardData) return;
    const link = DOCXMDEdit.pasteLink(ta.value, ta.selectionStart, ta.selectionEnd, e.clipboardData.getData("text/plain"));
    if (link) { e.preventDefault(); applyEditAction(link); return; }
    if (ED.pasteHtml()) {
      const md = DOCXMDEdit.htmlToMarkdown(e.clipboardData.getData("text/html"));
      if (md) { e.preventDefault(); replaceSel(md); }
    }
  });
  ["dragover", "drop"].forEach((ev) => panes.addEventListener(ev, (e) => e.preventDefault()));
  panes.addEventListener("drop", async (e) => {
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : []; if (!files.length) return;
    if (isImageFile(files[0])) { for (const f of files) if (isImageFile(f)) await insertImageFile(f); }
    else info(t("vs.dropHint"));
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
  function mode() { const m = /\bmode-(\w+)/.exec(panes.className); return m ? m[1] : "split"; }
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

  /* ---------- synced scrolling (Split mode) ---------- */
  let syncing = false, progScroll = false, progTimer = null;
  function suppressSync() { progScroll = true; clearTimeout(progTimer); progTimer = setTimeout(() => { progScroll = false; }, 150); }
  function syncFrom(src, dst) {
    if (syncing || progScroll) return; syncing = true;
    const sMax = src.scrollHeight - src.clientHeight, dMax = dst.scrollHeight - dst.clientHeight;
    dst.scrollTop = (sMax > 0 ? src.scrollTop / sMax : 0) * dMax;
    requestAnimationFrame(() => { syncing = false; });
  }
  ta.addEventListener("scroll", () => {
    if (bulkEdit) return;                          // the caret jumping line by line during an insert
    if (editorBackdrop) { editorBackdrop.scrollTop = ta.scrollTop; editorBackdrop.scrollLeft = ta.scrollLeft; }
    if (mode() === "split") syncFrom(ta, preview);
    if (mode() !== "preview") updatePos();
    scheduleSpy();
  });
  preview.addEventListener("scroll", () => {
    if (mode() === "split") syncFrom(preview, ta);
    if (mode() === "preview") updatePos();
    scheduleSpy();
  });
  window.addEventListener("resize", () => { updatePos(); paintEditor(); });

  /* ---------- outline ---------- */
  const outline = $("#outline"), outlineList = $("#outlineList");
  let outlineHeads = [];
  function buildOutline(heads) {
    outlineHeads = heads;
    if (!heads.length) { outlineList.innerHTML = '<div class="empty">' + esc(t("outline.empty")) + "</div>"; return; }
    outlineList.innerHTML = heads.map((h, i) => {
      const num = h.querySelector(".hnum");
      const label = ((num ? h.textContent.replace(num.textContent, "") : h.textContent).trim() || "—");
      return '<a href="#" class="l' + h.tagName[1] + '" data-i="' + i + '" title="' + esc(label) + '">' + (num ? esc(num.textContent) + " " : "") + esc(label) + "</a>";
    }).join("");
    scheduleSpy();
  }
  // Source offset of every ATX / setext heading (fenced code skipped)
  function headingOffsets() {
    const v = ta.value, lines = v.split("\n"), out = [];
    const fm = window.MD2DOCX && MD2DOCX.parseFrontMatter ? MD2DOCX.parseFrontMatter(v) : null;
    let pos = 0, fence = null, prev = null;
    for (const line of lines) {
      if (!fm || pos >= fm.raw.length) {
        const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (fence) { if (f && f[1][0] === fence) fence = null; }
        else if (f) fence = f[1][0];
        else if (/^\s{0,3}(?:>\s?)*#{1,6}(?:\s|$)/.test(line)) out.push(pos);
        else if (/^\s{0,3}(?:=+|-{2,})\s*$/.test(line) && prev && prev.text.trim() && !/^\s*([-*+>|]|\d+[.)]\s|#)/.test(prev.text)) out.push(prev.pos);
      }
      prev = { pos, text: line };
      pos += line.length + 1;
    }
    return out;
  }
  outlineList.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-i]"); if (!a) return;
    e.preventDefault();
    const i = +a.dataset.i, h = outlineHeads[i];
    if (mode() !== "preview") {
      const offs = headingOffsets();
      if (offs.length === outlineHeads.length && offs[i] != null) {
        suppressSync();
        try { ta.focus({ preventScroll: true }); } catch (x) { ta.focus(); }
        ta.setSelectionRange(offs[i], offs[i]);
        ta.scrollTop = Math.max(0, caretOffsetY(offs[i]) - 12);
      }
    }
    if (mode() !== "source" && h) { suppressSync(); h.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  let spyRaf = 0;
  function scheduleSpy() { if (!spyRaf) spyRaf = requestAnimationFrame(() => { spyRaf = 0; updateSpy(); }); }
  function updateSpy() {
    if (outline.classList.contains("hidden") || !outlineHeads.length || mode() === "source") return;
    const top = preview.getBoundingClientRect().top + 60;
    let cur = -1;
    for (let i = 0; i < outlineHeads.length; i++) { if (outlineHeads[i].getBoundingClientRect().top <= top) cur = i; else break; }
    $$("a.active", outlineList).forEach((x) => x.classList.remove("active"));
    const a = outlineList.querySelector('a[data-i="' + cur + '"]'); if (a) a.classList.add("active");
  }
  function toggleOutline(force) {
    const hide = force != null ? !force : !outline.classList.contains("hidden");
    outline.classList.toggle("hidden", hide);
    $("#outlineBtn").classList.toggle("active", !hide);
    $("#outlineBtn").setAttribute("aria-pressed", hide ? "false" : "true");
    save();
    scheduleSpy();
  }
  $("#outlineBtn").addEventListener("click", () => toggleOutline());

  /* ---------- statistics (modal) ---------- */
  const modalScrim = $("#modalScrim"), modal = $("#modal");
  let modalReturn = null;
  function openModal(html) { modalReturn = document.activeElement; modal.innerHTML = html; modalScrim.classList.add("show"); const b = modal.querySelector("button"); if (b) b.focus(); }
  function closeModal() {
    if (!modalScrim.classList.contains("show")) return;
    modalScrim.classList.remove("show");
    if (modalReturn && modalReturn.focus) try { modalReturn.focus({ preventScroll: true }); } catch (e) {}
    modalReturn = null;
  }
  modalScrim.addEventListener("click", (e) => { if (e.target === modalScrim) closeModal(); });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const f = $$("button,a[href],input,select,textarea", modal); if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  function showStats() {
    if (!window.MD2DOCX || !MD2DOCX.docStats) return;
    const S = MD2DOCX.docStats(ta.value);
    const hs = S.h.map((n, i) => (n ? "H" + (i + 1) + " " + n : "")).filter(Boolean).join(" · ");
    const row = (k, v, sub) => "<tr><th>" + esc(t(k)) + "</th><td>" + v + (sub ? " <small>" + esc(sub) + "</small>" : "") + "</td></tr>";
    const group = (k) => '<tr class="grp"><td colspan="2">' + esc(t(k)) + "</td></tr>";
    openModal('<h3 id="stTitle">' + esc(t("stats.title")) + "</h3>" +
      '<table class="stats-table">' +
      group("stats.text") +
      row("stats.words", S.words) + row("stats.chars", S.chars) + row("stats.charsNoSpace", S.charsNoSpace) +
      row("stats.lines", S.lines) + row("stats.paragraphs", S.paragraphs) + row("stats.reading", Math.max(1, Math.ceil(S.words / 200)) + " " + t("stats.min")) +
      group("stats.structure") +
      row("stats.headings", S.headings, hs) + row("stats.tables", S.tables, S.captions ? t("stats.captioned", { n: S.captions }) : "") +
      row("stats.images", S.images, S.figures ? t("stats.numbered", { n: S.figures }) : "") +
      row("stats.formulas", S.mathInline + S.mathBlock, t("stats.formulaSplit", { i: S.mathInline, b: S.mathBlock })) +
      row("stats.footnotes", S.footnotes) +
      row("stats.links", S.linksExt + S.linksInt, t("stats.linkSplit", { e: S.linksExt, i: S.linksInt })) +
      row("stats.code", S.code) + row("stats.lists", S.lists) + row("stats.boxes", S.boxes) + row("stats.marks", S.marks) +
      (S.frontMatter ? row("stats.frontMatter", "✓") : "") +
      "</table>" +
      '<div class="actions"><button class="btn" id="stClose">' + esc(t("btn.close")) + "</button></div>");
    modal.setAttribute("aria-labelledby", "stTitle");
    $("#stClose").addEventListener("click", closeModal);
  }
  $("#stWords").addEventListener("click", showStats);
  $("#stWords").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showStats(); } });

  /* ---------- find & replace: .* regex, Aa case, W whole word ---------- */
  const findbar = $("#findbar"), findInput = $("#findInput"), replaceInput = $("#replaceInput"), findCount = $("#findCount");
  const findState = { active: false, hits: [], idx: -1, positioned: false };
  const findOpts = (() => { const d = { regex: false, cas: false, word: false }; try { return Object.assign(d, JSON.parse(store.get("docxmd:findOpts", "{}")) || {}); } catch (e) { return d; } })();
  const WORDCH = "0-9A-Za-z_\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF\\u0590-\\u06FF\\u3040-\\u30FF\\u4E00-\\u9FFF";
  let findError = null;
  let editorBackdrop = null;
  function findRegex() {
    const q = findInput.value; findError = null;
    if (!q) return null;
    let src = findOpts.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (findOpts.word) src = "(?<![" + WORDCH + "])(?:" + src + ")(?![" + WORDCH + "])";
    try { return new RegExp(src, "gm" + (findOpts.cas ? "" : "i")); }
    catch (e) { findError = e.message; return null; }
  }
  function findAll(text, re) {
    const out = [];
    if (!re) return out;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].length) { re.lastIndex++; continue; }
      out.push({ s: m.index, e: m.index + m[0].length, m });
      if (out.length >= 50000) break;
    }
    return out;
  }
  function expandReplacement(r, hit) {
    if (!findOpts.regex || !hit || !hit.m) return r;
    const m = hit.m;
    return r.replace(/\$(\$|&|\d{1,2}|<([^>]+)>)/g, (x, k, name) => {
      if (k === "$") return "$";
      if (k === "&") return m[0];
      if (name != null) return (m.groups && m.groups[name]) || "";
      const n = +k; return n < m.length ? (m[n] || "") : x;
    });
  }
  function syncFindToggles() {
    [["#findRegex", "regex"], ["#findCase", "cas"], ["#findWord", "word"]].forEach(([sel, k]) => {
      const b = $(sel); b.classList.toggle("on", !!findOpts[k]); b.setAttribute("aria-pressed", findOpts[k] ? "true" : "false");
    });
  }
  function toggleFindOpt(k) {
    findOpts[k] = !findOpts[k];
    store.set("docxmd:findOpts", JSON.stringify(findOpts));
    syncFindToggles();
    findState.idx = -1; findState.positioned = false;
    runFind(false);
  }
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
    const re = findRegex(); if (!re) return;
    const targets = [];
    const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !n.parentNode) return NodeFilter.FILTER_REJECT;
        const tag = n.parentNode.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE") return NodeFilter.FILTER_REJECT;
        re.lastIndex = 0;
        return re.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node; while ((node = walker.nextNode())) targets.push(node);
    const marks = [];
    targets.forEach((textNode) => {
      const text = textNode.nodeValue, frag = document.createDocumentFragment();
      let from = 0;
      findAll(text, re).forEach((h) => {
        if (h.s > from) frag.appendChild(document.createTextNode(text.slice(from, h.s)));
        const mark = document.createElement("mark"); mark.className = "find-hit"; mark.textContent = text.slice(h.s, h.e);
        frag.appendChild(mark); marks.push(mark); from = h.e;
      });
      if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
    if (marks.length && findState.idx >= 0) {
      const cur = marks[((findState.idx % marks.length) + marks.length) % marks.length];
      if (cur) {
        cur.classList.add("find-current");
        if (scrollCurrent) {
          suppressSync();
          const cRect = preview.getBoundingClientRect(), mRect = cur.getBoundingClientRect();
          preview.scrollTop = Math.max(0, preview.scrollTop + (mRect.top - cRect.top) - preview.clientHeight * 0.35);
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
    m.boxSizing = "border-box"; m.width = (ta.clientWidth || 600) + "px"; m.top = "0"; m.left = "-9999px";
    findMirror.textContent = ta.value.slice(0, index);
    const marker = document.createElement("span"); marker.textContent = "​"; findMirror.appendChild(marker);
    const y = marker.offsetTop; findMirror.textContent = "";
    return y;
  }
  // Editor backdrop (behind the transparent textarea): tints embedded data-URI
  // images at all times, and marks find matches while the find bar is open.
  // With the editor options it also draws Markdown syntax colours, line numbers and the
  // active line (media/mdhighlight.js); the textarea text is then transparent.
  function paintEditor() {
    const v = ta.value;
    const H = window.DOCXMDHighlight;
    const syn = !!H && ED.syntax() && v.length <= 3000000, lines = !!H && ED.lines();
    ta.classList.toggle("syn-on", syn && mode() !== "preview");
    ta.classList.toggle("ln-on", lines && mode() !== "preview");
    if (mode() === "preview") { if (editorBackdrop) { if (H) H.clear(editorBackdrop); else editorBackdrop.innerHTML = ""; } return; }
    const q = findState.active ? findInput.value : "";
    const hasImg = v.indexOf("data:") !== -1;
    if (!q && !hasImg && !syn && !lines) { if (editorBackdrop) { if (H) H.clear(editorBackdrop); else editorBackdrop.innerHTML = ""; } return; }
    if (!editorBackdrop) {
      editorBackdrop = document.createElement("div");
      editorBackdrop.className = "find-backdrop";
      editorBackdrop.setAttribute("aria-hidden", "true");
      ta.parentElement.insertBefore(editorBackdrop, ta);
    }
    const cs = getComputedStyle(ta), s = editorBackdrop.style;
    ["fontSize", "fontWeight", "fontStyle", "letterSpacing", "wordSpacing", "lineHeight", "textTransform", "tabSize", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight"].forEach((p) => { s[p] = cs[p]; });
    s.width = ta.clientWidth + "px"; s.height = ta.clientHeight + "px";
    const hits = q ? findAll(v, findRegex()).map((h) => [h.s, h.e]) : [];
    const cur = findState.hits.length ? ((findState.idx % findState.hits.length) + findState.hits.length) % findState.hits.length : -1;
    if (H) { H.paint(editorBackdrop, v, { syntax: syn, lineNumbers: lines, hits, cur: q ? cur : -1, esc: escapeHtml }); if (syn || lines) H.setActive(editorBackdrop, ta.selectionStart); }
    else editorBackdrop.innerHTML = window.MD2DOCX && MD2DOCX.backdropHtml ? MD2DOCX.backdropHtml(v, hits, q ? cur : -1, escapeHtml).html : "";
    editorBackdrop.scrollTop = ta.scrollTop; editorBackdrop.scrollLeft = ta.scrollLeft;
  }
  function syncActiveLine() { if (bulkEdit) return; if (editorBackdrop && window.DOCXMDHighlight && (ED.syntax() || ED.lines())) DOCXMDHighlight.setActive(editorBackdrop, ta.selectionStart); }
  ["selectionchange", "keyup", "click", "focus"].forEach((ev) => ta.addEventListener(ev, syncActiveLine));
  document.addEventListener("selectionchange", () => { if (document.activeElement === ta) syncActiveLine(); });
  let paintTimer = null;
  function schedulePaint() { clearTimeout(paintTimer); paintTimer = setTimeout(paintEditor, 120); }
  function runFind(jump, keepInputFocus) {
    const q = findInput.value;
    findState.hits = q ? findAll(ta.value, findRegex()) : [];
    findCount.classList.toggle("bad", !!findError);
    if (findError) { findState.idx = -1; findCount.textContent = t("find.badRegex"); findCount.title = findError; paintPreview(false); paintEditor(); return; }
    findCount.title = "";
    if (!findState.hits.length) { findState.idx = -1; findCount.textContent = q ? t("find.none") : ""; paintPreview(false); paintEditor(); return; }
    if (findState.idx < 0 || findState.idx >= findState.hits.length) findState.idx = 0;
    findCount.textContent = t("find.count", { n: findState.idx + 1, t: findState.hits.length });
    if (jump && mode() !== "preview") {
      const h = findState.hits[findState.idx];
      ta.setSelectionRange(h.s, h.e);
      if (!keepInputFocus) ta.focus();
      suppressSync();
      ta.scrollTop = Math.max(0, caretOffsetY(h.s) - ta.clientHeight * 0.35);
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
  // Replacements go through editRange → one entry on the undo stack (Ctrl+Z works)
  function replaceCurrent() {
    if (!findInput.value) return;
    runFind(false);
    if (!findState.hits.length) return;
    if (findState.idx < 0 || findState.idx >= findState.hits.length) findState.idx = 0;
    const hit = findState.hits[findState.idx];
    const rep = expandReplacement(replaceInput.value, hit);
    editRange(hit.s, hit.e, rep);
    const from = hit.s + rep.length; runFind(false);
    if (!findState.hits.length) { findCount.textContent = t("find.none"); replaceInput.focus(); return; }
    const next = findState.hits.findIndex((h) => h.s >= from);
    findState.idx = next === -1 ? 0 : next; findState.positioned = true;
    runFind(true, true); replaceInput.focus();
  }
  function replaceAll() {
    if (!findInput.value) return;
    const v = ta.value, hits = findAll(v, findRegex());
    if (!hits.length) { runFind(false); return; }
    const r = replaceInput.value;
    let out = "", pos = hits[0].s;
    hits.forEach((h) => { out += v.slice(pos, h.s) + expandReplacement(r, h); pos = h.e; });
    editRange(hits[0].s, hits[hits.length - 1].e, out);
    info(t("find.replaced", { n: hits.length }));
    findState.idx = -1; findState.positioned = false; runFind(false);
  }
  findInput.addEventListener("input", () => { findState.idx = -1; findState.positioned = false; runFind(true, true); });
  findInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); stepFind(e.shiftKey); } });
  replaceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (e.ctrlKey || e.metaKey) replaceAll(); else replaceCurrent(); } });
  findbar.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = { r: "regex", c: "cas", w: "word" }[(e.code || "").replace(/^Key/, "").toLowerCase()];
    if (k) { e.preventDefault(); toggleFindOpt(k); }
  });
  $("#findNext").addEventListener("click", () => stepFind(false));
  $("#findPrev").addEventListener("click", () => stepFind(true));
  $("#findClose").addEventListener("click", () => toggleFind(false));
  $("#replaceOneBtn").addEventListener("click", replaceCurrent);
  $("#replaceAllBtn").addEventListener("click", replaceAll);
  $("#findRegex").addEventListener("click", () => toggleFindOpt("regex"));
  $("#findCase").addEventListener("click", () => toggleFindOpt("cas"));
  $("#findWord").addEventListener("click", () => toggleFindOpt("word"));
  syncFindToggles();
  $("#findBtn").addEventListener("click", () => toggleFind());
  $("#helpBtn").addEventListener("click", () => vscode.postMessage({ type: "openExternal", url: "https://docxmd.pp.ua/?help=1" }));

  /* ---------- keyboard ---------- */
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key || "").toLowerCase();
    // Ctrl+S: send the latest text with the save request — never a stale save
    if (mod && k === "s" && !e.shiftKey && !e.altKey) { e.preventDefault(); PE.close(true); clearTimeout(editTimer); editTimer = null; vscode.postMessage({ type: "save", text: docText() }); return; }
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || (ae.closest && ae.closest(".block-editor")))) return;   // typing in a preview editor
    if (mod && k === "f") { e.preventDefault(); toggleFind(true); }
    else if (mod && e.shiftKey && k === "h") { e.preventDefault(); toggleMark("yellow"); }
    else if (mod && e.key === ".") { e.preventDefault(); cmds.sup(); }
    else if (mod && e.key === ",") { e.preventDefault(); cmds.sub(); }
    else if (e.key === "Escape" && modalScrim.classList.contains("show")) closeModal();
    else if (e.key === "Escape" && popEl) closePop();
    else if (e.key === "Escape" && findState.active && ae !== ta) toggleFind(false);
  });

  /* ---------- view mode + theme + outline (persisted) ---------- */
  const modeSel = $("#mode"), themeSel = $("#theme");
  function setMode(m) {
    panes.className = "panes mode-" + m; modeSel.value = m;
    if (findState.active) runFind(false);
    requestAnimationFrame(() => { updatePos(); paintEditor(); });
    if (m !== "source") scheduleRender();
    save();
  }
  function setTheme(th) {
    document.documentElement.setAttribute("data-theme", th);
    const light = th === "white";
    $("#hljsLight").disabled = !light; $("#hljsDark").disabled = light;
    themeSel.value = th; save();
  }
  function save() { try { vscode.setState({ mode: modeSel.value, theme: themeSel.value, outline: !outline.classList.contains("hidden") }); } catch (e) {} }
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
    if (!md.trim()) { vscode.postMessage({ type: "error", text: t("toast.empty") }); return; }
    if (!window.MD2DOCX || typeof window.MD2DOCX.toBlob !== "function") {
      vscode.postMessage({ type: "error", text: "DOCX engine failed to load. Reinstall the extension and run “Developer: Reload Window”." });
      return;
    }
    const btn = $("#exportBtn"); btn.disabled = true; const label = btn.textContent; btn.textContent = "…";
    try {
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const blob = await window.MD2DOCX.toBlob(md, { title: docName, quoteColor: accent, resolveUrl: resolveRel,
        resolveAsset: (src) => (FOLD && FOLD.isToken(src) ? FOLD.blobOf(IMGS, src) : null) });
      const buf = await blob.arrayBuffer();
      vscode.postMessage({ type: "saveDocx", dataBase64: abToB64(buf) });
    } catch (e) {
      vscode.postMessage({ type: "error", text: "DOCX build failed: " + (e && e.message) });
    } finally { btn.disabled = false; btn.textContent = label; }
  }
  $("#exportBtn").addEventListener("click", exportDocx);
  // Standalone HTML (same look as the web app's export; formulas as MathML → no CSS/fonts needed)
  const EXPORT_CSS = "body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222}" +
    "pre{background:#f5f5f5;padding:1em;border-radius:8px;overflow:auto}code{background:#f0f0f0;padding:.15em .35em;border-radius:4px}" +
    "table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:.4em .7em}.num{text-align:right;font-variant-numeric:tabular-nums}.tbl-full table{width:100%}.tbl-compact th,.tbl-compact td{padding:.15em .45em;font-size:.88em}tbody tr:nth-child(2n) td:not([style]){background:#f7f7f7}.tbl-wrap{overflow-x:auto;margin:0 0 1em}.callout-title{font-weight:700;margin:0 0 .35em}blockquote.callout{color:#222;border-radius:0 8px 8px 0}figure.fig{margin:1em 0;text-align:center}figure.fig img{max-width:100%}figcaption,.tbl-caption{font-size:.92em;color:#444}.tbl-caption{margin:.8em 0 .3em}.fm-card{display:none}mark.hl{color:#000;padding:0 .1em;border-radius:2px}.hl-yellow{background:#fff176}.hl-red{background:#ff8a80}.hl-green{background:#b9f6ca}.hl-blue{background:#80d8ff}.hl-pink{background:#ff80ab}.hl-gray{background:#e0e0e0}nav.toc{border:1px solid #ddd;border-radius:8px;padding:.6em 1em;margin:0 0 1em}nav.toc ul{list-style:none;margin:0;padding:0}.toc-l2{padding-left:1.2em}.toc-l3{padding-left:2.4em}.toc-title{font-weight:700;margin:0 0 .3em}.footnotes{border-top:1px solid #ccc;margin-top:2em;font-size:.9em}.fn-ref a,.fn-back{text-decoration:none}.hnum{color:#666;margin-right:.2em}.xref-missing{color:#c00}blockquote{border-left:4px solid #0984e3;margin:0 0 1em;padding:.3em 1em;color:#555;background:#f7f9fc}img{max-width:100%}" +
    "math[display=block]{display:block;margin:1em 0;text-align:center}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}";
  function exportHtml() {
    const md = ta.value;
    if (!md.trim()) { vscode.postMessage({ type: "error", text: t("toast.empty") }); return; }
    mathStore = [];
    const tmp = document.createElement("div");
    mathOutput = "mathml";
    try { tmp.innerHTML = DOMPurify.sanitize(marked.parse(md), { ADD_ATTR: ["target", "id", "class", "align", "data-k"], ADD_TAGS: ["input"] }); }
    finally { mathOutput = "htmlAndMathml"; }
    if (mathStore.length) $$(".katex-ph", tmp).forEach((ph) => { const i = +ph.getAttribute("data-k"); if (mathStore[i] != null) ph.innerHTML = mathStore[i]; });
    if (FOLD) $$("img", tmp).forEach((im) => { const s = im.getAttribute("src"); if (FOLD.isToken(s)) { const d = FOLD.dataOf(IMGS, s); if (d) im.setAttribute("src", d); } });
    enhanceTables(tmp);
    const fm = window.MD2DOCX && MD2DOCX.parseFrontMatter ? MD2DOCX.parseFrontMatter(md) : null;
    const meta = (fm && fm.meta) || {};
    const ms = (k) => (Array.isArray(meta[k]) ? meta[k].join(", ") : meta[k] ? String(meta[k]) : "");
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0984e3";
    const html = "<!DOCTYPE html><html" + (ms("lang") ? ' lang="' + esc(ms("lang")) + '"' : "") + "><head><meta charset='utf-8'><title>" + esc(ms("title") || docName) + "</title>" +
      (ms("author") ? '<meta name="author" content="' + esc(ms("author")) + '">' : "") +
      (ms("description") ? '<meta name="description" content="' + esc(ms("description")) + '">' : "") +
      "<style>" + EXPORT_CSS.replace("#0984e3", accent) + "</style></head><body>" + tmp.innerHTML + "</body></html>";
    vscode.postMessage({ type: "saveHtml", html });
    render();          // restore the preview's own numbering state
  }

  /* ---------- init ---------- */
  const st = (function () { try { return vscode.getState() || {}; } catch (e) { return {}; } })();
  setTheme(st.theme || "dark");
  setMode(st.mode || "split");
  toggleOutline(!!st.outline);
  render();
  paintEditor();

  /* ---------- Word (.docx) → Markdown (same pipeline as the PWA) ---------- */
  async function importDocx(b64, fileBase) {
    try {
      if (!window.DOCXFMT || !DOCXFMT.toMarkdown) throw new Error("import libraries failed to load");
      const bin = atob(b64); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      // mammoth + table colours / widths, picture sizes, font sizes, alignment, front matter (shared with the PWA)
      const md = await DOCXFMT.toMarkdown(u8.buffer, fileBase || "");
      clearTimeout(editTimer); editTimer = null;
      applying = true; ta.value = foldText(md); applying = false; render();
      vscode.postMessage({ type: "imported", text: md });
    } catch (e) {
      vscode.postMessage({ type: "error", text: "DOCX import failed: " + (e && e.message) });
    }
  }

  vscode.postMessage({ type: "ready" });
})();
