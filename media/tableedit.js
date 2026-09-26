/* DOCXMD — tables in the preview: size, column widths, row heights, position, cell alignment.
   Shared by the PWA (js/app.js) and the VS Code webview (media/webview.js).

   Hover a table in the preview:
   • drag a column border → column widths (<colgroup><col style="width:NN%">, fixed layout);
   • drag the right edge → table width (style="width:NN%");
   • drag a row's bottom edge → row height (<tr style="height:NNpx">);
   • the bar above the table: position left / centre / right (margin auto), alignment of
     the clicked cell's content — cell, row, column or the whole table (text-align +
     vertical-align, a 3×3 grid), equal columns, reset sizes.
   Every change is one undoable edit of the table's source. A Markdown pipe table can't
   hold these settings, so it is rewritten as an HTML table the first time (a toast says so).
   The DOCX export reads all of it (md2docx buildHtmlTable).

   Exposes: window.DOCXMDTableEdit.attach({ preview, getText, editRange, render, pe, t, toast, enabled })
            -> { refresh() }   (call refresh() after every preview render) */
(function (global) {
  "use strict";
  const CSS =
    ".te-bar{position:fixed;z-index:58;display:none;align-items:center;gap:2px;padding:3px;border-radius:9px;background:var(--bg-card,#fff);" +
    "border:1px solid var(--border-subtle,#ccc);box-shadow:0 4px 14px rgba(0,0,0,.18);font:13px/1 system-ui,sans-serif}" +
    ".te-bar button{width:28px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--text-main,#222);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}" +
    ".te-bar button:hover,.te-bar button.on{background:color-mix(in srgb,var(--accent,#0984e3) 16%,transparent);color:var(--accent,#0984e3)}" +
    ".te-bar svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
    ".te-bar i{width:1px;height:18px;background:var(--border-subtle,#ccc);margin:0 3px}" +
    ".te-col,.te-row{position:fixed;z-index:57;display:none;background:transparent;touch-action:none}" +
    ".te-col{width:9px;margin-left:-4px;cursor:col-resize}.te-row{height:9px;margin-top:-4px;cursor:row-resize}" +
    ".te-col:hover,.te-row:hover,.te-col.drag,.te-row.drag{background:color-mix(in srgb,var(--accent,#0984e3) 55%,transparent)}" +
    ".te-col.edge{width:11px;margin-left:-5px;cursor:ew-resize}" +
    ".te-badge{position:fixed;z-index:61;padding:2px 7px;border-radius:5px;font:600 12px/1.5 system-ui,sans-serif;background:rgba(20,20,20,.82);color:#fff;pointer-events:none;display:none;white-space:nowrap}" +
    ".te-cur{outline:2px solid var(--accent,#0984e3)!important;outline-offset:-2px}" +
    ".te-pop{position:fixed;z-index:62;padding:.55rem .6rem;border-radius:10px;background:var(--bg-base,#fff);color:var(--text-main,#222);border:1px solid var(--border-subtle,#ccc);box-shadow:0 10px 30px rgba(0,0,0,.3);font:13px/1.35 system-ui,sans-serif;width:214px}" +
    ".te-pop b{display:block;font-size:12px;margin-bottom:.4rem}" +
    ".te-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:.5rem}" +
    ".te-grid button{height:30px;border:1px solid var(--border-subtle,#ccc);border-radius:6px;background:var(--bg-card,#f6f6f6);cursor:pointer;position:relative;padding:0}" +
    ".te-grid button::after{content:'';position:absolute;left:var(--x);top:var(--y);width:12px;height:4px;border-radius:2px;background:currentColor;color:var(--text-muted,#888)}" +
    ".te-grid button:hover{border-color:var(--accent,#0984e3)}.te-grid button:hover::after{color:var(--accent,#0984e3)}" +
    ".te-scope{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:.45rem}" +
    ".te-scope button{flex:1 1 45%;padding:.25rem .3rem;border:1px solid var(--border-subtle,#ccc);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px}" +
    ".te-scope button.on{border-color:var(--accent,#0984e3);color:var(--accent,#0984e3);font-weight:600}" +
    ".te-pop .te-reset{width:100%;padding:.3rem;border:1px solid var(--border-subtle,#ccc);border-radius:6px;background:transparent;color:inherit;cursor:pointer;font:inherit;font-size:12px}";

  const ICON = {
    left: '<svg viewBox="0 0 24 24"><line x1="3" y1="4" x2="3" y2="20"/><rect x="6" y="8" width="11" height="8" rx="1"/></svg>',
    center: '<svg viewBox="0 0 24 24"><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><rect x="6" y="8" width="12" height="8" rx="1"/></svg>',
    right: '<svg viewBox="0 0 24 24"><line x1="21" y1="4" x2="21" y2="20"/><rect x="7" y="8" width="11" height="8" rx="1"/></svg>',
    cell: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="16" x2="15" y2="16"/></svg>',
    equal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1"/><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg>',
    reset: '<svg viewBox="0 0 24 24"><polyline points="4 4 4 10 10 10"/><path d="M4.5 15a8 8 0 1 0 2-8.5L4 10"/></svg>'
  };
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // style attribute helpers (string-based)
  function getCss(el, prop) {
    const m = new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i").exec(el.getAttribute("style") || "");
    return m ? m[1].trim() : "";
  }
  function setCss(el, prop, val) {
    const rest = String(el.getAttribute("style") || "").split(";").map((x) => x.trim())
      .filter((x) => x && x.split(":")[0].trim().toLowerCase() !== prop);
    if (val) rest.push(prop + ":" + val);
    if (rest.length) el.setAttribute("style", rest.join(";")); else el.removeAttribute("style");
  }
  // cells with their grid position (colspan / rowspan aware)
  function grid(tbl) {
    const occ = [], out = [];
    let ncols = 0;
    Array.from(tbl.rows).forEach((tr, r) => {
      occ[r] = occ[r] || [];
      let c = 0;
      Array.from(tr.cells).forEach((td) => {
        while (occ[r][c]) c++;
        const cs = Math.max(1, td.colSpan || 1), rs = Math.max(1, td.rowSpan || 1);
        for (let i = 0; i < rs; i++) { occ[r + i] = occ[r + i] || []; for (let j = 0; j < cs; j++) occ[r + i][c + j] = true; }
        out.push({ el: td, r, c, cs, rs });
        c += cs; ncols = Math.max(ncols, c);
      });
    });
    return { cells: out, ncols, rows: Array.from(tbl.rows) };
  }
  // pretty, blank-line-free HTML (one Markdown HTML block)
  function attrs(el) { return Array.from(el.attributes).map((a) => " " + a.name + '="' + esc(a.value) + '"').join(""); }
  function serialize(tbl) {
    const out = ["<table" + attrs(tbl) + ">"];
    const cg = tbl.querySelector(":scope > colgroup");
    if (cg) out.push("<colgroup>" + Array.from(cg.children).map((c) => "<col" + attrs(c) + ">").join("") + "</colgroup>");
    const inner = (c) => c.innerHTML.replace(/\n[ \t]*(?=\n)/g, "").replace(/^\s+|\s+$/g, "");
    const row = (tr) => { out.push("<tr" + attrs(tr) + ">"); Array.from(tr.cells).forEach((c) => { const t = c.nodeName.toLowerCase(); out.push("<" + t + attrs(c) + ">" + inner(c) + "</" + t + ">"); }); out.push("</tr>"); };
    Array.from(tbl.children).forEach((sec) => {
      if (sec.nodeName === "TR") { row(sec); return; }
      if (!/^(THEAD|TBODY|TFOOT)$/.test(sec.nodeName)) return;
      out.push("<" + sec.nodeName.toLowerCase() + attrs(sec) + ">");
      Array.from(sec.rows).forEach(row);
      out.push("</" + sec.nodeName.toLowerCase() + ">");
    });
    out.push("</table>");
    return out.join("\n");
  }
  function parseTable(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html;
    return tpl.content.querySelector("table");
  }
  // Markdown pipe table → the same table in HTML (cell text rendered inline)
  function pipeToHtml(src) {
    const M = global.marked;
    let tok = null;
    try { tok = (M.lexer(src) || []).find((x) => x.type === "table"); } catch (e) {}
    if (!tok) return null;
    const inl = (text) => {
      if (/\$|\\\(|\[\^/.test(text)) return esc(text);                 // formulas / footnotes stay literal text
      try { return M.parseInline(text); } catch (e) { return esc(text); }
    };
    const al = tok.align || [];
    const cell = (tag, c, i) => "<" + tag + (al[i] ? ' style="text-align:' + al[i] + '"' : "") + ">" + inl(c.text) + "</" + tag + ">";
    return parseTable("<table><thead><tr>" + tok.header.map((c, i) => cell("th", c, i)).join("") + "</tr></thead><tbody>" +
      tok.rows.map((r) => "<tr>" + r.map((c, i) => cell("td", c, i)).join("") + "</tr>").join("") + "</tbody></table>");
  }

  function attach(o) {
    const preview = o.preview, t = o.t || ((k) => k), toast = o.toast || (() => {});
    if (!preview) return { refresh() {} };
    if (!document.getElementById("te-style")) { const st = document.createElement("style"); st.id = "te-style"; st.textContent = CSS; document.head.appendChild(st); }
    const enabled = () => (o.enabled ? o.enabled() : true);
    const bar = document.createElement("div");
    bar.className = "te-bar";
    bar.innerHTML =
      '<button data-te="left" title="' + esc(t("te.left")) + '">' + ICON.left + "</button>" +
      '<button data-te="center" title="' + esc(t("te.center")) + '">' + ICON.center + "</button>" +
      '<button data-te="right" title="' + esc(t("te.right")) + '">' + ICON.right + "</button><i></i>" +
      '<button data-te="cell" title="' + esc(t("te.cellAlign")) + '">' + ICON.cell + "</button><i></i>" +
      '<button data-te="equal" title="' + esc(t("te.equal")) + '">' + ICON.equal + "</button>" +
      '<button data-te="reset" title="' + esc(t("te.reset")) + '">' + ICON.reset + "</button>";
    document.body.appendChild(bar);
    const badge = document.createElement("div"); badge.className = "te-badge"; document.body.appendChild(badge);
    let tbl = null, handles = [], drag = null, pop = null, cur = null, scope = "cell", hideTimer = null;

    // which table: block n, k-th top-level table of that block
    const topTables = (n) => Array.from(preview.querySelectorAll('table[data-b="' + n + '"]')).filter((x) => !x.parentElement.closest("table"));
    function ident(el) { const n = +el.getAttribute("data-b"); return { n, k: topTables(n).indexOf(el) }; }
    const resolve = (id) => (id ? topTables(id.n)[id.k] || null : null);
    // the table's source range: { start, end, html | pipe }
    function locate(id) {
      const r = o.pe && o.pe.blockRange ? o.pe.blockRange(id.n) : null;
      if (!r) return null;
      const src = o.getText().slice(r.start, r.end);
      if (r.type === "table") return { pipe: true, start: r.start, end: r.end, src };
      if (r.type !== "html") return null;
      const re = /<\/?table\b[^>]*>/gi;
      let depth = 0, cnt = -1, st = -1, m;
      while ((m = re.exec(src))) {
        if (m[0][1] !== "/") { if (depth === 0) { cnt++; if (cnt === id.k) st = m.index; } depth++; }
        else { depth--; if (depth === 0 && cnt === id.k && st >= 0) return { pipe: false, start: r.start + st, end: r.start + m.index + m[0].length, src: src.slice(st, m.index + m[0].length) }; }
      }
      return null;
    }
    // Apply fn(sourceTableElement) to the table's source → one edit, then re-render
    function write(id, fn) {
      if (o.pe && o.pe.busy && o.pe.busy()) { o.pe.close(true); }
      const loc = locate(id);
      if (!loc) { toast(t("te.cannot"), "err"); return false; }
      const st = loc.pipe ? pipeToHtml(loc.src) : parseTable(loc.src);
      if (!st) { toast(t("te.cannot"), "err"); return false; }
      fn(st);
      const html = serialize(st);
      if (html === loc.src) return true;
      o.editRange(loc.start, loc.end, html);
      o.render();
      if (loc.pipe) toast(t("te.converted"), "ok");
      return true;
    }

    /* ---------- overlay: bar + handles ---------- */
    function clearHandles() { handles.forEach((h) => h.el.remove()); handles = []; }
    function hide() {
      bar.style.display = "none"; clearHandles(); tbl = null;
      if (pop) { pop.remove(); pop = null; }
    }
    function colGeometry(table) {
      const g = grid(table), xs = [], lefts = [];
      for (let j = 0; j < g.ncols; j++) {
        const c = g.cells.find((x) => x.c === j && x.cs === 1);
        if (!c) return null;
        const rc = c.el.getBoundingClientRect();
        lefts[j] = rc.left; xs[j] = rc.right;
      }
      return { g, xs, lefts };
    }
    function place() {
      if (!tbl || !tbl.isConnected) { hide(); return; }
      const r = tbl.getBoundingClientRect();
      const pr = preview.getBoundingClientRect();
      bar.style.display = "flex";
      bar.style.left = Math.max(4, r.left) + "px";
      bar.style.top = Math.max(pr.top + 2, r.top - bar.offsetHeight - 6) + "px";
      if (!handles.length) build();
      handles.forEach((h) => {
        if (h.kind === "col") {
          const geo = colGeometry(tbl);
          const x = h.edge ? r.right : geo ? geo.xs[h.j] : null;
          if (x == null) { h.el.style.display = "none"; return; }
          Object.assign(h.el.style, { display: "block", left: x + "px", top: r.top + "px", height: r.height + "px" });
        } else {
          const rr = h.tr.getBoundingClientRect();
          Object.assign(h.el.style, { display: "block", left: r.left + "px", top: rr.bottom + "px", width: r.width + "px" });
        }
      });
    }
    function build() {
      clearHandles();
      const geo = colGeometry(tbl);
      if (geo) for (let j = 0; j < geo.g.ncols - 1; j++) addHandle({ kind: "col", j });
      addHandle({ kind: "col", edge: true });
      Array.from(tbl.rows).forEach((tr, i) => addHandle({ kind: "row", tr, i }));
    }
    function addHandle(h) {
      h.el = document.createElement("div");
      h.el.className = h.kind === "col" ? "te-col" + (h.edge ? " edge" : "") : "te-row";
      h.el.title = h.kind === "row" ? t("te.rowHeight") : h.edge ? t("te.tableWidth") : t("te.colWidth");
      h.el.addEventListener("pointerdown", (e) => startDrag(e, h));
      h.el.addEventListener("dblclick", (e) => { e.preventDefault(); resetOne(h); });
      document.body.appendChild(h.el);
      handles.push(h);
    }
    function showFor(table) {
      if (table === tbl) { place(); return; }
      hide(); tbl = table; place();
    }

    /* ---------- dragging ---------- */
    function startDrag(e, h) {
      if (!tbl || e.button !== 0) return;
      e.preventDefault();
      const id = ident(tbl), r = tbl.getBoundingClientRect();
      const wrapW = (tbl.parentElement.getBoundingClientRect().width) || r.width;
      const geo = colGeometry(tbl);
      drag = { h, id, x0: e.clientX, y0: e.clientY, r, wrapW, geo, widths: geo ? geo.xs.map((x, j) => x - geo.lefts[j]) : null,
        rowH: h.tr ? h.tr.getBoundingClientRect().height : 0 };
      h.el.classList.add("drag");
      try { h.el.setPointerCapture(e.pointerId); } catch (x) {}
      const move = (ev) => onDrag(ev);
      const up = (ev) => { h.el.removeEventListener("pointermove", move); h.el.removeEventListener("pointerup", up); h.el.removeEventListener("pointercancel", up); endDrag(ev); };
      h.el.addEventListener("pointermove", move); h.el.addEventListener("pointerup", up); h.el.addEventListener("pointercancel", up);
    }
    function liveCols(widths) {
      let cg = tbl.querySelector(":scope > colgroup");
      if (!cg) { cg = document.createElement("colgroup"); tbl.insertBefore(cg, tbl.firstChild); }
      cg.innerHTML = widths.map((w) => '<col style="width:' + w + 'px">').join("");
      tbl.style.tableLayout = "fixed";
      tbl.style.width = widths.reduce((a, b) => a + b, 0) + "px";
    }
    function onDrag(e) {
      const d = drag; if (!d) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      let label = "";
      if (d.h.kind === "row") {
        const hgt = Math.max(16, Math.round(d.rowH + dy));
        d.h.tr.style.height = hgt + "px"; d.val = hgt; label = hgt + " px";
      } else if (d.h.edge) {
        const w = Math.max(d.wrapW * 0.15, Math.min(d.wrapW, d.r.width + dx));
        if (d.widths) liveCols(d.widths.map((x) => x * w / d.r.width)); else tbl.style.width = w + "px";
        d.val = Math.round(w / d.wrapW * 100); label = d.val + " %";
      } else if (d.widths) {
        const j = d.h.j, W = d.widths.slice(), min = 24;
        const a = Math.max(min, Math.min(W[j] + W[j + 1] - min, W[j] + dx));
        W[j + 1] = W[j] + W[j + 1] - a; W[j] = a;
        liveCols(W); d.val = W;
        const sum = W.reduce((p, q) => p + q, 0);
        label = W.map((x) => Math.round(x / sum * 100) + "%").join(" · ");
      }
      badge.textContent = label; badge.style.display = "block";
      badge.style.left = (e.clientX + 14) + "px"; badge.style.top = (e.clientY + 14) + "px";
      place();
    }
    function endDrag() {
      const d = drag; drag = null; badge.style.display = "none";
      if (!d) return;
      d.h.el.classList.remove("drag");
      if (d.val == null) return;
      const pct = (W) => { const s = W.reduce((a, b) => a + b, 0); const p = W.map((x) => Math.round(x / s * 1000) / 10); p[p.length - 1] = Math.round((100 - p.slice(0, -1).reduce((a, b) => a + b, 0)) * 10) / 10; return p; };
      const tablePct = d.h.edge ? d.val : Math.min(100, Math.round(d.r.width / d.wrapW * 100));
      write(d.id, (st) => {
        if (d.h.kind === "row") {
          const tr = st.rows[d.h.i]; if (tr) setCss(tr, "height", d.val + "px");
          return;
        }
        const widths = d.h.edge ? d.widths : d.val;
        setCss(st, "width", tablePct + "%");
        if (widths) setCols(st, pct(widths));
      });
      hide();
    }
    function setCols(st, p) {
      let cg = st.querySelector(":scope > colgroup");
      if (cg) cg.remove();
      cg = document.createElement("colgroup");
      p.forEach((x) => { const c = document.createElement("col"); c.setAttribute("style", "width:" + x + "%"); cg.appendChild(c); });
      st.insertBefore(cg, st.firstChild);
      setCss(st, "table-layout", "fixed");
      if (!getCss(st, "width")) setCss(st, "width", "100%");
    }
    function resetOne(h) {
      if (!tbl) return;
      const id = ident(tbl);
      write(id, (st) => {
        if (h.kind === "row") { const tr = st.rows[h.i]; if (tr) setCss(tr, "height", ""); }
        else if (h.edge) setCss(st, "width", "");
        else { const cg = st.querySelector(":scope > colgroup"); if (cg) cg.remove(); setCss(st, "table-layout", ""); }
      });
      hide();
    }

    /* ---------- bar: position, cell alignment, equal columns, reset ---------- */
    function openCellPop(btn) {
      if (pop) { pop.remove(); pop = null; return; }
      if (!cur || !resolve(cur.id)) { toast(t("te.clickCell"), "err"); return; }
      pop = document.createElement("div");
      pop.className = "te-pop";
      const V = ["top", "middle", "bottom"], H = ["left", "center", "right"];
      const pos = { left: "8px", center: "calc(50% - 6px)", right: "calc(100% - 20px)" }, vpos = { top: "6px", middle: "calc(50% - 2px)", bottom: "calc(100% - 10px)" };
      pop.innerHTML = "<b>" + esc(t("te.cellAlign")) + "</b>" +
        '<div class="te-scope">' + ["cell", "row", "col", "table"].map((s) => '<button data-scope="' + s + '"' + (s === scope ? ' class="on"' : "") + ">" + esc(t("te.scope." + s)) + "</button>").join("") + "</div>" +
        '<div class="te-grid">' + V.map((v) => H.map((h) => '<button data-v="' + v + '" data-h="' + h + '" title="' + esc(t("te.v." + v) + " · " + t("te.h." + h)) + '" style="--x:' + pos[h] + ";--y:" + vpos[v] + '"></button>').join("")).join("") + "</div>" +
        '<button class="te-reset" data-clear="1">' + esc(t("te.alignReset")) + "</button>";
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(r.left, global.innerWidth - 230)) + "px";
      pop.style.top = (r.bottom + 6) + "px";
      pop.addEventListener("mousedown", (e) => e.preventDefault());
      pop.addEventListener("click", (e) => {
        const s = e.target.closest("[data-scope]");
        if (s) { scope = s.dataset.scope; pop.querySelectorAll("[data-scope]").forEach((x) => x.classList.toggle("on", x === s)); return; }
        const g = e.target.closest("[data-v]"), clear = e.target.closest("[data-clear]");
        if (!g && !clear) return;
        alignCells(g ? g.dataset.h : "", g ? g.dataset.v : "");
        if (pop) { pop.remove(); pop = null; }
      });
    }
    function alignCells(h, v) {
      const id = cur.id, at = { r: cur.r, c: cur.c };
      write(id, (st) => {
        const g = grid(st);
        g.cells.filter((x) => scope === "table" || (scope === "row" && x.r <= at.r && at.r < x.r + x.rs) ||
          (scope === "col" && x.c <= at.c && at.c < x.c + x.cs) || (scope === "cell" && x.r === at.r && x.c === at.c))
          .forEach((x) => { setCss(x.el, "text-align", h); setCss(x.el, "vertical-align", v); x.el.removeAttribute("align"); x.el.removeAttribute("valign"); });
      });
    }
    bar.addEventListener("mousedown", (e) => e.preventDefault());
    bar.addEventListener("click", (e) => {
      const b = e.target.closest("[data-te]"); if (!b || !tbl) return;
      const id = ident(tbl), k = b.dataset.te;
      if (k === "cell") { openCellPop(b); return; }
      if (k === "left" || k === "center" || k === "right") {
        write(id, (st) => {
          st.removeAttribute("align");
          setCss(st, "margin-left", k === "left" ? "" : "auto");
          setCss(st, "margin-right", k === "center" ? "auto" : "");
          // a full-width table cannot move: make it narrower first
          const w = parseFloat(getCss(st, "width"));
          if (k !== "left" && (!w || w >= 100)) setCss(st, "width", "80%");
        });
      } else if (k === "equal") {
        const geo = colGeometry(tbl);
        const n = geo ? geo.g.ncols : grid(tbl).ncols;
        if (n < 2) return;
        write(id, (st) => setCols(st, Array.from({ length: n }, (_, i) => (i < n - 1 ? Math.round(1000 / n) / 10 : Math.round((100 - Math.round(1000 / n) / 10 * (n - 1)) * 10) / 10))));
      } else if (k === "reset") {
        write(id, (st) => {
          const cg = st.querySelector(":scope > colgroup"); if (cg) cg.remove();
          ["width", "table-layout", "margin-left", "margin-right"].forEach((p) => setCss(st, p, ""));
          Array.from(st.rows).forEach((tr) => setCss(tr, "height", ""));
        });
      }
      hide();
    });

    /* ---------- tracking the pointer / current cell ---------- */
    function tableAt(target) {
      const x = target && target.closest ? target.closest("table") : null;
      if (!x || !preview.contains(x) || x.closest(".block-editor,.be-hidden,.fm-card") || x.parentElement.closest("table") || !x.hasAttribute("data-b")) return null;
      return x;
    }
    preview.addEventListener("mousemove", (e) => {
      if (drag || !enabled()) return;
      const x = tableAt(e.target);
      if (x) { clearTimeout(hideTimer); showFor(x); }
    });
    document.addEventListener("mousemove", (e) => {
      if (!tbl || drag || pop) return;
      if (bar.contains(e.target) || handles.some((h) => h.el === e.target)) { clearTimeout(hideTimer); return; }
      const r = tbl.getBoundingClientRect(), m = 40;
      if (e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m) {
        clearTimeout(hideTimer); hideTimer = setTimeout(() => { if (!drag && !pop) hide(); }, 250);
      }
    });
    document.addEventListener("mousedown", (e) => { if (pop && !pop.contains(e.target) && !bar.contains(e.target)) { pop.remove(); pop = null; } }, true);
    // the clicked cell becomes the current one (outlined)
    preview.addEventListener("mousedown", (e) => {
      const td = e.target.closest && e.target.closest("td,th");
      const table = td && tableAt(td);
      if (!table || td.closest("table") !== table) return;
      const g = grid(table), c = g.cells.find((x) => x.el === td);
      if (!c) return;
      cur = { id: ident(table), r: c.r, c: c.c };
      mark();
    }, true);
    function mark() {
      preview.querySelectorAll(".te-cur").forEach((x) => x.classList.remove("te-cur"));
      const table = cur && resolve(cur.id);
      if (!table) return;
      const c = grid(table).cells.find((x) => x.r === cur.r && x.c === cur.c);
      if (c) c.el.classList.add("te-cur");
    }
    // only scrolling that moves the table matters (not the editor's own scroll while typing), once per frame
    let scrollRaf = 0;
    global.addEventListener("scroll", (e) => {
      const tg = e.target;
      if (!tbl || drag || scrollRaf || !(tg === document || (tg && tg.contains && tg.contains(tbl)))) return;
      scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; if (tbl && !drag) place(); });
    }, true);
    global.addEventListener("resize", () => { if (tbl) { clearHandles(); place(); } });

    return {
      refresh() { if (!drag) { hide(); mark(); } },
      hide
    };
  }

  global.DOCXMDTableEdit = { attach, serialize, pipeToHtml, grid };
})(typeof window !== "undefined" ? window : this);
