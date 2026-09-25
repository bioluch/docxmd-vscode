/* DOCXMD — smart Markdown editing (pure functions, no DOM except htmlToMarkdown).
   Shared by the PWA (js/app.js) and the VS Code webview (media/webview.js).

   Every function takes the text and the selection [s, e) and returns either null
   (let the browser do its default) or an action:
     { start, end, text, selStart, selEnd }   replace [start, end) with text, then select
     { selStart, selEnd }                     only move the selection (no edit)
     { noop: true }                           swallow the key, change nothing
   The shells apply edits through the textarea (execCommand) so they are undoable.

   Exposes: window.DOCXMDEdit = { onKey, pasteLink, htmlToMarkdown, alignTable,
     isRichHtml, styleSpan, setFrontMatter, lineStart, lineEnd } */
(function (global) {
  "use strict";

  const lineStart = (t, i) => t.lastIndexOf("\n", i - 1) + 1;
  const lineEnd = (t, i) => { const n = t.indexOf("\n", i); return n < 0 ? t.length : n; };
  const LIST_RE = /^([ \t]*(?:>[ \t]?)*[ \t]*)(?:([-*+])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
  const QUOTE_RE = /^([ \t]*(?:>[ \t]?)+)/;
  const TABLE_ROW_RE = /^[ \t]{0,3}\|.*\|?[ \t]*$/;
  const TABLE_SEP_RE = /^[ \t]{0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/;
  const width = (s) => s.replace(/\t/g, "    ").length;
  const indentOf = (line) => width(/^[ \t]*/.exec(line)[0]);

  // Is position i inside a fenced code block (``` / ~~~)?
  function inFence(text, i) {
    const before = text.slice(0, lineStart(text, i));
    let fence = null;
    for (const line of before.split("\n")) {
      const f = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      if (!f) continue;
      if (!fence) fence = f[1];
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
    }
    return !!fence;
  }

  // Lines [ls, le) covering the selection (a selection ending at a line start does not take that line)
  function blockOf(text, s, e) {
    const ls = lineStart(text, s);
    let endPos = e > s && text[e - 1] === "\n" ? e - 1 : e;
    if (endPos < ls) endPos = ls;
    return { ls, le: lineEnd(text, endPos) };
  }

  /* ---------- Enter: continue lists, quotes, task items and table rows ---------- */
  function onEnter(text, s, e) {
    if (s !== e || inFence(text, s)) return null;
    const ls = lineStart(text, s), le = lineEnd(text, s), line = text.slice(ls, le);
    const col = s - ls;

    // table row, caret at the end → a new empty row with the same number of cells
    if (TABLE_ROW_RE.test(line) && !TABLE_SEP_RE.test(line) && s === le && line.trim().length > 1) {
      const next = text.slice(le + 1, lineEnd(text, le + 1));
      if (!TABLE_SEP_RE.test(next)) {
        const n = cells(line).length || 1;
        const lead = /^[ \t]*/.exec(line)[0];
        const row = lead + "|" + "  |".repeat(n);
        return { start: s, end: s, text: "\n" + row, selStart: s + 1 + lead.length + 2, selEnd: s + 1 + lead.length + 2 };
      }
    }

    const m = LIST_RE.exec(line);
    if (m) {
      if (col < m[0].length) return null;                  // caret inside the marker
      const content = line.slice(m[0].length);
      if (!content.trim() && s === le) {
        // empty item: a nested one moves out one level, a top-level one ends the list
        if (indentOf(m[1]) > 0 && !/>/.test(m[1])) {
          const r = shiftList(text, ls, le, -1, s, e);
          if (r && !r.noop) return r;
        }
        const keep = m[1].replace(/[ \t]+$/, "").replace(/^[ \t]+$/, "");
        return { start: ls, end: le, text: keep, selStart: ls + keep.length, selEnd: ls + keep.length };
      }
      const marker = m[2] ? m[2] : (+m[3] + 1) + m[4];
      const ins = "\n" + m[1] + marker + m[5] + (m[6] ? "[ ] " : "");
      return { start: s, end: s, text: ins, selStart: s + ins.length, selEnd: s + ins.length };
    }

    const q = QUOTE_RE.exec(line);
    if (q) {
      if (col < q[0].length) return null;
      if (!line.slice(q[0].length).trim() && s === le) {       // empty quote line ends the quote
        return { start: ls, end: le, text: "", selStart: ls, selEnd: ls };
      }
      const pre = q[1].endsWith(" ") ? q[1] : q[1] + " ";
      return { start: s, end: s, text: "\n" + pre, selStart: s + 1 + pre.length, selEnd: s + 1 + pre.length };
    }
    return null;
  }

  /* ---------- tables ---------- */
  // cell boundaries of a table row: [{s, e}] relative to the line (content between pipes)
  function cellRanges(line) {
    const pipes = [];
    for (let i = 0; i < line.length; i++) {
      if (line[i] === "\\") { i++; continue; }
      if (line[i] === "|") pipes.push(i);
    }
    const out = [];
    const lead = /^[ \t]*/.exec(line)[0].length;
    const startsWithPipe = pipes.length && pipes[0] === lead;
    const bounds = startsWithPipe ? pipes : [lead - 1].concat(pipes);
    for (let k = 0; k < bounds.length; k++) {
      const a = bounds[k] + 1, b = k + 1 < bounds.length ? bounds[k + 1] : line.length;
      if (k + 1 >= bounds.length && !line.slice(a).trim()) break;     // trailing pipe
      out.push({ s: a, e: b });
    }
    return out;
  }
  function cells(line) { return cellRanges(line).map((c) => line.slice(c.s, c.e).trim()); }
  function trimRange(line, c) {
    let a = c.s, b = c.e;
    while (a < b && /\s/.test(line[a])) a++;
    while (b > a && /\s/.test(line[b - 1])) b--;
    if (a === b) { a = Math.min(c.s + 1, c.e); b = a; }                 // empty cell: caret after "| "
    return { a, b };
  }
  function tableTab(text, s, dir) {
    const ls = lineStart(text, s), le = lineEnd(text, s), line = text.slice(ls, le);
    if (!TABLE_ROW_RE.test(line) || TABLE_SEP_RE.test(line)) return null;
    const rs = cellRanges(line);
    if (rs.length < 1) return null;
    let cur = rs.findIndex((c) => s - ls >= c.s && s - ls <= c.e);
    if (cur < 0) cur = dir > 0 ? -1 : rs.length;
    const target = cur + dir;
    if (target >= 0 && target < rs.length) {
      const r = trimRange(line, rs[target]);
      return { selStart: ls + r.a, selEnd: ls + r.b };
    }
    // wrap to the next / previous row (skipping the separator row)
    let pos = dir > 0 ? le + 1 : ls - 1;
    while (pos >= 0 && pos <= text.length) {
      const a = lineStart(text, pos), b = lineEnd(text, pos), l = text.slice(a, b);
      if (!TABLE_ROW_RE.test(l)) break;
      if (!TABLE_SEP_RE.test(l)) {
        const cr = cellRanges(l); if (!cr.length) break;
        const r = trimRange(l, cr[dir > 0 ? 0 : cr.length - 1]);
        return { selStart: a + r.a, selEnd: a + r.b };
      }
      pos = dir > 0 ? b + 1 : a - 1;
      if (dir > 0 && b >= text.length) break;
    }
    if (dir > 0) {                                  // after the last cell of the last row → a new row
      const lead = /^[ \t]*/.exec(line)[0];
      const row = lead + "|" + "  |".repeat(rs.length);
      return { start: le, end: le, text: "\n" + row, selStart: le + 1 + lead.length + 2, selEnd: le + 1 + lead.length + 2 };
    }
    return { noop: true };
  }

  // East Asian wide characters and emoji take two columns in a monospace font
  const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/g;
  const colWidth = (s) => s.length + (s.match(WIDE) || []).length - (s.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || []).length;

  /* Align the pipe table around pos: pad every cell to its column width. */
  function alignTable(text, pos) {
    let ls = lineStart(text, pos), le = lineEnd(text, pos);
    if (!TABLE_ROW_RE.test(text.slice(ls, le))) return null;
    while (ls > 0) { const a = lineStart(text, ls - 1), l = text.slice(a, ls - 1); if (!TABLE_ROW_RE.test(l)) break; ls = a; }
    while (le < text.length) { const b = lineEnd(text, le + 1), l = text.slice(le + 1, b); if (!TABLE_ROW_RE.test(l) || le + 1 > text.length) break; le = b; }
    const lines = text.slice(ls, le).split("\n");
    const sepIdx = lines.findIndex((l) => TABLE_SEP_RE.test(l));
    if (sepIdx < 1) return null;
    const lead = /^[ \t]*/.exec(lines[0])[0];
    const rows = lines.map((l) => cells(l));
    const n = Math.max.apply(null, rows.map((r) => r.length));
    const align = rows[sepIdx].map((c) => (/^:-+:$/.test(c) ? "c" : /^-+:$/.test(c) ? "r" : /^:-+$/.test(c) ? "l" : ""));
    const w = new Array(n).fill(3);
    rows.forEach((r, i) => { if (i !== sepIdx) r.forEach((c, k) => { w[k] = Math.max(w[k], colWidth(c)); }); });
    const pad = (c, k) => {
      const gap = w[k] - colWidth(c);
      if (align[k] === "r") return " ".repeat(gap) + c;
      if (align[k] === "c") return " ".repeat(Math.floor(gap / 2)) + c + " ".repeat(Math.ceil(gap / 2));
      return c + " ".repeat(gap);
    };
    const out = rows.map((r, i) => {
      const full = r.concat(new Array(n - r.length).fill(""));
      if (i === sepIdx) return lead + "| " + full.map((c, k) => {
        const a = align[k];
        const d = "-".repeat(Math.max(1, w[k] - (a === "c" ? 2 : a ? 1 : 0)));
        return a === "c" ? ":" + d + ":" : a === "r" ? d + ":" : a === "l" ? ":" + d : d;
      }).join(" | ") + " |";
      return lead + "| " + full.map(pad).join(" | ") + " |";
    }).join("\n");
    if (out === text.slice(ls, le)) return { noop: true };
    const rowIdx = text.slice(ls, pos).split("\n").length - 1;
    const caret = ls + out.split("\n").slice(0, rowIdx).reduce((x, l) => x + l.length + 1, 0) + lead.length + 2;
    return { start: ls, end: le, text: out, selStart: caret, selEnd: caret };
  }

  /* ---------- Tab / Shift+Tab: list levels, line indentation ---------- */
  function shiftLines(text, ls, le, delta, s, e) {
    const lines = text.slice(ls, le).split("\n");
    let firstShift = 0, total = 0;
    const out = lines.map((l, i) => {
      if (!l.trim()) return l;
      let r;
      if (delta > 0) r = " ".repeat(delta) + l;
      else { const lead = /^[ \t]*/.exec(l)[0]; let cut = 0, wdt = 0; while (cut < lead.length && wdt < -delta) { wdt += lead[cut] === "\t" ? 4 : 1; cut++; } r = l.slice(cut); }
      const d = r.length - l.length; if (i === 0) firstShift = d; total += d;
      return r;
    }).join("\n");
    if (out === text.slice(ls, le)) return { noop: true };
    const ns = Math.max(ls, s + firstShift), ne = s === e ? ns : Math.max(ns, e + total);
    return { start: ls, end: le, text: out, selStart: ns, selEnd: ne };
  }
  function shiftList(text, ls, le, dir, s, e) {
    const line = text.slice(ls, lineEnd(text, ls));
    const m = LIST_RE.exec(line); if (!m || />/.test(m[1])) return null;
    const cur = indentOf(line);
    let target = null;
    // walk up to the nearest list item: a sibling (same indent) for Tab, a parent (smaller indent) for Shift+Tab
    let p = ls - 1;
    while (p > 0) {
      const a = lineStart(text, p), l = text.slice(a, p);
      p = a - 1;
      if (!l.trim()) continue;
      const pm = LIST_RE.exec(l);
      const ind = indentOf(l);
      if (!pm) { if (ind <= cur) break; else continue; }
      if (dir > 0 && ind === cur) { target = width(pm[0].replace(/\[[ xX]\][ \t]+$/, "")); break; }
      if (dir > 0 && ind < cur) break;
      if (dir < 0 && ind < cur) { target = ind; break; }
    }
    if (dir < 0 && target == null) target = cur > 0 ? 0 : null;
    if (target == null || target === cur) return { noop: true };
    const r = shiftLines(text, ls, le, target - cur, s == null ? ls : s, e == null ? ls : e);
    // an ordered item that moves into a new level starts at 1
    if (dir > 0 && m[3] && r.text) {
      const lm = LIST_RE.exec(r.text);
      if (lm && lm[3] && lm[3] !== "1") {
        const at = lm[1].length, diff = 1 - lm[3].length;
        r.text = r.text.slice(0, at) + "1" + r.text.slice(at + lm[3].length);
        if (r.selStart > r.start + at) r.selStart += diff;
        if (r.selEnd > r.start + at) r.selEnd += diff;
      }
    }
    return r;
  }
  function onTab(text, s, e, shift) {
    if (!inFence(text, s)) {
      const t = s === e || text.slice(s, e).indexOf("\n") < 0 ? tableTab(text, s, shift ? -1 : 1) : null;
      if (t) return t;
      const { ls, le } = blockOf(text, s, e);
      const l = shiftList(text, ls, le, shift ? -1 : 1, s, e);
      if (l) return l;
      if (!shift && s === e) return { start: s, end: s, text: "    ", selStart: s + 4, selEnd: s + 4 };
      if (!shift && text.slice(s, e).indexOf("\n") < 0) return { start: s, end: e, text: "    ", selStart: s + 4, selEnd: s + 4 };
      return shiftLines(text, ls, le, shift ? -4 : 4, s, e);
    }
    const { ls, le } = blockOf(text, s, e);
    if (!shift && text.slice(s, e).indexOf("\n") < 0) return { start: s, end: e, text: "    ", selStart: s + 4, selEnd: s + 4 };
    return shiftLines(text, ls, le, shift ? -4 : 4, s, e);
  }

  /* ---------- line operations ---------- */
  function moveLines(text, s, e, dir) {
    const { ls, le } = blockOf(text, s, e);
    const block = text.slice(ls, le);
    if (dir < 0) {
      if (ls === 0) return { noop: true };
      const pls = lineStart(text, ls - 1), prev = text.slice(pls, ls - 1);
      const d = -(prev.length + 1);
      return { start: pls, end: le, text: block + "\n" + prev, selStart: s + d, selEnd: e + d };
    }
    if (le >= text.length) return { noop: true };
    const nle = lineEnd(text, le + 1), next = text.slice(le + 1, nle);
    const d = next.length + 1;
    return { start: ls, end: nle, text: next + "\n" + block, selStart: s + d, selEnd: e + d };
  }
  function duplicateLines(text, s, e, dir) {
    const { ls, le } = blockOf(text, s, e);
    const block = text.slice(ls, le);
    if (dir < 0) return { start: ls, end: ls, text: block + "\n", selStart: s, selEnd: e };
    const d = block.length + 1;
    return { start: le, end: le, text: "\n" + block, selStart: s + d, selEnd: e + d };
  }
  function toggleComment(text, s, e) {
    const { ls, le } = blockOf(text, s, e);
    const block = text.slice(ls, le);
    const m = /^([ \t]*)<!--[ \t]?([\s\S]*?)[ \t]?-->[ \t]*$/.exec(block);
    const out = m ? m[1] + m[2] : "<!-- " + block + " -->";
    return { start: ls, end: le, text: out, selStart: ls, selEnd: ls + out.length };
  }

  /* ---------- wrap the selection when a pair character is typed ---------- */
  const PAIRS = { "*": ["*", "*"], "_": ["_", "_"], "`": ["`", "`"], "=": ["==", "=="], "~": ["~~", "~~"],
    "(": ["(", ")"], "[": ["[", "]"], "\"": ["\"", "\""], "«": ["«", "»"] };
  function wrapSelection(text, s, e, ch) {
    const p = PAIRS[ch]; if (!p || s === e) return null;
    const sel = text.slice(s, e);
    return { start: s, end: e, text: p[0] + sel + p[1], selStart: s + p[0].length, selEnd: s + p[0].length + sel.length };
  }

  /* ---------- key dispatcher ---------- */
  // k = { key, shift, alt, ctrl (Ctrl or ⌘), composing }
  function onKey(text, s, e, k) {
    if (!k || k.composing) return null;
    const plain = !k.ctrl && !k.alt;
    if (k.key === "Enter" && plain && !k.shift) return onEnter(text, s, e);
    if (k.key === "Tab" && !k.ctrl && !k.alt) return onTab(text, s, e, k.shift);
    if (k.alt && !k.ctrl && (k.key === "ArrowUp" || k.key === "ArrowDown")) {
      const dir = k.key === "ArrowUp" ? -1 : 1;
      return k.shift ? duplicateLines(text, s, e, dir) : moveLines(text, s, e, dir);
    }
    if (k.ctrl && !k.alt && (k.key === "/" || k.code === "Slash")) return toggleComment(text, s, e);
    if (plain && k.key && k.key.length === 1 && PAIRS[k.key]) return wrapSelection(text, s, e, k.key);
    return null;
  }

  /* ---------- paste ---------- */
  const URL_RE = /^(?:https?:\/\/|mailto:)[^\s<>"]+$/i;
  // A URL pasted onto selected text (not itself a URL) → [text](url)
  function pasteLink(text, s, e, clip) {
    const url = String(clip || "").trim();
    if (s === e || !URL_RE.test(url)) return null;
    const sel = text.slice(s, e);
    if (sel.indexOf("\n") >= 0 || URL_RE.test(sel.trim())) return null;
    const out = "[" + sel + "](" + url.replace(/\)/g, "%29").replace(/ /g, "%20") + ")";
    return { start: s, end: e, text: out, selStart: s + out.length, selEnd: s + out.length };
  }
  // Clipboard HTML worth converting (Word, browsers, Google Docs) — not the div/span
  // markup code editors put on the clipboard.
  function isRichHtml(html) {
    if (!html || !/<[a-z]/i.test(html)) return false;
    return /<(p|h[1-6]|ul|ol|li|table|blockquote|strong|b|em|i|a\s[^>]*href|img|pre|code|sup|sub|u|s|del|mark)\b/i.test(html);
  }
  function htmlToMarkdown(html) {
    if (!global.TurndownService || typeof DOMParser === "undefined" || !isRichHtml(html)) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("style,script,meta,title,link,o\\:p").forEach((n) => n.remove());
    // Word's <p><b><span>…</span></b></p> soup: drop empty spans, keep text
    const td = new global.TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*", strongDelimiter: "**", hr: "---" });
    if (global.turndownPluginGfm) td.use(global.turndownPluginGfm.gfm);
    td.keep(["sub", "sup"]);
    if (global.DOCXFMT && global.DOCXFMT.markdownRules) global.DOCXFMT.markdownRules(td);
    let md = td.turndown(doc.body.innerHTML || "");
    md = md.replace(/\u00A0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
      .replace(/^([ \t]*)([-*+]|\d+\.)[ \t]{2,}(?=\S)/gm, "$1$2 ")            // Turndown pads markers: "-   item" → "- item"
      .trim();
    if (!md) return null;
    // an inline fragment keeps the blanks at its edges (" with **bold**" pasted after a word)
    if (md.indexOf("\n") < 0) {
      const txt = doc.body.textContent || "";
      if (/^\s/.test(txt)) md = " " + md;
      if (/\s$/.test(txt)) md += " ";
    }
    return md;
  }


  /* ---------- Text style: <span style="font-size / font-family / color"> ---------- */
  // "a:1;b:2" with prop set to value (value "" removes it)
  function styleWith(style, prop, value) {
    const out = String(style || "").split(";").map((x) => x.trim())
      .filter((x) => x && x.split(":")[0].trim().toLowerCase() !== prop);
    if (value) out.push(prop + ":" + value);
    return out.join(";");
  }
  const SPAN_TAG_RE = /<span\b([^>]*)>|<\/span\s*>/gi;
  const styleAttr = (attrs) => { const m = /\bstyle\s*=\s*(["'])(.*?)\1/i.exec(attrs || ""); return m ? m[2] : null; };
  // Remove prop from the spans that open and close inside seg; a span left without
  // any style / attribute disappears (its content stays).
  function stripProp(seg, prop) {
    const toks = [];
    let m; SPAN_TAG_RE.lastIndex = 0;
    while ((m = SPAN_TAG_RE.exec(seg))) toks.push({ at: m.index, len: m[0].length, open: m[0][1] !== "/", attrs: m[1] || "" });
    const stack = [], edits = [];
    for (const t of toks) {
      if (t.open) { stack.push(t); continue; }
      const o = stack.pop(); if (!o) continue;                  // closes a span opened before the selection
      const st = styleAttr(o.attrs);
      if (st == null || !new RegExp("(^|;)\\s*" + prop + "\\s*:", "i").test(st)) continue;
      const ns = styleWith(st, prop, "");
      const other = o.attrs.replace(/\bstyle\s*=\s*(["']).*?\1/i, "").trim();
      if (!ns && !other) { edits.push({ at: o.at, len: o.len, text: "" }, { at: t.at, len: t.len, text: "" }); }
      else edits.push({ at: o.at, len: o.len, text: "<span" + (other ? " " + other : "") + (ns ? ' style="' + ns + '"' : "") + ">" });
    }
    edits.sort((a, b) => b.at - a.at).forEach((x) => { seg = seg.slice(0, x.at) + x.text + seg.slice(x.at + x.len); });
    return seg;
  }
  const BLOCK_MARK_RE = /^([ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?)/;
  // Set a CSS property on the selected text: the span around exactly the selection is
  // updated (no nesting); otherwise the same property inside the selection is removed and
  // every line (table cell) of the selection is wrapped in <span style="prop:value">.
  // value "" removes the property. Code blocks, front matter and table rules are skipped.
  function styleSpan(text, s, e, prop, value) {
    if (e <= s) return null;
    prop = String(prop).toLowerCase();
    // 1) the selection is exactly the content of a <span …>
    const open = /<span\b([^>]*)>$/i.exec(text.slice(Math.max(0, s - 300), s));
    if (open && /^<\/span\s*>/i.test(text.slice(e)) && !/<\/?span\b/i.test(text.slice(s, e))) {
      const close = /^<\/span\s*>/i.exec(text.slice(e))[0];
      const st = styleWith(styleAttr(open[1]) || "", prop, value);
      const other = open[1].replace(/\bstyle\s*=\s*(["']).*?\1/i, "").trim();
      const os = s - open[0].length, inner = text.slice(s, e);
      const tag = st || other ? "<span" + (other ? " " + other : "") + (st ? ' style="' + st + '"' : "") + ">" : "";
      return { start: os, end: e + close.length, text: tag + inner + (tag ? close : ""), selStart: os + tag.length, selEnd: os + tag.length + inner.length };
    }
    // 2) the selection is one whole <span …>…</span>
    const whole = /^<span\b([^>]*)>([\s\S]*)<\/span\s*>$/i.exec(text.slice(s, e));
    if (whole && !/<\/?span\b/i.test(whole[2])) {
      const st = styleWith(styleAttr(whole[1]) || "", prop, value);
      const other = whole[1].replace(/\bstyle\s*=\s*(["']).*?\1/i, "").trim();
      const tag = st || other ? "<span" + (other ? " " + other : "") + (st ? ' style="' + st + '"' : "") + ">" : "";
      const out = tag + whole[2] + (tag ? "</span>" : "");
      return { start: s, end: e, text: out, selStart: s, selEnd: s + out.length };
    }
    // 3) line by line
    const fm = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
    const fmEnd = fm ? fm[0].length : 0;
    let out = "", pos = s, changed = 0, innerAt = -1, innerLen = 0;
    while (pos < e) {
      const ls = lineStart(text, pos), le = Math.min(lineEnd(text, pos), e);
      const line = text.slice(ls, lineEnd(text, pos));
      let a = pos, b = le;
      const skip = ls < fmEnd || inFence(text, ls) || /^[ \t]{0,3}(`{3,}|~{3,})/.test(line) || TABLE_SEP_RE.test(line) || /^[ \t]*<\/?[a-z][^>]*>[ \t]*$/i.test(line) || /^[ \t]*:::/.test(line);
      if (!skip) {
        if (a === ls) a = ls + BLOCK_MARK_RE.exec(line)[0].length;
        if (a < b) {
          // a table row: each cell on its own
          const parts = TABLE_ROW_RE.test(line) ? cellRanges(line).map((c) => [ls + c.s, ls + c.e]).filter((r) => r[1] > a && r[0] < b).map((r) => [Math.max(r[0], a), Math.min(r[1], b)]) : [[a, b]];
          let cur = a, seg = "";
          for (const [x0, x1] of parts) {
            let x = x0, y = x1;
            while (x < y && /\s/.test(text[x])) x++;
            while (y > x && /\s/.test(text[y - 1])) y--;
            seg += text.slice(cur, x);
            if (y > x) {
              const inner = stripProp(text.slice(x, y), prop);
              const tag = value ? '<span style="' + prop + ":" + value + '">' : "";
              innerAt = out.length + text.slice(pos, a).length + seg.length + tag.length; innerLen = inner.length;
              seg += tag + inner + (tag ? "</span>" : "");
              changed++;
            }
            cur = y;
          }
          seg += text.slice(cur, b);
          out += text.slice(pos, a) + seg;
        } else out += text.slice(pos, b);
      } else out += text.slice(pos, b);
      if (le < e) out += text.slice(le, le + 1);   // the newline
      pos = le + 1;
    }
    if (!changed) return null;
    // one piece: keep only its text selected, so the next style lands on the same span
    if (changed === 1 && value) return { start: s, end: e, text: out, selStart: s + innerAt, selEnd: s + innerAt + innerLen };
    return { start: s, end: e, text: out, selStart: s, selEnd: s + out.length };
  }

  /* ---------- Document settings in the YAML front matter (font, font-size) ---------- */
  // Set key: value in the front matter (created when missing; value "" removes the key and
  // an emptied front matter). The selection [s, e) is kept on the same text.
  function setFrontMatter(text, key, value, s, e) {
    s = s || 0; e = e == null ? s : e;
    const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text);
    const safe = (v) => (/^[\w\u0080-\uFFFF][^:#{}\[\]"'\n]*$/.test(v) && !/\s$/.test(v) ? v : '"' + String(v).replace(/(["\\])/g, "\\$1") + '"');
    let start = 0, end = 0, out;
    if (!m) {
      if (!value) return null;
      out = "---\n" + key + ": " + safe(value) + "\n---\n\n";
    } else {
      const lines = m[1].split(/\r?\n/);
      const re = new RegExp("^" + key.replace(/[-]/g, "\\-") + "[ \\t]*:");
      const i = lines.findIndex((l) => re.test(l));
      if (i >= 0) {
        // drop the key's continuation lines (indented / list items) too
        let j = i + 1; while (j < lines.length && /^[ \t]+\S|^-[ \t]/.test(lines[j])) j++;
        lines.splice(i, j - i, ...(value ? [key + ": " + safe(value)] : []));
      } else if (value) lines.push(key + ": " + safe(value));
      else return null;
      end = m[0].length;
      const kept = lines.filter((l) => l.trim());
      out = kept.length ? "---\n" + lines.join("\n") + "\n" + m[2] + (m[3] || "\n") : "";
      if (!out) { while (/[\r\n]/.test(text[end] || "")) end++; }   // no front matter left: drop the blank line after it
    }
    const d = out.length - (end - start);
    const mv = (x) => (x >= end ? x + d : Math.min(x, start + out.length));
    return { start, end, text: out, selStart: mv(s), selEnd: mv(e) };
  }

  global.DOCXMDEdit = { onKey, onEnter, onTab, pasteLink, htmlToMarkdown, isRichHtml, alignTable, moveLines,
    duplicateLines, toggleComment, wrapSelection, styleSpan, setFrontMatter, lineStart, lineEnd, inFence };
})(typeof window !== "undefined" ? window : this);
