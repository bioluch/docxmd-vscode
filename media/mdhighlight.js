/* DOCXMD — Markdown syntax highlighting, line numbers and the active line for the
   editor backdrop (the <div> mirrored behind the transparent <textarea>).
   Shared by the PWA (js/app.js) and the VS Code webview (media/webview.js).

   Only colours / backgrounds / text-shadow are used — never font weight, style or
   size — so the backdrop keeps exactly the textarea's text layout.
   Rendering is incremental: one <div class="ln"> per source line; lines whose HTML
   did not change keep their DOM nodes (fast typing in long documents).

   Exposes: window.DOCXMDHighlight = {
     paint(backdrop, text, { syntax, lineNumbers, hits: [[s,e]], cur, esc }) -> { lines },
     clear(backdrop), setActive(backdrop, caretPos), tokenizeLine(line) } */
(function (global) {
  "use strict";

  const escDefault = (s) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));

  /* ---------- block state per line ---------- */
  // returns an array: for each line, a block class ("fm", "fence", "code", "math", "comment") or ""
  function blockClasses(lines) {
    const out = new Array(lines.length).fill("");
    let i = 0;
    // YAML front matter
    if (/^﻿?---\s*$/.test(lines[0] || "")) {
      let j = 1;
      while (j < lines.length && !/^(---|\.\.\.)\s*$/.test(lines[j])) j++;
      if (j < lines.length) { for (let k = 0; k <= j; k++) out[k] = "fm"; i = j + 1; }
    }
    let fence = null, math = null, comment = false;
    for (; i < lines.length; i++) {
      const l = lines[i];
      if (fence) {
        const f = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(l);
        if (f && f[1][0] === fence[0] && f[1].length >= fence.length) { out[i] = "fence"; fence = null; }
        else out[i] = "code";
        continue;
      }
      if (math) {
        out[i] = "math";
        if (!l.trim()) { math = null; out[i] = ""; continue; }          // display math never spans a blank line
        if (math === "$$" ? /\$\$[ \t]*$/.test(l) : /\\\][ \t]*$/.test(l)) math = null;
        continue;
      }
      if (comment) { out[i] = "comment"; if (l.indexOf("-->") >= 0) comment = false; continue; }
      const f = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { fence = f[1]; out[i] = "fence"; continue; }
      if (/^[ \t]{0,3}\$\$/.test(l)) { out[i] = "math"; if (!/^[ \t]{0,3}\$\$[\s\S]*\$\$[ \t]*$/.test(l) || l.trim() === "$$") math = "$$"; continue; }
      if (/^[ \t]{0,3}\\\[/.test(l) && (/^[ \t]{0,3}\\\[[ \t]*$/.test(l) || /\\\][ \t]*$/.test(l))) { out[i] = "math"; if (!/\\\][ \t]*$/.test(l)) math = "\\["; continue; }
      if (/^[ \t]*<!--/.test(l) && l.indexOf("-->") < 0) { out[i] = "comment"; comment = true; continue; }
    }
    return out;
  }

  /* ---------- inline tokens of one normal line ---------- */
  // [[start, end, cls], …] non-overlapping, sorted
  const INLINE = new RegExp([
    "(`+)[^`]+?\\1",                                              // 1 code span
    "\\$\\$[^$\\n]+?\\$\\$|\\$(?![\\s$])[^$\\n]*?[^\\s\\\\$]\\$(?!\\d)|\\$[^\\s$\\\\]\\$(?!\\d)|\\\\\\(.+?\\\\\\)", // math
    "!\\[[^\\]\\n]*\\]\\([^)\\n]*\\)(?:\\{[^}\\n]*\\})?",          // image
    "\\[[^\\]\\n]*\\]\\([^)\\n]*\\)",                              // link
    "\\[\\^[^\\]\\s]+\\]",                                         // footnote ref
    "\\[?@(?:fig|tbl|sec):[A-Za-z0-9_-]+\\]?",                     // cross-reference
    "<!--.*?-->|<\\/?[A-Za-z][^>\\n]*>",                           // html
    "https?:\\/\\/[^\\s<>()]+",                                    // bare url
    "\\*\\*(?=\\S)[^\\n]*?\\S\\*\\*|__(?=\\S)[^\\n]*?\\S__",           // strong
    "~~(?=\\S)[^\\n]*?\\S~~",                                      // del
    "==(?=\\S)(?:[^=\\n]|=(?!=))*?\\S==",                          // highlight
    "\\*(?=[^\\s*])[^*\\n]*?[^\\s*]\\*|\\*[^\\s*]\\*|(?<![A-Za-z0-9\\u0400-\\u04FF])_(?=\\S)[^_\\n]*?\\S_(?![A-Za-z0-9\\u0400-\\u04FF])", // em
    "\\{[#.][^}\\n]*\\}",                                          // {#sec:x} attrs
    "\\\\[\\\\`*_{}\\[\\]()#+\\-.!|<>$=~]"                          // escape
  ].map((x) => "(" + x + ")").join("|"), "g");
  const KIND = ["code", "code", "math", "img", "link", "fn", "ref", "tag", "url", "strong", "del", "hl", "em", "attr", "esc"];

  function inlineTokens(line, base, out) {
    INLINE.lastIndex = 0;
    let m;
    while ((m = INLINE.exec(line))) {
      const s = base + m.index, e = s + m[0].length;
      let k = 1; while (k < m.length && m[k] === undefined) k++;
      const kind = KIND[k - 1];
      if (kind === "link") {
        const cut = m[0].indexOf("](");
        out.push([s, s + 1, "mk"], [s + 1, s + cut, "link"], [s + cut, e, "url"]);
      } else if (kind === "strong" || kind === "del" || kind === "hl") {
        const w = 2;
        out.push([s, s + w, "mk"], [s + w, e - w, kind], [e - w, e, "mk"]);
      } else if (kind === "em") {
        out.push([s, s + 1, "mk"], [s + 1, e - 1, "em"], [e - 1, e, "mk"]);
      } else out.push([s, e, kind]);
      if (!m[0].length) INLINE.lastIndex++;
    }
  }

  function tokenizeLine(line) {
    const out = [];
    let pos = 0, lineCls = "";
    let m;
    if ((m = /^[ \t]{0,3}(#{1,6})(?=[ \t]|$)/.exec(line))) {                       // heading
      out.push([0, m[0].length, "hm"]); pos = m[0].length; lineCls = "h";
    } else if (/^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) {            // rule
      return { toks: [[0, line.length, "hr"]], lineCls: "" };
    } else if ((m = /^[ \t]*:::/.exec(line))) {                                     // ::: box fences
      return { toks: [[0, line.length, "box"]], lineCls: "" };
    } else if (/^[ \t]{0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)+\|?[ \t]*$/.test(line)) {  // table separator
      return { toks: [[0, line.length, "pipe"]], lineCls: "" };
    } else if (/^\[TOC\][ \t]*$/i.test(line)) {
      return { toks: [[0, line.length, "attr"]], lineCls: "" };
    } else {
      if ((m = /^([ \t]*(?:>[ \t]?)+)/.exec(line))) { out.push([0, m[0].length, "qm"]); pos = m[0].length; }
      const lm = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(line.slice(pos));
      if (lm) { const a = pos + lm[1].length; out.push([a, pos + lm[0].length, "lm"]); pos += lm[0].length; }
      if ((m = /^\[\^[^\]\s]+\]:/.exec(line.slice(pos)))) { out.push([pos, pos + m[0].length, "fn"]); pos += m[0].length; }
      if ((m = /^(?:Table|Таблиця|Tabla|表)[ \t]*[:：]/.exec(line.slice(pos)))) { out.push([pos, pos + m[0].length, "attr"]); pos += m[0].length; }
    }
    const rest = line.slice(pos);
    const inl = [];
    inlineTokens(rest, pos, inl);
    // table pipes (only where no inline token is)
    if (/^[ \t]{0,3}\|/.test(line)) {
      for (let i = pos; i < line.length; i++) {
        if (line[i] === "\\") { i++; continue; }
        if (line[i] === "|" && !inl.some((t) => i >= t[0] && i < t[1])) inl.push([i, i + 1, "pipe"]);
      }
      inl.sort((a, b) => a[0] - b[0]);
    }
    return { toks: out.concat(inl), lineCls };
  }

  /* ---------- one line → HTML with overlays (find hits, data-URI images) ---------- */
  function lineHtml(line, ls, tok, overlays, esc) {
    const le = ls + line.length;
    const cuts = new Set([0, line.length]);
    tok.toks.forEach((t) => { cuts.add(t[0]); cuts.add(t[1]); });
    overlays.forEach((o) => { cuts.add(Math.max(0, o[0] - ls)); cuts.add(Math.min(line.length, o[1] - ls)); });
    const pts = Array.from(cuts).filter((x) => x >= 0 && x <= line.length).sort((a, b) => a - b);
    let html = "";
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      if (a === b) continue;
      let seg = esc(line.slice(a, b));
      for (const o of overlays) {
        if (o[0] - ls <= a && b <= o[1] - ls) {
          seg = o[2] === "img" ? '<span class="img-data">' + seg + "</span>" : '<mark class="find-hit' + (o[2] === "cur" ? " find-current" : "") + '">' + seg + "</mark>";
        }
      }
      const t = tok.toks.find((x) => x[0] <= a && b <= x[1]);
      if (t) seg = '<span class="md-' + t[2] + '">' + seg + "</span>";
      html += seg;
    }
    void le;
    return html;
  }

  /* ---------- paint ---------- */
  function paint(el, text, o) {
    o = o || {};
    const esc = o.esc || escDefault;
    const st = el.__hl || (el.__hl = { lines: [], html: [], cache: new Map() });
    el.classList.add("hl-lines");
    el.classList.toggle("hl-syn", !!o.syntax);
    el.classList.toggle("hl-ln", !!o.lineNumbers);
    const lines = text.split("\n");
    const blocks = o.syntax ? blockClasses(lines) : null;
    // overlays: data-URI images + find hits, as absolute ranges
    const imgs = global.MD2DOCX && global.MD2DOCX.dataImageRanges ? global.MD2DOCX.dataImageRanges(text) : [];
    const hits = o.hits || [];
    const html = new Array(lines.length);
    let pos = 0, hi = 0, ii = 0;
    const starts = new Array(lines.length);
    if (st.cache.size > 20000) st.cache.clear();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], ls = pos, le = pos + line.length;
      starts[i] = ls;
      const ov = [];
      while (ii < imgs.length && imgs[ii][1] <= ls) ii++;
      for (let j = ii; j < imgs.length && imgs[j][0] < le; j++) ov.push([imgs[j][0], imgs[j][1], "img"]);
      while (hi < hits.length && hits[hi][1] <= ls) hi++;
      for (let j = hi; j < hits.length && hits[j][0] < le; j++) ov.push([hits[j][0], hits[j][1], j === o.cur ? "cur" : "hit"]);
      const bcls = blocks ? blocks[i] : "";
      const key = (o.syntax ? "s" : "p") + bcls + "\u0001" + ov.map((x) => (x[0] - ls) + ":" + (x[1] - ls) + x[2]).join(",") + "\u0001" + line;
      let h = st.cache.get(key);
      if (h == null) {
        let tok;
        if (!o.syntax || !line) tok = { toks: [], lineCls: "" };
        else if (bcls) tok = { toks: [[0, line.length, bcls === "code" ? "cb" : bcls]], lineCls: "" };
        else tok = tokenizeLine(line);
        const inner = line ? lineHtml(line, ls, tok, ov, esc) : "";
        h = '<div class="ln' + (tok.lineCls ? " md-" + tok.lineCls : "") + '">' + (inner || "<br>") + "</div>";
        if (line.length < 5000) st.cache.set(key, h);
      }
      html[i] = h;
      pos = le + 1;
    }
    // the active-line class lives only in the DOM: clear it before nodes are reused
    if (st.active >= 0 && el.children[st.active]) el.children[st.active].classList.remove("ln-active");
    st.active = -1;
    // incremental DOM update: keep the unchanged head and tail
    const old = st.html;
    if (el.children.length !== old.length) { el.innerHTML = html.join(""); }
    else {
      let a = 0; while (a < old.length && a < html.length && old[a] === html[a]) a++;
      let b = 0; while (b < old.length - a && b < html.length - a && old[old.length - 1 - b] === html[html.length - 1 - b]) b++;
      const kids = el.children;
      for (let k = old.length - b - 1; k >= a; k--) kids[k].remove();
      if (a < html.length - b) {
        const tpl = document.createElement("template");
        tpl.innerHTML = html.slice(a, html.length - b).join("");
        el.insertBefore(tpl.content, kids[a] || null);
      }
    }
    st.html = html;
    st.starts = starts;
    st.active = -1;
    return { lines: lines.length };
  }

  function clear(el) {
    if (!el) return;
    el.innerHTML = "";
    if (el.__hl) { el.__hl.html = []; el.__hl.starts = []; el.__hl.active = -1; }
    el.classList.remove("hl-syn", "hl-ln", "hl-lines");
  }

  // highlight the line holding the caret (binary search over line starts)
  function setActive(el, pos) {
    const st = el && el.__hl; if (!st || !st.starts || !st.starts.length) return;
    let lo = 0, hi = st.starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (st.starts[mid] <= pos) lo = mid; else hi = mid - 1; }
    if (lo === st.active) return;
    const kids = el.children;
    if (st.active >= 0 && kids[st.active]) kids[st.active].classList.remove("ln-active");
    if (kids[lo]) kids[lo].classList.add("ln-active");
    st.active = lo;
  }

  global.DOCXMDHighlight = { paint, clear, setActive, tokenizeLine, blockClasses };
})(typeof window !== "undefined" ? window : this);
