/* DOCXMD — editing in the preview (Typora-like), shared by the PWA (js/app.js)
   and the VS Code webview (media/webview.js).
   Block editor: the ✎ handle next to a block (or a double-click on a code block,
   formula, image, table…) opens that block's Markdown in place; applying writes
   exactly that range of the source. Quick edit: a click on the text of a
   paragraph, heading, list item or table cell makes it editable in place; the
   change is mapped back through MD2DOCX.editContainers to the plain-text part of
   the source it came from. Every change is one undoable edit of the source.
   Smart editing (js/mdedit.js) works here too: in the block editor exactly as in the
   source editor; in the quick edit every key runs on the source — the typed text is
   applied first, then the list / table / line / wrap operation, as one undoable edit —
   and editing continues at the resulting place (a new list item, the next cell…).
   Exposes: window.DOCXMDPreviewEdit.attach({ preview, getText, editRange(s,e,text),
     render(), enabled(), t(key), toast(msg, kind), pasteHtml() })
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
    const ED = () => global.DOCXMDEdit;
    const pasteHtmlOn = o.pasteHtml || (() => true);

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
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeBlockEditor(false); return; }
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); closeBlockEditor(true); return; }
        const E = ED(); if (!E || e.isComposing || e.keyCode === 229) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.shiftKey && (e.key === "V" || e.key === "v")) { ta.__plain = true; return; }
        const r = ctrl && e.shiftKey && (e.key === "T" || e.key === "t")
          ? E.alignTable(ta.value, ta.selectionStart) || { noop: true }
          : E.onKey(ta.value, ta.selectionStart, ta.selectionEnd, { key: e.key, code: e.code, shift: e.shiftKey, alt: e.altKey, ctrl });
        if (!r) return;
        e.preventDefault(); e.stopPropagation();
        taApply(ta, r); fit();
      });
      ta.addEventListener("paste", (e) => {
        const E = ED(); if (!E || !e.clipboardData) return;
        if (ta.__plain) { ta.__plain = false; return; }
        const link = E.pasteLink(ta.value, ta.selectionStart, ta.selectionEnd, e.clipboardData.getData("text/plain"));
        if (link) { e.preventDefault(); taApply(ta, link); fit(); return; }
        if (pasteHtmlOn()) {
          const md = E.htmlToMarkdown(e.clipboardData.getData("text/html"));
          if (md) { e.preventDefault(); taApply(ta, { start: ta.selectionStart, end: ta.selectionEnd, text: md, selStart: ta.selectionStart + md.length, selEnd: ta.selectionStart + md.length }); fit(); }
        }
      });
      ed.addEventListener("click", (e) => { const b = e.target.closest("[data-be]"); if (b) closeBlockEditor(b.dataset.be === "ok"); });
      hideHandle();
      fit(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    // apply an mdedit action inside a textarea (undoable through execCommand)
    function taApply(ta, r) {
      if (!r || r.noop) return;
      if (r.text != null) {
        ta.focus(); ta.setSelectionRange(r.start, r.end);
        let ok = false; try { ok = document.execCommand("insertText", false, r.text); } catch (x) {}
        if (!ok) ta.setRangeText(r.text, r.start, r.end, "end");
      }
      ta.setSelectionRange(r.selStart, r.selEnd);
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
      const rt = (x) => x.replace(/\s+$/, "");          // a trailing blank in the source is not rendered
      const conts = MD2DOCX.editContainers(getText().slice(r.start, r.end), r.start).filter((k) => !k.bad && rt(k.text) === rt(text));
      if (!conts.length) return false;
      // several containers with the same text in this block → pick by order
      const same = $$(QE_CONTAINERS, b.matches(QE_CONTAINERS) ? b.parentElement : b).filter((k) => k.closest("[data-b]") === b && rt(qeText(k)) === rt(text));
      const map = conts[Math.min(conts.length - 1, Math.max(0, same.indexOf(c)))];
      if (!map.leaves.some((L) => L.edit)) return false;
      activateQuick(c, map, text);
      const rng = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (rng && c.contains(rng.startContainer)) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng); }
      return true;
    }
    function activateQuick(c, map, text) {
      hideHandle();
      c.setAttribute("contenteditable", "true");
      c.setAttribute("spellcheck", "true");
      c.classList.add("qe-on");
      pe.quick = { c, map, old: text, src: getText() };
      c.focus();
      c.addEventListener("keydown", qeKey);
      c.addEventListener("blur", qeBlur);
      c.addEventListener("paste", qePaste);
      c.addEventListener("drop", qeDrop);
    }
    function detachQuick() {
      const q = pe.quick; if (!q) return null;
      pe.quick = null;
      const c = q.c;
      c.removeEventListener("keydown", qeKey); c.removeEventListener("blur", qeBlur);
      c.removeEventListener("paste", qePaste); c.removeEventListener("drop", qeDrop);
      c.removeAttribute("contenteditable"); c.classList.remove("qe-on");
      return q;
    }
    // text offset of a DOM point inside a container (counted like qeText)
    function textOffset(c, node, off) {
      let acc = 0, found = null;
      (function walk(n) {
        for (let i = 0; i < n.childNodes.length && found == null; i++) {
          const x = n.childNodes[i];
          if (n === node && i === off) { found = acc; return; }
          if (x === node && x.nodeType === 3) { found = acc + off; return; }
          if (x.nodeType === 3) acc += x.nodeValue.length;
          else if (x.nodeType === 1 && !x.matches(QE_SKIP)) walk(x);
        }
        if (n === node && found == null) found = acc;
      })(c);
      return found == null ? acc : found;
    }
    function domPoint(c, t) {
      let acc = 0, res = null;
      (function walk(n) {
        for (const x of n.childNodes) {
          if (res) return;
          if (x.nodeType === 3) { const L = x.nodeValue.length; if (acc + L >= t) { res = [x, t - acc]; return; } acc += L; }
          else if (x.nodeType === 1 && !x.matches(QE_SKIP)) walk(x);
        }
      })(c);
      return res || [c, c.childNodes.length];
    }
    function setCaret(c, t0, t1) {
      const a = domPoint(c, t0), b = domPoint(c, t1 == null ? t0 : t1);
      const rng = document.createRange(); rng.setStart(a[0], a[1]); rng.setEnd(b[0], b[1]);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rng);
    }
    // Open the quick edit at a source position (after a smart-editing operation)
    function startQuickEditAt(s, e) {
      if (e == null || e < s) e = s;
      const src = getText();
      let n = -1;
      // (marked leaves the trailing blank of an empty item "- " out of the block range)
      const inB = (b) => b && b.start <= s && (s <= b.end || (!src.slice(b.end, s).trim() && src.slice(b.end, s).indexOf("\n") < 0));
      for (let i = 0; i < pe.blocks.length; i++) { if (inB(pe.blocks[i])) { n = i; break; } }
      if (n < 0) return false;
      const r = blockRange(n), els = blockEls(n);
      if (!r || !els.length || r.type === "frontMatter" || !MD2DOCX || !MD2DOCX.editContainers) return false;
      const conts = MD2DOCX.editContainers(src.slice(r.start, r.end), r.start).filter((k) => !k.bad);
      const within = (L, p) => L.edit && L.s <= p && p <= L.s + L.text.length;
      let map = null, L = null;
      for (const k of conts) { L = k.leaves.find((x) => within(x, s)); if (L) { map = k; break; } }
      const roots = els.map((x) => (x.matches(QE_CONTAINERS) ? x.parentElement : x));
      const inBlock = (k) => els.some((x) => x === k || x.contains(k));
      const domConts = () => { const set = new Set(); roots.forEach((rt) => $$(QE_CONTAINERS, rt).forEach((k) => { if (inBlock(k) && qeContainer(k) === k) set.add(k); })); return Array.from(set); };
      let c = null, text = "", t0 = 0, t1 = 0;
      if (map) {
        const same = conts.filter((k) => k.text === map.text), idx = same.indexOf(map);
        const rt = (x) => x.replace(/\s+$/, "");
        const cands = domConts().filter((k) => rt(qeText(k)) === rt(map.text));
        c = cands[Math.min(idx, cands.length - 1)] || null;
        text = c ? qeText(c) : map.text;
        t0 = L.t0 + (s - L.s);
        const L2 = map.leaves.find((x) => within(x, e));
        t1 = L2 ? L2.t0 + (e - L2.s) : t0;
      } else {
        // an empty list item or table cell: an editable point right at s
        const ls = src.lastIndexOf("\n", s - 1) + 1, le = src.indexOf("\n", s) < 0 ? src.length : src.indexOf("\n", s);
        const line = src.slice(ls, le);
        const lm = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line);
        if (lm && s - ls >= lm[0].length && !line.slice(lm[0].length).trim()) {
          let k = 0;
          src.slice(r.start, ls).split("\n").forEach((l) => { if (/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/.test(l)) k++; });
          const lis = []; roots.forEach((rt) => $$("li", rt).forEach((x) => { if (inBlock(x)) lis.push(x); }));
          c = lis[k] || null;
          map = { kind: "text", leaves: [{ s, e: s, t0: 0, t1: 0, text: "", edit: true, kind: "text" }], text: "" };
        } else if (/^[ \t]{0,3}\|/.test(line)) {
          let row = 0;
          src.slice(r.start, ls).split("\n").forEach((l) => { if (/^[ \t]{0,3}\|/.test(l) && !/^[ \t]{0,3}\|?[ \t]*:?-+/.test(l)) row++; });
          let col = 0; for (let i = line.indexOf("|") + 1; i < s - ls; i++) { if (line[i] === "\\") { i++; continue; } if (line[i] === "|") col++; }
          const table = roots.map((rt) => (rt.matches && rt.matches("table") ? rt : rt.querySelector && rt.querySelector("table"))).find(Boolean);
          const tr = table && table.rows[row];
          c = tr && tr.cells[col] || null;
          if (c && qeText(c).trim()) c = null;                  // not empty after all: mapping failed
          map = { kind: "cell", leaves: [{ s, e: s, t0: 0, t1: 0, text: "", edit: true, kind: "text" }], text: "" };
        }
      }
      if (!c) return false;
      activateQuick(c, map, text);
      setCaret(c, t0, t1);
      return true;
    }
    function qeKey(e) {
      const q = pe.quick; if (!q) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); endQuickEdit(false); return; }
      if (e.isComposing || e.keyCode === 229) return;
      const E = ED(), c = q.c, ctrl = e.ctrlKey || e.metaKey;
      const li = c.matches("li"), cell = c.matches("td,th"), para = c.matches("p");
      const collapsed = window.getSelection().isCollapsed;
      const handled = (fn, reopen) => { e.preventDefault(); e.stopPropagation(); return E ? quickOp(fn, reopen) : false; };
      if (e.key === "Enter" && !ctrl && !e.altKey) {
        e.preventDefault();
        if (!e.shiftKey && E) {
          // a list item: a new item right after it (an empty one leaves the list)
          if (li && quickOp((tx, s, en) => E.onEnter(tx, s, en))) return;
          // the middle of a paragraph: split it into two
          if (para && collapsed && quickOp((tx, s, en) => {
            const ls = tx.lastIndexOf("\n", s - 1) + 1, le = tx.indexOf("\n", s) < 0 ? tx.length : tx.indexOf("\n", s);
            if (s === le || s === ls) return null;
            let a = s, b = en;                                    // no blanks left at the split
            while (a > ls && /[ \t]/.test(tx[a - 1])) a--;
            while (b < le && /[ \t]/.test(tx[b])) b++;
            if (a === ls || b === le) return null;
            return { start: a, end: b, text: "\n\n", selStart: a + 2, selEnd: a + 2 };
          })) return;
        }
        endQuickEdit(true); return;
      }
      if (!E) { if (ctrl && /^[biu]$/i.test(e.key)) e.preventDefault(); return; }
      if (e.key === "Tab" && !ctrl && !e.altKey) {
        e.preventDefault(); e.stopPropagation();
        if (li || cell) quickOp((tx, s, en) => E.onTab(tx, s, en, e.shiftKey));
        return;
      }
      if (e.altKey && !ctrl && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // list items / table rows move as lines; any other block swaps with its neighbour
        if (li || cell || e.shiftKey) { handled((tx, s, en) => E.onKey(tx, s, en, { key: e.key, alt: true, shift: e.shiftKey })); return; }
        const n = +c.closest("[data-b]").dataset.b, dir = e.key === "ArrowUp" ? -1 : 1;
        handled((tx, s, en) => moveBlock(tx, s, en, n, dir));
        return;
      }
      if (ctrl && !e.altKey && (e.key === "/" || e.code === "Slash")) { handled((tx, s, en) => E.toggleComment(tx, s, en), false); return; }
      if (ctrl && e.shiftKey && (e.key === "T" || e.key === "t")) { handled((tx, s) => E.alignTable(tx, s) || { noop: true }); return; }
      if (ctrl && !e.shiftKey && !e.altKey && /^[bi]$/i.test(e.key)) {
        e.preventDefault();
        if (!collapsed) quickOp((tx, s, en) => { const m = e.key.toLowerCase() === "b" ? "**" : "*"; return { start: s, end: en, text: m + tx.slice(s, en) + m, selStart: s + m.length, selEnd: en + m.length }; });
        return;
      }
      if (ctrl && /^u$/i.test(e.key)) { e.preventDefault(); return; }
      // a pair character with text selected wraps it: *bold*, ==mark==, `code`, [link]…
      if (!ctrl && !e.altKey && !collapsed && e.key && e.key.length === 1 && /[*_`=~(\["]/.test(e.key)) { handled((tx, s, en) => E.wrapSelection(tx, s, en, e.key)); }
    }
    function qeBlur() { endQuickEdit(true); }
    function qePaste(e) {
      e.preventDefault();
      const plain = (e.clipboardData && e.clipboardData.getData("text/plain")) || "";
      const E = ED();
      if (E) {
        // a URL onto selected text → [text](url)
        if (!window.getSelection().isCollapsed && quickOp((tx, s, en) => E.pasteLink(tx, s, en, plain))) return;
        // formatted text (Word, web pages) → Markdown, written into the source as is
        const md = pasteHtmlOn() ? E.htmlToMarkdown((e.clipboardData && e.clipboardData.getData("text/html")) || "") : null;
        if (md && quickOp((tx, s, en) => {
          const block = md.indexOf("\n") >= 0, ins = block ? "\n\n" + md + "\n\n" : md;
          return { start: s, end: en, text: ins, selStart: s + ins.length, selEnd: s + ins.length };
        }, md.indexOf("\n") < 0)) return;
      }
      document.execCommand("insertText", false, plain.replace(/\s*\r?\n\s*/g, " "));
    }
    function qeDrop(e) { e.preventDefault(); }
    // Markdown-escape typed text so it stays plain text in the source
    function mdEscapeTyped(s, kind) {
      if (kind === "code") return s;
      s = s.replace(/([\\`*\[\]$])/g, "\\$1").replace(/<(?=[A-Za-z\/!?])/g, "&lt;").replace(/==/g, "=\\=")
        .replace(/_/g, (m, i, str) => (/[\p{L}\p{N}]/u.test(str[i - 1] || "") && /[\p{L}\p{N}]/u.test(str[i + 1] || "") ? "_" : "\\_"));
      return kind === "cell" ? s.replace(/\|/g, "\\|") : s;
    }
    // The typed-but-not-committed change of the quick edit as a source edit
    function pendingEdit(q, now) {
      const old = q.old;
      if (now === old) return { none: true };
      let p = 0; while (p < old.length && p < now.length && old[p] === now[p]) p++;
      let sfx = 0; while (sfx < old.length - p && sfx < now.length - p && old[old.length - 1 - sfx] === now[now.length - 1 - sfx]) sfx++;
      const a = p, b = old.length - sfx, ins = now.slice(p, now.length - sfx);
      const Ls = q.map.leaves.filter((L) => L.edit);
      const L = a === b
        ? Ls.find((k) => k.t0 < a && a <= k.t1) || Ls.find((k) => k.t0 <= a && a <= k.t1)
        : Ls.find((k) => k.t0 <= a && b <= k.t1);
      if (!L) return null;
      const kind = L.kind === "code" ? "code" : q.map.kind;
      const esc = mdEscapeTyped(ins, kind);
      return { a, b, ins, kind, start: L.s + (a - L.t0), end: L.s + (b - L.t0), text: esc };
    }
    // text offset in the edited container → source offset (after the pending edit)
    function mapToSource(q, pend, t) {
      const mapOld = (x) => {
        const Ls = q.map.leaves.filter((L) => L.edit);
        const L = Ls.find((k) => k.t0 < x && x <= k.t1) || Ls.find((k) => k.t0 <= x && x <= k.t1);
        return L ? L.s + (x - L.t0) : null;
      };
      if (pend.none || t <= pend.a) return mapOld(t);
      if (t >= pend.a + pend.ins.length) {
        const o = mapOld(t - pend.ins.length + (pend.b - pend.a));
        return o == null ? null : o + pend.text.length - (pend.end - pend.start);
      }
      return pend.start + mdEscapeTyped(pend.ins.slice(0, t - pend.a), pend.kind).length;
    }
    // Swap block n with its neighbour (dir −1 / +1) in tx — tx may already hold the
    // typed text of block n, so n's end is shifted by the length difference.
    function moveBlock(tx, s, e, n, dir) {
      const d = tx.length - getText().length;
      const B = blockRange(n), A = blockRange(n + dir);
      if (!B || !A || A.type === "frontMatter" || B.type === "frontMatter") return { noop: true };
      const bE = B.end + d;
      let out, shift;
      if (dir < 0) {
        out = tx.slice(0, A.start) + tx.slice(B.start, bE) + tx.slice(A.end, B.start) + tx.slice(A.start, A.end) + tx.slice(bE);
        shift = A.start - B.start;
      } else {
        const aS = A.start + d, aE = A.end + d;
        out = tx.slice(0, B.start) + tx.slice(aS, aE) + tx.slice(bE, aS) + tx.slice(B.start, bE) + tx.slice(aE);
        shift = aE - bE;
      }
      return { start: 0, end: tx.length, text: out, selStart: s + shift, selEnd: e + shift };
    }
    // Run fn(text, s, e) → mdedit action on the source with the typed text applied;
    // commit everything as ONE edit and continue editing at the action's selection.
    function quickOp(fn, reopen) {
      const q = pe.quick; if (!q) return false;
      const c = q.c, sel = window.getSelection();
      if (!sel.rangeCount) return false;
      const rg = sel.getRangeAt(0);
      if (!c.contains(rg.startContainer) && rg.startContainer !== c) return false;
      const now = qeText(c).replace(/\u00A0/g, " ").replace(/\n+$/, "");
      if (getText() !== q.src) { detachQuick(); toast(t("pe.changed"), "err"); renderNow(); return true; }
      const pend = pendingEdit(q, now);
      if (!pend) return false;
      let tS = textOffset(c, rg.startContainer, rg.startOffset), tE = textOffset(c, rg.endContainer, rg.endOffset);
      tS = Math.min(tS, now.length); tE = Math.min(tE, now.length);
      const sS = mapToSource(q, pend, tS), sE = mapToSource(q, pend, tE);
      if (sS == null || sE == null) return false;
      const src0 = q.src;
      const src1 = pend.none ? src0 : src0.slice(0, pend.start) + pend.text + src0.slice(pend.end);
      const r = fn(src1, Math.min(sS, sE), Math.max(sS, sE));
      if (!r) return false;
      if (r.noop) return true;
      const fin = r.text != null ? src1.slice(0, r.start) + r.text + src1.slice(r.end) : src1;
      detachQuick();
      if (fin !== src0) {
        let p = 0; while (p < src0.length && p < fin.length && src0[p] === fin[p]) p++;
        let sfx = 0; while (sfx < src0.length - p && sfx < fin.length - p && src0[src0.length - 1 - sfx] === fin[fin.length - 1 - sfx]) sfx++;
        editRange(p, src0.length - sfx, fin.slice(p, fin.length - sfx));
      }
      renderNow();
      if (reopen !== false) startQuickEditAt(r.selStart, r.selEnd);
      return true;
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

    // ---- toolbar actions from the preview (text style: font, size, colour) ----
    // Source range of the current selection: the quick edit (its typed text is committed
    // first) or a plain selection inside one paragraph / list item / table cell. null: none.
    function sourceSelection() {
      if (pe.block) return null;
      if (!pe.quick) {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed || !preview.contains(sel.anchorNode)) return null;
        const rg = sel.getRangeAt(0), c = qeContainer(rg.startContainer);
        const t0 = c ? textOffset(c, rg.startContainer, rg.startOffset) : 0, t1 = c ? textOffset(c, rg.endContainer, rg.endOffset) : 0;
        if (!c || !c.contains(rg.endContainer) || !startQuickEdit(c, -1, -1)) return textSelection(rg);
        setCaret(c, t0, t1);
      }
      let out = null;
      quickOp((tx, s, e) => { out = { s, e }; return { start: s, end: s, text: "", selStart: s, selEnd: e }; }, false);
      if (pe.quick) detachQuick();
      return out && out.e > out.s ? out : null;
    }
    // A selection the quick edit cannot take (HTML blocks, e.g. imported tables): find the
    // selected text in the block's source — the same occurrence (counted in the rendered
    // block before the selection). { s, e } or { unmapped: true }.
    function textSelection(rg) {
      const txt = rg.toString();
      const el = rg.startContainer.nodeType === 1 ? rg.startContainer : rg.startContainer.parentElement;
      const b = el && el.closest("[data-b]");
      const r = b && blockRange(+b.dataset.b);
      if (!txt.trim() || /\n/.test(txt) || !r) return { unmapped: true };
      const src = getText().slice(r.start, r.end);
      const pre = document.createRange(); pre.setStart(b, 0); pre.setEnd(rg.startContainer, rg.startOffset);
      let nth = 0, i = -1; const before = pre.toString();
      while ((i = before.indexOf(txt, i + 1)) >= 0) nth++;
      let at = -1; for (let k = 0; k <= nth; k++) { at = src.indexOf(txt, at + 1); if (at < 0) return { unmapped: true }; }
      return { s: r.start + at, e: r.start + at + txt.length };
    }
    // re-open the quick edit on [s, e) after a toolbar edit (keeps the selection visible)
    function reopenAt(s, e) { try { return startQuickEditAt(s, e); } catch (x) { return false; } }
    // run fn(text, s, e) → mdedit action inside the open block editor; false: none open
    function applyToBlock(fn) {
      const b = pe.block; if (!b) return false;
      const ta = b.ta, r = fn(ta.value, ta.selectionStart, ta.selectionEnd);
      if (r) { taApply(ta, r); ta.dispatchEvent(new Event("input")); }
      return true;
    }

    // a render replaces the preview DOM: close whatever editor is open first
    function beforeRender() { if (pe.block) closeBlockEditor(false); if (pe.quick) endQuickEdit(false); }
    function setBlocks(blocks, src) { pe.blocks = blocks || []; pe.src = src; }
    function close(apply) { if (pe.quick) endQuickEdit(apply); if (pe.block) closeBlockEditor(apply); }
    return { pe, beforeRender, annotateBlocks, setBlocks, close, hideHandle, sourceSelection, reopenAt, applyToBlock, blockRange,
      busy: () => !!(pe.block || pe.quick) };
  }

  global.DOCXMDPreviewEdit = { attach };
})(typeof window !== "undefined" ? window : this);
