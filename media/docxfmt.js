/* DOCXMD — table formatting for .docx import.
   mammoth drops cell shading, text colour and alignment, so we read them straight
   from word/document.xml and put them back onto mammoth's HTML tables as inline
   styles. Tables that carry such formatting are then kept as HTML in the Markdown
   (a pipe table can't hold colours); md2docx turns them back into Word tables.
   Font sizes, paragraph alignment and table column widths are carried over as well
   (mammoth drops them): run sizes → <span style="font-size:…pt">, the document's main
   size → front matter `font-size:`, centred / right-aligned paragraphs → <div align>,
   Word's column grid → <colgroup> on an HTML table.
   Exposes: window.DOCXFMT.toMarkdown(arrayBuffer, fileBase) -> Promise<markdown>
            window.DOCXFMT.extract(arrayBuffer) -> Promise<fmt|null>
            window.DOCXFMT.apply(html, fmt) -> html
            window.DOCXFMT.tableRule(turndownService) */
(function (global) {
  "use strict";
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

  // ---- minimal zip reader (central directory + DecompressionStream) --------
  async function readZipEntry(ab, name) {
    const dv = new DataView(ab), u8 = new Uint8Array(ab);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder("utf-8");
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return null;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const fname = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (fname !== name) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const data = u8.subarray(start, start + csize);
      if (method === 0) return dec.decode(data);
      if (method !== 8 || typeof DecompressionStream === "undefined") return null;
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return dec.decode(await new Response(stream).arrayBuffer());
    }
    return null;
  }

  // ---- OOXML helpers -------------------------------------------------------
  const kids = (el, local) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.namespaceURI === W && n.localName === local);
  const kid = (el, local) => (el ? kids(el, local)[0] || null : null);
  const wval = (el, attr) => (el ? el.getAttributeNS(W, attr || "val") || el.getAttribute("w:" + (attr || "val")) : null);
  const hex = (v) => (v && /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : null);

  function isDark(h) {
    const n = parseInt(h.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 140;
  }

  // Elements of `el` excluding anything inside a nested table
  function ownDescendants(el, local) {
    const out = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === W && c.localName === "tbl") continue;
        if (c.namespaceURI === W && c.localName === local) out.push(c);
        walk(c);
      }
    })(el);
    return out;
  }

  const DEFAULT_HEAD_FILL = "#F0F0F0";
  const DEFAULT_ZEBRA_FILL = "#F7F7F7"; // DOCXMD's zebra rows in plain tables
  // quote-bar colours that mean "a plain > quote": the old grey + the theme accents
  const PLAIN_BARS = ["#BBBBBB", "#007BFF", "#64FFDA", "#28A745", "#0984E3"];
  const JC = { center: "center", right: "right", end: "right", both: "justify", distribute: "justify", left: "left", start: "left" };
  const VA = { center: "middle", bottom: "bottom" };

  function cellFmt(tc, tblFill) {
    const tcPr = kid(tc, "tcPr");
    const f = {};
    const fill = hex(wval(kid(tcPr, "shd"), "fill")) || tblFill;
    if (fill) f.fill = fill;
    const va = VA[wval(kid(tcPr, "vAlign"))];
    if (va) f.valign = va;
    // horizontal alignment: first paragraph that has text (a cell with only a
    // picture: the picture's paragraph)
    const paras = ownDescendants(tc, "p");
    const lead = paras.find((p) => ownDescendants(p, "t").some((t) => t.textContent.trim())) ||
      paras.find((p) => p.getElementsByTagNameNS(NS_WP, "inline").length || p.getElementsByTagNameNS(NS_WP, "anchor").length || p.getElementsByTagNameNS(NS_V, "imagedata").length);
    if (lead) {
      const jc = JC[wval(kid(kid(lead, "pPr"), "jc"))];
      if (jc && jc !== "left") f.align = jc;
    }
    // text colour: only when every text run agrees
    const colors = new Set();
    for (const r of ownDescendants(tc, "r")) {
      if (!ownDescendants(r, "t").some((t) => t.textContent.trim())) continue;
      if (r.parentNode.localName === "hyperlink") continue; // link blue belongs to the link
      const c = wval(kid(kid(r, "rPr"), "color"));
      colors.add(c && c !== "auto" ? c.toUpperCase() : "auto");
    }
    if (colors.size === 1) { const c = hex([...colors][0]); if (c && c !== "#000000") f.color = c; }
    // Word draws "auto" text white on dark fills; keep it readable in every theme
    if (f.fill && !f.color) { f.color = isDark(f.fill) ? "#FFFFFF" : "#000000"; f.autoColor = true; }
    const span = parseInt(wval(kid(tcPr, "gridSpan")) || "1", 10);
    if (span > 1) f.colspan = span;
    return f;
  }

  function borderOn(b) { const v = wval(b); return !!b && v && v !== "none" && v !== "nil"; }

  // Our own DOCX export writes a blockquote as a 1×1 table with only a left bar
  function isQuoteTable(tbl) {
    const trs = kids(tbl, "tr");
    if (trs.length !== 1 || kids(trs[0], "tc").length !== 1) return false;
    const bd = kid(kid(tbl, "tblPr"), "tblBorders");
    if (!bd) return false;
    return borderOn(kid(bd, "left")) && !borderOn(kid(bd, "top")) && !borderOn(kid(bd, "right")) && !borderOn(kid(bd, "bottom"));
  }

  // Word's column grid as % of the table: [46.4, 53.6]
  function gridCols(tbl) {
    const w = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => +wval(g, "w") || 0);
    const sum = w.reduce((a, b) => a + b, 0);
    if (w.length < 2 || !sum || w.some((x) => !x)) return null;
    return w.map((x) => Math.round(x / sum * 1000) / 10);
  }
  // text column of the (last) section in twips
  function textWidth(doc) {
    const ss = doc.getElementsByTagNameNS(W, "sectPr"), sp = ss[ss.length - 1];
    const pg = kid(sp, "pgSz"), mar = kid(sp, "pgMar");
    const w = +wval(pg, "w") || 11906;
    return Math.max(1440, w - (+wval(mar, "left") || 1440) - (+wval(mar, "right") || 1440));
  }
  // table width as % of the text column (null: auto / full width)
  function tableWidth(tbl, textW) {
    const tw = kid(kid(tbl, "tblPr"), "tblW"), type = wval(tw, "type"), v = +wval(tw, "w") || 0;
    let pct = null;
    if (type === "pct" && v) pct = /%$/.test(wval(tw, "w")) ? parseFloat(wval(tw, "w")) : v / 50;
    else if (type === "dxa" && v) pct = v / textW * 100;
    else {
      const grid = kids(kid(tbl, "tblGrid"), "gridCol").reduce((a, g) => a + (+wval(g, "w") || 0), 0);
      if (grid) pct = grid / textW * 100;
    }
    return pct == null ? null : Math.max(10, Math.min(100, Math.round(pct)));
  }

  async function extract(ab) {
    try {
      const xml = await readZipEntry(ab, "word/document.xml");
      if (!xml || typeof DOMParser === "undefined") return null;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const tables = [];
      const textW = textWidth(doc);
      for (const tbl of Array.from(doc.getElementsByTagNameNS(W, "tbl"))) {
        if (isQuoteTable(tbl)) {
          const c = hex(wval(kid(kid(kid(tbl, "tblPr"), "tblBorders"), "left"), "color"));
          const tc = kid(kid(tbl, "tr"), "tc");
          const fill = hex(wval(kid(kid(tc, "tcPr"), "shd"), "fill"));
          // a filled quote whose bar is a callout colour → :::callout
          const M = global.MD2DOCX;
          const kind = fill && c && M && M.calloutByColor ? M.calloutByColor(c) : null;
          tables.push({ quote: true, callout: kind, color: kind ? null : (c && !PLAIN_BARS.includes(c) ? c : null) });
          continue;
        }
        const tblFill = hex(wval(kid(kid(tbl, "tblPr"), "shd"), "fill"));
        const rows = kids(tbl, "tr").map((tr, ri) => kids(tr, "tc")
          // vMerge continuation cells don't exist in mammoth's HTML (rowspan instead)
          .filter((tc) => { const vm = kid(kid(tc, "tcPr"), "vMerge"); return !vm || wval(vm) === "restart"; })
          .map((tc) => {
            const f = cellFmt(tc, tblFill);
            // the light-grey header fill is DOCXMD's own default for plain tables
            if ((ri === 0 && f.fill === DEFAULT_HEAD_FILL) || (ri > 0 && f.fill === DEFAULT_ZEBRA_FILL)) { delete f.fill; if (f.autoColor) delete f.color; }
            delete f.autoColor;
            return f;
          }));
        tables.push({ rows, cols: gridCols(tbl), width: tableWidth(tbl, textW) });
      }
      return { tables, images: extractImages(doc) };
    } catch (e) {
      console.warn("DOCXFMT.extract", e);
      return null;
    }
  }

  // ---- image sizes -----------------------------------------------------------
  // mammoth drops the size a picture has in Word. Collect the displayed width of
  // every picture in document order (what mammoth turns into <img>): DrawingML
  // <pic:pic> and legacy VML <v:imagedata>. mc:Choice is skipped because mammoth
  // reads the mc:Fallback branch of AlternateContent.
  const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
  const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
  const NS_V = "urn:schemas-microsoft-com:vml";
  const NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006";
  const EMU_PX = 9525, COL_PX = 600; // = MAX_IMG_W in md2docx.js
  function extractImages(doc) {
    const body = doc.getElementsByTagNameNS(W, "body")[0];
    if (!body) return [];
    // % is relative to DOCXMD's own text column (what the DOCX export uses), so an
    // imported picture is exported again at the size it had in Word
    const colEmu = COL_PX * EMU_PX;
    const out = [];
    (function walk(n, inTable) {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.namespaceURI === NS_MC && c.localName === "Choice") continue;
        if (c.namespaceURI === NS_PIC && c.localName === "pic") {
          const ext = c.getElementsByTagNameNS(NS_A, "ext")[0];
          let cx = ext ? +ext.getAttribute("cx") : 0;
          if (!cx) { let p = c.parentNode; while (p && !(p.namespaceURI === NS_WP && (p.localName === "inline" || p.localName === "anchor"))) p = p.parentNode; const e = p && p.getElementsByTagNameNS(NS_WP, "extent")[0]; cx = e ? +e.getAttribute("cx") : 0; }
          out.push({ emu: cx, colEmu, inTable, align: paraAlign(c) });
          continue;
        }
        if (c.namespaceURI === NS_V && c.localName === "imagedata") {
          let sh = c.parentNode; const m = /(?:^|;)\s*width\s*:\s*([\d.]+)(pt|in|cm|mm|px)?/i.exec(sh && sh.getAttribute ? sh.getAttribute("style") || "" : "");
          const k = { pt: 12700, in: 914400, cm: 360000, mm: 36000, px: EMU_PX }[(m && m[2] || "pt").toLowerCase()];
          out.push({ emu: m ? +m[1] * k : 0, colEmu, inTable, align: paraAlign(c) });
          continue;
        }
        walk(c, inTable || (c.namespaceURI === W && c.localName === "tbl"));
      }
    })(body, false);
    return out;
  }
  function paraAlign(n) {
    while (n && !(n.namespaceURI === W && n.localName === "p")) n = n.parentNode;
    const jc = n && JC[wval(kid(kid(n, "pPr"), "jc"))];
    return jc === "center" || jc === "right" ? jc : null;
  }
  // width="NN%" (share of the text column) on body images, width="NNN" (px) in
  // tables, where a percentage would be relative to the cell instead
  function imageWidth(im) {
    if (!im || !im.emu) return "";
    if (im.inTable) return String(Math.max(1, Math.round(im.emu / EMU_PX)));
    return Math.max(1, Math.min(100, Math.round(im.emu / im.colEmu * 100))) + "%";
  }
  function applyImages(html, fmt) {
    if (!fmt || !fmt.images || !fmt.images.length || typeof document === "undefined") return html;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const imgs = Array.from(tpl.content.querySelectorAll("img"));
    // footnote/endnote pictures come after the body ones; fewer <img> → can't pair
    if (imgs.length < fmt.images.length) return html;
    fmt.images.forEach((im, i) => {
      const w = imageWidth(im); if (w && w !== "100%") imgs[i].setAttribute("width", w);
      // a styled paragraph (no alignment class from the transform) still keeps its centring
      const p = imgs[i].closest("p");
      if (im.align && p && !/\bdocxmd-align-/.test(p.className)) p.classList.add("docxmd-align-" + im.align);
    });
    return tpl.innerHTML;
  }

  // ---- apply onto mammoth HTML -------------------------------------------
  function styleOf(f) {
    const s = [];
    if (f.fill) s.push("background-color:" + f.fill);
    if (f.color) s.push("color:" + f.color);
    if (f.align) s.push("text-align:" + f.align);
    if (f.valign) s.push("vertical-align:" + f.valign);
    return s.join(";");
  }

  function apply(html, fmt) { return structure(applyTables(applyImages(html, fmt), fmt)); }
  function applyTables(html, fmt) {
    if (!fmt || !fmt.tables || !fmt.tables.length) return html;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const tables = Array.from(tpl.content.querySelectorAll("table"));
    if (tables.length !== fmt.tables.length) return html; // can't pair them up safely
    tables.forEach((table, ti) => {
      const tf = fmt.tables[ti];
      if (tf.quote) {
        table.setAttribute("data-docxmd-quote", tf.callout ? "callout:" + tf.callout : (tf.color || "1"));
        return;
      }
      const rows = Array.from(table.rows);
      let rich = !isHeadingRow(rows[0]);
      const colAlign = [];
      rows.forEach((tr, ri) => {
        const cf = tf.rows[ri] || [];
        Array.from(tr.cells).forEach((cell, ci) => {
          const f = cf[ci] || {};
          const st = styleOf(f);
          if (st) cell.setAttribute("style", st);
          if (f.fill || f.color || f.valign || cell.colSpan > 1 || cell.rowSpan > 1) rich = true;
          const a = f.align || "left";
          if (colAlign[ci] === undefined) colAlign[ci] = a;
          else if (colAlign[ci] !== a) rich = true;
        });
      });
      // unequal Word columns: only an HTML table can keep their widths
      if (tf.cols && Math.max(...tf.cols) - Math.min(...tf.cols) > 100 / tf.cols.length * 0.3) rich = true;
      if (rich && tf.cols) table.setAttribute("data-docxmd-cols", tf.cols.join(","));
      if (rich && tf.width) table.setAttribute("data-docxmd-width", String(tf.width));
      if (rich) table.setAttribute("data-docxmd-html", "1");
      else if (rows[0]) Array.from(rows[0].cells).forEach((c, ci) => {
        // plain table with per-column alignment → GFM pipe table with :--: markers
        if (colAlign[ci] && colAlign[ci] !== "left" && colAlign[ci] !== "justify") c.setAttribute("align", colAlign[ci]);
        c.removeAttribute("style");
      });
      if (!rich) rows.forEach((tr) => Array.from(tr.cells).forEach((c) => c.removeAttribute("style")));
    });
    return tpl.innerHTML;
  }

  function isHeadingRow(tr) {
    if (!tr) return false;
    const p = tr.parentNode;
    return p.nodeName === "THEAD" || Array.from(tr.childNodes).every((n) => n.nodeName === "TH");
  }

  // Pretty, blank-line-free HTML so the whole table stays one Markdown HTML block
  function tableHtml(table) {
    const cols = (table.getAttribute("data-docxmd-cols") || "").split(",").filter(Boolean);
    const tw = table.getAttribute("data-docxmd-width");
    // Word's column widths: a fixed layout, so pictures shrink to their column
    const st = cols.length ? ["width:" + (tw || 100) + "%", "table-layout:fixed"] : [];
    if (getCss(table, "font-size")) st.push("font-size:" + getCss(table, "font-size"));
    const out = [st.length ? '<table style="' + st.join(";") + '">' : "<table>"];
    if (cols.length) out.push("<colgroup>" + cols.map((c) => '<col style="width:' + c + '%">').join("") + "</colgroup>");
    const attrs = (el) => ["colspan", "rowspan", "style"].filter((a) => el.hasAttribute(a))
      .map((a) => " " + a + '="' + el.getAttribute(a).replace(/"/g, "&quot;") + '"').join("");
    const cellHtml = (c) => {
      const x = c.cloneNode(true);
      // drop our internal markers and Word's empty bookmark anchors
      x.querySelectorAll("[data-docxmd-html],[data-docxmd-quote]").forEach((e) => { e.removeAttribute("data-docxmd-html"); e.removeAttribute("data-docxmd-quote"); });
      // headings / bookmarks that internal links point at keep an id="sec:…" anchor
      x.querySelectorAll("[data-docxmd-sec]").forEach((e) => { e.id = "sec:" + e.getAttribute("data-docxmd-sec"); e.removeAttribute("data-docxmd-sec"); });
      x.querySelectorAll('a[id^="sec_"]:not([href])').forEach((a) => { const p = a.parentElement; if (p && p !== x && !p.id) p.id = "sec:" + unBookmark(a.id, "sec"); });
      x.querySelectorAll("a[id]:not([href])").forEach((a) => { if (!a.textContent && !a.children.length) a.remove(); });
      return x.innerHTML.replace(/\s*\n\s*/g, " ").trim();
    };
    const sections = Array.from(table.children).filter((n) => /^(THEAD|TBODY|TFOOT)$/.test(n.nodeName));
    const groups = sections.length ? sections.map((s) => [s.nodeName.toLowerCase(), Array.from(s.rows)]) : [[null, Array.from(table.rows)]];
    for (const [tag, rows] of groups) {
      if (tag) out.push("<" + tag + ">");
      for (const tr of rows) {
        out.push("<tr>");
        for (const c of tr.cells) {
          const t = c.nodeName.toLowerCase();
          out.push("<" + t + attrs(c) + ">" + cellHtml(c) + "</" + t + ">");
        }
        out.push("</tr>");
      }
      if (tag) out.push("</" + tag + ">");
    }
    out.push("</table>");
    return out.join("\n");
  }


  // ---- document structure written by DOCXMD's DOCX export ---------------
  // Bookmarks/links from md2docx become Markdown again: footnotes → [^n],
  // figure/table captions → {#fig:id} / Table: … {#tbl:id}, links → @fig:id,
  // heading bookmarks → {#sec:id}, TOC → [TOC], numbered headings → directive.
  const unBookmark = (name, kind) => name.slice(kind.length + 1).replace(/__/g, "-");
  const LABEL_RE = /^\s*(?:Figure|Рисунок|Figura|图|Table|Таблиця|Tabla|表)\s*\d+\s*$/;
  function stripLabel(p) {
    // "<strong>Рисунок 1</strong> — caption" → "caption"
    const first = p.firstElementChild;
    if (first && /^(STRONG|B)$/.test(first.nodeName) && LABEL_RE.test(first.textContent) && (!first.previousSibling || !first.previousSibling.textContent.trim())) {
      first.remove();
      const t = p.firstChild;
      if (t && t.nodeType === 3) t.nodeValue = t.nodeValue.replace(/^\s*[—–-]\s*/, "");
    }
  }
  function structure(html) {
    if (typeof document === "undefined") return html;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const root = tpl.content;
    const marker = (attr, text) => { const m = document.createElement("p"); m.setAttribute(attr, "1"); m.textContent = text; return m; };
    // numbered headings
    const num = root.querySelector('a[id="docxmd_numbered"]');
    if (num) {
      num.remove();
      root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
        const w = document.createTreeWalker(h, 4); const t = w.nextNode();
        if (t) t.nodeValue = t.nodeValue.replace(/^\s*\d+(?:\.\d+)*\s+/, "");
      });
      root.insertBefore(marker("data-docxmd-numbered", "numbered"), root.firstChild);
    }
    // table of contents (+ entries of a TOC field Word has already updated)
    root.querySelectorAll('a[id="docxmd_toc"]').forEach((a) => {
      const p = a.closest("p") || a.parentElement;
      const m = marker("data-docxmd-toc", "TOC");
      p.replaceWith(m);
      let n = m.nextElementSibling;
      while (n && n.nodeName === "P") {
        const links = Array.from(n.querySelectorAll("a[href]"));
        if (!links.length || links.some((x) => !/^#_Toc/.test(x.getAttribute("href")))) break;
        const next = n.nextElementSibling; n.remove(); n = next;
      }
    });
    // section anchors in headings
    root.querySelectorAll('h1 a[id^="sec_"],h2 a[id^="sec_"],h3 a[id^="sec_"],h4 a[id^="sec_"],h5 a[id^="sec_"],h6 a[id^="sec_"]').forEach((a) => {
      const h = a.closest("h1,h2,h3,h4,h5,h6");
      h.setAttribute("data-docxmd-sec", unBookmark(a.id, "sec")); a.remove();
    });
    // Word's own TOC and cross-references: links to a bookmark inside a heading
    // (#_Toc241144139) → the heading gets {#sec:toc241144139} and the link points at
    // it; a TOC entry "7.\tTitle\t22" loses the tab and the page number
    const bm = {};
    root.querySelectorAll("a[id]").forEach((x) => { bm[x.id] = x; });
    root.querySelectorAll('a[href^="#"]').forEach((a) => {
      const id = a.getAttribute("href").slice(1);
      if (!id || /^(fig|tbl|sec)_|^docxmd_|^(footnote|endnote)-/.test(id)) return;
      const h = bm[id] && bm[id].closest("h1,h2,h3,h4,h5,h6");
      if (!h) return;
      let sec = h.getAttribute("data-docxmd-sec");
      if (!sec) {
        sec = id.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "h";
        h.setAttribute("data-docxmd-sec", sec);
      }
      a.setAttribute("href", "#sec:" + sec);
      const w = document.createTreeWalker(a, 4), texts = [];
      for (let n = w.nextNode(); n; n = w.nextNode()) texts.push(n);
      if (texts.length) texts[texts.length - 1].nodeValue = texts[texts.length - 1].nodeValue.replace(/\s*\t\s*\d+\s*$/, "");
      texts.forEach((t) => { t.nodeValue = t.nodeValue.replace(/\t+/g, " "); });
    });
    // figure captions: the image paragraph just before the caption
    root.querySelectorAll('a[id^="fig_"]').forEach((a) => {
      const cap = a.closest("p"); if (!cap) return;
      const id = unBookmark(a.id, "fig"); a.remove(); stripLabel(cap);
      const prev = cap.previousElementSibling;
      const img = prev && prev.nodeName === "P" && prev.querySelectorAll("img").length === 1 && !prev.textContent.trim() ? prev.querySelector("img") : null;
      if (!img) return;
      const f = document.createElement("p");
      f.setAttribute("data-docxmd-fig", id); f.setAttribute("data-src", img.getAttribute("src") || "");
      if (img.hasAttribute("width")) f.setAttribute("data-width", img.getAttribute("width"));
      f.innerHTML = cap.innerHTML || "&#8203;";
      prev.remove(); cap.replaceWith(f);
    });
    // table captions
    root.querySelectorAll('a[id^="tbl_"]').forEach((a) => {
      const cap = a.closest("p"); if (!cap) return;
      const id = unBookmark(a.id, "tbl"); a.remove(); stripLabel(cap);
      cap.setAttribute("data-docxmd-tblcap", id);
      if (!cap.textContent.trim()) cap.innerHTML = "&#8203;";
    });
    // footnotes / endnotes: drop back-links and the duplicates mammoth adds for repeated references
    root.querySelectorAll('a[href^="#footnote-ref-"],a[href^="#endnote-ref-"]').forEach((a) => a.remove());
    root.querySelectorAll("ol").forEach((ol) => {
      const lis = Array.from(ol.children);
      if (!lis.length || !lis.every((li) => /^(footnote|endnote)-\d+$/.test(li.id))) return;
      const seen = {};
      lis.forEach((li) => { if (seen[li.id]) li.remove(); else seen[li.id] = 1; });
      ol.setAttribute("data-docxmd-fn", "1");
    });
    return tpl.innerHTML;
  }
  const bare = (x) => String(x || "").replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const sameText = (a, b) => bare(a) === bare(b);
  const mdWidth = (w) => (/%$/.test(w) ? w : w + "px");
  const noteId = (href) => { const m = /#(footnote|endnote)-(\d+)$/.exec(href || ""); return m ? (m[1] === "endnote" ? "e" : "") + m[2] : null; };
  function structureRules(td) {
    // Word highlight (mammoth styleMap → <mark class="hl-…">) → ==text== / ==red:text==
    td.addRule("docxmdMark", {
      filter: (n) => n.nodeName === "MARK",
      replacement: (content, n) => {
        if (!content.trim()) return content;
        const c = (/\bhl-([a-z]+)/.exec(n.getAttribute("class") || "") || [])[1] || "yellow";
        const lead = content.match(/^\s*/)[0], trail = content.match(/\s*$/)[0];
        return lead + "==" + (c !== "yellow" ? c + ":" : "") + content.trim() + "==" + trail;
      }
    });
    td.addRule("docxmdNumbered", { filter: (n) => n.nodeName === "P" && n.hasAttribute("data-docxmd-numbered"), replacement: () => "\n\n<!-- docxmd: numbered-headings -->\n\n" });
    td.addRule("docxmdToc", { filter: (n) => n.nodeName === "P" && n.hasAttribute("data-docxmd-toc"), replacement: () => "\n\n[TOC]\n\n" });
    td.addRule("docxmdSecHeading", {
      filter: (n) => /^H[1-6]$/.test(n.nodeName) && n.hasAttribute("data-docxmd-sec"),
      replacement: (content, n) => "\n\n" + "#".repeat(+n.nodeName[1]) + " " + content.trim() + " {#sec:" + n.getAttribute("data-docxmd-sec") + "}\n\n"
    });
    td.addRule("docxmdFigure", {
      filter: (n) => n.nodeName === "P" && n.hasAttribute("data-docxmd-fig"),
      replacement: (content, n) => "\n\n![" + content.replace(/​/g, "").trim() + "](" + n.getAttribute("data-src") + "){#fig:" + n.getAttribute("data-docxmd-fig") +
        (n.hasAttribute("data-width") ? " width=" + mdWidth(n.getAttribute("data-width")) : "") + "}\n\n"
    });
    // <img width="…"> → ![alt](src){width=…}
    td.addRule("docxmdSizedImage", {
      filter: (n) => n.nodeName === "IMG" && /^[\d.]+%?$/.test(n.getAttribute("width") || ""),
      replacement: (content, n) => {
        const alt = (n.getAttribute("alt") || "").replace(/([\\\[\]])/g, "\\$1").replace(/\s*\n\s*/g, " ");
        const title = n.getAttribute("title");
        return "![" + alt + "](" + (n.getAttribute("src") || "") + (title ? ' "' + title.replace(/"/g, '\\"') + '"' : "") + "){width=" + mdWidth(n.getAttribute("width")) + "}";
      }
    });
    td.addRule("docxmdTableCaption", {
      filter: (n) => n.nodeName === "P" && n.hasAttribute("data-docxmd-tblcap"),
      replacement: (content, n) => "\n\nTable: " + content.replace(/​/g, "").trim() + " {#tbl:" + n.getAttribute("data-docxmd-tblcap") + "}\n\n"
    });
    td.addRule("docxmdXref", {
      filter: (n) => n.nodeName === "A" && /^#(fig|tbl|sec)_/.test(n.getAttribute("href") || ""),
      replacement: (content, n) => {
        const h = n.getAttribute("href").slice(1), k = h.slice(0, 3), id = unBookmark(h, k);
        // a DOCXMD cross-ref shows the heading text; other text (a TOC entry) stays a link
        const head = k === "sec" && n.ownerDocument && n.ownerDocument.querySelector('[data-docxmd-sec="' + id + '"]');
        if (k === "sec" && (!head || !sameText(head.textContent, content))) return "[" + content + "](#sec:" + id + ")";
        return "@" + k + ":" + id;
      }
    });
    td.addRule("docxmdNoteRef", {
      filter: (n) => n.nodeName === "SUP" && n.children.length === 1 && n.firstElementChild.nodeName === "A" && noteId(n.firstElementChild.getAttribute("href")) != null,
      replacement: (content, n) => "[^" + noteId(n.firstElementChild.getAttribute("href")) + "]"
    });
    td.addRule("docxmdNotes", {
      filter: (n) => n.nodeName === "OL" && n.hasAttribute("data-docxmd-fn"),
      replacement: (content, n) => "\n\n" + Array.from(n.children).map((li) =>
        "[^" + noteId("#" + li.id) + "]: " + td.turndown(li.innerHTML).replace(/\s*\n+\s*/g, " ").trim()).join("\n") + "\n\n"
    });
  }

  // Turndown rules: styled tables → HTML block; exported quote tables → blockquote.
  // addRule() puts them in front of the GFM plugin's table rule.
  function tableRule(td) {
    structureRules(td);
    td.addRule("docxmdHtmlTable", {
      filter: (n) => n.nodeName === "TABLE" && n.getAttribute("data-docxmd-html") === "1",
      replacement: (content, node) => "\n\n" + tableHtml(node) + "\n\n"
    });
    td.addRule("docxmdQuoteTable", {
      filter: (n) => n.nodeName === "TABLE" && n.hasAttribute("data-docxmd-quote"),
      replacement: (content, node) => {
        const cell = node.rows[0] && node.rows[0].cells[0];
        const md = cell ? td.turndown(cell.innerHTML) : "";
        const quote = md.trim().split("\n").map((l) => (l ? "> " + l : ">")).join("\n");
        const c = node.getAttribute("data-docxmd-quote");
        if (c === "1") return "\n\n" + quote + "\n\n";
        if (c.indexOf("callout:") === 0) {
          // first bold line = "icon Title"; a default title is dropped (it is implied by the type)
          const kind = c.slice(8);
          const lines = md.trim().split("\n");
          let title = "";
          const m = /^\*\*(.+)\*\*$/.exec(lines[0] || "");
          if (m) {
            const M = global.MD2DOCX;
            const icon = M && M.CALLOUTS && M.CALLOUTS[kind] ? M.CALLOUTS[kind].icon : "";
            title = m[1].trim();
            if (icon && title.indexOf(icon) === 0) title = title.slice(icon.length);
            title = title.replace(/^[\uFE0F\u200D\s]+/, "").trim();
            lines.shift();
            while (lines.length && !lines[0].trim()) lines.shift();
            if (M && M.isDefaultCalloutTitle && M.isDefaultCalloutTitle(kind, title)) title = "";
          }
          return "\n\n:::" + kind + (title ? " " + title : "") + "\n" + lines.join("\n") + "\n:::\n\n";
        }
        // coloured bar → :::colour box (named when it matches the palette)
        const name = global.MD2DOCX && MD2DOCX.colorName ? MD2DOCX.colorName(c) : c;
        return "\n\n:::" + name + "\n" + quote + "\n:::\n\n";
      }
    });
  }

  // mammoth style map for Word text highlights (import → <mark class="hl-…">)
  function highlightStyleMap() {
    const M = global.MD2DOCX, map = (M && M.HL_FROM_WORD) || {};
    return Object.keys(map).map((w) => "highlight[color='" + w + "'] => mark.hl-" + map[w]);
  }

  // Word styles → Markdown code (Pandoc names; DOCXMD's own export writes them too)
  function codeStyleMap() {
    return ["r[style-name='Verbatim Char'] => code", "r[style-name='Source Code Char'] => code",
      "p[style-name='Source Code'] => pre:separator('\\n')"];
  }
  // Turndown rules for text that came from Word:
  //  • plain text is escaped as text — "<textarea>" or "&mdash;" written in a document stay
  //    literal characters instead of turning into HTML tags / entities in the preview;
  //  • <pre> without <code> (a "Source Code" paragraph) becomes a fenced code block.
  function markdownRules(td) {
    const baseEscape = td.escape.bind(td);
    td.escape = (str) => baseEscape(str)
      .replace(/&(?=#?[A-Za-z0-9]+;)/g, "&amp;")
      .replace(/<(?=[A-Za-z\/!?])/g, "&lt;");
    td.addRule("docxmdPlainPre", {
      filter: (node) => node.nodeName === "PRE" && !(node.firstChild && node.firstChild.nodeName === "CODE"),
      replacement: (content, node) => {
        const c = node.cloneNode(true);
        c.querySelectorAll("br").forEach((b) => b.replaceWith("\n"));
        const text = c.textContent.replace(/\n+$/, "");
        const fence = /```/.test(text) ? "~~~" : "```";
        return "\n\n" + fence + "\n" + text + "\n" + fence + "\n\n";
      }
    });
    return td;
  }


  // ---- font sizes & paragraph alignment (mammoth transforms) ------------------
  // Size of the Normal text in pt: docDefaults, then the default paragraph style
  // (Word's own fallback is 10 pt).
  function baseSize(stylesXml) {
    if (!stylesXml) return 11;
    const doc = new DOMParser().parseFromString(stylesXml, "application/xml");
    let sz = null;
    const dd = doc.getElementsByTagNameNS(W, "docDefaults")[0];
    const d = dd && dd.getElementsByTagNameNS(W, "sz")[0];
    if (d) sz = +wval(d) / 2;
    for (const st of Array.from(doc.getElementsByTagNameNS(W, "style"))) {
      if (wval(st, "type") !== "paragraph" || !/^(1|true)$/.test(wval(st, "default") || "")) continue;
      const x = kid(kid(st, "rPr"), "sz"); if (x) sz = +wval(x) / 2;
    }
    return sz || 10;
  }
  // style attribute helpers (string-based: identical in every DOM implementation)
  function getCss(el, prop) {
    const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i").exec((el && el.getAttribute && el.getAttribute("style")) || "");
    return m ? m[1].trim() : "";
  }
  function setCss(el, prop, val) {
    const rest = String(el.getAttribute("style") || "").split(";").map((x) => x.trim())
      .filter((x) => x && x.split(":")[0].trim().toLowerCase() !== prop);
    if (val) rest.push(prop + ":" + val);
    if (rest.length) el.setAttribute("style", rest.join(";")); else el.removeAttribute("style");
  }
  const sizeClass = (pt) => "docxmd-fs-" + String(pt).replace(".", "_");
  const HEAD_STYLE = /^(heading|title|subtitle|toc|caption)\b/i;
  // styleMap lines + transformDocument for mammoth. Runs whose size differs from
  // the document's main size get a style name that maps to <span class="docxmd-fs-N">;
  // centred / right-aligned plain paragraphs → <p class="docxmd-align-…">.
  // Headings keep the size of their level. keep: run styles already mapped elsewhere.
  function sizeAlignImport(docXml, base, keep) {
    const M = global.mammoth, tf = M && M.transforms;
    const res = { styleMap: [], transformDocument: null, docSize: base };
    if (!tf) return res;
    const sizes = new Set([base]);
    String(docXml || "").replace(/<w:sz w:val="(\d+)"/g, (x, v) => { sizes.add(+v / 2); return x; });
    sizes.forEach((pt) => res.styleMap.push("r[style-name='" + sizeClass(pt) + "'] => span." + sizeClass(pt)));
    ["center", "right"].forEach((a) => res.styleMap.push("p[style-name='docxmd-align-" + a + "'] => p.docxmd-align-" + a + ":fresh"));
    const chars = (r) => (r.children || []).reduce((n, c) => n + (c.type === "text" ? String(c.value || "").replace(/\s/g, "").length : 0), 0);
    const isHead = (p) => HEAD_STYLE.test(p.styleName || "");
    res.transformDocument = (doc) => {
      // pass 1: the size most paragraphs are written in (each paragraph votes with the
      // size of most of its text — a few long 8 pt logs must not outvote the body text)
      const count = new Map();
      tf.paragraph((p) => {
        if (isHead(p)) return p;
        const own = new Map();
        tf.run((r) => { const n = chars(r); if (n) { const k = r.fontSize || base; own.set(k, (own.get(k) || 0) + n); } return r; })(p);
        let k = null, m = 0; own.forEach((n, x) => { if (n > m) { m = n; k = x; } });
        if (k != null) count.set(k, (count.get(k) || 0) + 1);
        return p;
      })(doc);
      let best = -1; count.forEach((n, k) => { if (n > best) { best = n; res.docSize = k; } });
      // pass 2: mark the runs that differ from it, and aligned paragraphs
      return tf.paragraph((p) => {
        let q = p;
        if (!isHead(p)) q = tf.run((r) => {
          const k = r.fontSize || base;
          if (k === res.docSize || !chars(r) || (r.styleName && keep.has(r.styleName)) || !sizes.has(k)) return r;
          return Object.assign({}, r, { styleName: sizeClass(k) });
        })(q);
        if (!q.styleName && (q.alignment === "center" || q.alignment === "right")) q = Object.assign({}, q, { styleName: "docxmd-align-" + q.alignment });
        return q;
      })(doc);
    };
    return res;
  }
  // <span class="docxmd-fs-8"> → <span style="font-size:8pt">
  function inlineSizes(root) {
    root.querySelectorAll('span[class*="docxmd-fs-"]').forEach((sp) => {
      const m = /docxmd-fs-(\d+(?:_\d+)?)/.exec(sp.className);
      sp.classList.remove(m[0]); if (!sp.classList.length) sp.removeAttribute("class");
      setCss(sp, "font-size", m[1].replace("_", ".") + "pt");
    });
  }
  // Fewer spans: neighbouring spans with the same style are merged; a cell whose
  // text is all one size carries it on the <td>, a table whose cells agree on the <table>.
  const sizeOfSpan = (el) => (el && el.nodeName === "SPAN" ? getCss(el, "font-size") : "");
  function mergeSpans(root) {
    root.querySelectorAll("span[style]").forEach((sp) => {
      if (!sp.parentNode) return;
      let n = sp.nextSibling;
      while (n) {
        const gap = n.nodeType === 3 && !n.nodeValue.trim() ? n : null;
        const nx = gap ? gap.nextSibling : n;
        if (!nx || nx.nodeName !== "SPAN" || nx.getAttribute("style") !== sp.getAttribute("style")) break;
        if (gap) sp.appendChild(gap);
        while (nx.firstChild) sp.appendChild(nx.firstChild);
        n = nx.nextSibling; nx.remove();
      }
    });
  }
  function unwrapSize(scope) {
    scope.querySelectorAll("span[style]").forEach((sp) => {
      setCss(sp, "font-size", "");
      if (!sp.hasAttribute("style")) { while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.remove(); }
    });
  }
  function hoistSizes(root) {
    root.querySelectorAll('table[data-docxmd-html="1"]').forEach((table) => {
      const cellSizes = [];
      Array.from(table.querySelectorAll("td,th")).filter((c) => c.closest("table") === table).forEach((cell) => {
        const sizes = new Set();
        const walker = document.createTreeWalker(cell, 4);
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
          if (!t.nodeValue.trim() || t.parentNode.closest("table") !== table) continue;
          let e = t.parentNode, sz = "";
          while (e && e !== cell && !sz) { sz = sizeOfSpan(e); e = e.parentNode; }
          sizes.add(sz);
        }
        if (sizes.size === 1 && [...sizes][0]) { setCss(cell, "font-size", [...sizes][0]); unwrapSize(cell); }
        if (sizes.size) cellSizes.push(sizes.size === 1 ? getCss(cell, "font-size") : "*");
        else cellSizes.push(null);
      });
      const set = new Set(cellSizes.filter((x) => x !== null));
      if (set.size === 1 && [...set][0] && [...set][0] !== "*") {
        setCss(table, "font-size", [...set][0]);
        Array.from(table.querySelectorAll("td,th")).filter((c) => c.closest("table") === table).forEach((c) => setCss(c, "font-size", ""));
      }
    });
  }
  // Paragraphs inside cells: HTML tables keep them as line breaks (Markdown tables:
  // spaces); a centred paragraph among others becomes <div style="text-align:…">.
  // Consecutive aligned body paragraphs are grouped into one <div data-docxmd-align>.
  function cleanHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    inlineSizes(tpl.content);
    const alignOf = (p) => { const m = /\bdocxmd-align-(center|right)\b/.exec(p.className || ""); return m ? m[1] : null; };
    tpl.content.querySelectorAll("td p, th p").forEach((p) => {
      const table = p.closest("table");
      if (table && table.hasAttribute("data-docxmd-quote")) return; // becomes a blockquote
      const cell = p.parentNode, html = table && table.hasAttribute("data-docxmd-html");
      const al = alignOf(p), cellAl = getCss(cell, "text-align") || "left";
      if (html && al && al !== cellAl) {
        const d = document.createElement("div"); setCss(d, "text-align", al);
        while (p.firstChild) d.appendChild(p.firstChild);
        p.replaceWith(d);
        return;
      }
      if (p.previousElementSibling && p.previousElementSibling.nodeName !== "DIV") cell.insertBefore(html ? document.createElement("br") : document.createTextNode(" "), p);
      while (p.firstChild) cell.insertBefore(p.firstChild, p);
      p.remove();
    });
    mergeSpans(tpl.content);
    hoistSizes(tpl.content);
    // body: runs of centred / right paragraphs → one wrapper
    Array.from(tpl.content.querySelectorAll("p")).forEach((p) => {
      const al = alignOf(p); if (!al || p.closest("td,th,li,blockquote")) return;
      const prev = p.previousElementSibling;
      if (prev && prev.nodeName === "DIV" && prev.getAttribute("data-docxmd-align") === al) { prev.appendChild(p); return; }
      const d = document.createElement("div"); d.setAttribute("data-docxmd-align", al);
      p.replaceWith(d); d.appendChild(p);
    });
    tpl.content.querySelectorAll('p[class*="docxmd-align-"]').forEach((p) => { p.className = p.className.replace(/\s*docxmd-align-\w+/g, "").trim(); if (!p.className) p.removeAttribute("class"); });
    return tpl.innerHTML;
  }
  // Turndown: aligned groups → <div align="…"> around Markdown; sized / coloured /
  // font spans stay inline HTML around their (Markdown) content.
  function formatRules(td) {
    td.addRule("docxmdAlign", {
      filter: (n) => n.nodeName === "DIV" && n.hasAttribute("data-docxmd-align"),
      replacement: (content, node) => '\n\n<div align="' + node.getAttribute("data-docxmd-align") + '">\n\n' + content.replace(/^\n+|\n+$/g, "") + "\n\n</div>\n\n"
    });
    td.addRule("docxmdStyledSpan", {
      filter: (n) => n.nodeName === "SPAN" && /font-size|font-family|color/i.test(n.getAttribute("style") || ""),
      replacement: (content, node) => (content.trim() ? '<span style="' + node.getAttribute("style").replace(/"/g, "'") + '">' + content + "</span>" : content)
    });
    return td;
  }

  // The whole Word → Markdown import (PWA and VS Code webview):
  // mammoth + our transforms → HTML → table/picture/structure formatting → Turndown
  // → front matter (header / footer / page numbers / main font size).
  async function toMarkdown(ab, fileBase) {
    const M = global.mammoth;
    if (!M || !global.TurndownService) throw new Error("import libraries failed to load");
    const [docXml, stylesXml] = await Promise.all([readZipEntry(ab, "word/document.xml"), readZipEntry(ab, "word/styles.xml")]);
    const styleMap = ["p[style-name='Quote'] => blockquote", "p[style-name='Intense Quote'] => blockquote"]
      .concat(highlightStyleMap(), codeStyleMap());
    const keep = new Set(styleMap.map((x) => (/^r\[style-name='([^']+)'\]/.exec(x) || [])[1]).filter(Boolean));
    let fa = { styleMap: [], transformDocument: null, docSize: null };
    try { fa = sizeAlignImport(docXml, baseSize(stylesXml), keep); } catch (e) { console.warn("DOCXFMT sizes", e); }
    const opts = { styleMap: styleMap.concat(fa.styleMap) };
    if (fa.transformDocument) opts.transformDocument = fa.transformDocument;
    const result = await M.convertToHtml({ arrayBuffer: ab }, opts);
    const td = new global.TurndownService({
      headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
      emDelimiter: "*", strongDelimiter: "**", hr: "---"
    });
    if (global.turndownPluginGfm) td.use(global.turndownPluginGfm.gfm);
    td.keep(["sub", "sup"]);
    markdownRules(td);              // "<tag>" / "&x;" typed in Word stay text
    formatRules(td);
    tableRule(td);
    // mammoth ignores table colours / alignment / widths: read them from the XML ourselves
    const html = apply(result.value || "", await extract(ab));
    let md = td.turndown(cleanHtml(html)).replace(/\n{3,}/g, "\n\n").trim() + "\n";
    // Word header / footer / page numbers / main size → YAML front matter (exported back the same way)
    let meta = await extractMeta(ab, fileBase || "");
    if (fa.docSize && fa.docSize !== 11) meta = Object.assign(meta || {}, { "font-size": fa.docSize + "pt" });
    if (meta) md = frontMatterText(meta) + md;
    return md;
  }

  // ---- header / footer / document properties → YAML front matter -------------
  const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  // Text of a header/footer part: PAGE → {n}, NUMPAGES → {N}, tabs kept as \t.
  function partText(xml) {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const paras = [];
    for (const p of Array.from(doc.getElementsByTagNameNS(W, "p"))) {
      let out = "", depth = 0, skip = false;
      const field = (instr) => (/\bNUMPAGES\b/.test(instr) ? "{N}" : /\bPAGE\b/.test(instr) ? "{n}" : "");
      (function walk(n) {
        for (const c of Array.from(n.childNodes)) {
          if (c.nodeType !== 1) continue;
          const ln = c.namespaceURI === W ? c.localName : "";
          if (ln === "fldSimple") { out += field(c.getAttributeNS(W, "instr") || c.getAttribute("w:instr") || ""); continue; }
          if (ln === "fldChar") {
            const t = wval(c, "fldCharType");
            if (t === "begin") depth++;
            else if (t === "separate") skip = true;
            else if (t === "end") { depth = Math.max(0, depth - 1); if (!depth) skip = false; }
            continue;
          }
          if (ln === "instrText") { out += field(c.textContent); continue; }
          if (ln === "t") { if (!skip) out += c.textContent; continue; }
          if (ln === "tab") { if (!skip && c.parentNode.localName === "r") out += "\t"; continue; }
          walk(c);
        }
      })(p);
      if (out.trim()) paras.push(out.trim());
    }
    return paras.join("\t");   // paragraphs (and table cells) are separate pieces, like tab stops
  }
  async function extractMeta(ab, fileBase) {
    try {
      if (typeof DOMParser === "undefined") return null;
      const [docXml, relsXml, coreXml] = await Promise.all([
        readZipEntry(ab, "word/document.xml"), readZipEntry(ab, "word/_rels/document.xml.rels"), readZipEntry(ab, "docProps/core.xml")]);
      const meta = {};
      if (docXml && relsXml) {
        const doc = new DOMParser().parseFromString(docXml, "application/xml");
        const rels = new DOMParser().parseFromString(relsXml, "application/xml");
        const target = (id) => { const r = Array.from(rels.getElementsByTagName("Relationship")).find((x) => x.getAttribute("Id") === id); return r ? "word/" + r.getAttribute("Target").replace(/^\/?word\//, "") : null; };
        const sects = doc.getElementsByTagNameNS(W, "sectPr");
        const sect = sects[sects.length - 1];
        const part = async (kind) => {
          if (!sect) return "";
          const refs = kids(sect, kind + "Reference");
          const ref = refs.find((r) => wval(r, "type") === "default") || refs[0];
          const id = ref && (ref.getAttributeNS(NS_R, "id") || ref.getAttribute("r:id"));
          const xml = id && target(id) ? await readZipEntry(ab, target(id)) : null;
          return xml ? partText(xml) : "";
        };
        const split = (txt) => {
          const pieces = txt.split("\t").map((x) => x.trim()).filter(Boolean);
          return { text: pieces.filter((x) => !/\{[nN]\}/.test(x)).join(" · "), pages: pieces.filter((x) => /\{[nN]\}/.test(x)).join(" ") };
        };
        const h = split(await part("header")), f = split(await part("footer"));
        if (h.text) meta.header = h.text;
        if (f.text) meta.footer = f.text;
        const pages = f.pages || h.pages;
        if (pages) meta["page-numbers"] = pages === "{n}" ? "true" : pages;
      }
      if (!Object.keys(meta).length) return null;   // plain Word properties alone are not worth a front matter
      if (coreXml) {
        const core = new DOMParser().parseFromString(coreXml, "application/xml");
        const get = (tag) => { const e = core.getElementsByTagName(tag)[0]; return e ? e.textContent.trim() : ""; };
        const title = get("dc:title"), author = get("dc:creator"), subject = get("dc:subject"), keywords = get("cp:keywords");
        const head = {};
        if (title && title !== fileBase) head.title = title;
        if (author && author !== "DOCXMD") head.author = author;
        if (subject) head.subject = subject;
        if (keywords) head.keywords = keywords;
        return Object.assign(head, meta);
      }
      return meta;
    } catch (e) {
      console.warn("DOCXFMT.extractMeta", e);
      return null;
    }
  }
  // meta object → "---\nkey: value\n---\n\n" (values quoted when YAML would misread them)
  function frontMatterText(meta) {
    const keys = Object.keys(meta || {}); if (!keys.length) return "";
    const q = (v) => (/^[\w\u0080-\uFFFF][^:#{}\[\]"'\n]*$/.test(v) && !/\s$/.test(v) ? v : '"' + String(v).replace(/(["\\])/g, "\\$1") + '"');
    return "---\n" + keys.map((k) => k + ": " + q(String(meta[k]))).join("\n") + "\n---\n\n";
  }

  global.DOCXFMT = { toMarkdown, cleanHtml, formatRules, baseSize, extract, apply, structure, tableRule, readZipEntry, extractMeta, frontMatterText, highlightStyleMap, codeStyleMap, markdownRules };
})(typeof window !== "undefined" ? window : this);
