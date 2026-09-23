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
      const buf = await blob.arrayBuffer();
      let type = (blob.type || "").split("/")[1] || "";
      type = type.replace("jpeg", "jpg").replace("svg+xml", "svg");
      if (!/^(png|jpg|gif|bmp|svg)$/.test(type)) {
        const ext = ((src || "").split("?")[0].split(".").pop() || "").toLowerCase();
        type = ext === "jpeg" ? "jpg" : ext;
      }
      if (!/^(png|jpg|gif|bmp)$/.test(type)) return null; // docx raster only
      const dim = await imageSize(blob);
      return { data: buf, type: type, width: dim.w, height: dim.h };
    } catch (e) { return null; }
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

  function collectImageSrcs(tokens, out) {
    for (const t of tokens) {
      if (t.type === "image" && t.href) out.add(t.href);
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
  const MOPS = { cdot: "·", times: "×", div: "÷", pm: "±", mp: "∓", approx: "≈", neq: "≠", ne: "≠", leq: "≤", le: "≤", geq: "≥", ge: "≥", ll: "≪", gg: "≫", rightarrow: "→", to: "→", leftarrow: "←", infty: "∞", ldots: "…", cdots: "⋯", dots: "…", equiv: "≡", sim: "∼", propto: "∝", partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", in: "∈", notin: "∉", cup: "∪", cap: "∩", forall: "∀", exists: "∃" };

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
          runs.push(new D.ExternalHyperlink({ link: tk.href || "#", children: kids.length ? kids : [mkRun(tk.text || tk.href, { color: "0563C1", underline: true }, D)] }));
          break;
        }
        case "image": {
          const info = tk.href && imgMap.get(tk.href);
          if (info) {
            runs.push(new D.ImageRun({ data: info.data, type: info.type, transformation: { width: info.width, height: info.height } }));
          } else if (tk.text) {
            runs.push(mkRun("[" + tk.text + "]", Object.assign({}, style, { italics: true }), D));
          }
          break;
        }
        case "mathInline":
          runs.push(mathToOmml(D, tk.text)); break;
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
    u: { underline: true }, s: { strike: true }, del: { strike: true }, strike: { strike: true }
  };

  function mkRun(text, style, D) {
    return new D.TextRun({
      text: text || "",
      bold: !!style.bold,
      italics: !!style.italics,
      strike: !!style.strike,
      underline: style.underline ? {} : undefined,
      superScript: style.sup || undefined,
      subScript: style.sub || undefined,
      color: style.color
    });
  }

  function decode(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
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
    const aligns = tk.align || [];
    const mkCell = (cell, header) => new D.TableCell({
      children: [new D.Paragraph({
        children: inlineRuns(cell.tokens || [{ type: "text", text: cell.text }], header ? { bold: true } : {}, ctx.imgMap, D),
        alignment: mapAlign(aligns[cell.__i], D)
      })],
      shading: header ? { type: D.ShadingType.CLEAR, fill: "F0F0F0" } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 }
    });
    const head = new D.TableRow({
      tableHeader: true,
      children: tk.header.map((c, i) => { c.__i = i; return mkCell(c, true); })
    });
    rows.push(head);
    for (const r of tk.rows) {
      rows.push(new D.TableRow({ children: r.map((c, i) => { c.__i = i; return mkCell(c, false); }) }));
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

  // Blockquote → one-cell table with only a left bar, so the bar is continuous
  // and the quote can hold any block: paragraphs, lists, code, tables, quotes.
  const QUOTE_STYLE = { color: "666666" };
  function buildQuote(tk, ctx, color) {
    const D = ctx.D;
    const bar = { style: D.BorderStyle.SINGLE, size: 24, color: color || ctx.quoteColor || "BBBBBB" };
    const qctx = Object.assign({}, ctx, { baseStyle: QUOTE_STYLE });
    const kids = [];
    const para = (runs, extra) => kids.push(new D.Paragraph(Object.assign({ children: runs, spacing: { after: 80 } }, extra)));
    for (const b of (tk.tokens || global.marked.lexer(tk.text || ""))) {
      switch (b.type) {
        case "space": break;
        case "paragraph": case "text":
          para(inlineRuns(b.tokens || [{ type: "text", text: b.text }], QUOTE_STYLE, ctx.imgMap, D)); break;
        case "heading":
          para(inlineRuns(b.tokens, Object.assign({ bold: true }, QUOTE_STYLE), ctx.imgMap, D)); break;
        case "list":
          if (b.ordered) ctx.ol++;
          buildList(b, 0, ctx.ol, qctx, kids); break;
        case "code": kids.push(codeBlock(b, D, 0)); break;
        case "mathBlock": para([mathToOmml(D, b.text)], { alignment: D.AlignmentType.CENTER }); break;
        case "table": kids.push(buildTable(b, ctx)); break;
        case "blockquote": kids.push(buildQuote(b, ctx)); break;
        case "colorBox": kids.push(buildQuote({ tokens: unwrapQuotes(b.tokens) }, ctx, b.color)); break;
        case "hr": break;
        default: {
          const txt = String(b.text || "").replace(/<[^>]*>/g, "").trim();
          if (b.tokens) para(inlineRuns(b.tokens, QUOTE_STYLE, ctx.imgMap, D));
          else if (txt) para([mkRun(decode(txt), QUOTE_STYLE, D)]);
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
        margins: { top: 60, bottom: 20, left: 240, right: 80 },
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
          if (info) runs.push(new D.ImageRun({ data: info.data, type: info.type, transformation: { width: info.width, height: info.height } }));
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
        walk(n, /^h[1-6]$/.test(tag) ? Object.assign(elFmt(n, st), { bold: true }) : elFmt(n, st), listInfo);
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
  function boxColor(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase();
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
  const BOX_RE = /^:::[ \t]*(#?[0-9A-Za-zЀ-ӿ]+)[ \t]*\n([\s\S]*?\n)?[ \t]*:::[ \t]*(?:\n|$)/;
  function colorBoxExtension() {
    return {
      name: "colorBox", level: "block",
      start(src) { const m = /(^|\n):::[ \t]*#?[0-9A-Za-zЀ-ӿ]/.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src) {
        const m = BOX_RE.exec(src);
        const color = m && boxColor(m[1]);
        if (!color) return undefined;
        return { type: "colorBox", raw: m[0], color, tokens: this.lexer.blockTokens(m[2] || "", []) };
      },
      renderer(t) {
        return '<blockquote class="md-box" style="border-left-color:#' + t.color + '">\n' +
          this.parser.parse(unwrapQuotes(t.tokens)) + "</blockquote>\n";
      }
    };
  }

  // ---- Main --------------------------------------------------------------
  async function toBlob(markdown, opts, onProgress) {
    if (!ready()) throw new Error("Converter libraries not loaded");
    opts = opts || {};
    const D = global.docx;
    const report = (p, label) => { if (onProgress) onProgress(p, label); };

    report(0.05, "parse");
    const tokens = global.marked.lexer(markdown || "");

    // Pre-fetch images
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
        if (!info) info = await fetchImage(s);
        if (info) imgMap.set(s, info);
        done++; report(0.05 + 0.2 * (done / srcs.size), "images");
      }
    }

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
          case "heading":
            body.push(new D.Paragraph({
              heading: H[tk.depth] || D.HeadingLevel.HEADING_6,
              children: inlineRuns(tk.tokens, {}, imgMap, D),
              alignment: mapAlign(curAlign(), D),
              spacing: { before: 240, after: 80 }
            }));
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
            body.push(buildQuote({ tokens: unwrapQuotes(tk.tokens) }, ctx, tk.color));
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

    const doc = new D.Document({
      creator: "DOCXMD",
      title: opts.title || "Document",
      description: "Converted from Markdown by DOCXMD",
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
      sections: [{
        properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
        children: body
      }]
    });

    const blob = await D.Packer.toBlob(doc);
    report(1, "done");
    return blob;
  }

  global.MD2DOCX = { toBlob, ready, colorBoxExtension, boxColor, colorName, BOX_COLORS };
})(typeof window !== "undefined" ? window : this);
