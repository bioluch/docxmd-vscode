/* ============================================================
   DOCXMD — Markdown -> DOCX converter (pure JS, offline)
   Uses marked (lexer) + docx (document builder).
   Exposes: window.MD2DOCX.toBlob(markdown, opts, onProgress) -> Promise<Blob>
   ============================================================ */
(function (global) {
  "use strict";

  function ready() { return global.marked && global.docx; }

  // Cap image display width to typical content width (~6.3in @96dpi)
  const MAX_IMG_W = 600;

  // ---- Image pre-fetch ---------------------------------------------------
  async function blobToInfo(blob, src) {
    try {
      let type = (blob.type || "").split("/")[1] || "";
      type = type.replace("jpeg", "jpg").replace("svg+xml", "svg");
      if (!/^(png|jpg|gif|bmp|svg|webp|avif)$/.test(type)) {
        const ext = ((src || "").split("?")[0].split(".").pop() || "").toLowerCase();
        type = ext === "jpeg" ? "jpg" : ext;
      }
      // Word takes PNG / JPEG / GIF / BMP only: anything else the browser can
      // draw (WebP, AVIF, SVG…) is rasterised to PNG instead of being dropped.
      if (!/^(png|jpg|gif|bmp)$/.test(type)) {
        const png = await rasterToPng(blob, type === "svg" ? "image/svg+xml" : "");
        if (!png) return null;
        blob = png; type = "png";
      }
      const buf = await blob.arrayBuffer();
      const dim = await imageSize(blob);
      return { data: buf, type: type, width: dim.w, height: dim.h };
    } catch (e) { return null; }
  }
  // Any browser-decodable image → PNG blob (2× for SVG so vector art stays sharp)
  function rasterToPng(blob, forceType) {
    if (typeof document === "undefined") return Promise.resolve(null);
    if (forceType && blob.type !== forceType) blob = new Blob([blob], { type: forceType });
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = forceType === "image/svg+xml" ? 2 : 1;
          const w = Math.max(1, Math.round((img.naturalWidth || MAX_IMG_W) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || Math.round(MAX_IMG_W * 0.66)) * scale));
          const c = document.createElement("canvas"); c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          c.toBlob((b) => resolve(b), "image/png");
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  async function fetchImage(src) {
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(res.status);
      return await blobToInfo(await res.blob(), src);
    } catch (e) { return null; }
  }

  function imageSize(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth || MAX_IMG_W, h = img.naturalHeight || 0;
        if (w > MAX_IMG_W) { h = Math.round(h * (MAX_IMG_W / w)); w = MAX_IMG_W; }
        if (!h) h = Math.round(w * 0.66);
        URL.revokeObjectURL(url); resolve({ w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: MAX_IMG_W, h: 400 }); };
      img.src = url;
    });
  }

  // ---- Image width ---------------------------------------------------------
  // One width syntax for every image: `{width=60%}` after ![](…), or width="…" /
  // style="width:…" on <img>. % is relative to the text column (MAX_IMG_W in
  // Word), plain numbers are px; cm/mm/in are converted at 96 dpi.
  const WIDTH_ATTR_RE = /\bwidth\s*=\s*"?([\d.]+(?:%|px|cm|mm|in)?)"?/;
  const UNIT_PX = { px: 1, "": 1, cm: 96 / 2.54, mm: 96 / 25.4, in: 96 };
  function widthCss(w) { return /^[\d.]+$/.test(w) ? w + "px" : w; }
  function htmlImgWidth(el) {
    const st = /(?:^|;)\s*width\s*:\s*([\d.]+(?:%|px|cm|mm|in))/i.exec(el.getAttribute("style") || "");
    const a = /^\s*([\d.]+(?:%|px)?)\s*$/.exec(el.getAttribute("width") || "");
    return st ? st[1] : a ? a[1] : "";
  }
  // Word size (px) of an image for a width value; no width → natural size
  function sizeFor(info, width) {
    let w = info.width, h = info.height;
    const m = /^([\d.]+)(%|px|cm|mm|in)?$/.exec(String(width || "").trim());
    if (m && +m[1] > 0) {
      const target = m[2] === "%" ? MAX_IMG_W * Math.min(100, +m[1]) / 100 : Math.min(MAX_IMG_W, +m[1] * UNIT_PX[m[2] || ""]);
      h = Math.round(h * target / w); w = Math.round(target);
    }
    return { width: Math.max(1, w), height: Math.max(1, h) };
  }
  function imageRun(info, width, D) {
    return new D.ImageRun({ data: info.data, type: info.type, transformation: sizeFor(info, width) });
  }
  function parseHtmlFragment(raw) {
    if (typeof global.DOMParser === "undefined") return null;
    return new global.DOMParser().parseFromString("<!doctype html><body>" + raw + "</body>", "text/html").body;
  }

  // ---- Source positions of images (for resizing from the preview) ----------
  // ![alt](src "title"){attrs}   and   <img … src="…" …>
  const MD_IMG_RE = /!\[(?:[^\]\\\n]|\\.)*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+"[^"\n]*")?\s*\)(\{[^}\n]*\})?/g;
  const HTML_IMG_RE = /<img\b[^>]*>/gi;
  // Source ranges that never render as images: fenced code, `code spans`, <!-- comments -->
  function codeRanges(text) {
    const out = [];
    const re = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\2[`~]*[ \t]*(?=\n|$)|$)|<!--[\s\S]*?(?:-->|$)|(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`\n]\3(?!`)/g;
    let m;
    while ((m = re.exec(text))) { out.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; }
    return out;
  }
  function imageRanges(text) {
    const out = [];
    if (!text) return out;
    const skip = codeRanges(text);
    const inCode = (i) => skip.some((r) => i >= r[0] && i < r[1]);
    let m;
    MD_IMG_RE.lastIndex = 0;
    while ((m = MD_IMG_RE.exec(text))) {
      out.push({ kind: "md", start: m.index, end: m.index + m[0].length, src: m[1].replace(/^<|>$/g, ""),
        attr: m[2] ? { start: m.index + m[0].length - m[2].length, end: m.index + m[0].length, text: m[2] } : null });
    }
    HTML_IMG_RE.lastIndex = 0;
    while ((m = HTML_IMG_RE.exec(text))) {
      const s = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[0]);
      out.push({ kind: "html", start: m.index, end: m.index + m[0].length, src: s ? (s[1] != null ? s[1] : s[2]).replace(/&amp;/g, "&") : "", tag: m[0] });
    }
    return out.filter((r) => !inCode(r.start)).sort((a, b) => a.start - b.start);
  }
  // Minimal edit {start, end, text} that sets (or with width=null removes) the width
  // of an image found by imageRanges(). Only the attribute part changes, never the
  // (possibly huge base64) src — cheap to apply and to undo.
  function imageWidthEdit(r, width) {
    if (r.kind === "md") {
      if (!r.attr) return width ? { start: r.end, end: r.end, text: "{width=" + width + "}" } : null;
      let inner = r.attr.text.slice(1, -1);
      if (WIDTH_ATTR_RE.test(inner)) inner = inner.replace(/\s*\bwidth\s*=\s*"?[\d.]+(?:%|px|cm|mm|in)?"?/, width ? " width=" + width : "").trim();
      else if (width) inner = (inner.trim() + " width=" + width).trim();
      return { start: r.attr.start, end: r.attr.end, text: inner ? "{" + inner + "}" : "" };
    }
    // <img>: only the attribute ranges; src stays untouched
    const tag = r.tag, edits = [];
    const wa = /\swidth\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i.exec(tag);
    const sa = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    if (sa) {
      const css = sa[2] != null ? sa[2] : sa[3];
      const clean = css.replace(/(^|;)\s*(?:max-)?width\s*:[^;]*/gi, "$1").replace(/^;+|;+$/g, "").replace(/;;+/g, ";").trim();
      if (clean !== css.trim()) edits.push({ s: sa.index, e: sa.index + sa[0].length, t: clean ? ' style="' + clean + '"' : "" });
    }
    const hv = /\sheight\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i.exec(tag); // keep the aspect ratio
    if (hv) edits.push({ s: hv.index, e: hv.index + hv[0].length, t: "" });
    if (wa) edits.push({ s: wa.index, e: wa.index + wa[0].length, t: width ? ' width="' + width.replace(/px$/, "") + '"' : "" });
    else if (width) edits.push({ s: 4, e: 4, t: ' width="' + width.replace(/px$/, "") + '"' });
    if (!edits.length) return null;
    edits.sort((a, b) => a.s - b.s);
    const s = edits[0].s, e = Math.max.apply(null, edits.map((x) => x.e));
    let seg = tag.slice(s, e);
    for (let k = edits.length - 1; k >= 0; k--) seg = seg.slice(0, edits[k].s - s) + edits[k].t + seg.slice(edits[k].e - s);
    return { start: r.start + s, end: r.start + e, text: seg };
  }

  function collectImageSrcs(tokens, out) {
    for (const t of tokens) {
      if ((t.type === "image" || t.type === "figure") && t.href) out.add(t.href);
      if (t.type === "html" && /<img\b/i.test(t.text || "")) {
        const re = /<img\b[^>]*?\bsrc\s*=\s*("([^"]*)"|'([^']*)')/gi; let m;
        while ((m = re.exec(t.text))) out.add((m[2] != null ? m[2] : m[3]).replace(/&amp;/g, "&"));
      }
      if (t.tokens) collectImageSrcs(t.tokens, out);
      if (t.items) for (const it of t.items) if (it.tokens) collectImageSrcs(it.tokens, out);
      if (t.rows) for (const row of t.rows) for (const cell of row) if (cell.tokens) collectImageSrcs(cell.tokens, out);
      if (t.header) for (const cell of t.header) if (cell.tokens) collectImageSrcs(cell.tokens, out);
    }
  }

  // ---- Inline runs -------------------------------------------------------
  // ---- LaTeX → OMML (native Word math) ----------------------------------
  const GREEK = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω", Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω" };
  const MOPS = { cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", approx: "≈", neq: "≠", ne: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥", ll: "≪", gg: "≫", rightarrow: "→", to: "→", leftarrow: "←", infty: "∞", ldots: "…", cdots: "⋯", dots: "…", equiv: "≡", sim: "∼", propto: "∝", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", in: "∈", notin: "∉", cup: "∪", cap: "∩", forall: "∀", exists: "∃", leftrightarrow: "↔", Rightarrow: "⇒", Leftrightarrow: "⇔", uparrow: "↑", downarrow: "↓", subset: "⊂", circ: "°", varphi: "φ" };

  function mathToOmml(D, tex) {
    try { return new D.Math({ children: parseTex(D, String(tex)) }); }
    catch (e) { return new D.Math({ children: [new D.MathRun(String(tex))] }); }
  }
  function parseTex(D, s) {
    const out = []; let buf = "", i = 0;
    const flushRest = (keepLast) => {
      if (!buf) return null;
      if (keepLast) { const last = buf.slice(-1), rest = buf.slice(0, -1); if (rest) out.push(new D.MathRun(rest)); buf = ""; return new D.MathRun(last); }
      out.push(new D.MathRun(buf)); buf = ""; return null;
    };
    const readGroup = () => { let depth = 0; const start = i + 1; for (; i < s.length; i++) { if (s[i] === "{") depth++; else if (s[i] === "}") { depth--; if (!depth) { const inner = s.slice(start, i); i++; return inner; } } } return s.slice(start); };
    const readArg = () => { while (i < s.length && s[i] === " ") i++; if (s[i] === "{") return readGroup(); if (s[i] === "\\") { let j = i + 1; while (j < s.length && /[a-zA-Z]/.test(s[j])) j++; const c = s.slice(i, j); i = j; return c; } const ch = s[i] || ""; i++; return ch; };
    const scriptsFor = (baseChildren) => {
      let sub = null, sup = null;
      while (i < s.length && (s[i] === "_" || s[i] === "^")) { const isSup = s[i] === "^"; i++; const kids = parseTex(D, readArg()); if (isSup) sup = kids; else sub = kids; }
      if (sub && sup) return new D.MathSubSuperScript({ children: baseChildren, subScript: sub, superScript: sup });
      if (sub) return new D.MathSubScript({ children: baseChildren, subScript: sub });
      if (sup) return new D.MathSuperScript({ children: baseChildren, superScript: sup });
      return null;
    };
    while (i < s.length) {
      const c = s[i];
      if (c === "\\") {
        let j = i + 1; while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
        const cmd = s.slice(i + 1, j);
        if (!cmd) { const nx = s[i + 1] || ""; i += 2; if (nx === "," || nx === ";" || nx === " " || nx === ":") buf += " "; else if (nx !== "!") buf += nx; continue; }
        i = j;
        if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") { flushRest(); const n = readArg(), d = readArg(); const fr = new D.MathFraction({ numerator: parseTex(D, n), denominator: parseTex(D, d) }); const sc = scriptsFor([fr]); out.push(sc || fr); continue; }
        if (cmd === "sqrt") { flushRest(); out.push(new D.MathRadical({ children: parseTex(D, readArg()) })); continue; }
        if (cmd === "text" || cmd === "mathrm" || cmd === "mathbf" || cmd === "mathit" || cmd === "operatorname") { const t = readArg(); flushRest(); const run = new D.MathRun(t); const sc = scriptsFor([run]); out.push(sc || run); continue; }
        if (["left", "right", "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits", "big", "Big", "bigg", "Bigg", "quad", "qquad"].indexOf(cmd) !== -1) { if (cmd === "quad" || cmd === "qquad") buf += "  "; continue; }
        if (MOPS[cmd] != null) { buf += MOPS[cmd]; continue; }
        if (GREEK[cmd] != null) { buf += GREEK[cmd]; continue; }
        buf += cmd; continue;
      }
      if (c === "{") { flushRest(); const gk = parseTex(D, readGroup()); const sc = scriptsFor(gk); if (sc) out.push(sc); else out.push.apply(out, gk); continue; }
      if (c === "_" || c === "^") { let base = flushRest(true); if (!base) base = out.pop() || new D.MathRun(""); const sc = scriptsFor([base]); out.push(sc || base); continue; }
      if (c === "$") { i++; continue; }
      buf += c; i++;
    }
    flushRest();
    return out.length ? out : [new D.MathRun("")];
  }

  function inlineRuns(tokens, style, imgMap, D) {
    const runs = [];
    style = style || {};
    if (!tokens) return runs;
    const htmlStack = [];
    for (const tk of tokens) {
      switch (tk.type) {
        case "text":
          if (tk.tokens && tk.tokens.length) {
            runs.push(...inlineRuns(tk.tokens, style, imgMap, D));
          } else {
            runs.push(mkRun(decode(tk.text), style, D));
          }
          break;
        case "escape":
          runs.push(mkRun(tk.text, style, D)); break;
        case "strong":
          runs.push(...inlineRuns(tk.tokens, Object.assign({}, style, { bold: true }), imgMap, D)); break;
        case "em":
          runs.push(...inlineRuns(tk.tokens, Object.assign({}, style, { italics: true }), imgMap, D)); break;
        case "del":
          runs.push(...inlineRuns(tk.tokens, Object.assign({}, style, { strike: true }), imgMap, D)); break;
        case "mark":
          runs.push(...inlineRuns(tk.tokens, Object.assign({}, style, { highlight: HIGHLIGHTS[tk.color] || "yellow" }), imgMap, D)); break;
        case "codespan":
          runs.push(new D.TextRun({
            text: decode(tk.text), font: "Consolas", size: 20,
            color: style.color, shading: { type: D.ShadingType.CLEAR, fill: "EFEFEF" }
          }));
          break;
        case "br":
          runs.push(new D.TextRun({ text: "", break: 1 })); break;
        case "link": {
          const kids = inlineRuns(tk.tokens, Object.assign({}, style, { color: "0563C1", underline: true }), imgMap, D);
          const children = kids.length ? kids : [mkRun(tk.text || tk.href, { color: "0563C1", underline: true }, D)];
          const anchor = internalAnchor(tk.href);
          runs.push(anchor ? new D.InternalHyperlink({ anchor, children }) : new D.ExternalHyperlink({ link: tk.href || "#", children }));
          break;
        }
        case "image": {
          const info = tk.href && imgMap.get(tk.href);
          if (info) {
            runs.push(imageRun(info, tk.width, D));
          } else if (tk.text) {
            runs.push(mkRun("[" + tk.text + "]", Object.assign({}, style, { italics: true }), D));
          }
          break;
        }
        case "mathInline":
          runs.push(mathToOmml(D, tk.text)); break;
        case "footnoteRef": {
          const n = DOC.fnNum[tk.id];
          runs.push(n ? new D.FootnoteReferenceRun(n) : mkRun(tk.raw, style, D));
          break;
        }
        case "crossRef": {
          const txt = xrefText(tk.kind, tk.id);
          if (!txt) { runs.push(mkRun(tk.raw, style, D)); break; }
          const anchor = tk.kind === "sec" ? bookmarkName("sec", tk.id) : bookmarkName(tk.kind, tk.id);
          runs.push(new D.InternalHyperlink({ anchor, children: [new D.TextRun({ text: txt, color: "0563C1", underline: {} })] }));
          break;
        }
        case "html": {
          // marked emits <sup>, "1", </sup> as separate tokens: formatting tags
          // switch the style for the following tokens; other tags are dropped.
          const raw = String(tk.text || "");
          const re = /<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/gi;
          let last = 0, m;
          const text = (t) => { if (t) runs.push(mkRun(decode(t), style, D)); };
          while ((m = re.exec(raw))) {
            text(raw.slice(last, m.index)); last = re.lastIndex;
            const tag = m[2].toLowerCase();
            if (tag === "br") { runs.push(new D.TextRun({ text: "", break: 1 })); continue; }
            if (tag === "img") {
              const b = parseHtmlFragment(m[0]), el = b && b.querySelector("img");
              const info = el && imgMap.get(el.getAttribute("src"));
              if (info) runs.push(imageRun(info, htmlImgWidth(el), D));
              continue;
            }
            const fmt = HTML_FMT[tag];
            if (!fmt || m[3]) continue;
            if (!m[1]) { htmlStack.push({ tag, prev: style }); style = Object.assign({}, style, fmt); }
            else {
              const at = htmlStack.map((e) => e.tag).lastIndexOf(tag);
              if (at >= 0) { style = htmlStack[at].prev; htmlStack.length = at; }
            }
          }
          text(raw.slice(last));
          break;
        }
        default:
          if (tk.tokens) runs.push(...inlineRuns(tk.tokens, style, imgMap, D));
          else if (tk.text) runs.push(mkRun(decode(tk.text), style, D));
      }
    }
    return runs;
  }

  // inline HTML tags that map onto run formatting
  const HTML_FMT = {
    sup: { sup: true, sub: false }, sub: { sub: true, sup: false },
    b: { bold: true }, strong: { bold: true }, i: { italics: true }, em: { italics: true },
    u: { underline: true }, s: { strike: true }, del: { strike: true }, strike: { strike: true },
    mark: { highlight: "yellow" }
  };

  function mkRun(text, style, D) {
    return new D.TextRun({
      text: text || "",
      bold: !!style.bold,
      italics: !!style.italics,
      strike: !!style.strike,
      underline: style.underline ? {} : undefined,
      superScript: style.sup || undefined,
      size: style.size || undefined,
      subScript: style.sub || undefined,
      highlight: style.highlight || undefined,
      color: style.color
    });
  }

  // HTML entities → characters, the way the preview shows them: &mdash; &copy;
  // &#8212; &#x2014; … (each entity decoded once, so "&amp;lt;" stays "&lt;").
  const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  let entEl = null;
  function decode(s) {
    if (s == null) return "";
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]{1,31});/gi, (m, e) => {
      if (e[0] === "#") {
        const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return cp > 0 && cp <= 0x10FFFF ? String.fromCodePoint(cp) : m;
      }
      if (ENT[e] != null) return ENT[e];
      if (typeof document === "undefined") return m;
      entEl = entEl || document.createElement("textarea");
      entEl.innerHTML = m;
      return entEl.value;
    });
  }

  const HEADING = (D) => [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2,
    D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];

  // ---- List handling -----------------------------------------------------
  function buildList(list, level, olInstance, ctx, out) {
    const D = ctx.D;
    for (const item of list.items) {
      let lead = [];
      const nested = [];
      for (const child of (item.tokens || [])) {
        if (child.type === "list") nested.push(child);
        else if (child.type === "text" || child.type === "paragraph") {
          lead.push(...inlineRuns(child.tokens || [{ type: "text", text: child.text }], ctx.baseStyle || {}, ctx.imgMap, D));
        } else if (child.type === "space") { /* ignore */ }
        else if (child.type === "code") {
          nested.push(child); // handle code blocks after lead
        } else {
          lead.push(...inlineRuns(child.tokens || [], ctx.baseStyle || {}, ctx.imgMap, D));
        }
      }

      const opts = { children: lead, spacing: { after: 40 } };
      if (item.task) {
        opts.children = [new D.TextRun({ text: (item.checked ? "☒ " : "☐ ") }), ...lead];
        opts.indent = { left: 360 * (level + 1) };
      } else if (list.ordered) {
        // "3. …" must stay 3 in Word: lists that don't start at 1 get their own numbering definition
        const start = level === 0 && +list.start > 1 ? +list.start : 1;
        if (start > 1 && ctx.olStarts) ctx.olStarts.add(start);
        opts.numbering = { reference: start > 1 ? "docxmd-ol-" + start : "docxmd-ol", level: Math.min(level, 5), instance: olInstance };
      } else {
        opts.bullet = { level: Math.min(level, 5) };
      }
      out.push(new D.Paragraph(opts));

      for (const n of nested) {
        if (n.type === "list") {
          buildList(n, level + 1, olInstance, ctx, out);
        } else if (n.type === "code") {
          out.push(codeBlock(n, D, 360 * (level + 1)));
        }
      }
    }
  }

  function codeBlock(tk, D, indentLeft) {
    const lines = String(tk.text || "").replace(/\n$/, "").split("\n");
    const children = [];
    lines.forEach((ln, i) => {
      children.push(new D.TextRun({ text: ln || " ", font: "Consolas", size: 20, break: i > 0 ? 1 : 0 }));
    });
    return new D.Paragraph({
      children,
      shading: { type: D.ShadingType.CLEAR, fill: "F5F5F5" },
      spacing: { before: 80, after: 120 },
      indent: indentLeft ? { left: indentLeft } : undefined,
      border: {
        top: { style: D.BorderStyle.SINGLE, size: 4, color: "DDDDDD", space: 6 },
        bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "DDDDDD", space: 6 },
        left: { style: D.BorderStyle.SINGLE, size: 4, color: "DDDDDD", space: 6 },
        right: { style: D.BorderStyle.SINGLE, size: 4, color: "DDDDDD", space: 6 }
      }
    });
  }

  function buildTable(tk, ctx) {
    const D = ctx.D;
    const rows = [];
    const compact = ctx.tableMode === "compact";
    // explicit :--: alignment wins; otherwise all-numeric columns align right (as in the preview)
    const aligns = (tk.header || []).map((c, i) => (tk.align && tk.align[i]) ||
      (tk.rows.length && tk.rows.every((r) => r[i] && isNumericCell(r[i].text)) ? "right" : null));
    const mkCell = (cell, header, zebra) => new D.TableCell({
      children: [new D.Paragraph({
        children: inlineRuns(cell.tokens || [{ type: "text", text: cell.text }], Object.assign(header ? { bold: true } : {}, compact ? { size: 18 } : {}), ctx.imgMap, D),
        alignment: mapAlign(aligns[cell.__i], D)
      })],
      shading: header ? { type: D.ShadingType.CLEAR, fill: "F0F0F0" } : zebra ? { type: D.ShadingType.CLEAR, fill: "F7F7F7" } : undefined,
      margins: compact ? { top: 10, bottom: 10, left: 60, right: 60 } : { top: 40, bottom: 40, left: 80, right: 80 }
    });
    const head = new D.TableRow({
      tableHeader: true,
      children: tk.header.map((c, i) => { c.__i = i; return mkCell(c, true); })
    });
    rows.push(head);
    tk.rows.forEach((r, ri) => {
      rows.push(new D.TableRow({ children: r.map((c, i) => { c.__i = i; return mkCell(c, false, ri % 2 === 1); }) }));
    });
    return new D.Table({
      rows,
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      borders: {
        top: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        bottom: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        left: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        right: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        insideHorizontal: { style: D.BorderStyle.SINGLE, size: 2, color: "DDDDDD" },
        insideVertical: { style: D.BorderStyle.SINGLE, size: 2, color: "DDDDDD" }
      }
    });
  }

  // Blockquote → one-cell table with only a left bar, so the bar is continuous
  // and the quote can hold any block: paragraphs, lists, code, tables, quotes.
  const QUOTE_STYLE = { color: "666666" };
  const CALLOUT_STYLE = { color: "333333" };
  // box: the colorBox token (callout kind / title) or undefined for a plain quote
  function buildQuote(tk, ctx, color, box) {
    const D = ctx.D;
    const bar = { style: D.BorderStyle.SINGLE, size: 24, color: color || ctx.quoteColor || "BBBBBB" };
    const kind = box && box.kind;
    const TXT = kind ? CALLOUT_STYLE : QUOTE_STYLE;
    const qctx = Object.assign({}, ctx, { baseStyle: TXT });
    const kids = [];
    const para = (runs, extra) => kids.push(new D.Paragraph(Object.assign({ children: runs, spacing: { after: 80 } }, extra)));
    if (box && box.titleTokens) {
      const runs = inlineRuns(box.titleTokens, { bold: true, color: "222222" }, ctx.imgMap, D);
      if (kind) runs.unshift(mkRun(CALLOUTS[kind].icon + " ", { bold: true }, D));
      para(runs, { spacing: { after: 60 } });
    }
    for (const b of (tk.tokens || global.marked.lexer(tk.text || ""))) {
      switch (b.type) {
        case "space": break;
        case "paragraph": case "text":
          para(inlineRuns(b.tokens || [{ type: "text", text: b.text }], TXT, ctx.imgMap, D)); break;
        case "heading":
          para(inlineRuns(b.tokens, Object.assign({ bold: true }, TXT), ctx.imgMap, D)); break;
        case "list":
          if (b.ordered) ctx.ol++;
          buildList(b, 0, ctx.ol, qctx, kids); break;
        case "code": kids.push(codeBlock(b, D, 0)); break;
        case "mathBlock": para([mathToOmml(D, b.text)], { alignment: D.AlignmentType.CENTER }); break;
        case "table": kids.push(buildTable(b, ctx)); break;
        case "blockquote": kids.push(buildQuote(b, ctx)); break;
        case "colorBox": kids.push(buildQuote({ tokens: unwrapQuotes(b.tokens) }, ctx, b.color, b)); break;
        case "tableBox":
          for (const x of b.tokens) if (x.type === "table") kids.push(buildTable(x, Object.assign({}, ctx, { tableMode: b.mode })));
          break;
        case "hr": break;
        default: {
          const txt = String(b.text || "").replace(/<[^>]*>/g, "").trim();
          if (b.tokens) para(inlineRuns(b.tokens, TXT, ctx.imgMap, D));
          else if (txt) para([mkRun(decode(txt), TXT, D)]);
        }
      }
    }
    // a Word table cell must end with a paragraph
    if (!kids.length || !(kids[kids.length - 1] instanceof D.Paragraph)) kids.push(new D.Paragraph({ children: [] }));
    const none = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" };
    return new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      borders: { top: none, bottom: none, right: none, insideHorizontal: none, insideVertical: none, left: bar },
      rows: [new D.TableRow({ children: [new D.TableCell({
        children: kids,
        shading: kind ? { type: D.ShadingType.CLEAR, fill: tint(color), color: "auto" } : undefined,
        margins: kind ? { top: 100, bottom: 60, left: 240, right: 160 } : { top: 60, bottom: 20, left: 240, right: 80 },
        borders: { top: none, bottom: none, right: none, left: bar }
      })] })]
    });
  }

  // ---- HTML <table> (styled tables, e.g. imported from .docx) -------------
  // Cell background, text colour, horizontal/vertical alignment, colspan and
  // rowspan are carried over to the Word table.
  const CSS_NAMED = { white: "FFFFFF", black: "000000", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500", navy: "000080" };
  function cssColor(v) {
    if (!v) return null;
    v = String(v).trim().toLowerCase();
    let m = /^#([0-9a-f]{6})$/.exec(v); if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v); if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
    if (m) return [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("").toUpperCase();
    return CSS_NAMED[v] || null;
  }
  function cssProps(el) {
    const out = {};
    String(el.getAttribute("style") || "").split(";").forEach((d) => {
      const i = d.indexOf(":"); if (i > 0) out[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
    });
    return out;
  }
  function elFmt(el, style) {
    const css = cssProps(el), st = Object.assign({}, style);
    const tag = el.nodeName.toLowerCase();
    if (HTML_FMT[tag]) Object.assign(st, HTML_FMT[tag]);
    const hl = tag === "mark" && /\bhl-([a-z]+)/.exec(el.getAttribute("class") || "");
    if (hl && HIGHLIGHTS[hl[1]]) st.highlight = HIGHLIGHTS[hl[1]];
    const c = cssColor(css.color || el.getAttribute("color")); if (c) st.color = c;
    if (/bold|[6-9]00/.test(css["font-weight"] || "")) st.bold = true;
    if (css["font-style"] === "italic") st.italics = true;
    if (/underline/.test(css["text-decoration"] || "")) st.underline = true;
    if (/line-through/.test(css["text-decoration"] || "")) st.strike = true;
    return st;
  }

  const HTML_BLOCK = /^(p|div|ul|ol|li|h[1-6]|blockquote|pre|table)$/i;
  // Walk a cell's DOM into Word paragraphs (inline runs + simple block handling)
  function htmlCellChildren(cell, style, align, ctx) {
    const D = ctx.D, out = [];
    let runs = [];
    const flush = (force) => {
      if (runs.length || force) out.push(new D.Paragraph({ children: runs, alignment: mapAlign(align, D), spacing: { after: 0 } }));
      runs = [];
    };
    (function walk(node, st, listInfo) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          const t = n.nodeValue.replace(/\s+/g, " ");
          if (t.trim() || (t && runs.length)) runs.push(mkRun(t, st, D));
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.nodeName.toLowerCase();
        if (tag === "br") { runs.push(new D.TextRun({ text: "", break: 1 })); continue; }
        if (tag === "img") {
          const info = ctx.imgMap.get(n.getAttribute("src"));
          if (info) runs.push(imageRun(info, htmlImgWidth(n), D));
          continue;
        }
        if (tag === "table") { flush(); out.push(buildHtmlTable(n, ctx)); continue; }
        if (tag === "a") {
          const kids = [];
          const save = runs; runs = kids;
          walk(n, Object.assign({}, elFmt(n, st), { color: "0563C1", underline: true }), listInfo);
          runs = save;
          runs.push(new D.ExternalHyperlink({ link: n.getAttribute("href") || "#", children: kids }));
          continue;
        }
        if (tag === "code") { runs.push(new D.TextRun({ text: n.textContent, font: "Consolas", size: 20, color: st.color })); continue; }
        if (tag === "ul" || tag === "ol") { flush(); walk(n, st, { ordered: tag === "ol", n: 0 }); continue; }
        if (tag === "li") {
          flush();
          const mark = listInfo && listInfo.ordered ? (++listInfo.n) + ". " : "• ";
          runs.push(mkRun(mark, st, D));
          walk(n, elFmt(n, st), listInfo); flush(); continue;
        }
        const block = HTML_BLOCK.test(tag);
        if (block) flush();
        const sec = /^sec:([A-Za-z0-9_-]+)$/.exec(n.getAttribute("id") || "");
        const before = runs.length;
        walk(n, /^h[1-6]$/.test(tag) ? Object.assign(elFmt(n, st), { bold: true }) : elFmt(n, st), listInfo);
        // <h3 id="sec:x"> → Word bookmark, target of internal links (#sec:x)
        if (sec) runs.splice(before, runs.length - before, new D.Bookmark({ id: bookmarkName("sec", sec[1]), children: runs.slice(before) }));
        if (block) flush();
      }
    })(cell, style, null);
    flush(!out.length || !(out[out.length - 1] instanceof D.Paragraph));
    return out;
  }

  function buildHtmlTable(table, ctx) {
    const D = ctx.D;
    const VAL = { middle: "center", center: "center", bottom: "bottom" };
    const rows = [];
    for (const tr of Array.from(table.rows)) {
      const inHead = tr.parentNode && tr.parentNode.nodeName === "THEAD";
      const trCss = cssProps(tr);
      const cells = Array.from(tr.cells).map((c) => {
        const css = cssProps(c);
        const header = c.nodeName === "TH";
        const fill = cssColor(css["background-color"] || css.background || c.getAttribute("bgcolor")) ||
                     cssColor(trCss["background-color"] || trCss.background || tr.getAttribute("bgcolor"));
        const align = (css["text-align"] || c.getAttribute("align") || "").toLowerCase() || null;
        const valign = VAL[(css["vertical-align"] || c.getAttribute("valign") || "").toLowerCase()];
        const st = elFmt(c, header ? { bold: true } : {});
        if (!st.color) { const trc = cssColor(trCss.color); if (trc) st.color = trc; }
        const opts = {
          children: htmlCellChildren(c, st, align, ctx),
          margins: { top: 40, bottom: 40, left: 80, right: 80 }
        };
        if (fill) opts.shading = { type: D.ShadingType.CLEAR, fill, color: "auto" };
        else if (header) opts.shading = { type: D.ShadingType.CLEAR, fill: "F0F0F0" };
        if (valign) opts.verticalAlign = valign;
        if (c.colSpan > 1) opts.columnSpan = c.colSpan;
        if (c.rowSpan > 1) opts.rowSpan = c.rowSpan;
        return new D.TableCell(opts);
      });
      if (cells.length) rows.push(new D.TableRow({ tableHeader: inHead || undefined, children: cells }));
    }
    return new D.Table({
      rows,
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      borders: {
        top: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        bottom: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        left: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        right: { style: D.BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
        insideHorizontal: { style: D.BorderStyle.SINGLE, size: 2, color: "DDDDDD" },
        insideVertical: { style: D.BorderStyle.SINGLE, size: 2, color: "DDDDDD" }
      }
    });
  }

  function parseHtmlTable(raw) {
    if (typeof global.DOMParser === "undefined") return null;
    const doc = new global.DOMParser().parseFromString("<!doctype html><body>" + raw + "</body>", "text/html");
    return doc.body.querySelector("table");
  }

  function mapAlign(a, D) {
    if (a === "center") return D.AlignmentType.CENTER;
    if (a === "right") return D.AlignmentType.RIGHT;
    if (a === "justify") return D.AlignmentType.JUSTIFIED;
    return D.AlignmentType.LEFT;
  }

  // Read a text alignment from an HTML wrapper token (<div align="center">,
  // <p style="text-align:right">, <center>…). Returns null when there is none.
  function alignFromHtml(raw) {
    const s = String(raw);
    if (/<center[\s>]/i.test(s)) return "center";
    let m = s.match(/align\s*=\s*["']?\s*(left|right|center|justify)/i);
    if (m) return m[1].toLowerCase();
    m = s.match(/text-align\s*:\s*(left|right|center|justify)/i);
    if (m) return m[1].toLowerCase();
    return null;
  }
  const isClosingHtml = (raw) => /<\/\s*(div|p|center)\s*>/i.test(String(raw));

  // ---- Colour boxes  :::red … :::  -------------------------------------
  // A fenced container that renders as a quote with a coloured left bar.
  // Shared by the PWA and the VS Code webview (both load this file first).
  const BOX_COLORS = {
    red: "E53935", orange: "FB8C00", yellow: "FBC02D", green: "43A047", teal: "00897B",
    blue: "1E88E5", purple: "8E24AA", pink: "D81B60", gray: "9E9E9E", grey: "9E9E9E", black: "212121",
    "червоний": "E53935", "помаранчевий": "FB8C00", "жовтий": "FBC02D", "зелений": "43A047",
    "бірюзовий": "00897B", "синій": "1E88E5", "блакитний": "1E88E5", "фіолетовий": "8E24AA",
    "рожевий": "D81B60", "сірий": "9E9E9E", "чорний": "212121"
  };
  // Callout types (info / note / tip / success / important / warning / danger).
  // Colours are fixed so preview, print, HTML and DOCX look the same in every theme.
  const CALLOUTS = {
    info:      { color: "1E88E5", icon: "ℹ️", title: { en: "Info", uk: "Інформація", es: "Información", zh: "信息" } },
    note:      { color: "78909C", icon: "📝", title: { en: "Note", uk: "Примітка", es: "Nota", zh: "注" } },
    tip:       { color: "00897B", icon: "💡", title: { en: "Tip", uk: "Порада", es: "Consejo", zh: "提示" } },
    success:   { color: "43A047", icon: "✅", title: { en: "Success", uk: "Успіх", es: "Éxito", zh: "成功" } },
    important: { color: "8E24AA", icon: "❗", title: { en: "Important", uk: "Важливо", es: "Importante", zh: "重要" } },
    warning:   { color: "F9A825", icon: "⚠️", title: { en: "Warning", uk: "Попередження", es: "Advertencia", zh: "警告" } },
    danger:    { color: "E53935", icon: "⛔", title: { en: "Danger", uk: "Небезпека", es: "Peligro", zh: "危险" } }
  };
  const CALLOUT_ALIAS = {
    caution: "danger", error: "danger", hint: "tip", check: "success", attention: "warning",
    "інформація": "info", "примітка": "note", "порада": "tip", "успіх": "success",
    "важливо": "important", "попередження": "warning", "увага": "warning", "небезпека": "danger"
  };
  function calloutKind(name) {
    const n = String(name || "").trim().toLowerCase();
    return CALLOUTS[n] ? n : (CALLOUT_ALIAS[n] || null);
  }
  function calloutTitle(kind) {
    const t = CALLOUTS[kind].title; return t[docLang()] || t.en;
  }
  // DOCX import: which callout draws this bar colour (callouts always have a fill)
  function calloutByColor(hex) {
    hex = String(hex || "").replace(/^#/, "").toUpperCase();
    for (const k in CALLOUTS) if (CALLOUTS[k].color === hex) return k;
    return null;
  }
  function isDefaultCalloutTitle(kind, title) {
    const t = CALLOUTS[kind] && CALLOUTS[kind].title; if (!t) return false;
    return Object.keys(t).some((l) => t[l].toLowerCase() === String(title).trim().toLowerCase());
  }
  // light background for a callout: the bar colour mixed with white
  function tint(hex, amount) {
    const n = parseInt(hex, 16), a = amount == null ? 0.88 : amount;
    return [16, 8, 0].map((sh) => { const c = (n >> sh) & 255; return Math.round(c + (255 - c) * a).toString(16).padStart(2, "0"); }).join("").toUpperCase();
  }
  function rgba(hex, a) {
    const n = parseInt(hex, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  const TABLE_MODES = { "table-compact": "compact", "table-full": "full" };
  function boxColor(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase().replace(/^quote-/, "");
    let m = /^#([0-9a-f]{6})$/.exec(n); if (m) return m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(n); if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    return BOX_COLORS[n] || null;
  }
  function colorName(hex) {
    hex = String(hex || "").replace(/^#/, "").toUpperCase();
    for (const k in BOX_COLORS) if (BOX_COLORS[k] === hex && /^[a-z]+$/.test(k)) return k;
    return "#" + hex;
  }
  // `:::red` wrapping a `>` quote must not draw two bars: use the quote's content
  function unwrapQuotes(tokens) {
    const real = (tokens || []).filter((t) => t.type !== "space");
    if (!real.length || !real.every((t) => t.type === "blockquote")) return tokens || [];
    const out = [];
    real.forEach((q, i) => { if (i) out.push({ type: "space", raw: "\n" }); out.push(...(q.tokens || [])); });
    return out;
  }
  const escHtml = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // :::name [title]  …  :::   (name = colour | callout type | table mode)
  const BOX_RE = /^:::[ \t]*(#?[0-9A-Za-zЀ-ӿ-]+)(?:[ \t]+([^\n]*?))?[ \t]*\n([\s\S]*?\n)?[ \t]*:::[ \t]*(?:\n|$)/;
  function boxToken(lexer, raw, name, title, body) {
    const tokens = lexer.blockTokens(body || "", []);
    const mode = TABLE_MODES[String(name).toLowerCase()];
    if (mode) return { type: "tableBox", raw, mode, tokens };
    const kind = calloutKind(name);
    const color = kind ? CALLOUTS[kind].color : boxColor(name);
    if (!color) return undefined;
    const tok = { type: "colorBox", raw, color, kind, tokens };
    title = (title || "").trim();
    if (kind || title) {
      tok.title = title || calloutTitle(kind);
      tok.titleTokens = lexer.inlineTokens(tok.title);
    }
    return tok;
  }
  function boxRenderer(t) {
    const style = "border-left-color:#" + t.color + (t.kind ? ";background:" + rgba(t.color, 0.1) : "");
    const head = t.titleTokens ? '<p class="callout-title">' +
      (t.kind ? '<span class="callout-icon">' + CALLOUTS[t.kind].icon + "</span> " : "") +
      this.parser.parseInline(t.titleTokens) + "</p>\n" : "";
    return '<blockquote class="md-box' + (t.kind ? " callout callout-" + t.kind : "") + '" style="' + style + '">\n' +
      head + this.parser.parse(unwrapQuotes(t.tokens)) + "</blockquote>\n";
  }
  function colorBoxExtension() {
    return {
      name: "colorBox", level: "block",
      start(src) { const m = /(^|\n):::[ \t]*#?[0-9A-Za-zЀ-ӿ]/.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src) {
        const m = BOX_RE.exec(src);
        return m ? boxToken(this.lexer, m[0], m[1], m[2], m[3]) : undefined;
      },
      renderer: boxRenderer
    };
  }
  // table-compact / table-full wrappers
  function tableBoxExtension() {
    return {
      name: "tableBox", level: "block",
      renderer(t) { return '<div class="tbl-' + t.mode + '">\n' + this.parser.parse(t.tokens) + "</div>\n"; }
    };
  }
  // GitHub / Obsidian alerts:  > [!WARNING] optional title
  const GH_KIND = { note: "note", tip: "tip", important: "important", warning: "warning", caution: "danger" };
  function alertExtension() {
    return {
      name: "ghAlert", level: "block",
      start(src) { const m = /(^|\n) {0,3}> ?\[!/.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src) {
        const m = /^(?: {0,3}>[^\n]*(?:\n|$))+/.exec(src);
        if (!m) return undefined;
        const lines = m[0].replace(/\n$/, "").split("\n");
        const h = /^ {0,3}> ?\[!([A-Za-zЀ-ӿ]+)\][+-]?[ \t]*(.*)$/.exec(lines[0]);
        if (!h) return undefined;
        const name = h[1].toLowerCase();
        const kind = GH_KIND[name] || calloutKind(name);
        if (!kind) return undefined;
        const body = lines.slice(1).map((l) => l.replace(/^ {0,3}> ?/, "")).join("\n") + "\n";
        return boxToken(this.lexer, m[0], kind, h[2], body);
      },
      renderer: boxRenderer
    };
  }
  // Source ranges of embedded (data-URI) images — ![alt](data:…) and <img src="data:…">.
  // The editors tint these long base64 runs so they stand out from the text.
  const DATA_IMG_RE = /!\[[^\]\n]*\]\(\s*<?data:[^)\s]*[^)]*\)|<img\b[^>]*?\bsrc\s*=\s*(["'])data:[\s\S]*?\1[^>]*>/gi;
  function dataImageRanges(text) {
    const out = [];
    if (!text || text.indexOf("data:") === -1) return out;
    DATA_IMG_RE.lastIndex = 0;
    let m;
    while ((m = DATA_IMG_RE.exec(text))) out.push([m.index, m.index + m[0].length]);
    return out;
  }
  // HTML for the editor backdrop: data-URI images tinted, find matches marked on top.
  // hits: [[start, end], …] (sorted), cur: index of the current hit or -1.
  function backdropHtml(text, hits, cur, esc) {
    const imgs = dataImageRanges(text);
    const cuts = new Set([0, text.length]);
    imgs.forEach((r) => { cuts.add(r[0]); cuts.add(r[1]); });
    hits.forEach((r) => { cuts.add(r[0]); cuts.add(r[1]); });
    const pts = Array.from(cuts).sort((x, y) => x - y);
    let html = "", ii = 0, hi = 0;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      while (ii < imgs.length && imgs[ii][1] <= a) ii++;
      while (hi < hits.length && hits[hi][1] <= a) hi++;
      let seg = esc(text.slice(a, b));
      if (hi < hits.length && hits[hi][0] <= a && b <= hits[hi][1]) seg = '<mark class="find-hit' + (hi === cur ? " find-current" : "") + '">' + seg + "</mark>";
      if (ii < imgs.length && imgs[ii][0] <= a && b <= imgs[ii][1]) seg = '<span class="img-data">' + seg + "</span>";
      html += seg;
    }
    return { html: html + "\n", images: imgs.length };
  }

  // ---- Document structure: footnotes, figure/table captions, cross-refs, TOC ----
  // Syntax follows Pandoc / pandoc-crossref so documents stay portable:
  //   text[^1]   [^1]: note            footnotes
  //   ![Caption](img.png){#fig:id}     numbered figure (optional width=70%)
  //   Table: Caption {#tbl:id}         numbered table caption (line before/after the table)
  //   ## Heading {#sec:id}             section anchor
  //   @fig:id  @tbl:id  @sec:id        cross-references (also [@fig:id])
  //   [TOC]                            table of contents
  //   <!-- docxmd: numbered-headings -->  number headings 1, 1.1, 1.1.1
  const WORDS = {
    fig: { en: "Figure", uk: "Рисунок", es: "Figura", zh: "图" },
    tbl: { en: "Table", uk: "Таблиця", es: "Tabla", zh: "表" },
    toc: { en: "Contents", uk: "Зміст", es: "Contenido", zh: "目录" }
  };
  const uiLang = () => (global.I18N && global.I18N.lang) || "en";
  // Language of generated words (Figure / Рисунок, callout titles): front matter
  // `lang:` when it is one of ours, otherwise the interface language.
  const docLang = () => { const l = String((DOC.meta && DOC.meta.lang) || "").slice(0, 2).toLowerCase(); return WORDS.fig[l] ? l : uiLang(); };
  const word = (k) => WORDS[k][docLang()] || WORDS[k].en;
  const NUMBERING_RE = /<!--\s*docxmd:\s*numbered-headings\s*-->/i;
  const SEC_ATTR_RE = /[ \t]*\{#sec:([A-Za-z0-9_-]+)\}[ \t]*$/;
  // Word bookmark names: letters, digits, "_" only ("-" → "__", reversed on import)
  const bookmarkName = (kind, id) => (kind + "_" + String(id).replace(/-/g, "__")).slice(0, 40);

  // Word bookmark for a heading anchor: sec:id → sec_id, h-3 → h_3
  const headingBookmark = (anchor) => (/^sec:/.test(anchor) ? bookmarkName("sec", anchor.slice(4)) : String(anchor).replace(/-/g, "_"));
  // #sec:id / #fig:id / #tbl:id / #h-3 → Word bookmark name (null: not an internal target)
  function internalAnchor(href) {
    const m = /^#(sec|fig|tbl):([A-Za-z0-9_-]+)$/.exec(href || "");
    if (m) return m[1] === "sec" ? (DOC.secs[m[2]] || DOC.htmlIds.has("sec:" + m[2]) ? bookmarkName("sec", m[2]) : null) : ((m[1] === "fig" ? DOC.figs : DOC.tbls)[m[2]] ? bookmarkName(m[1], m[2]) : null);
    const h = /^#(h-\d+)$/.exec(href || "");
    return h && DOC.headings.some((x) => x.anchor === h[1] && x.linked) ? headingBookmark(h[1]) : null;
  }
  function emptyDoc() { return { meta: null, htmlIds: new Set(), figs: {}, tbls: {}, secs: {}, headings: [], fnNum: {}, fnOrder: [], fnDefs: {}, fnSeen: {}, numbered: false, hIndex: 0, hasToc: false }; }
  let DOC = emptyDoc();

  function tokensText(tokens) {
    return (tokens || []).map((t) => t.tokens ? tokensText(t.tokens) : t.type === "html" ? "" : decode(t.text || "")).join("");
  }
  // One pass over the lexed document (before rendering): numbers figures, tables,
  // footnotes and headings, strips {#sec:id} from headings and remembers anchors.
  function analyzeDoc(tokens) {
    const D = emptyDoc();
    let fig = 0, tbl = 0, fn = 0, hn = 0;
    const links = [];
    (function walk(list) {
      for (const t of list || []) {
        if (!t || typeof t !== "object") continue;
        switch (t.type) {
          case "html": {
            const raw = t.raw || t.text || "";
            if (NUMBERING_RE.test(raw)) D.numbered = true;
            raw.replace(/\sid\s*=\s*"([^"]+)"/gi, (m, id) => { D.htmlIds.add(id); return m; });
            break;
          }
          case "heading": {
            const m = SEC_ATTR_RE.exec(t.text || "");
            let sec = null;
            if (m) {
              sec = m[1];
              t.text = t.text.replace(SEC_ATTR_RE, "");
              const last = t.tokens && t.tokens[t.tokens.length - 1];
              if (last && last.type === "text") { last.text = last.text.replace(SEC_ATTR_RE, ""); last.raw = (last.raw || "").replace(SEC_ATTR_RE, ""); }
            }
            const h = { depth: t.depth, text: tokensText(t.tokens).trim(), sec, anchor: sec ? "sec:" + sec : "h-" + (hn++), num: "" };
            t._h = h; D.headings.push(h);
            if (sec) D.secs[sec] = h;
            break;
          }
          case "figure": if (t.id && !(t.id in D.figs)) D.figs[t.id] = ++fig; break;
          case "tableCaption": if (!(t.id in D.tbls)) D.tbls[t.id] = ++tbl; break;
          case "footnoteDef": D.fnDefs[t.id] = t; break;
          case "footnoteRef": if (!(t.id in D.fnNum)) { D.fnNum[t.id] = ++fn; D.fnOrder.push(t.id); } break;
          case "toc": D.hasToc = true; break;
          case "link": if (/^#./.test(t.href || "")) links.push(t); break;
        }
        if (t.tokens) walk(t.tokens);
        if (t.titleTokens) walk(t.titleTokens);
        if (t.captionTokens) walk(t.captionTokens);
        if (t.items) t.items.forEach((it) => walk(it.tokens));
        if (t.header) t.header.forEach((c) => walk(c.tokens));
        if (t.rows) t.rows.forEach((r) => r.forEach((c) => walk(c.tokens)));
      }
    })(tokens);
    resolveLinks(D, links);
    if (D.numbered && D.headings.length) {
      // a single top-level title is not numbered: numbering starts one level below it
      const h1 = D.headings.filter((h) => h.depth === 1).length;
      const min = h1 === 1 && D.headings.some((h) => h.depth > 1) ? 2 : Math.min.apply(null, D.headings.map((h) => h.depth));
      const c = [0, 0, 0, 0, 0, 0, 0];
      D.headings.forEach((h) => {
        if (h.depth < min) return;
        const lvl = h.depth - min;
        c[lvl]++; for (let k = lvl + 1; k < c.length; k++) c[k] = 0;
        h.num = c.slice(0, lvl + 1).map((x) => x || 1).join(".");
      });
    }
    return D;
  }
  // [text](#anchor) links to headings. Anchors that exist (#sec:id, #h-3) are kept;
  // anything else — GitHub-style slugs (#my-heading), Word bookmarks left over from a
  // .docx TOC (#_Toc241144139) — is matched to a heading by slug or by the link text
  // ("7.\tTitle\t22": list number and page number ignored). Links with the same text
  // go to same-text headings in document order. The link token gets the heading's
  // anchor, so the preview scrolls there and the DOCX gets an internal link.
  const textKey = (x) => String(x || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const lettersKey = (x) => String(x || "").toLowerCase().replace(/[^\p{L}]+/gu, "");
  const slugOf = (x) => String(x || "").trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
  const noPage = (x) => String(x || "").replace(/(?:[\t .…·_-]*\t|[ .…·_]{2,}|\s)\d+\s*$/, "");
  const noNum = (x) => String(x || "").replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/, "");
  // headings: [{text, anchor}], links: [{href, label}] → heading (or null) per link
  function matchLinks(headings, links, known) {
    const tiers = [
      [(h) => textKey(h.text), (l) => textKey(l)],
      [(h) => textKey(h.text), (l) => textKey(noPage(l))],
      [(h) => textKey(noNum(h.text)), (l) => textKey(noNum(noPage(l)))],
      [(h) => lettersKey(h.text), (l) => lettersKey(noPage(l))]
    ].map(([hk, lk]) => { const map = new Map(); headings.forEach((h) => { const k = hk(h); if (k) { if (!map.has(k)) map.set(k, []); map.get(k).push(h); } }); return { map, lk, seen: new Map() }; });
    const bySlug = new Map(); headings.forEach((h) => { const k = slugOf(h.text); if (k && !bySlug.has(k)) bySlug.set(k, h); });
    return links.map((l) => {
      let target = String(l.href || "").slice(1);
      try { target = decodeURIComponent(target); } catch (e) {}
      if (!target || known(target) || /^(fig|tbl|fn|fnref)[:-]/.test(target)) return null;
      let h = bySlug.get(target.toLowerCase()) || null;
      for (let i = 0; !h && i < tiers.length; i++) {
        const T = tiers[i], k = T.lk(l.label), list = k && T.map.get(k);
        if (!list) continue;
        const n = T.seen.get(k) || 0; T.seen.set(k, n + 1);
        h = list[n % list.length];
      }
      return h;
    });
  }
  function resolveLinks(D, links) {
    if (!links.length || !D.headings.length) return;
    const anchors = new Set(D.headings.map((h) => h.anchor));
    const hits = matchLinks(D.headings, links.map((t) => ({ href: t.href, label: tokensText(t.tokens) || t.text || "" })),
      (id) => anchors.has(id) || D.htmlIds.has(id));
    hits.forEach((h, i) => { if (h) { links[i].href = "#" + h.anchor; h.linked = true; } });
  }
  // Preview pass for links whose target is still missing — e.g. headings written as
  // raw HTML (<h3> inside an HTML table) or an older import: match against the
  // rendered headings the same way. Call after heading ids are assigned.
  function fixPreviewLinks(root) {
    const links = Array.from(root.querySelectorAll('a[href^="#"]'));
    if (!links.length) return;
    const doc = root.ownerDocument;
    const exists = (id) => { const e = doc.getElementById(id); return !!e && root.contains(e); };
    const heads = Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6")).filter((h) => h.id)
      .map((h) => ({ text: h.textContent, anchor: h.id }));
    if (!heads.length) return;
    const hits = matchLinks(heads, links.map((a) => ({ href: a.getAttribute("href"), label: a.textContent })), exists);
    hits.forEach((h, i) => { if (h) links[i].setAttribute("href", "#" + h.anchor); });
  }
  const xrefText = (kind, id) => {
    if (kind === "sec") { const h = DOC.secs[id]; return h ? (h.num ? h.num + " " : "") + h.text : null; }
    const n = (kind === "fig" ? DOC.figs : DOC.tbls)[id];
    return n ? word(kind) + " " + n : null;
  };
  const xrefAnchor = (kind, id) => (kind === "sec" ? (DOC.secs[id] ? DOC.secs[id].anchor : "") : kind + ":" + id);

  const FIG_RE = /^!\[((?:[^\]\\\n]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+"([^"\n]*)")?\s*\)\{([^}\n]*)\}[ \t]*(?:\n+|$)/;
  const TBLCAP_RE = /^(?:Table|Таблиця|Tabla|表)[ \t]*[:：][ \t]*([^\n]*?)[ \t]*\{#tbl:([A-Za-z0-9_-]+)\}[ \t]*(?:\n+|$)/;
  function structureExtensions() {
    return [
      { name: "footnoteDef", level: "block",
        start(src) { const m = /(^|\n)\[\^[^\]\s]+\]:/.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(src);
          if (!m) return undefined;
          const text = m[2].replace(/\n[ \t]+/g, " ").trim();
          return { type: "footnoteDef", raw: m[0], id: m[1], text, tokens: this.lexer.inlineTokens(text) };
        },
        renderer() { return ""; } },
      { name: "footnoteRef", level: "inline",
        start(src) { const i = src.indexOf("[^"); return i < 0 ? undefined : i; },
        tokenizer(src) { const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src); if (m) return { type: "footnoteRef", raw: m[0], id: m[1] }; },
        renderer(t) {
          const n = DOC.fnNum[t.id]; if (!n) return escHtml(t.raw);
          const first = !DOC.fnSeen[t.id]; DOC.fnSeen[t.id] = 1;
          return '<sup class="fn-ref"' + (first ? ' id="fnref-' + escHtml(t.id) + '"' : "") + '><a href="#fn-' + escHtml(t.id) + '">' + n + "</a></sup>";
        } },
      { name: "footnotes", level: "block",
        renderer() {
          if (!DOC.fnOrder.length) return "";
          return '<section class="footnotes"><ol>' + DOC.fnOrder.map((id) => {
            const d = DOC.fnDefs[id];
            return '<li id="fn-' + escHtml(id) + '" value="' + DOC.fnNum[id] + '">' + (d ? this.parser.parseInline(d.tokens) : "<em>?</em>") +
              ' <a href="#fnref-' + escHtml(id) + '" class="fn-back">↩</a></li>';
          }).join("") + "</ol></section>\n";
        } },
      { name: "figure", level: "block",
        start(src) { const m = /(^|\n)!\[/.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = FIG_RE.exec(src); if (!m) return undefined;
          const id = /#fig:([A-Za-z0-9_-]+)/.exec(m[4]); if (!id) return undefined;
          const w = WIDTH_ATTR_RE.exec(m[4]);
          const caption = m[1].replace(/\\(.)/g, "$1");
          return { type: "figure", raw: m[0], id: id[1], href: m[2].replace(/^<|>$/g, ""), title: m[3] || "", caption,
            width: w ? w[1] : "", captionTokens: this.lexer.inlineTokens(caption) };
        },
        renderer(t) {
          const n = DOC.figs[t.id], cap = this.parser.parseInline(t.captionTokens);
          return '<figure class="fig" id="fig:' + escHtml(t.id) + '"><img src="' + escHtml(t.href) + '" alt="' + escHtml(tokensText(t.captionTokens)) + '"' +
            (t.title ? ' title="' + escHtml(t.title) + '"' : "") + (t.width ? ' style="width:' + escHtml(widthCss(t.width)) + '"' : "") +
            '><figcaption><strong>' + word("fig") + " " + (n || "?") + "</strong>" + (t.caption ? " — " + cap : "") + "</figcaption></figure>\n";
        } },
      { name: "tableCaption", level: "block",
        start(src) { const m = /(^|\n)(?:Table|Таблиця|Tabla|表)[ \t]*[:：]/.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) {
          const m = TBLCAP_RE.exec(src); if (!m) return undefined;
          return { type: "tableCaption", raw: m[0], id: m[2], caption: m[1], captionTokens: this.lexer.inlineTokens(m[1]) };
        },
        renderer(t) {
          return '<p class="tbl-caption" id="tbl:' + escHtml(t.id) + '"><strong>' + word("tbl") + " " + (DOC.tbls[t.id] || "?") + "</strong>" +
            (t.caption ? " — " + this.parser.parseInline(t.captionTokens) : "") + "</p>\n";
        } },
      { name: "crossRef", level: "inline",
        start(src) { const m = /\[?@(?:fig|tbl|sec):/.exec(src); return m ? m.index : undefined; },
        tokenizer(src) {
          const m = /^\[@(fig|tbl|sec):([A-Za-z0-9_-]+)\]/.exec(src) || /^@(fig|tbl|sec):([A-Za-z0-9_-]+)/.exec(src);
          if (m) return { type: "crossRef", raw: m[0], kind: m[1], id: m[2] };
        },
        renderer(t) {
          const txt = xrefText(t.kind, t.id);
          if (!txt) return '<span class="xref-missing" title="?">' + escHtml(t.raw) + "</span>";
          return '<a class="xref" href="#' + escHtml(xrefAnchor(t.kind, t.id)) + '">' + escHtml(txt) + "</a>";
        } },
      { name: "toc", level: "block",
        start(src) { const m = /(^|\n)\[TOC\]/i.exec(src); return m ? m.index + m[1].length : undefined; },
        tokenizer(src) { const m = /^\[TOC\][ \t]*(?:\n+|$)/i.exec(src); if (m) return { type: "toc", raw: m[0] }; },
        renderer() {
          const hs = DOC.headings.filter((h) => h.depth <= 3 && h.text);
          if (!hs.length) return "";
          const min = Math.min.apply(null, hs.map((h) => h.depth));
          return '<nav class="toc"><p class="toc-title">' + word("toc") + '</p><ul>' + hs.map((h) =>
            '<li class="toc-l' + (h.depth - min + 1) + '"><a href="#' + escHtml(h.anchor) + '">' + (h.num ? '<span class="hnum">' + h.num + "</span> " : "") +
            escHtml(h.text) + "</a></li>").join("") + "</ul></nav>\n";
        } }
    ];
  }
  // Full marked configuration used by the PWA and the VS Code webview.
  function markedConfig() {
    return {
      extensions: extensions(),
      hooks: {
        preprocess(md) {
          DOC = emptyDoc();
          const fm = parseFrontMatter(md);
          PRE = { src: fm ? fm.body : md, base: fm ? fm.raw.length : 0, fmLen: fm ? fm.raw.length : 0 };
          if (!fm) return md;
          DOC.meta = fm.meta;
          return fm.body;
        },
        processAllTokens(tokens) {
          const meta = DOC.meta;
          DOC = analyzeDoc(tokens);
          DOC.meta = meta;
          DOC.blocks = [];
          if (BLOCK_MARKS && PRE) markBlocks(tokens, PRE.src, PRE.base);
          if (meta) {
            tokens.unshift({ type: "frontMatter", raw: "", meta });
            if (BLOCK_MARKS && PRE) { DOC.blocks.push({ start: 0, end: PRE.fmLen, type: "frontMatter" }); tokens.unshift({ type: "blockMark", raw: "", n: DOC.blocks.length - 1 }); }
          }
          if (DOC.fnOrder.length) tokens.push({ type: "footnotes", raw: "" });
          return tokens;
        }
      },
      renderer: {
        heading(text, level) {
          const h = DOC.headings[DOC.hIndex++] || {};
          return "<h" + level + (h.anchor ? ' id="' + escHtml(h.anchor) + '"' : "") + ">" +
            (h.num ? '<span class="hnum">' + h.num + "</span> " : "") + text + "</h" + level + ">\n";
        }
      }
    };
  }

  // ![alt](src "title"){width=60%} — any image (not only numbered figures) with a width.
  // Named "image" so its renderer also serves marked's own image tokens (falls back
  // to the default when there is no width).
  const IMG_ATTR_RE = /^!\[((?:[^\]\\\n]|\\.)*)\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+"([^"\n]*)")?\s*\)\{([^}\n]*)\}/;
  function imageExtension() {
    return {
      name: "image", level: "inline",
      start(src) { const i = src.indexOf("!["); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = IMG_ATTR_RE.exec(src); if (!m) return undefined;
        const w = WIDTH_ATTR_RE.exec(m[4]); if (!w) return undefined;
        return { type: "image", raw: m[0], href: m[2].replace(/^<|>$/g, ""), title: m[3] || null, text: m[1].replace(/\\(.)/g, "$1"), width: w[1] };
      },
      renderer(t) {
        if (!t.width) return false;
        return '<img src="' + escHtml(t.href) + '" alt="' + escHtml(t.text || "") + '"' + (t.title ? ' title="' + escHtml(t.title) + '"' : "") +
          ' style="width:' + escHtml(widthCss(t.width)) + '">';
      }
    };
  }

  // ---- ==highlight== ------------------------------------------------------
  // ==text== (yellow) and ==red:text== (colour name right before a colon, no space).
  // Preview: <mark class="hl hl-red">; DOCX: Word text highlight.
  const HIGHLIGHTS = {
    yellow: "yellow", red: "red", green: "green", blue: "cyan", pink: "magenta", gray: "lightGray"
  };
  const HL_ALIAS = {
    grey: "gray", cyan: "blue", magenta: "pink",
    "жовтий": "yellow", "червоний": "red", "зелений": "green", "синій": "blue", "блакитний": "blue",
    "рожевий": "pink", "сірий": "gray"
  };
  // Word highlight value → our colour name (DOCX import)
  const HL_FROM_WORD = {
    yellow: "yellow", darkYellow: "yellow", red: "red", darkRed: "red", green: "green", darkGreen: "green",
    cyan: "blue", blue: "blue", darkBlue: "blue", darkCyan: "blue", magenta: "pink", darkMagenta: "pink",
    lightGray: "gray", darkGray: "gray"
  };
  function highlightName(name) {
    const n = String(name || "").trim().toLowerCase();
    return HIGHLIGHTS[n] ? n : (HL_ALIAS[n] || null);
  }
  const MARK_RE = /^==(?![\s=])((?:\\=|[^=\n]|=(?!=))+?)(?<![\s\\])==(?!=)/;
  function markExtension() {
    return {
      name: "mark", level: "inline",
      start(src) { const i = src.indexOf("=="); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = MARK_RE.exec(src); if (!m) return undefined;
        let text = m[1], color = "yellow";
        const c = /^([A-Za-z\u0400-\u04FF]+):(?!\s)/.exec(text);
        if (c && highlightName(c[1])) { color = highlightName(c[1]); text = text.slice(c[0].length); }
        return { type: "mark", raw: m[0], color, text, tokens: this.lexer.inlineTokens(text) };
      },
      renderer(t) { return '<mark class="hl hl-' + t.color + '">' + this.parser.parseInline(t.tokens) + "</mark>"; }
    };
  }

  // ---- YAML front matter ----------------------------------------------------
  // ---
  // title: …            author: …          lang: uk
  // header: …           footer: …          page-numbers: "Page {n} of {N}"
  // ---
  // A small YAML subset: `key: value` (quoted or not), `key:` + "- item" lists.
  // Anything else between the fences means it is not front matter (a rule + text).
  const FM_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;
  function fmValue(v) {
    v = String(v).trim();
    const q = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
    if (q) return q[1].replace(/\\(["\\])/g, "$1").replace(/\\n/g, "\n");
    const s = /^'((?:[^']|'')*)'$/.exec(v);
    if (s) return s[1].replace(/''/g, "'");
    return v.replace(/\s+#.*$/, "");
  }
  function parseFrontMatter(md) {
    const m = FM_RE.exec(md || "");
    if (!m) return null;
    const meta = {}, order = [];
    let last = null;
    for (const line of m[1].split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const kv = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
      if (kv) {
        last = kv[1].toLowerCase(); order.push(last);
        const v = kv[2] == null ? "" : kv[2].trim();
        const arr = /^\[(.*)\]$/.exec(v);
        meta[last] = arr ? arr[1].split(",").map(fmValue).filter(Boolean) : fmValue(v);
        continue;
      }
      const item = /^[ \t]+-[ \t]+(.*)$/.exec(line) || /^-[ \t]+(.*)$/.exec(line);
      if (item && last) { if (!Array.isArray(meta[last])) meta[last] = meta[last] ? [meta[last]] : []; meta[last].push(fmValue(item[1])); continue; }
      if (/^[ \t]+\S/.test(line) && last && typeof meta[last] === "string") { meta[last] = (meta[last] + " " + line.trim()).trim(); continue; }
      return null;
    }
    if (!order.length) return null;
    return { meta, keys: order, raw: m[0], body: md.slice(m[0].length) };
  }
  const metaText = (v) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));
  // header/footer placeholders other than the page fields
  function fillMeta(text, meta) {
    return String(text).replace(/\{(title|author|date|subject)\}/g, (x, k) => metaText(meta[k]));
  }
  // `page-numbers:` true / yes / on → just the number; a string with {n}/{N} is used as is
  function pageNumbersFormat(meta) {
    const v = meta["page-numbers"];
    if (v == null || v === "") return null;
    if (/^(false|no|off|0)$/i.test(String(v))) return null;
    if (/^(true|yes|on|1)$/i.test(String(v))) return "{n}";
    return /\{n\}|\{N\}/.test(v) ? String(v) : String(v) + " {n}";
  }
  function frontMatterExtension() {
    return {
      name: "frontMatter", level: "block",
      renderer(t) {
        const meta = t.meta || {}, keys = Object.keys(meta);
        const head = [meta.title, meta.author].map(metaText).filter(Boolean).map(escHtml).join(" · ") || "front matter";
        return '<details class="fm-card"><summary><span class="fm-tag">YAML</span> ' + head + "</summary><table>" +
          keys.map((k) => "<tr><th>" + escHtml(k) + "</th><td>" + escHtml(metaText(meta[k])) + "</td></tr>").join("") +
          "</table></details>\n";
      }
    };
  }

  // ---- Editing in the preview: block map + inline text map -------------------
  // With block marks on (the PWA preview only), every top-level block of the
  // document gets an invisible <i class="bm" data-b="N"> in front of it and
  // DOC.blocks[N] = { start, end } is its range in the Markdown source. HTML that
  // opens a <div>/<table>… across blank lines stays one block until it closes.
  let BLOCK_MARKS = false, PRE = null;
  const HTML_WRAP = /<(\/?)(div|table|details|section|center|figure|blockquote|aside|article)\b[^>]*>/gi;
  function htmlBalance(raw) {
    let d = 0, m; HTML_WRAP.lastIndex = 0;
    while ((m = HTML_WRAP.exec(raw))) d += m[1] ? -1 : 1;
    return d;
  }
  function markBlocks(tokens, src, base) {
    const out = [];
    let cur = 0, depth = 0, blk = null;
    for (const t of tokens) {
      const at = t.raw ? src.indexOf(t.raw, cur) : -1;
      if (at < 0) { out.push(t); continue; }          // synthetic / lost sync: not editable
      cur = at + t.raw.length;
      if (t.type === "space") { out.push(t); continue; }
      if (depth > 0 && blk) { blk.end = base + cur; blk.type = "html"; }
      else {
        blk = { start: base + at, end: base + cur, type: t.type };
        DOC.blocks.push(blk);
        out.push({ type: "blockMark", raw: "", n: DOC.blocks.length - 1 });
      }
      if (t.type === "html") depth = Math.max(0, depth + htmlBalance(t.raw));
      out.push(t);
    }
    tokens.length = 0;
    out.forEach((t) => tokens.push(t));
  }
  function blockMarkExtension() {
    return { name: "blockMark", level: "block", renderer(t) { return '<i class="bm" data-b="' + t.n + '"></i>'; } };
  }

  // Inline-text map of one block's Markdown for the quick text edit: every
  // "container" (paragraph, heading, list item, table cell) with its rendered
  // text and leaves { s, e, t0, t1, edit } — s/e are source offsets, t0/t1 offsets
  // in the rendered text; edit = the leaf's text is written verbatim in the source.
  const SEC_TAIL = /[ \t]*\{#sec:[A-Za-z0-9_-]+\}[ \t]*$/;
  function editContainers(src, base) {
    const out = [];
    let tokens;
    try { tokens = global.marked.lexer(src); } catch (e) { return out; }
    function leaves(list, raw, abs, c, code) {
      let cur = 0;
      for (const t of list || []) {
        if (!t.raw) continue;
        const at = raw.indexOf(t.raw, cur);
        if (at < 0) { c.bad = true; return; }
        cur = at + t.raw.length;
        const s = abs + at;
        const push = (text, ls, edit) => { c.leaves.push({ s: ls, e: ls + (edit ? text.length : t.raw.length), text, edit, kind: code ? "code" : t.type }); };
        switch (t.type) {
          case "text":
            if (t.tokens && t.tokens.length && !(t.tokens.length === 1 && t.tokens[0] === t)) { leaves(t.tokens, t.raw, s, c); break; }
            { const r = decode(t.text); push(r, s, r === t.raw); } break;
          case "strong": case "em": case "del": case "mark": case "link":
            leaves(t.tokens, t.raw, s, c); break;
          case "codespan": {
            const r = decode(t.text), i = t.raw.indexOf(r);
            if (i >= 0 && r.indexOf("`") < 0) c.leaves.push({ s: s + i, e: s + i + r.length, text: r, edit: true, kind: "code" });
            else push(r, s, false);
            break;
          }
          case "escape": push(decode(t.text), s, false); break;
          case "br": case "image": case "html": case "mathInline": case "footnoteRef": case "crossRef":
            c.leaves.push({ s, e: s + t.raw.length, text: "", edit: false, kind: t.type }); break;
          default:
            if (t.tokens) leaves(t.tokens, t.raw, s, c); else c.bad = true;
        }
      }
    }
    function container(kind, inl, raw, abs) {
      const c = { kind, leaves: [], bad: false };
      leaves(inl, raw, abs, c);
      if (kind === "heading" && c.leaves.length) {            // {#sec:id} is not shown in the preview
        const L = c.leaves[c.leaves.length - 1], m = SEC_TAIL.exec(L.text);
        if (m && L.edit) { L.text = L.text.slice(0, m.index); L.e = L.s + L.text.length; }
      }
      let pos = 0;
      c.leaves.forEach((L) => { L.t0 = pos; pos += L.text.length; L.t1 = pos; });
      c.text = c.leaves.map((L) => L.text).join("");
      out.push(c);
    }
    function blocks(list, raw, abs) {
      let cur = 0;
      for (const t of list || []) {
        if (!t.raw) continue;
        const at = raw.indexOf(t.raw, cur);
        if (at < 0) return;
        cur = at + t.raw.length;
        const s = abs + at;
        switch (t.type) {
          case "paragraph": case "heading": {
            const i = t.raw.indexOf(t.text);
            if (i >= 0) container(t.type, t.tokens, t.text, s + i);
            break;
          }
          case "text": {
            const i = t.raw.indexOf(t.text);
            if (i >= 0 && t.tokens) container("text", t.tokens, t.text, s + i);
            break;
          }
          case "list": {
            let ic = 0;
            (t.items || []).forEach((it) => { const j = t.raw.indexOf(it.raw, ic); if (j < 0) return; ic = j + it.raw.length; blocks(it.tokens, it.raw, s + j); });
            break;
          }
          case "table": {
            let tc = 0;
            const cell = (cl) => { const j = t.raw.indexOf(cl.text, tc); if (j < 0 || !cl.text) return; tc = j + cl.text.length; container("cell", cl.tokens, cl.text, s + j); };
            (t.header || []).forEach(cell);
            (t.rows || []).forEach((r) => r.forEach(cell));
            break;
          }
          default:
            if (t.tokens && /^(blockquote|colorBox|tableBox)$/.test(t.type)) blocks(t.tokens, t.raw, s);
        }
      }
    }
    blocks(tokens, src, base);
    return out;
  }

  // ---- Document statistics (status bar panel) --------------------------------
  function docStats(md) {
    const fm = parseFrontMatter(md);
    const body = fm ? fm.body : String(md || "");
    const S = { headings: 0, h: [0, 0, 0, 0, 0, 0], paragraphs: 0, tables: 0, images: 0, figures: 0, captions: 0,
      mathInline: 0, mathBlock: 0, footnotes: 0, linksExt: 0, linksInt: 0, code: 0, lists: 0, boxes: 0, marks: 0,
      words: (body.match(/\S+/g) || []).length, chars: body.length, charsNoSpace: body.replace(/\s/g, "").length,
      lines: body ? body.split("\n").length : 0, frontMatter: !!fm };
    if (!global.marked) return S;
    let tokens;
    try { tokens = global.marked.lexer(body); } catch (e) { return S; }
    const fnIds = new Set();
    (function walk(list) {
      for (const t of list || []) {
        if (!t || typeof t !== "object") continue;
        switch (t.type) {
          case "heading": S.headings++; S.h[t.depth - 1]++; break;
          case "paragraph": S.paragraphs++; break;
          case "table": S.tables++; break;
          case "image": S.images++; break;
          case "figure": S.figures++; S.images++; break;
          case "tableCaption": S.captions++; break;
          case "mathInline": S.mathInline++; break;
          case "mathBlock": S.mathBlock++; break;
          case "footnoteDef": fnIds.add(t.id); break;
          case "footnoteRef": fnIds.add(t.id); break;
          case "link": if (/^#/.test(t.href || "")) S.linksInt++; else S.linksExt++; break;
          case "crossRef": S.linksInt++; break;
          case "code": S.code++; break;
          case "list": S.lists++; break;
          case "colorBox": S.boxes++; break;
          case "mark": S.marks++; break;
          case "html": {
            const raw = t.raw || t.text || "";
            S.tables += (raw.match(/<table\b/gi) || []).length;
            S.images += (raw.match(/<img\b/gi) || []).length;
            const hs = raw.match(/<h[1-6]\b/gi) || [];
            hs.forEach((x) => { S.headings++; S.h[+x[2] - 1]++; });
            break;
          }
        }
        if (t.tokens) walk(t.tokens);
        if (t.captionTokens) walk(t.captionTokens);
        if (t.items) t.items.forEach((it) => walk(it.tokens));
        if (t.header) t.header.forEach((c) => walk(c.tokens));
        if (t.rows) t.rows.forEach((r) => r.forEach((c) => walk(c.tokens)));
      }
    })(tokens);
    S.footnotes = fnIds.size;
    return S;
  }

  // All DOCXMD marked extensions (register in the PWA and the VS Code webview)
  function extensions() { return [alertExtension(), colorBoxExtension(), tableBoxExtension(), imageExtension(), markExtension(), frontMatterExtension(), blockMarkExtension()].concat(structureExtensions()); }

  // Numeric column detection (shared by preview and DOCX): a column with no
  // explicit alignment whose body cells are all numbers (optionally with a unit,
  // a range or a comparison) is right-aligned.
  const NUM_RE = /^[<>≤≥~≈±+\-−]?\s*\d[\d\s.,]*(?:\s*[–—-]\s*\d[\d\s.,]*)?\s*(?:%|‰|°\s?[CF]|[A-Za-zµμ°²³\/·]{1,8})?$/;
  const cellPlain = (x) => String(x == null ? "" : x).replace(/<[^>]*>/g, "").replace(/[*_`~]/g, "").replace(/&nbsp;/g, " ").trim();
  function isNumericCell(text) { const v = cellPlain(text); return !!v && NUM_RE.test(v); }

  // Header / footer paragraph: plain text with {n} (PAGE) and {N} (NUMPAGES) fields.
  // Footer text + page numbers share one line: text on the left, numbers on the right.
  function hfRuns(text, D) {
    return String(text).split(/(\{n\}|\{N\})/).filter((x) => x !== "").map((x) =>
      new D.TextRun({ children: [x === "{n}" ? D.PageNumber.CURRENT : x === "{N}" ? D.PageNumber.TOTAL_PAGES : x], size: 18, color: "666666" }));
  }
  function hfParagraph(text, pageFmt, D) {
    if (text && pageFmt) {
      return new D.Paragraph({
        children: hfRuns(text, D).concat([new D.TextRun({ children: [new D.Tab()], size: 18 })], hfRuns(pageFmt, D)),
        tabStops: [{ type: D.TabStopType.RIGHT, position: D.TabStopPosition.MAX }]
      });
    }
    return new D.Paragraph({ children: hfRuns(text || pageFmt, D), alignment: D.AlignmentType.CENTER });
  }

  // ---- Main --------------------------------------------------------------
  async function toBlob(markdown, opts, onProgress) {
    if (!ready()) throw new Error("Converter libraries not loaded");
    opts = opts || {};
    const D = global.docx;
    const report = (p, label) => { if (onProgress) onProgress(p, label); };

    report(0.05, "parse");
    // YAML front matter → document properties, header/footer, page numbers
    const fm = parseFrontMatter(markdown || "");
    const meta = fm ? fm.meta : {};
    const tokens = global.marked.lexer(fm ? fm.body : (markdown || ""));

    // Pre-fetch images FIRST. Everything after the awaits below runs synchronously
    // up to Packer, so a preview render in between (it resets the shared DOC) can
    // no longer mix its numbering into the export.
    const srcs = new Set();
    collectImageSrcs(tokens, srcs);
    const imgMap = new Map();
    if (srcs.size) {
      let done = 0;
      for (const s of srcs) {
        let info = null;
        if (opts.resolveAsset) {
          try { const b = opts.resolveAsset(s); if (b) info = await blobToInfo(b, s); } catch (e) {}
        }
        // resolveUrl: relative paths → a fetchable URL (the VS Code webview resource URI)
        if (!info) info = await fetchImage(opts.resolveUrl ? opts.resolveUrl(s) : s);
        if (info) imgMap.set(s, info);
        done++; report(0.05 + 0.2 * (done / srcs.size), "images");
      }
    }

    const previewDoc = DOC;
    DOC = analyzeDoc(tokens); // numbers figures/tables/footnotes/headings (same as the preview)
    DOC.meta = fm ? meta : null;

    // default quote bar = the editor theme's accent (what the preview shows)
    const ctx = { D, imgMap, ol: 0, olStarts: new Set(), quoteColor: boxColor(opts.quoteColor) || "BBBBBB" };
    const body = [];
    const total = tokens.length || 1;
    const H = HEADING(D);
    // Text-alignment context, driven by <div align="…"> wrappers in the source.
    const alignStack = [];
    const curAlign = () => (alignStack.length ? alignStack[alignStack.length - 1] : null);

    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      try {
        switch (tk.type) {
          case "heading": {
            const h = tk._h || {};
            let hr = inlineRuns(tk.tokens, {}, imgMap, D);
            if (h.num) hr.unshift(new D.TextRun(h.num + " "));
            if (h.sec) hr = [new D.Bookmark({ id: bookmarkName("sec", h.sec), children: hr })];
            else if (h.linked) hr = [new D.Bookmark({ id: headingBookmark(h.anchor), children: hr })];
            // marker so a DOCX import restores <!-- docxmd: numbered-headings -->
            if (h.num && !ctx.numMarked) { ctx.numMarked = true; hr.unshift(new D.Bookmark({ id: "docxmd_numbered", children: [] })); }
            body.push(new D.Paragraph({
              heading: H[tk.depth] || D.HeadingLevel.HEADING_6,
              children: hr,
              alignment: mapAlign(curAlign(), D),
              spacing: { before: 240, after: 80 }
            }));
            break;
          }
          case "footnoteDef": break;          // written as real Word footnotes (see below)
          case "figure": {
            const info = imgMap.get(tk.href);
            let img;
            if (info) img = imageRun(info, tk.width, D);
            else img = mkRun("[" + tk.caption + "]", { italics: true }, D);
            body.push(new D.Paragraph({ children: [img], alignment: D.AlignmentType.CENTER, keepNext: true, spacing: { before: 120, after: 60 } }));
            const cap = [new D.Bookmark({ id: bookmarkName("fig", tk.id), children: [new D.TextRun({ text: word("fig") + " " + (DOC.figs[tk.id] || "?"), bold: true })] })];
            if (tk.caption) cap.push(new D.TextRun(" — "), ...inlineRuns(tk.captionTokens, {}, imgMap, D));
            body.push(new D.Paragraph({ children: cap, alignment: D.AlignmentType.CENTER, spacing: { after: 200 } }));
            break;
          }
          case "tableCaption": {
            const cap = [new D.Bookmark({ id: bookmarkName("tbl", tk.id), children: [new D.TextRun({ text: word("tbl") + " " + (DOC.tbls[tk.id] || "?"), bold: true })] })];
            if (tk.caption) cap.push(new D.TextRun(" — "), ...inlineRuns(tk.captionTokens, {}, imgMap, D));
            body.push(new D.Paragraph({ children: cap, keepNext: true, spacing: { before: 160, after: 80 } }));
            break;
          }
          case "toc":
            body.push(new D.Paragraph({ children: [new D.Bookmark({ id: "docxmd_toc", children: [new D.TextRun({ text: word("toc"), bold: true, size: 28 })] })], spacing: { before: 120, after: 120 } }));
            body.push(new D.TableOfContents(word("toc"), { hyperlink: true, headingStyleRange: "1-3" }));
            break;
          case "paragraph":
            body.push(new D.Paragraph({
              children: inlineRuns(tk.tokens, {}, imgMap, D),
              alignment: mapAlign(curAlign(), D),
              spacing: { after: 120 }
            }));
            break;
          case "mathBlock":
            body.push(new D.Paragraph({
              children: [mathToOmml(D, tk.text)],
              alignment: D.AlignmentType.CENTER,
              spacing: { before: 80, after: 120 }
            }));
            break;
          case "colorBox":
            body.push(buildQuote({ tokens: unwrapQuotes(tk.tokens) }, ctx, tk.color, tk));
            body.push(new D.Paragraph({ text: "", spacing: { after: 80 } }));
            break;
          case "blockquote":
            body.push(buildQuote(tk, ctx));
            body.push(new D.Paragraph({ text: "", spacing: { after: 80 } }));
            break;
          case "code":
            body.push(codeBlock(tk, D, 0));
            break;
          case "list":
            if (tk.ordered) ctx.ol++;
            buildList(tk, 0, ctx.ol, ctx, body);
            break;
          case "table":
            body.push(buildTable(tk, ctx));
            body.push(new D.Paragraph({ text: "", spacing: { after: 80 } }));
            break;
          case "hr":
            body.push(new D.Paragraph({
              text: "", border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
              spacing: { before: 120, after: 120 }
            }));
            break;
          case "space":
            break;
          case "tableBox":
            // :::table-compact / :::table-full — process the content with the table mode set
            tokens.splice(i + 1, 0, { type: "__tblmode", mode: tk.mode }, ...tk.tokens, { type: "__tblmode", mode: null });
            break;
          case "__tblmode": ctx.tableMode = tk.mode; break;
          case "__alignpush": alignStack.push(tk.a); break;
          case "__alignpop": alignStack.pop(); break;
          case "html": {
            let raw = String(tk.text || "");
            if (/^\s*<table[\s>]/i.test(raw)) {
              // blank lines inside the table split it into several tokens: rejoin
              while (!/<\/table>/i.test(raw) && i + 1 < tokens.length) raw += "\n" + (tokens[++i].raw || "");
              const tbl = parseHtmlTable(raw);
              if (tbl) {
                body.push(buildHtmlTable(tbl, ctx));
                body.push(new D.Paragraph({ text: "", spacing: { after: 80 } }));
                break;
              }
            }
            const al = alignFromHtml(raw), closing = isClosingHtml(raw);
            if (al && closing) {
              // Self-contained <div align="x"> … </div> on one block: re-lex the
              // inner Markdown and process it between push/pop markers.
              const inner = raw.replace(/^\s*<[^>]+>/, "").replace(/<\/[^>]+>\s*$/, "").trim();
              const innerToks = global.marked.lexer(inner);
              tokens.splice(i + 1, 0, { type: "__alignpush", a: al }, ...innerToks, { type: "__alignpop" });
              break;
            }
            if (al) { alignStack.push(al); break; }      // opening wrapper
            if (closing && alignStack.length) { alignStack.pop(); break; } // closing wrapper
            if (/<img\b/i.test(raw)) {
              // <img width="…"> (and text around it) as real Word paragraphs
              const frag = parseHtmlFragment(raw);
              if (frag) { body.push(...htmlCellChildren(frag, {}, curAlign(), ctx)); break; }
            }
            const txt = raw.replace(/<[^>]*>/g, "").trim();
            if (txt) body.push(new D.Paragraph({ children: [mkRun(decode(txt), {}, D)], alignment: mapAlign(curAlign(), D) }));
            break;
          }
          default:
            if (tk.tokens) body.push(new D.Paragraph({ children: inlineRuns(tk.tokens, {}, imgMap, D) }));
            else if (tk.text) body.push(new D.Paragraph({ children: [mkRun(decode(tk.text), {}, D)] }));
        }
      } catch (e) {
        body.push(new D.Paragraph({ children: [mkRun(decode(tk.raw || tk.text || ""), {}, D)] }));
      }
      if (i % 50 === 0) report(0.25 + 0.6 * (i / total), "build");
    }

    if (!body.length) body.push(new D.Paragraph({ children: [new D.TextRun("")] }));

    report(0.9, "package");

    const olLevels = [0, 1, 2, 3, 4, 5].map((l) => ({
      level: l,
      format: D.LevelFormat.DECIMAL,
      text: "%" + (l + 1) + ".",
      alignment: D.AlignmentType.START,
      style: { paragraph: { indent: { left: 360 * (l + 1) + 360, hanging: 360 } } }
    }));

    const footnotes = {};
    DOC.fnOrder.forEach((id) => {
      const d = DOC.fnDefs[id];
      footnotes[DOC.fnNum[id]] = { children: [new D.Paragraph({ children: d ? inlineRuns(d.tokens, {}, imgMap, D) : [new D.TextRun("?")] })] };
    });
    const pageFmt = pageNumbersFormat(meta);
    const headerText = meta.header ? fillMeta(metaText(meta.header), meta) : "";
    const footerText = meta.footer ? fillMeta(metaText(meta.footer), meta) : "";
    const section = { properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: body };
    if (headerText) section.headers = { default: new D.Header({ children: [hfParagraph(headerText, null, D)] }) };
    if (footerText || pageFmt) section.footers = { default: new D.Footer({ children: [hfParagraph(footerText, pageFmt, D)] }) };
    const doc = new D.Document({
      footnotes,
      features: DOC.hasToc ? { updateFields: true } : undefined,
      creator: metaText(meta.author) || "DOCXMD",
      title: metaText(meta.title) || opts.title || "Document",
      subject: metaText(meta.subject) || undefined,
      keywords: metaText(meta.keywords) || undefined,
      description: metaText(meta.description || meta.abstract) || "Converted from Markdown by DOCXMD",
      numbering: { config: [{ reference: "docxmd-ol", levels: olLevels }].concat(
        Array.from(ctx.olStarts, (n) => ({ reference: "docxmd-ol-" + n, levels: olLevels.map((l) => (l.level === 0 ? Object.assign({}, l, { start: n }) : l)) }))) },
      styles: {
        default: {
          document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { line: 276 } } }
        },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 40, bold: true, color: "1a1a1a" }, paragraph: { spacing: { before: 240, after: 120 } } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, color: "1a1a1a" }, paragraph: { spacing: { before: 200, after: 100 } } },
          { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 28, bold: true, color: "2a2a2a" }, paragraph: { spacing: { before: 160, after: 80 } } }
        ]
      },
      sections: [section]
    });

    DOC = previewDoc;      // hand the preview's state back before the async packing
    const blob = await D.Packer.toBlob(doc);
    report(1, "done");
    return blob;
  }

  global.MD2DOCX = { toBlob, ready, extensions, colorBoxExtension, boxColor, colorName, BOX_COLORS,
    CALLOUTS, calloutKind, calloutByColor, isDefaultCalloutTitle, isNumericCell, dataImageRanges, backdropHtml,
    markedConfig, bookmarkName, NUMBERING_RE, fixPreviewLinks, imageRanges, imageWidthEdit, widthCss,
    parseFrontMatter, docStats, highlightName, HIGHLIGHTS, HL_FROM_WORD,
    setBlockMarks(on) { BLOCK_MARKS = !!on; }, blocks: () => (DOC.blocks || []).slice(), editContainers };
})(typeof window !== "undefined" ? window : this);
