/* DOCXMD — table formatting for .docx import.
   mammoth drops cell shading, text colour and alignment, so we read them straight
   from word/document.xml and put them back onto mammoth's HTML tables as inline
   styles. Tables that carry such formatting are then kept as HTML in the Markdown
   (a pipe table can't hold colours); md2docx turns them back into Word tables.
   Exposes: window.DOCXFMT.extract(arrayBuffer) -> Promise<fmt|null>
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
    // horizontal alignment: first paragraph that has text
    for (const p of ownDescendants(tc, "p")) {
      if (!ownDescendants(p, "t").some((t) => t.textContent.trim())) continue;
      const jc = JC[wval(kid(kid(p, "pPr"), "jc"))];
      if (jc && jc !== "left") f.align = jc;
      break;
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

  async function extract(ab) {
    try {
      const xml = await readZipEntry(ab, "word/document.xml");
      if (!xml || typeof DOMParser === "undefined") return null;
      const doc = new DOMParser().parseFromString(xml, "application/xml");
      const tables = [];
      for (const tbl of Array.from(doc.getElementsByTagNameNS(W, "tbl"))) {
        if (isQuoteTable(tbl)) {
          const c = hex(wval(kid(kid(kid(tbl, "tblPr"), "tblBorders"), "left"), "color"));
          tables.push({ quote: true, color: c && !PLAIN_BARS.includes(c) ? c : null });
          continue;
        }
        const tblFill = hex(wval(kid(kid(tbl, "tblPr"), "shd"), "fill"));
        const rows = kids(tbl, "tr").map((tr, ri) => kids(tr, "tc")
          // vMerge continuation cells don't exist in mammoth's HTML (rowspan instead)
          .filter((tc) => { const vm = kid(kid(tc, "tcPr"), "vMerge"); return !vm || wval(vm) === "restart"; })
          .map((tc) => {
            const f = cellFmt(tc, tblFill);
            // the light-grey header fill is DOCXMD's own default for plain tables
            if (ri === 0 && f.fill === DEFAULT_HEAD_FILL) { delete f.fill; if (f.autoColor) delete f.color; }
            delete f.autoColor;
            return f;
          }));
        tables.push({ rows });
      }
      return { tables };
    } catch (e) {
      console.warn("DOCXFMT.extract", e);
      return null;
    }
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

  function apply(html, fmt) {
    if (!fmt || !fmt.tables || !fmt.tables.length) return html;
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    const tables = Array.from(tpl.content.querySelectorAll("table"));
    if (tables.length !== fmt.tables.length) return html; // can't pair them up safely
    tables.forEach((table, ti) => {
      const tf = fmt.tables[ti];
      if (tf.quote) { table.setAttribute("data-docxmd-quote", tf.color || "1"); return; }
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
    const out = ["<table>"];
    const attrs = (el) => ["colspan", "rowspan", "style"].filter((a) => el.hasAttribute(a))
      .map((a) => " " + a + '="' + el.getAttribute(a).replace(/"/g, "&quot;") + '"').join("");
    const cellHtml = (c) => {
      const x = c.cloneNode(true);
      // drop our internal markers and Word's empty bookmark anchors
      x.querySelectorAll("[data-docxmd-html],[data-docxmd-quote]").forEach((e) => { e.removeAttribute("data-docxmd-html"); e.removeAttribute("data-docxmd-quote"); });
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

  // Turndown rules: styled tables → HTML block; exported quote tables → blockquote.
  // addRule() puts them in front of the GFM plugin's table rule.
  function tableRule(td) {
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
        // coloured bar → :::colour box (named when it matches the palette)
        const name = global.MD2DOCX && MD2DOCX.colorName ? MD2DOCX.colorName(c) : c;
        return "\n\n:::" + name + "\n" + quote + "\n:::\n\n";
      }
    });
  }

  global.DOCXFMT = { extract, apply, tableRule, readZipEntry };
})(typeof window !== "undefined" ? window : this);
