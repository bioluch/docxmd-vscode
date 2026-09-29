/* DOCXMD — text style from the toolbar: font, font size and text colour.
   Shared by the PWA (js/app.js) and the VS Code webview (media/webview.js).

   • Text selected (in the Markdown source, in the ✎ block editor or in the preview —
     quick edit or a plain selection inside one paragraph / list item / table cell):
     the selection gets <span style="font-family / font-size / color:…"> (mdedit.styleSpan —
     an existing span around exactly that text is updated, never nested).
   • Nothing selected: font and size apply to the whole document — the `font:` /
     `font-size:` keys of the YAML front matter (preview and DOCX export use them).
     Colour needs a selection.
   Every change is one undoable edit of the source (Ctrl+Z).

   • Bold / italic [data-ts="bold|italic"] (shown in Preview mode): toggle the selection —
     in Markdown text with ** / * (removed again when the selection is wrapped in them),
     in HTML (imported tables, <span> runs of a PDF import) with font-weight / font-style
     on a span; "off" writes normal, so it also works inside a bold cell or heading.
   A selection across several <span> runs / table cells is styled piece by piece (no tag
   boundary is ever wrapped) and stays selected after the edit.

   Exposes: window.DOCXMDTextStyle.attach({ root, source, pe, isPreview, editRange, render,
     t, toast, lastColor }) -> { close(), apply(), target(), toggle(what) } — root holds the
     buttons [data-ts="font|size|color|bold|italic"] */
(function (global) {
  "use strict";
  const FONTS = ["Arial", "Book Antiqua", "Calibri", "Cambria", "Candara", "Century Gothic", "Comic Sans MS", "Consolas",
    "Constantia", "Corbel", "Courier New", "Franklin Gothic Medium", "Garamond", "Georgia", "Palatino Linotype",
    "Play", "Roboto", "Segoe UI", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana"];
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
  // Word's standard colours + greys
  const COLORS = ["#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050", "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0",
    "#000000", "#404040", "#7F7F7F", "#A6A6A6", "#D9D9D9", "#FFFFFF", "#E53935", "#FB8C00", "#43A047", "#1E88E5"];
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PROP = { font: "font-family", size: "font-size", color: "color" };
  const KEY = { font: "font", size: "font-size" };

  function attach(o) {
    const root = o.root, ta = o.source, PE = o.pe || {};
    const t = o.t || ((k) => k), toast = o.toast || (() => {});
    const E = () => global.DOCXMDEdit;
    let pop = null, localFonts = null;
    const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
    let lastColor = store("docxmd:lastColor") || "#C00000";
    const colorBar = root.querySelector("[data-ts=color] i");
    if (colorBar) colorBar.style.background = lastColor;

    function close() {
      if (!pop) return;
      pop.remove(); pop = null;
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("keydown", onEsc, true);
    }
    function outside(e) { if (pop && !pop.contains(e.target) && !e.target.closest("[data-ts]")) close(); }
    function onEsc(e) { if (e.key === "Escape" && pop) { e.stopPropagation(); close(); } }

    // What the style applies to — captured when the button is pressed (before a popover
    // takes the focus): { kind: "src" | "block" | "none", s, e, preview, text }
    function target() {
      const pe = PE.pe || {};
      if (pe.block && pe.block.ta) return { kind: "block", s: pe.block.ta.selectionStart, e: pe.block.ta.selectionEnd };
      const sel = global.getSelection ? global.getSelection() : null;
      const inPreview = o.isPreview() || !!pe.quick || !!(sel && sel.rangeCount && !sel.isCollapsed && o.previewEl && o.previewEl.contains(sel.anchorNode));
      if (inPreview && PE.sourceSelection) {
        const had = !!pe.quick || !!(sel && sel.rangeCount && !sel.isCollapsed && o.previewEl && o.previewEl.contains(sel.anchorNode));
        const r = PE.sourceSelection();
        if (r && r.unmapped) return { kind: "unmapped" };
        // text is selected but cannot be located: never fall back to the whole document
        if (!r && had && sel && !sel.isCollapsed) return { kind: "unmapped" };
        return r ? { kind: "src", s: r.s, e: r.e, segs: r.segs || null, html: !!r.html, preview: true, text: ta.value } : { kind: "none", preview: true };
      }
      return ta.selectionEnd > ta.selectionStart ? { kind: "src", s: ta.selectionStart, e: ta.selectionEnd, text: ta.value } : { kind: "none" };
    }

    function applySrc(r, tg) {
      o.editRange(r.start, r.end, r.text);
      if (tg.preview) { o.render(); if (PE.reopenAt) PE.reopenAt(r.selStart, r.selEnd); }
      else { ta.focus(); ta.setSelectionRange(r.selStart, r.selEnd); if (o.afterEdit) o.afterEdit(); }
      tg.s = r.selStart; tg.e = r.selEnd; tg.text = ta.value; tg.segs = null;
    }
    // fn(text, s, e) → edit, run on every piece of the selection (last first, so the
    // earlier offsets stay valid); all of it becomes ONE edit of the source
    function editSegs(text, tg, fn) {
      const segs = tg.segs && tg.segs.length ? tg.segs : [[tg.s, tg.e]];
      let work = text, selStart = null, selEnd = null;
      for (let i = segs.length - 1; i >= 0; i--) {
        const r = fn(work, segs[i][0], segs[i][1]);
        if (!r || r.noop) continue;
        work = work.slice(0, r.start) + r.text + work.slice(r.end);
        const d = r.text.length - (r.end - r.start);
        selEnd = selEnd == null ? r.selEnd : selEnd + d;
        selStart = r.selStart;
      }
      if (selStart == null || work === text) return null;
      let p = 0; while (p < text.length && p < work.length && text[p] === work[p]) p++;
      let sfx = 0; while (sfx < text.length - p && sfx < work.length - p && text[text.length - 1 - sfx] === work[work.length - 1 - sfx]) sfx++;
      return { start: p, end: text.length - sfx, text: work.slice(p, work.length - sfx), selStart, selEnd };
    }
    // what: font | size | color; value "" = default / automatic
    function apply(tg, what, value) {
      const ed = E(); if (!ed) return;
      const prop = PROP[what];
      if (tg.kind === "block" && tg.e > tg.s) {
        PE.applyToBlock((tx) => { const r = ed.styleSpan(tx, tg.s, tg.e, prop, value); if (r) { tg.s = r.selStart; tg.e = r.selEnd; } return r; });
        return;
      }
      if (tg.kind === "src" && tg.e > tg.s) {
        if (ta.value !== tg.text) { toast(t("style.changed"), "err"); return; }
        const r = editSegs(ta.value, tg, (tx, s, e) => ed.styleSpan(tx, s, e, prop, value));
        if (r) applySrc(r, tg);
        return;
      }
      if (what === "color") { toast(t("style.selectText"), "err"); return; }
      // nothing selected: the whole document (front matter)
      const r = ed.setFrontMatter(ta.value, KEY[what], value, ta.selectionStart, ta.selectionEnd);
      if (!r) return;
      o.editRange(r.start, r.end, r.text);
      o.render();
      toast(value ? t("style.docApplied", { v: value }) : t("style.docReset"), "ok");
    }

    // ---- bold / italic ----
    const MARKS = { bold: ["**", "__"], italic: ["*", "_"] };
    const TAGS = { bold: ["strong", "b"], italic: ["em", "i"] };
    // is every character of the preview selection already bold / italic?
    function selectionHas(what) {
      const sel = global.getSelection ? global.getSelection() : null;
      if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
      const rg = sel.getRangeAt(0);
      const root = rg.commonAncestorContainer.nodeType === 1 ? rg.commonAncestorContainer : rg.commonAncestorContainer.parentElement;
      const nodes = [];
      if (rg.commonAncestorContainer.nodeType === 3) nodes.push(rg.commonAncestorContainer);
      else {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let x = w.nextNode(); x; x = w.nextNode()) {
          if (!rg.intersectsNode(x) || !x.nodeValue.trim()) continue;
          // only touched at a boundary: none of its characters is selected
          if ((x === rg.startContainer && rg.startOffset >= x.nodeValue.length) || (x === rg.endContainer && rg.endOffset === 0)) continue;
          nodes.push(x);
        }
      }
      if (!nodes.length) return null;
      return nodes.every((x) => {
        const cs = getComputedStyle(x.parentElement);
        return what === "bold" ? (parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400)) >= 600 : /italic|oblique/.test(cs.fontStyle);
      });
    }
    // Toggle one piece [s, e) of the source; on = the text is bold / italic now
    function toggleSeg(tx, s, e, what, on, html) {
      while (s < e && /\s/.test(tx[s])) s++;
      while (e > s && /\s/.test(tx[e - 1])) e--;
      if (e <= s) return null;
      const ed = E(), prop = what === "bold" ? "font-weight" : "font-style";
      if (!html) {
        for (const m of MARKS[what]) {
          const l = m.length;
          if (tx.slice(s - l, s) !== m || tx.slice(e, e + l) !== m) continue;
          // "*" must not be half of a "**" (bold) around the selection
          if (what === "italic" && tx[s - l - 1] === m && tx[e + l] === m && tx[s - l - 2] !== m) continue;
          if (on) return { start: s - l, end: e + l, text: tx.slice(s, e), selStart: s - l, selEnd: e - l };
          return null;                                          // already marked: nothing to add
        }
      }
      for (const tag of TAGS[what]) {
        const open = new RegExp("<" + tag + ">$", "i").exec(tx.slice(Math.max(0, s - 10), s));
        const close = new RegExp("^</" + tag + ">", "i").exec(tx.slice(e, e + 10));
        if (open && close && on) return { start: s - open[0].length, end: e + close[0].length, text: tx.slice(s, e), selStart: s - open[0].length, selEnd: e - open[0].length };
      }
      if (!html && !on) { const m = MARKS[what][0]; return { start: s, end: e, text: m + tx.slice(s, e) + m, selStart: s + m.length, selEnd: e + m.length }; }
      return ed.styleSpan(tx, s, e, prop, on ? "normal" : (what === "bold" ? "bold" : "italic"));
    }
    function toggle(what) {
      close();
      const ed = E(); if (!ed) return;
      const has = selectionHas(what);
      const tg = target();
      if (tg.kind === "unmapped") { toast(t("style.unmapped"), "err"); return; }
      if (tg.kind === "block") {
        if (tg.e <= tg.s) { toast(t("style.selectText"), "err"); return; }
        PE.applyToBlock((tx) => {
          const r = toggleSeg(tx, tg.s, tg.e, what, (() => { const m = MARKS[what][0]; return tx.slice(tg.s - m.length, tg.s) === m && tx.slice(tg.e, tg.e + m.length) === m; })(), false);
          if (r) { tg.s = r.selStart; tg.e = r.selEnd; }
          return r;
        });
        return;
      }
      if (tg.kind !== "src" || tg.e <= tg.s) { toast(t("style.selectText"), "err"); return; }
      if (ta.value !== tg.text) { toast(t("style.changed"), "err"); return; }
      const r = editSegs(ta.value, tg, (tx, s, e) => toggleSeg(tx, s, e, what, !!has, tg.html));
      if (r) applySrc(r, tg);
      else if (tg.preview && PE.reopenAt) PE.reopenAt(tg.s, tg.e);
    }

    function docValue(what) {
      const M = global.MD2DOCX, f = M && M.docFont ? M.docFont(ta.value) : null;
      return f ? (what === "font" ? f.family : f.size) : "";
    }
    function open(what, btn, tg) {
      close();
      pop = document.createElement("div");
      pop.className = "popover ts-pop";
      pop.dataset.ts = what;
      const scope = '<div class="ts-scope">' + esc(tg.kind === "none" ? t("style.scopeDoc") : t("style.scopeSel")) + "</div>";
      const cur = tg.kind === "none" ? docValue(what) : "";
      const mark = (v) => (cur && String(v).toLowerCase() === String(cur).toLowerCase() ? " on" : "");
      if (what === "font") {
        const list = (localFonts || FONTS);
        pop.innerHTML = '<div class="pop-head"><b>' + esc(t("tb.fontFamily")) + "</b></div>" + scope +
          (localFonts ? '<input class="ts-filter" type="search" placeholder="' + esc(t("style.search")) + '">' : "") +
          '<div class="ts-list">' +
          '<button class="pop-item ts-item" data-v="">' + esc(t("style.default")) + "</button>" +
          list.map((f) => '<button class="pop-item ts-item' + mark(f) + '" data-v="' + esc(f) + '" style="font-family:&quot;' + esc(f) + '&quot;,sans-serif">' + esc(f) + "</button>").join("") +
          "</div>" +
          (!localFonts && global.queryLocalFonts ? '<button class="pop-item ts-more" data-more="1">' + esc(t("style.more")) + "</button>" : "");
      } else if (what === "size") {
        pop.innerHTML = '<div class="pop-head"><b>' + esc(t("tb.fontSize")) + "</b></div>" + scope +
          '<div class="ts-sizes">' + SIZES.map((n) => '<button class="ts-size' + mark(n + "pt") + '" data-v="' + n + 'pt">' + n + "</button>").join("") + "</div>" +
          '<button class="pop-item ts-item" data-v="">' + esc(t("style.default")) + "</button>";
      } else {
        pop.innerHTML = '<div class="pop-head"><b>' + esc(t("tb.fontColor")) + "</b></div>" + scope +
          '<div class="ts-swatches">' + COLORS.map((c) => '<button class="ts-sw" data-v="' + c + '" title="' + c + '" style="background:' + c + '"></button>').join("") + "</div>" +
          '<div class="ts-row"><label class="ts-custom">' + esc(t("style.custom")) + ' <input type="color" value="' + esc(lastColor) + '"></label>' +
          '<button class="pop-item ts-item" data-v="">' + esc(t("style.auto")) + "</button></div>";
      }
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
      pop.style.top = (r.bottom + 6) + "px";
      pop.style.left = Math.max(8, Math.min(r.left, global.innerWidth - w - 8)) + "px";
      pop.addEventListener("mousedown", (e) => { if (!e.target.closest("input")) e.preventDefault(); });   // keep the selection
      pop.addEventListener("click", async (e) => {
        if (e.target.closest("[data-more]")) {
          try {
            const fonts = await global.queryLocalFonts();
            localFonts = Array.from(new Set(fonts.map((f) => f.family))).sort((a, b) => a.localeCompare(b));
          } catch (x) { toast(t("style.localDenied"), "err"); return; }
          open("font", btn, tg);
          return;
        }
        const b = e.target.closest("[data-v]"); if (!b) return;
        const v = b.dataset.v;
        if (what === "color" && v) { lastColor = v; store("docxmd:lastColor", v); if (colorBar) colorBar.style.background = v; }
        close();
        apply(tg, what, v);
      });
      const inp = pop.querySelector("input[type=color]");
      if (inp) inp.addEventListener("change", () => {
        const v = inp.value.toUpperCase();
        lastColor = v; store("docxmd:lastColor", v); if (colorBar) colorBar.style.background = v;
        close(); apply(tg, "color", v);
      });
      const flt = pop.querySelector(".ts-filter");
      if (flt) { flt.focus(); flt.addEventListener("input", () => { const q = flt.value.trim().toLowerCase(); pop.querySelectorAll(".ts-list [data-v]").forEach((x) => { x.hidden = q && x.dataset.v && x.dataset.v.toLowerCase().indexOf(q) < 0; }); }); }
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", onEsc, true);
    }

    // keep the focus / selection where it is when a style button is pressed
    root.addEventListener("mousedown", (e) => { if (e.target.closest("[data-ts]")) e.preventDefault(); });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-ts]"); if (!b || !root.contains(b)) return;
      const what = b.dataset.ts;
      if (what === "bold" || what === "italic") { toggle(what); return; }
      if (pop && pop.dataset.ts === what) { close(); return; }   // second click closes
      const tg = target();
      // selected text we cannot locate in the source: never fall back to the whole document
      if (tg.kind === "unmapped") { toast(t("style.unmapped"), "err"); return; }
      open(what, b, tg);
    });
    return { close, apply, target, toggle };
  }

  global.DOCXMDTextStyle = { attach, FONTS, SIZES, COLORS };
})(typeof window !== "undefined" ? window : this);
