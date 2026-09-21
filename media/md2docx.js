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
        case "html":
          // strip tags, keep any text
          { const txt = String(tk.text || "").replace(/<[^>]*>/g, ""); if (txt.trim()) runs.push(mkRun(decode(txt), style, D)); }
          break;
        default:
          if (tk.tokens) runs.push(...inlineRuns(tk.tokens, style, imgMap, D));
          else if (tk.text) runs.push(mkRun(decode(tk.text), style, D));
      }
    }
    return runs;
  }

  function mkRun(text, style, D) {
    return new D.TextRun({
      text: text || "",
      bold: !!style.bold,
      italics: !!style.italics,
      strike: !!style.strike,
      underline: style.underline ? {} : undefined,
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
          lead.push(...inlineRuns(child.tokens || [{ type: "text", text: child.text }], {}, ctx.imgMap, D));
        } else if (child.type === "space") { /* ignore */ }
        else if (child.type === "code") {
          nested.push(child); // handle code blocks after lead
        } else {
          lead.push(...inlineRuns(child.tokens || [], {}, ctx.imgMap, D));
        }
      }

      const opts = { children: lead, spacing: { after: 40 } };
      if (item.task) {
        opts.children = [new D.TextRun({ text: (item.checked ? "☒ " : "☐ ") }), ...lead];
        opts.indent = { left: 360 * (level + 1) };
      } else if (list.ordered) {
        opts.numbering = { reference: "docxmd-ol", level: Math.min(level, 5), instance: olInstance };
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

    const ctx = { D, imgMap };
    const body = [];
    let olInstance = 0;
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
          case "blockquote": {
            const inner = global.marked.lexer(tk.text || "");
            for (const b of inner) {
              body.push(new D.Paragraph({
                children: b.tokens ? inlineRuns(b.tokens, { italics: true, color: "666666" }, imgMap, D) : [mkRun(decode(b.text), { italics: true, color: "666666" }, D)],
                indent: { left: 480 },
                border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: "BBBBBB", space: 12 } },
                spacing: { after: 80 }
              }));
            }
            break;
          }
          case "code":
            body.push(codeBlock(tk, D, 0));
            break;
          case "list":
            if (tk.ordered) olInstance++;
            buildList(tk, 0, olInstance, ctx, body);
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
            const raw = String(tk.text || "");
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
      numbering: { config: [{ reference: "docxmd-ol", levels: olLevels }] },
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

  global.MD2DOCX = { toBlob, ready };
})(typeof window !== "undefined" ? window : this);
