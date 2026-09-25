/* DOCXMD — editing in the preview (Typora-like), shared by the PWA (js/app.js)
   and the VS Code webview (media/webview.js).
   Block editor: the ✎ handle next to a block (or a double-click on a code block,
   formula, image, table…) opens that block's Markdown in place; applying writes
   exactly that range of the source. Quick edit: a click on the text of a
   paragraph, heading, list item or table cell makes it editable in place; the
   change is mapped back through MD2DOCX.editContainers to the plain-text part of
   the source it came from. Every change is one undoable edit of the source.
   Exposes: window.DOCXMDPreviewEdit.attach({ preview, getText, editRange(s,e,text),
     render(), enabled(), t(key), toast(msg, kind) })
     -> { pe, annotateBlocks(root), setBlocks(blocks, src), close(apply), hideHandle(),
          busy() } */
(function (global) {
  "use strict";
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const escapeHtml = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function attach(o) {
    const preview = o.preview, getText = o.getText, enabled = o.enabled || (() => true);
    const t = o.t || ((k) => k), toast = o.toast || (() => {});
    const renderNow = () => o.render();
    const editRange = (s, e, text) => o.editRange(s, e, text);
    const MD2DOCX = global.MD2DOCX;

    /* ---------------- Editing in the preview (Typora-like) ----------------
       Block editor: the ✎ handle next to a block (or a double-click on a code block,
       formula, image, table…) opens that block's Markdown in place; applying writes
       exactly that range of the source. Quick edit: a click on the text of a
       paragraph, heading, list item or table cell makes it editable in place; the
       change is mapped back through MD2DOCX.editContainers to the plain-text part of
       the source it came from, so formatting, links and formulas are never rewritten.
       Every change is one undoable edit of the source (Ctrl+Z). */
    const pe = { blocks: [], src: "", block: null, quick: null, handle: null };
    const previewEditOn = () => !!enabled();
    // <i class="bm" data-b="N"> markers → data-b on the block's elements; markers removed
    function annotateBlocks(root) {
      $$("i.bm[data-b]", root).forEach((m) => {
        const n = m.dataset.b;
        for (let x = m.nextSibling; x && !(x.nodeType === 1 && x.matches("i.bm")); x = x.nextSibling) {
          if (x.nodeType === 1 && !x.hasAttribute("data-b")) x.setAttribute("data-b", n);
        }
      });
      $$("i.bm", root).forEach((m) => m.remove());
    }
    function blockRange(n) {
      const b = pe.blocks[n];
      if (!b || pe.src !== getText()) return null;
      let end = b.end;
      while (end > b.start && /\s/.test(pe.src[end - 1])) end--;
      return { start: b.start, end, type: b.type };
    }
    const blockEls = (n) => $$('[data-b="' + n + '"]', preview).filter((x) => !x.parentElement.closest('[data-b="' + n + '"]'));

    // ---- ✎ handle ----
    function ensureHandle() {
      if (pe.handle) return pe.handle;
      const h = document.createElement("button");
      h.className = "pe-handle"; h.type = "button"; h.textContent = "✎";
      h.title = t("pe.editBlock");
      h.addEventListener("mousedown", (e) => e.preventDefault());
      h.addEventListener("click", (e) => { e.stopPropagation(); const n = h.dataset.b; hideHandle(); if (n != null) openBlockEditor(+n); });
      preview.parentElement.appendChild(h);
      return (pe.handle = h);
    }
    function hideHandle() { if (pe.handle) pe.handle.classList.remove("show"); }
    preview.addEventListener("mousemove", (e) => {
      if (!previewEditOn() || pe.block) { hideHandle(); return; }
      const b = e.target.closest && e.target.closest("[data-b]");
      if (!b || !preview.contains(b) || blockRange(+b.dataset.b) == null) { hideHandle(); return; }
      let top = b; while (top.parentElement && top.parentElement !== preview && top.parentElement.closest("[data-b]")) top = top.parentElement.closest("[data-b]");
      const h = ensureHandle(), pane = preview.parentElement;
      const pr = pane.getBoundingClientRect(), br = b.getBoundingClientRect(), prv = preview.getBoundingClientRect();
      h.dataset.b = b.dataset.b;
      h.style.top = (br.top - pr.top + pane.scrollTop + 2) + "px";
      h.style.left = Math.max(2, prv.left - pr.left + parseFloat(getComputedStyle(preview).paddingLeft) - 30) + "px";
      h.classList.add("show");
    });
    preview.parentElement.addEventListener("mouseleave", hideHandle);

    // ---- block editor ----
    function openBlockEditor(n) {
      if (pe.quick) endQuickEdit(true);
      if (pe.block) closeBlockEditor(true);
      const r = blockRange(n), els = blockEls(n);
      if (!r || !els.length) return;
      const ed = document.createElement("div");
      ed.className = "block-editor";
      ed.innerHTML = '<textarea spellcheck="true"></textarea><div class="be-bar"><span class="be-hint">' + escapeHtml(t("pe.hint")) + "</span>" +
        '<button class="btn ghost" data-be="cancel" type="button">' + escapeHtml(t("btn.cancel")) + '</button><button class="btn" data-be="ok" type="button">' + escapeHtml(t("pe.apply")) + "</button></div>";
      const first = els[0].parentElement && els[0].parentElement.classList.contains("tbl-wrap") ? els[0].parentElement : els[0];
      first.parentNode.insertBefore(ed, first);
      const hidden = els.map((x) => (x.parentElement && x.parentElement.classList.contains("tbl-wrap") ? x.parentElement : x));
      hidden.forEach((x) => x.classList.add("be-hidden"));
      const ta = ed.querySelector("textarea");
      ta.value = getText().slice(r.start, r.end);
      const fit = () => { ta.style.height = "auto"; ta.style.height = Math.min(window.innerHeight * 0.7, ta.scrollHeight + 4) + "px"; };
      pe.block = { n, r, ed, hidden, orig: ta.value, ta };
      ta.addEventListener("input", fit);
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBlockEditor(false); }
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); closeBlockEditor(true); }
        else if (e.key === "Tab") {
          e.preventDefault();
          try { if (!document.execCommand("insertText", false, "    ")) throw 0; } catch (x) { const p = ta.selectionStart; ta.setRangeText("    ", p, ta.selectionEnd, "end"); }
        }
      });
      ed.addEventListener("click", (e) => { const b = e.target.closest("[data-be]"); if (b) closeBlockEditor(b.dataset.be === "ok"); });
      hideHandle();
      fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    // apply: write the block back (one undoable edit); otherwise just restore the view
    function closeBlockEditor(apply) {
      const b = pe.block; if (!b) return;
      pe.block = null;
      const v = b.ta.value;
      b.ed.remove();
      b.hidden.forEach((x) => x.classList.remove("be-hidden"));
      if (!apply || v === b.orig) return;
      if (getText().slice(b.r.start, b.r.end) !== b.orig) { toast(t("pe.changed"), "err"); renderNow(); return; }
      editRange(b.r.start, b.r.end, v);
      renderNow();
    }
    // a click outside the open block editor applies it (as leaving a block in Typora)
    document.addEventListener("mousedown", (e) => {
      if (pe.block && !pe.block.ed.contains(e.target) && !e.target.closest(".modal-scrim,.pe-handle")) closeBlockEditor(true);
    }, true);

    // ---- quick text edit ----
    const QE_CONTAINERS = "p,h1,h2,h3,h4,h5,h6,li,td,th";
    const QE_EXCLUDE = ".katex,.katex-ph,nav.toc,.footnotes,figcaption,.tbl-caption,.callout-title,.fm-card,pre,.welcome,.block-editor";
    const QE_SKIP = "img,input,br,.katex,.katex-ph,sup.fn-ref,a.xref,.xref-missing,.hnum,ul,ol,p,table,pre,blockquote,div,figure,details";
    // the rendered text of a container the way the source map counts it
    function qeText(c) {
      let s = "";
      (function walk(n) {
        for (const x of n.childNodes) {
          if (x.nodeType === 3) s += x.nodeValue;
          else if (x.nodeType === 1 && !x.matches(QE_SKIP)) walk(x);
        }
      })(c);
      return s;
    }
    function qeContainer(node) {
      const e = node && (node.nodeType === 1 ? node : node.parentElement);
      if (!e || !preview.contains(e) || e.closest(QE_EXCLUDE)) return null;
      let c = e.closest(QE_CONTAINERS);
      if (!c || !preview.contains(c)) return null;
      if (c.matches("li") && c.querySelector(":scope > p")) return null;     // loose item: its <p> is the container
      return c.closest("[data-b]") ? c : null;
    }
    function startQuickEdit(c, x, y) {
      const b = c.closest("[data-b]"), n = +b.dataset.b, r = blockRange(n);
      if (!r || r.type === "frontMatter" || !window.MD2DOCX || !MD2DOCX.editContainers) return false;
      const text = qeText(c);
      if (!text.trim()) return false;
      const conts = MD2DOCX.editContainers(getText().slice(r.start, r.end), r.start).filter((k) => !k.bad && k.text === text);
      if (!conts.length) return false;
      // several containers with the same text in this block → pick by order
      const same = $$(QE_CONTAINERS, b.matches(QE_CONTAINERS) ? b.parentElement : b).filter((k) => k.closest("[data-b]") === b && qeText(k) === text);
      const map = conts[Math.min(conts.length - 1, Math.max(0, same.indexOf(c)))];
      if (!map.leaves.some((L) => L.edit)) return false;
      hideHandle();
      c.setAttribute("contenteditable", "true");
      c.setAttribute("spellcheck", "true");
      c.classList.add("qe-on");
      pe.quick = { c, map, old: text, src: getText() };
      c.focus();
      const rng = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (rng && c.contains(rng.startContainer)) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng); }
      c.addEventListener("keydown", qeKey);
      c.addEventListener("blur", qeBlur);
      c.addEventListener("paste", qePaste);
      c.addEventListener("drop", qeDrop);
      return true;
    }
    function qeKey(e) {
      if (e.key === "Enter") { e.preventDefault(); endQuickEdit(true); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endQuickEdit(false); }
      else if ((e.ctrlKey || e.metaKey) && /^[biu]$/i.test(e.key)) e.preventDefault();   // plain text only
    }
    function qeBlur() { endQuickEdit(true); }
    function qePaste(e) {
      e.preventDefault();
      const txt = ((e.clipboardData && e.clipboardData.getData("text/plain")) || "").replace(/\s*\r?\n\s*/g, " ");
      document.execCommand("insertText", false, txt);
    }
    function qeDrop(e) { e.preventDefault(); }
    // Markdown-escape typed text so it stays plain text in the source
    function mdEscapeTyped(s, kind) {
      if (kind === "code") return s;
      s = s.replace(/([\\`*\[\]$])/g, "\\$1").replace(/<(?=[A-Za-z\/!?])/g, "&lt;").replace(/==/g, "=\\=")
        .replace(/_/g, (m, i, str) => (/[\p{L}\p{N}]/u.test(str[i - 1] || "") && /[\p{L}\p{N}]/u.test(str[i + 1] || "") ? "_" : "\\_"));
      return kind === "cell" ? s.replace(/\|/g, "\\|") : s;
    }
    function endQuickEdit(commit) {
      const q = pe.quick; if (!q) return;
      pe.quick = null;
      const c = q.c;
      c.removeEventListener("keydown", qeKey); c.removeEventListener("blur", qeBlur);
      c.removeEventListener("paste", qePaste); c.removeEventListener("drop", qeDrop);
      c.removeAttribute("contenteditable"); c.classList.remove("qe-on");
      const now = qeText(c).replace(/\u00A0/g, " ").replace(/\n+$/, "");
      if (!commit || now === q.old) { if (now !== q.old) renderNow(); return; }
      if (getText() !== q.src) { toast(t("pe.changed"), "err"); renderNow(); return; }
      // the changed span: common prefix / suffix of the old and new text
      const old = q.old;
      let p = 0; while (p < old.length && p < now.length && old[p] === now[p]) p++;
      let sfx = 0; while (sfx < old.length - p && sfx < now.length - p && old[old.length - 1 - sfx] === now[now.length - 1 - sfx]) sfx++;
      const a = p, b = old.length - sfx, ins = now.slice(p, now.length - sfx);
      const Ls = q.map.leaves.filter((L) => L.edit);
      // the whole change must lie inside one plain-text piece of the source
      const L = a === b
        ? Ls.find((k) => k.t0 < a && a <= k.t1) || Ls.find((k) => k.t0 <= a && a <= k.t1)   // typing: stay in the piece before the caret
        : Ls.find((k) => k.t0 <= a && b <= k.t1);
      if (!L) { toast(t("pe.boundary"), "err"); renderNow(); return; }
      const kind = L.kind === "code" ? "code" : q.map.kind;
      editRange(L.s + (a - L.t0), L.s + (b - L.t0), mdEscapeTyped(ins, kind));
      renderNow();
    }
    preview.addEventListener("click", (e) => {
      if (!previewEditOn() || pe.quick || pe.block || e.defaultPrevented || e.button !== 0) return;
      if (e.altKey) {                                       // Alt+click: edit the whole block
        const b = e.target.closest("[data-b]");
        if (b && preview.contains(b)) { e.preventDefault(); openBlockEditor(+b.dataset.b); }
        return;
      }
      if (e.target.closest("a[href],input,button,img,.katex,summary,.pe-handle,.img-rs-handle")) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;                  // selecting text to copy
      const c = qeContainer(e.target);
      if (c && startQuickEdit(c, e.clientX, e.clientY)) return;
    });
    // a double-click on a block without editable text (code, formula, image, rule…) opens its editor
    preview.addEventListener("dblclick", (e) => {
      if (!previewEditOn() || pe.block || pe.quick) return;
      if (e.target.closest("a[href],input,button,.img-rs-handle")) return;
      const b = e.target.closest("[data-b]");
      if (b && preview.contains(b)) { e.preventDefault(); window.getSelection().removeAllRanges(); openBlockEditor(+b.dataset.b); }
    });

    // a render replaces the preview DOM: close whatever editor is open first
    function beforeRender() { if (pe.block) closeBlockEditor(false); if (pe.quick) endQuickEdit(false); }
    function setBlocks(blocks, src) { pe.blocks = blocks || []; pe.src = src; }
    function close(apply) { if (pe.quick) endQuickEdit(apply); if (pe.block) closeBlockEditor(apply); }
    return { pe, beforeRender, annotateBlocks, setBlocks, close, hideHandle, busy: () => !!(pe.block || pe.quick) };
  }

  global.DOCXMDPreviewEdit = { attach };
})(typeof window !== "undefined" ? window : this);
