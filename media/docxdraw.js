/* DOCXMD — Word drawings that mammoth cannot show (Word import)
   1) Shapes and groups of shapes (flowcharts drawn in Word: wps:wsp / wpg:wgp, with or without
      a VML fallback) → one SVG picture each: frames, lines, connectors with arrow heads, fills and
      the text of the text boxes. The drawing is replaced by a text marker in document.xml; after the
      conversion the marker becomes ![](data:image/svg+xml…){width=…%}.
   2) Floating pictures (wp:anchor): position, wrapping and "behind text" go into the picture's
      description (alt text), so the imported HTML can place them as Word does — a stamp over a
      signature line stays there instead of being pushed into the text.
   Exposes: window.DOCXMDDraw = { prepare(ab) → { ab, shapes } | null, finishHtml(html), finishMd(md, shapes) } */
(function (global) {
  "use strict";
  const NS = {
    w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    wpg: "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    wpc: "http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas",
    r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture"
  };
  const EMU_PX = 9525, EMU_PT = 12700;
  const ANCHOR_TAG = "docxmd-anchor:";
  const kids = (el, ns, name) => (el ? Array.from(el.childNodes).filter((c) => c.nodeType === 1 && c.namespaceURI === NS[ns] && (!name || c.localName === name)) : []);
  const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
  const desc = (el, ns, name) => (el ? Array.from(el.getElementsByTagNameNS(NS[ns], name)) : []);
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
  const attr = (el, name) => (el ? el.getAttribute(name) : null);
  const wattr = (el, name) => (el ? el.getAttributeNS(NS.w, name) || el.getAttribute("w:" + name) : null);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------------- colours (theme + modifiers) ---------------- */
  function themeColors(xml) {
    const out = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1" };
    if (!xml) return out;
    try {
      const d = new DOMParser().parseFromString(xml, "application/xml");
      const cs = desc(d.documentElement, "a", "clrScheme")[0]; if (!cs) return out;
      Array.from(cs.childNodes).forEach((c) => {
        if (c.nodeType !== 1) return;
        const v = c.firstElementChild; if (!v) return;
        const val = v.localName === "sysClr" ? attr(v, "lastClr") : attr(v, "val");
        if (val) out[c.localName] = val;
      });
    } catch (e) {}
    return out;
  }
  function hexToRgb(h) { const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) { return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join(""); }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (!s) return [l * 255, l * 255, l * 255];
    const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
  }
  // <a:solidFill> / <a:fontRef> … → "#rrggbb" (null: none)
  function colorOf(holder, theme) {
    if (!holder) return null;
    const c = Array.from(holder.childNodes).find((x) => x.nodeType === 1 && /^(srgbClr|schemeClr|sysClr|prstClr)$/.test(x.localName));
    if (!c) return null;
    const SCHEME = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2" };
    const PRST = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080" };
    let hex = c.localName === "srgbClr" ? attr(c, "val") : c.localName === "sysClr" ? attr(c, "lastClr") || "000000"
      : c.localName === "prstClr" ? PRST[attr(c, "val")] || "000000" : theme[SCHEME[attr(c, "val")] || attr(c, "val")] || "000000";
    let [r, g, b] = hexToRgb(hex || "000000");
    let alpha = 1;
    Array.from(c.childNodes).forEach((m) => {
      if (m.nodeType !== 1) return;
      const v = num(attr(m, "val"), 100000) / 100000;
      if (m.localName === "lumMod" || m.localName === "lumOff") {
        const hsl = rgbToHsl(r, g, b);
        hsl[2] = m.localName === "lumMod" ? hsl[2] * v : Math.min(1, hsl[2] + v);
        [r, g, b] = hslToRgb(hsl[0], hsl[1], hsl[2]);
      } else if (m.localName === "shade") { r *= v; g *= v; b *= v; }
      else if (m.localName === "tint") { r = r + (255 - r) * (1 - v); g = g + (255 - g) * (1 - v); b = b + (255 - b) * (1 - v); }
      else if (m.localName === "alpha") alpha = v;
    });
    return { hex: rgbToHex(r, g, b), alpha };
  }

  /* ---------------- geometry ---------------- */
  // preset shapes → SVG path in the box (x, y, w, h); null = no outline of its own (text only)
  function presetPath(prst, x, y, w, h, av) {
    const r = (f) => Math.min(w, h) * f;
    const P = (pts) => "M" + pts.map((p) => p[0] + "," + p[1]).join(" L") + " Z";
    switch (prst) {
      case "textNoShape": return null;
      case "ellipse": case "flowChartConnector": case "flowChartOffpageConnector":
        return "M" + (x + w / 2) + "," + y + " A" + w / 2 + "," + h / 2 + " 0 1,1 " + (x + w / 2) + "," + (y + h) + " A" + w / 2 + "," + h / 2 + " 0 1,1 " + (x + w / 2) + "," + y + " Z";
      case "roundRect": case "flowChartAlternateProcess": {
        const k = r(av.adj != null ? av.adj : (prst === "roundRect" ? 0.16667 : 0.16667));
        return "M" + (x + k) + "," + y + " H" + (x + w - k) + " Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + k) + " V" + (y + h - k) + " Q" + (x + w) + "," + (y + h) + " " + (x + w - k) + "," + (y + h) + " H" + (x + k) + " Q" + x + "," + (y + h) + " " + x + "," + (y + h - k) + " V" + (y + k) + " Q" + x + "," + y + " " + (x + k) + "," + y + " Z";
      }
      case "flowChartTerminator": {
        const k = Math.min(h / 2, w / 2);
        return "M" + (x + k) + "," + y + " H" + (x + w - k) + " A" + k + "," + h / 2 + " 0 0,1 " + (x + w - k) + "," + (y + h) + " H" + (x + k) + " A" + k + "," + h / 2 + " 0 0,1 " + (x + k) + "," + y + " Z";
      }
      case "diamond": case "flowChartDecision": return P([[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]]);
      case "parallelogram": case "flowChartInputOutput": { const k = w * (av.adj != null ? Math.min(av.adj, 1) * h / w : 0.2); return P([[x + k, y], [x + w, y], [x + w - k, y + h], [x, y + h]]); }
      case "triangle": case "isoTriangle": return P([[x + w / 2, y], [x + w, y + h], [x, y + h]]);
      case "rtTriangle": return P([[x, y], [x + w, y + h], [x, y + h]]);
      case "hexagon": case "flowChartPreparation": { const k = w * 0.2; return P([[x + k, y], [x + w - k, y], [x + w, y + h / 2], [x + w - k, y + h], [x + k, y + h], [x, y + h / 2]]); }
      case "pentagon": case "homePlate": { const k = w * 0.2; return P([[x, y], [x + w - k, y], [x + w, y + h / 2], [x + w - k, y + h], [x, y + h]]); }
      case "chevron": { const k = w * 0.2; return P([[x, y], [x + w - k, y], [x + w, y + h / 2], [x + w - k, y + h], [x, y + h], [x + k, y + h / 2]]); }
      case "rightArrow": { const t = h * 0.25, k = Math.min(w * 0.4, h * 0.5); return P([[x, y + t], [x + w - k, y + t], [x + w - k, y], [x + w, y + h / 2], [x + w - k, y + h], [x + w - k, y + h - t], [x, y + h - t]]); }
      case "leftArrow": { const t = h * 0.25, k = Math.min(w * 0.4, h * 0.5); return P([[x + w, y + t], [x + k, y + t], [x + k, y], [x, y + h / 2], [x + k, y + h], [x + k, y + h - t], [x + w, y + h - t]]); }
      case "downArrow": { const t = w * 0.25, k = Math.min(h * 0.4, w * 0.5); return P([[x + t, y], [x + w - t, y], [x + w - t, y + h - k], [x + w, y + h - k], [x + w / 2, y + h], [x, y + h - k], [x + t, y + h - k]]); }
      case "upArrow": { const t = w * 0.25, k = Math.min(h * 0.4, w * 0.5); return P([[x + w / 2, y], [x + w, y + k], [x + w - t, y + k], [x + w - t, y + h], [x + t, y + h], [x + t, y + k], [x, y + k]]); }
      case "flowChartDocument": { const k = h * 0.1; return "M" + x + "," + y + " H" + (x + w) + " V" + (y + h - k) + " C" + (x + w * 0.75) + "," + (y + h - 3 * k) + " " + (x + w * 0.4) + "," + (y + h + k) + " " + x + "," + (y + h - k) + " Z"; }
      case "can": case "flowChartMagneticDisk": { const k = h * 0.1; return "M" + x + "," + (y + k) + " A" + w / 2 + "," + k + " 0 0,1 " + (x + w) + "," + (y + k) + " V" + (y + h - k) + " A" + w / 2 + "," + k + " 0 0,1 " + x + "," + (y + h - k) + " Z M" + x + "," + (y + k) + " A" + w / 2 + "," + k + " 0 0,0 " + (x + w) + "," + (y + k); }
      default: return "M" + x + "," + y + " H" + (x + w) + " V" + (y + h) + " H" + x + " Z";     // rect, flowChartProcess, …
    }
  }
  const CONNECTOR = /^(line|straightConnector1|bentConnector[2-5]|curvedConnector[2-5])$/;
  // points of a connector in its box, before flipping: [[x,y], …]
  function connectorPts(prst, w, h, av) {
    const a1 = av.adj1 != null ? av.adj1 : 0.5, a2 = av.adj2 != null ? av.adj2 : 0.5;
    if (prst === "bentConnector2") return [[0, 0], [w, 0], [w, h]];
    if (prst === "bentConnector3") return [[0, 0], [w * a1, 0], [w * a1, h], [w, h]];
    if (prst === "bentConnector4") return [[0, 0], [w * a1, 0], [w * a1, h * a2], [w, h * a2], [w, h]];
    if (prst === "bentConnector5") return [[0, 0], [w * a1, 0], [w * a1, h * a2], [w * (av.adj3 != null ? av.adj3 : 0.5), h * a2], [w * (av.adj3 != null ? av.adj3 : 0.5), h], [w, h]];
    return [[0, 0], [w, h]];
  }
  function avList(geom) {
    const out = {};
    desc(geom, "a", "gd").forEach((g) => { const m = /val\s+(-?\d+)/.exec(attr(g, "fmla") || ""); if (m) out[attr(g, "name")] = +m[1] / 100000; });
    return out;
  }
  // a custom geometry (a:custGeom) → path in the box
  function customPath(geom, x, y, w, h) {
    let d = "";
    desc(geom, "a", "path").forEach((p) => {
      const pw = num(attr(p, "w"), w) || w, ph = num(attr(p, "h"), h) || h;
      const X = (v) => x + num(v, 0) * w / pw, Y = (v) => y + num(v, 0) * h / ph;
      Array.from(p.childNodes).forEach((c) => {
        if (c.nodeType !== 1) return;
        const pts = desc(c, "a", "pt").map((q) => X(attr(q, "x")) + "," + Y(attr(q, "y")));
        if (c.localName === "moveTo") d += "M" + pts[0] + " ";
        else if (c.localName === "lnTo") d += "L" + pts[0] + " ";
        else if (c.localName === "cubicBezTo") d += "C" + pts.join(" ") + " ";
        else if (c.localName === "quadBezTo") d += "Q" + pts.join(" ") + " ";
        else if (c.localName === "close") d += "Z ";
      });
    });
    return d.trim() || null;
  }

  /* ---------------- text of a text box ---------------- */
  let measureCtx = null;
  function textWidthPx(text, sizePx, bold, italic, family) {
    if (!measureCtx && typeof document !== "undefined") measureCtx = document.createElement("canvas").getContext("2d");
    if (!measureCtx) return text.length * sizePx * 0.5;
    measureCtx.font = (italic ? "italic " : "") + (bold ? "bold " : "") + sizePx + "px " + family;
    return measureCtx.measureText(text).width;
  }
  // paragraphs of w:txbxContent → [{ align, runs: [{ text, size(pt), bold, italic, color }] }]
  function boxParagraphs(txbx, defaultPt) {
    const out = [];
    desc(txbx, "w", "p").forEach((p) => {
      const ppr = kid(p, "w", "pPr");
      const jc = ppr ? wattr(kid(ppr, "w", "jc"), "val") : null;
      const pRpr = ppr ? kid(ppr, "w", "rPr") : null;
      const runs = [];
      desc(p, "w", "r").forEach((r) => {
        const rpr = kid(r, "w", "rPr") || pRpr;
        const sz = rpr ? num(wattr(kid(rpr, "w", "sz"), "val"), 0) : 0;
        const on = (n) => { const e = rpr && kid(rpr, "w", n); return !!e && !/^(0|false)$/.test(wattr(e, "val") || ""); };
        const col = rpr ? wattr(kid(rpr, "w", "color"), "val") : null;
        let text = "";
        Array.from(r.childNodes).forEach((c) => {
          if (c.nodeType !== 1 || c.namespaceURI !== NS.w) return;
          if (c.localName === "t") text += c.textContent;
          else if (c.localName === "tab") text += " ";
          else if (c.localName === "br") text += "\n";
        });
        if (text) runs.push({ text, size: sz ? sz / 2 : defaultPt, bold: on("b"), italic: on("i"), color: col && col !== "auto" ? "#" + col : null });
      });
      out.push({ align: jc === "center" ? "middle" : jc === "right" || jc === "end" ? "end" : "start", runs });
    });
    return out;
  }
  // lines that fit maxW (EMU): words of all runs of a paragraph, wrapped
  function layoutText(paras, maxW, family) {
    const lines = [];
    paras.forEach((p) => {
      const lineH = Math.max(5, ...p.runs.map((r) => r.size)) * 1.12 * 96 / 72;
      if (!p.runs.length) { lines.push({ align: p.align, parts: [], h: lineH, w: 0 }); return; }
      let cur = { align: p.align, parts: [], h: lineH, w: 0 };
      const push = () => { lines.push(cur); cur = { align: p.align, parts: [], h: lineH, w: 0 }; };
      p.runs.forEach((r) => {
        const px = r.size * 96 / 72;
        r.text.split(/(\n)/).forEach((chunk) => {
          if (chunk === "\n") { push(); return; }
          chunk.split(/(\s+)/).forEach((word) => {
            if (!word) return;
            const wEmu = textWidthPx(word, px, r.bold, r.italic, family);
            if (cur.w + wEmu > maxW && cur.parts.length && word.trim()) { push(); if (!word.trim()) return; }
            if (!cur.parts.length && !word.trim()) return;
            const last = cur.parts[cur.parts.length - 1];
            if (last && last.r === r) last.text += word; else cur.parts.push({ r, text: word });
            cur.w += wEmu;
          });
        });
      });
      push();
    });
    return lines;
  }

  /* ---------------- one drawing → SVG ---------------- */
  // image: (rId) → data URI | null (pictures inside a canvas or a group of shapes)
  function renderDrawing(drawing, theme, defaultPt, image) {
    const frame = kid(drawing, "wp", "inline") || kid(drawing, "wp", "anchor");
    const ext = kid(frame, "wp", "extent");
    const W = num(attr(ext, "cx"), 0), H = num(attr(ext, "cy"), 0);
    if (!W || !H) return null;
    const gd = desc(frame, "a", "graphicData")[0]; if (!gd) return null;
    const root = kid(gd, "wpg", "wgp") || kid(gd, "wps", "wsp") || kid(gd, "wpc", "wpc"); if (!root) return null;
    const family = "Calibri, Carlito, Arial, sans-serif";
    const defs = new Map(), body = [], texts = [];
    const marker = (type, color, w, where) => {
      if (!type || type === "none") return "";
      const id = "m" + where + type + color.replace("#", "") + Math.round(w);
      if (!defs.has(id)) {
        const s = Math.max(w, 1) * 3 + 4;
        const shape = type === "oval" ? '<circle cx="5" cy="5" r="4"/>' : type === "diamond" ? '<path d="M5,0 L10,5 L5,10 L0,5 Z"/>' : type === "arrow" ? '<path d="M0,0 L10,5 L0,10" fill="none" stroke="' + color + '" stroke-width="1.5"/>' : '<path d="M0,0 L10,5 L0,10 Z"/>';
        defs.set(id, '<marker id="' + id + '" viewBox="0 0 10 10" refX="' + (type === "oval" ? 5 : 9) + '" refY="5" markerUnits="userSpaceOnUse" markerWidth="' + s + '" markerHeight="' + s + '" orient="auto-start-reverse" fill="' + color + '">' + shape + "</marker>");
      }
      return ' marker-' + (where === "s" ? "start" : "end") + '="url(#' + id + ')"';
    };
    // m: the parent frame → drawing EMU: X = x * m.sx + m.tx
    const walk = (el, m) => {
      // a drawing canvas (wpc): its children are placed in the drawing's own EMU space
      if (el.localName === "wpc") {
        const bg = kid(el, "wpc", "bg");
        const bf = bg && kid(bg, "a", "solidFill") ? colorOf(kid(bg, "a", "solidFill"), theme) : null;
        if (bf) body.push('<rect x="0" y="0" width="' + W / EMU_PX + '" height="' + H / EMU_PX + '" fill="' + bf.hex + '"/>');
        Array.from(el.childNodes).forEach((c) => { if (c.nodeType === 1 && /^(wsp|grpSp|wgp|pic)$/.test(c.localName)) walk(c, m); });
        return;
      }
      // a picture inside a canvas / group
      if (el.localName === "pic" && el.namespaceURI === NS.pic) {
        const sp = kid(el, "pic", "spPr"), xf = sp && kid(sp, "a", "xfrm"); if (!xf) return;
        const off = kid(xf, "a", "off"), ex = kid(xf, "a", "ext");
        const blip = desc(el, "a", "blip")[0], rid = blip ? blip.getAttributeNS(NS.r, "embed") || blip.getAttribute("r:embed") : null;
        const href = rid && image ? image(rid) : null; if (!href) return;
        const x = (m.tx + m.sx * num(attr(off, "x"), 0)) / EMU_PX, y = (m.ty + m.sy * num(attr(off, "y"), 0)) / EMU_PX;
        body.push('<image x="' + x + '" y="' + y + '" width="' + m.sx * num(attr(ex, "cx"), 0) / EMU_PX + '" height="' + m.sy * num(attr(ex, "cy"), 0) / EMU_PX + '" preserveAspectRatio="none" href="' + href + '"/>');
        return;
      }
      if (el.localName === "wgp" || el.localName === "grpSp") {
        const xf = desc(kid(el, "wpg", "grpSpPr") || el, "a", "xfrm")[0];
        let mm = m;
        if (xf) {
          const off = kid(xf, "a", "off"), ex = kid(xf, "a", "ext"), co = kid(xf, "a", "chOff"), ce = kid(xf, "a", "chExt");
          const ox = num(attr(off, "x"), 0), oy = num(attr(off, "y"), 0), ew = num(attr(ex, "cx"), 0), eh = num(attr(ex, "cy"), 0);
          const cx = num(attr(co, "x"), 0), cy = num(attr(co, "y"), 0), cw = num(attr(ce, "cx"), ew) || ew, ch = num(attr(ce, "cy"), eh) || eh;
          const top = el.localName === "wgp";
          // the top group fills the drawing's extent; a nested one sits at its offset in the parent
          const sx = top ? W / (cw || W) : (cw ? ew / cw : 1), sy = top ? H / (ch || H) : (ch ? eh / ch : 1);
          const bx = top ? 0 : ox, by = top ? 0 : oy;
          mm = { sx: m.sx * sx, sy: m.sy * sy, tx: m.tx + m.sx * (bx - cx * sx), ty: m.ty + m.sy * (by - cy * sy) };
        }
        Array.from(el.childNodes).forEach((c) => { if (c.nodeType === 1 && /^(wsp|grpSp|pic)$/.test(c.localName)) walk(c, mm); });
        return;
      }
      if (el.localName !== "wsp") return;
      const sp = kid(el, "wps", "spPr"); if (!sp) return;
      const xf = kid(sp, "a", "xfrm"), off = kid(xf, "a", "off"), ex = kid(xf, "a", "ext");
      // the SVG is in px: a font size in EMU (127000 for 10 pt) is capped by browsers and comes out tiny
      const x = (m.tx + m.sx * num(attr(off, "x"), 0)) / EMU_PX, y = (m.ty + m.sy * num(attr(off, "y"), 0)) / EMU_PX;
      const w = m.sx * num(attr(ex, "cx"), 0) / EMU_PX, h = m.sy * num(attr(ex, "cy"), 0) / EMU_PX;
      const rot = num(attr(xf, "rot"), 0) / 60000, fH = attr(xf, "flipH") === "1", fV = attr(xf, "flipV") === "1";
      const pg = kid(sp, "a", "prstGeom"), cg = kid(sp, "a", "custGeom");
      const prst = pg ? attr(pg, "prst") : cg ? "custom" : "rect";
      const av = avList(pg || cg);
      const style = kid(el, "wps", "style");
      // fill
      let fill = null;
      if (kid(sp, "a", "noFill")) fill = null;
      else if (kid(sp, "a", "solidFill")) fill = colorOf(kid(sp, "a", "solidFill"), theme);
      else if (kid(sp, "a", "gradFill")) { const gs = desc(kid(sp, "a", "gradFill"), "a", "gs")[0]; fill = colorOf(gs, theme); }
      else if (style && num(attr(kid(style, "a", "fillRef"), "idx"), 0) > 0 && !CONNECTOR.test(prst)) fill = colorOf(kid(style, "a", "fillRef"), theme);
      // outline
      const ln = kid(sp, "a", "ln");
      let stroke = null, sw = 1;
      if (ln && kid(ln, "a", "noFill")) stroke = null;
      else if (ln && kid(ln, "a", "solidFill")) stroke = colorOf(kid(ln, "a", "solidFill"), theme);
      else if (style && num(attr(kid(style, "a", "lnRef"), "idx"), 0) > 0) stroke = colorOf(kid(style, "a", "lnRef"), theme);
      if (ln && attr(ln, "w")) sw = Math.max(0.5, num(attr(ln, "w"), 9525) / EMU_PX);
      const dash = ln ? attr(kid(ln, "a", "prstDash"), "val") : null;
      const da = !dash || dash === "solid" ? "" : ' stroke-dasharray="' + (/dot/i.test(dash) ? [sw, sw * 2] : /lgDash/.test(dash) ? [sw * 8, sw * 3] : [sw * 4, sw * 3]).join(",") + '"';
      const tf = rot ? ' transform="rotate(' + rot + " " + (x + w / 2) + " " + (y + h / 2) + ')"' : "";
      if (CONNECTOR.test(prst)) {
        if (!stroke) stroke = { hex: "#000000", alpha: 1 };
        const pts = connectorPts(prst, w, h, av).map(([px, py]) => [x + (fH ? w - px : px), y + (fV ? h - py : py)]);
        const head = ln ? kid(ln, "a", "headEnd") : null, tail = ln ? kid(ln, "a", "tailEnd") : null;
        const d = /^curved/.test(prst) ? "M" + pts[0] + " C" + [x + (fH ? w / 2 : w / 2), pts[0][1]] + " " + [x + w / 2, pts[pts.length - 1][1]] + " " + pts[pts.length - 1] : "M" + pts.map((p) => p.join(",")).join(" L");
        body.push('<path d="' + d + '" fill="none" stroke="' + stroke.hex + '"' + (stroke.alpha < 1 ? ' stroke-opacity="' + stroke.alpha + '"' : "") + ' stroke-width="' + sw + '"' + da + tf +
          marker(head && attr(head, "type"), stroke.hex, sw, "s") + marker(tail && attr(tail, "type"), stroke.hex, sw, "e") + "/>");
      } else {
        const d = prst === "custom" ? customPath(cg, x, y, w, h) : presetPath(prst, x, y, w, h, { adj: av.adj });
        if (d && (fill || stroke)) body.push('<path d="' + d + '" fill="' + (fill ? fill.hex : "none") + '"' + (fill && fill.alpha < 1 ? ' fill-opacity="' + fill.alpha + '"' : "") +
          (stroke ? ' stroke="' + stroke.hex + '" stroke-width="' + sw + '"' + (stroke.alpha < 1 ? ' stroke-opacity="' + stroke.alpha + '"' : "") + da : "") + tf + "/>");
      }
      // text box
      const txbx = kid(el, "wps", "txbx"), content = txbx ? kid(txbx, "w", "txbxContent") : null;
      if (content) {
        const bp = kid(el, "wps", "bodyPr");
        const li = num(attr(bp, "lIns"), 91440) * m.sx / EMU_PX, ri = num(attr(bp, "rIns"), 91440) * m.sx / EMU_PX, ti = num(attr(bp, "tIns"), 45720) * m.sy / EMU_PX, bi = num(attr(bp, "bIns"), 45720) * m.sy / EMU_PX;
        const anchor = attr(bp, "anchor") || "t";
        const paras = boxParagraphs(content, defaultPt);
        const fontRef = style ? colorOf(kid(style, "a", "fontRef"), theme) : null;
        // the text must fit its box: the substitute font (no Calibri here) is often wider than Word's,
        // so the box text is scaled down a little until it fits (not below 70 %)
        const availW = Math.max(10, w - li - ri), availH = Math.max(6, h - ti - bi);
        let lines = layoutText(paras, availW, family), total = lines.reduce((s, l) => s + l.h, 0);
        for (let k = 0, f = 1; k < 4 && total > availH && f > 0.7; k++) {
          f = Math.max(0.7, f * Math.min(0.95, Math.sqrt(availH / total)));
          const scaled = paras.map((pp) => ({ align: pp.align, runs: pp.runs.map((r) => Object.assign({}, r, { size: r.size * f })) }));
          lines = layoutText(scaled, availW, family); total = lines.reduce((s, l) => s + l.h, 0);
        }
        let ty = anchor === "ctr" ? y + ti + (h - ti - bi - total) / 2 : anchor === "b" ? y + h - bi - total : y + ti;
        lines.forEach((l) => {
          ty += l.h;
          if (!l.parts.length) return;
          const tx = l.align === "middle" ? x + w / 2 : l.align === "end" ? x + w - ri : x + li;
          const spans = l.parts.map((p) => '<tspan font-size="' + Math.round(p.r.size * 96 / 72 * 100) / 100 + '"' + (p.r.bold ? ' font-weight="bold"' : "") + (p.r.italic ? ' font-style="italic"' : "") +
            (p.r.color || fontRef ? ' fill="' + (p.r.color || fontRef.hex) + '"' : "") + ">" + esc(p.text) + "</tspan>").join("");
          texts.push('<text x="' + tx + '" y="' + (ty - l.h * 0.22) + '" text-anchor="' + l.align + '"' + tf + ">" + spans + "</text>");
        });
      }
    };
    walk(root, { sx: 1, sy: 1, tx: 0, ty: 0 });
    if (!body.length && !texts.length) return null;
    const tidy = (str) => str.replace(/(\d+\.\d{2})\d+/g, "$1");
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + Math.round(W / EMU_PX) + " " + Math.round(H / EMU_PX) + '" width="' + Math.round(W / EMU_PX) + '" height="' + Math.round(H / EMU_PX) + '" font-family="' + family + '" fill="#000">' +
      (defs.size ? "<defs>" + Array.from(defs.values()).join("") + "</defs>" : "") + tidy(body.join("") + texts.join("")) + "</svg>";
    return { svg, w: W, h: H };
  }

  /* ---------------- document.xml rewrite ---------------- */
  async function prepare(ab) {
    const Z = global.DOCXMDZip;
    if (!Z || typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return null;
    let files; try { files = await Z.read(ab); } catch (e) { return null; }
    const part = files.get("word/document.xml"); if (!part) return null;
    const xml = Z.text(part);
    if (!/<wps:wsp\b|<wpg:wgp\b|<wpc:wpc\b|<wp:anchor\b/.test(xml)) return null;
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const body = desc(doc.documentElement, "w", "body")[0]; if (!body) return null;
    const theme = themeColors(files.get("word/theme/theme1.xml") ? Z.text(files.get("word/theme/theme1.xml")) : null);
    // default text size (docDefaults) for text boxes without their own
    let defaultPt = 11;
    const st = files.get("word/styles.xml");
    if (st) { const m = /<w:docDefaults>[\s\S]*?<w:sz w:val="(\d+)"/.exec(Z.text(st)); if (m) defaultPt = +m[1] / 2; }
    // the text column: pictures and drawings get their width as a share of it
    const sect = desc(body, "w", "sectPr").pop();
    const pgW = num(wattr(sect && kid(sect, "w", "pgSz"), "w"), 11906), mar = sect && kid(sect, "w", "pgMar");
    const textW = (pgW - num(wattr(mar, "left"), 1440) - num(wattr(mar, "right"), 1440)) * 635;          // twips → EMU
    const shapes = [];
    // pictures referenced from a canvas / group: rId → data URI (PNG, JPEG, GIF, SVG)
    const rels = {};
    const relsPart = files.get("word/_rels/document.xml.rels");
    if (relsPart) Z.text(relsPart).replace(/<Relationship\b[^>]*>/g, (tag) => { const id = /Id="([^"]+)"/.exec(tag), t = /Target="([^"]+)"/.exec(tag); if (id && t) rels[id[1]] = t[1]; return tag; });
    const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", bmp: "image/bmp" };
    const image = (rid) => {
      const tgt = rels[rid]; if (!tgt) return null;
      const path = tgt.replace(/^\/?/, "").replace(/^(?!word\/)/, "word/"), ext = (/\.(\w+)$/.exec(path) || [])[1];
      const data = files.get(path), mime = ext && MIME[ext.toLowerCase()];
      if (!data || !mime) return null;
      let bin = ""; for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
      return "data:" + mime + ";base64," + btoa(bin);
    };
    const W_ = (n) => doc.createElementNS(NS.w, "w:" + n);
    const markerRun = (i) => { const r = W_("r"), t = W_("t"); t.textContent = "DOCXMDSHAPE" + i + "X"; r.appendChild(t); return r; };
    // 1) shapes: the run that holds the drawing (or its mc:AlternateContent) becomes a marker run
    desc(body, "w", "drawing").forEach((dr) => {
      if (!dr.isConnected) return;
      const gd = desc(dr, "a", "graphicData")[0];
      if (!gd || !(kid(gd, "wpg", "wgp") || kid(gd, "wps", "wsp") || kid(gd, "wpc", "wpc"))) return;
      let r;
      try { r = renderDrawing(dr, theme, defaultPt, image); } catch (e) { console.warn("DOCXMDDraw shape", e); r = null; }
      if (!r) return;
      const run = dr.closest ? dr.closest("r") : null;
      const host = (function () { let n = dr; while (n && !(n.localName === "r" && n.namespaceURI === NS.w)) n = n.parentNode; return n; })() || run;
      if (!host || !host.parentNode) return;
      const an = kid(dr, "wp", "anchor");
      shapes.push({ svg: r.svg, pct: Math.max(1, Math.min(100, Math.round(r.w / textW * 1000) / 10)), px: Math.round(r.w / EMU_PX), anchor: an ? anchorInfo(an) : null });
      host.parentNode.replaceChild(markerRun(shapes.length - 1), host);
    });
    // 2) floating pictures: where Word puts them → the description (read back in finishHtml)
    let anchors = 0;
    desc(body, "wp", "anchor").forEach((an) => {
      if (!an.isConnected || !desc(an, "pic", "pic").length) return;
      const info = anchorInfo(an);
      const dp = kid(an, "wp", "docPr"); if (!dp) return;
      dp.setAttribute("descr", ANCHOR_TAG + JSON.stringify(info) + "|" + (attr(dp, "descr") || ""));
      anchors++;
    });
    if (!shapes.length && !anchors) return null;
    files.set("word/document.xml", Z.bytes(new XMLSerializer().serializeToString(doc)));
    const out = await Z.write(files);
    return { ab: out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength), shapes };
    function anchorInfo(an) {
      const ph = kid(an, "wp", "positionH"), pv = kid(an, "wp", "positionV"), ext = kid(an, "wp", "extent");
      const wrapEl = Array.from(an.childNodes).find((c) => c.nodeType === 1 && /^wrap/.test(c.localName));
      const pos = (p) => p ? { rel: attr(p, "relativeFrom"), off: kid(p, "wp", "posOffset") ? num(kid(p, "wp", "posOffset").textContent, 0) / EMU_PX : null, align: kid(p, "wp", "align") ? kid(p, "wp", "align").textContent : null } : null;
      let inCell = false; for (let n = an.parentNode; n; n = n.parentNode) if (n.localName === "tc" && n.namespaceURI === NS.w) { inCell = true; break; }
      const info = { h: pos(ph), v: pos(pv), wrap: wrapEl ? wrapEl.localName : "wrapNone", side: wrapEl ? attr(wrapEl, "wrapText") : null,
        behind: attr(an, "behindDoc") === "1", w: Math.round(num(attr(ext, "cx"), 0) / EMU_PX), hgt: Math.round(num(attr(ext, "cy"), 0) / EMU_PX),
        inCell: inCell && attr(an, "layoutInCell") !== "0", marginL: Math.round(num(wattr(mar, "left"), 1440) / 15), textW: Math.round(textW / EMU_PX) };
      return info;
    }
  }

  /* ---------------- after mammoth: place floating pictures ---------------- */
  // wrapNone (in front of / behind the text): absolutely placed over the paragraph, like Word —
  // a zero-height positioned box at the start of the paragraph carries it; wrapped ones float.
  function finishHtml(html, shapes) {
    const anchoredShapes = (shapes || []).some((x) => x.anchor);
    if (html.indexOf(ANCHOR_TAG) < 0 && !anchoredShapes) return html;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    // a floating shape (a checkbox square beside text, one box of a flowchart) → an SVG picture that
    // is placed like a floating picture; inline shapes stay markers for finishMd
    if (anchoredShapes) {
      const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT), hits = [];
      while (walker.nextNode()) if (/DOCXMDSHAPE\d+X/.test(walker.currentNode.data)) hits.push(walker.currentNode);
      hits.forEach((tn) => {
        const frag = document.createDocumentFragment();
        tn.data.split(/(DOCXMDSHAPE\d+X)/).forEach((part) => {
          const m = /^DOCXMDSHAPE(\d+)X$/.exec(part), sh = m && shapes[+m[1]];
          if (sh && sh.anchor) {
            const img = document.createElement("img");
            img.setAttribute("src", "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(sh.svg))));
            img.setAttribute("alt", ANCHOR_TAG + JSON.stringify(sh.anchor) + "|");
            frag.appendChild(img);
          } else if (part) frag.appendChild(document.createTextNode(part));
        });
        tn.replaceWith(frag);
      });
    }
    tpl.content.querySelectorAll('img[alt^="' + ANCHOR_TAG + '"]').forEach((img) => {
      const alt = img.getAttribute("alt"), bar = alt.indexOf("|", ANCHOR_TAG.length);
      let info = null; try { info = JSON.parse(alt.slice(ANCHOR_TAG.length, bar < 0 ? alt.length : bar)); } catch (e) {}
      img.setAttribute("alt", bar < 0 ? "" : alt.slice(bar + 1));
      if (!info) return;
      if (info.w) img.setAttribute("width", info.w);
      const h = info.h || {}, v = info.v || {};
      let left = h.off != null ? h.off : 0;
      if (!info.inCell && h.rel === "page") left -= info.marginL || 0;
      if (h.rel === "character") left = 0;
      if (/^(wrapNone)$/.test(info.wrap) || info.wrap === "wrapThrough" && info.behind) {
        const top = v.off != null && /^(paragraph|line)$/.test(v.rel || "paragraph") ? v.off : 0;
        const box = document.createElement("span");
        box.setAttribute("data-docxmd-float", "1");
        // a left-aligned paragraph with a first-line indent (a form line with its check box in the indent):
        // a block box would become the paragraph's first line and the text would lose the indent — a
        // zero-size inline box at the start of the text instead, its offset counted back by the indent
        const host = img.closest("p");
        const im = host && !/docxmd-align-(center|right)/.test(host.className || "") ? /\bdocxmd-ind-l(\d+)f(m?)(\d+)\b/.exec(host.className || "") : null;
        const firstIndent = im ? +im[1] + (im[2] ? -1 : 1) * +im[3] : 0;
        if (im && firstIndent && info.inCell) { box.setAttribute("style", "position:relative;display:inline-block;width:0;height:0;vertical-align:top"); left -= firstIndent; }
        else box.setAttribute("style", "position:relative;display:block;height:0;width:100%");
        // in a table cell the px offset stays (Word-wide tables scroll on phones); in the body it is a share
        // of the text column, kept inside the screen, so a signature at the right margin stays on a phone
        const pct = Math.max(0, Math.round(left / (info.textW || 640) * 1000) / 10);
        const hor = h.align === "center" ? "left:50%;transform:translateX(-50%)" : h.align === "right" ? "right:0"
          : info.inCell ? "left:" + Math.round(left) + "px" : "left:min(" + pct + "%, calc(100% - " + (info.w || 0) + "px))";
        img.setAttribute("style", "position:absolute;" + hor + ";top:" + Math.round(top) + "px;max-width:" + (info.inCell ? "none" : "100%") + ";pointer-events:none;z-index:" + (info.behind ? 0 : 2));
        const p = img.closest("p, td, th, li") || img.parentNode;
        box.appendChild(img);
        p.insertBefore(box, p.firstChild);
        if (p.nodeName === "P" && !p.textContent.trim() && !p.querySelector("img:not([style*='absolute'])")) p.setAttribute("data-docxmd-anchor-host", "1");
      } else if (/^(wrapSquare|wrapTight|wrapThrough)$/.test(info.wrap)) {
        const right = h.align === "right" || (h.align !== "left" && left + info.w / 2 > (info.textW || 600) / 2);
        img.setAttribute("style", "float:" + (right ? "right" : "left") + ";margin:" + (right ? "0 0 .4em .8em" : "0 .8em .4em 0"));
      } else if (info.wrap === "wrapTopAndBottom") {
        img.setAttribute("style", "display:block;margin:.4em 0 .4em " + Math.max(0, Math.round(left)) + "px");
      }
    });
    return tpl.innerHTML;
  }
  // markers → the SVG pictures (embedded; the app folds them into #embedded-image-N tokens)
  function finishMd(md, shapes) {
    if (!shapes || !shapes.length) return md;
    return md.replace(/DOCXMDSHAPE(\d+)X/g, (m, i) => {
      const s = shapes[+i]; if (!s) return "";
      const b64 = btoa(unescape(encodeURIComponent(s.svg)));
      return "\n\n![](data:image/svg+xml;base64," + b64 + "){width=" + s.pct + "%}\n\n";
    }).replace(/\n{3,}/g, "\n\n");
  }

  /* ---------------- EMF / WMF pictures (Visio drawings, plans, old clip art) ---------------- */
  // Browsers cannot show Windows metafiles: EMF is drawn by js/emfsvg.js, WMF by WMFJS (rtf.js, MIT;
  // js/vendor/emfjs/, loaded only when a document has a WMF) — in the browser, nothing leaves the device.
  const VENDOR = (function () {
    try { const sc = document.currentScript && document.currentScript.src; if (sc) return sc.replace(/[^/]*$/, "") + "vendor/emfjs/"; } catch (e) {}
    return "js/vendor/emfjs/";
  })();
  const libs = {};
  function loadLib(name) {
    if (global[name]) return Promise.resolve(global[name]);
    if (libs[name]) return libs[name];
    libs[name] = new Promise((res, rej) => {
      const sc = document.createElement("script");
      sc.src = VENDOR + name + ".bundle.min.js";
      sc.onload = () => (global[name] ? res(global[name]) : rej(new Error(name)));
      sc.onerror = () => { libs[name] = null; rej(new Error(name + " not loaded")); };
      document.head.appendChild(sc);
    });
    return libs[name];
  }
  // metafile bytes → SVG text | null
  async function metafileSvg(u8, contentType) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ab = u8.slice().buffer;
    const ser = (el) => new XMLSerializer().serializeToString(el);
    if (/emf/i.test(contentType) || (u8.length > 44 && dv.getUint32(0, true) === 1 && dv.getUint32(40, true) === 0x464D4520)) {
      // js/emfsvg.js: our own GDI → SVG (text, transforms, bitmaps …); a picture it cannot draw → its bitmap
      if (global.DOCXMDEmf) { try { const svg = await global.DOCXMDEmf.toSvg(u8); if (svg) return svg; } catch (e) { console.warn("DOCXMDEmf", e); } }
      const png = await emfBitmap(u8);
      return png ? { png } : null;
    }
    if (/wmf/i.test(contentType) || (u8.length > 22 && dv.getUint32(0, true) === 0x9AC6CDD7)) {
      const Wm = await loadLib("WMFJS"); if (Wm.loggingEnabled) Wm.loggingEnabled(false);
      let w = 400, h = 300;
      if (dv.getUint32(0, true) === 0x9AC6CDD7) {           // placeable header: bounding box + units per inch
        const l = dv.getInt16(6, true), t = dv.getInt16(8, true), r = dv.getInt16(10, true), b = dv.getInt16(12, true), inch = dv.getUint16(14, true) || 1440;
        w = Math.max(1, r - l); h = Math.max(1, b - t);
        const svg = new Wm.Renderer(ab).render({ width: Math.round(w / inch * 96) + "px", height: Math.round(h / inch * 96) + "px", xExt: w, yExt: h, mapMode: 8 });
        return ser(svg);
      }
      return ser(new Wm.Renderer(ab).render({ width: w + "px", height: h + "px", xExt: w, yExt: h, mapMode: 8 }));
    }
    return null;
  }
  // the largest bitmap of an EMF (EMR_STRETCHDIBITS 81, SETDIBITSTODEVICE 80, BITBLT 76, STRETCHBLT 77)
  // → PNG data URI: the DIB gets a BMP file header, the browser decodes it, a canvas re-encodes it
  async function emfBitmap(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const OFF = { 81: 48, 80: 48, 76: 84, 77: 84 };
    let best = null;
    for (let i = 0; i + 8 <= u8.length;) {
      const type = dv.getUint32(i, true), size = dv.getUint32(i + 4, true);
      if (size < 8 || i + size > u8.length) break;
      if (OFF[type] && size > OFF[type] + 16) {
        const o = i + OFF[type], offBmi = dv.getUint32(o, true), cbBmi = dv.getUint32(o + 4, true), offBits = dv.getUint32(o + 8, true), cbBits = dv.getUint32(o + 12, true);
        if (cbBmi >= 40 && cbBits > 0 && offBmi + cbBmi <= size && offBits + cbBits <= size && (!best || cbBits > best.cbBits)) best = { start: i, offBmi, cbBmi, offBits, cbBits };
      }
      i += size;
    }
    if (!best || typeof createImageBitmap === "undefined") return null;
    const bmp = new Uint8Array(14 + best.cbBmi + best.cbBits), bv = new DataView(bmp.buffer);
    bmp[0] = 0x42; bmp[1] = 0x4D;                                         // "BM"
    bv.setUint32(2, bmp.length, true); bv.setUint32(10, 14 + best.cbBmi, true);
    bmp.set(u8.subarray(best.start + best.offBmi, best.start + best.offBmi + best.cbBmi), 14);
    bmp.set(u8.subarray(best.start + best.offBits, best.start + best.offBits + best.cbBits), 14 + best.cbBmi);
    try {
      const bm = await createImageBitmap(new Blob([bmp], { type: "image/bmp" }));
      const cv = document.createElement("canvas"); cv.width = bm.width; cv.height = bm.height;
      cv.getContext("2d").drawImage(bm, 0, 0);
      return cv.toDataURL("image/png");
    } catch (e) { return null; }
  }
  // mammoth's convertImage: metafiles become SVG pictures, other pictures stay as they are
  function mammothImages(M) {
    return M.images.imgElement(async (image) => {
      const ct = image.contentType || "";
      if (/x-emf|x-wmf|emf|wmf/i.test(ct)) {
        try {
          const raw = await image.read();
          const svg = await metafileSvg(new Uint8Array(raw.buffer ? raw.buffer.slice(raw.byteOffset || 0, (raw.byteOffset || 0) + raw.byteLength) : raw), ct);
          if (svg && svg.png) return { src: svg.png };
          if (svg) return { src: "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))) };
        } catch (e) { console.warn("DOCXMDDraw metafile", e); }
      }
      return { src: "data:" + ct + ";base64," + (await image.read("base64")) };
    });
  }

  global.DOCXMDDraw = { prepare, finishHtml, finishMd, renderDrawing, themeColors, metafileSvg, mammothImages };
})(typeof window !== "undefined" ? window : this);
