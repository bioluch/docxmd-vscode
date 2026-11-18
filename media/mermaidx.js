/* DOCXMD — Mermaid diagrams.
     ```mermaid {#fig:flow caption="Алгоритм обробки" width=80%}
     flowchart LR
       A[Markdown] --> B{DOCXMD} --> C[Word]
     ```
   Preview: md2docx.js renders a placeholder <div class="mmd" data-mmd="key">; fill() puts the SVG
   in (memory + IndexedDB cache by code + theme + font; only changed diagrams are drawn again).
   Word: exportImage() → light-theme SVG (text labels, no <foreignObject>) + PNG 3×; md2docx writes
   the PNG with the source in the picture's alt text ("mermaid:" + base64 JSON) and addSvg() adds
   the vector copy (a:blip → asvg:svgBlip, Word 2016+ / 365) — the PNG stays as the fallback.
   Import: the alt text turns back into the ```mermaid block (importHtml / importMd).
   Mermaid itself (js/vendor/mermaid/mermaid.min.js, MIT, 3.5 MB) is loaded on first use.

   window.DOCXMDMermaid = { configure, load, register, codeOf, parseInfo, fill, render, exportImage, addSvg,
     encodeAlt, decodeAlt, importHtml, importMd, infoString, toImage, TEMPLATES } */
(function (global) {
  "use strict";
  const cfg = { base: "js/vendor/mermaid/", onChange: null };
  function configure(o) { Object.assign(cfg, o || {}); }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function hash(s) { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + s.length.toString(36); }
  const b64 = (s) => { const u = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(bin); };
  const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); };

  /* ---------------- source ---------------- */
  const codes = new Map();                  // key → code
  function register(code) { const k = hash(code); codes.set(k, code); return k; }
  const codeOf = (k) => codes.get(k);
  // {#fig:flow caption="…" width=80%} after ```mermaid
  function parseInfo(info) {
    const s = String(info || "");
    const id = /#fig:([A-Za-z0-9_-]+)/.exec(s);
    const cap = /\bcaption\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/.exec(s);
    const w = /\bwidth\s*=\s*"?([\d.]+(?:%|px|cm|mm|in)?)"?/.exec(s);
    const al = /\balign\s*=\s*"?(left|center|right)"?/i.exec(s), rot = /\brotate\s*=\s*"?(90|180|270)"?/.exec(s);
    return { id: id ? id[1] : "", caption: cap ? (cap[1] != null ? cap[1] : cap[2]).replace(/\\(.)/g, "$1") : "", width: w ? w[1] : "",
      align: al ? al[1].toLowerCase() : "", rotate: rot ? +rot[1] : 0 };
  }
  function infoString(a) {
    const parts = [];
    if (a.id) parts.push("#fig:" + a.id);
    if (a.caption) parts.push('caption="' + String(a.caption).replace(/(["\\])/g, "\\$1") + '"');
    if (a.width) parts.push("width=" + a.width);
    if (a.align && a.align !== "center") parts.push("align=" + a.align);
    if (a.rotate) parts.push("rotate=" + a.rotate);
    return parts.length ? " {" + parts.join(" ") + "}" : "";
  }

  /* ---------------- engine ---------------- */
  let loadP = null, seq = 0, queue = Promise.resolve();
  const GANTT_W = 960;
  const CACHE_V = "v4";          // bump when the drawing options change: cached SVGs of older options are not reused
  function load() {
    if (global.mermaid && global.mermaid.render) return Promise.resolve(global.mermaid);
    if (loadP) return loadP;
    loadP = new Promise((res, rej) => {
      if (typeof document === "undefined") { rej(new Error("no document")); return; }
      const sc = document.createElement("script");
      sc.src = cfg.base + "mermaid.min.js";
      sc.onload = () => (global.mermaid ? res(global.mermaid) : rej(new Error("mermaid")));
      sc.onerror = () => { loadP = null; sc.remove(); const e = new Error("Mermaid could not be loaded (offline?)"); e.transient = true; rej(e); };
      document.head.appendChild(sc);
    });
    return loadP;
  }
  // One diagram at a time (mermaid keeps global state between initialize / render).
  function render(code, o) {
    o = o || {};
    const job = queue.then(async () => {
      const M = await load();
      M.initialize({
        startOnLoad: false, securityLevel: "strict", theme: o.theme || "default",
        fontFamily: o.font || "Arial, Helvetica, sans-serif", htmlLabels: false,
        flowchart: { htmlLabels: false }, class: { htmlLabels: false }, state: { htmlLabels: false },
        // Gantt takes the width of the page it is drawn in (390 px on a phone → the dates of the axis
        // overlap): a fixed width, the SVG then scales to the screen / the Word page like other diagrams
        gantt: { useWidth: GANTT_W, useMaxWidth: true },
        deterministicIds: true, deterministicIDSeed: "mmd" + hash(code), suppressErrorRendering: true
      });
      const id = "mmd" + (++seq) + "x" + hash(code);
      try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
      try {
        const r = await M.render(id, String(code));
        const fitted = fitLabels(r.svg);
        return STYLE3D.test(code) ? extrude3d(fitted) : fitted;
      } finally {
        ["d" + id, id, "i" + id].forEach((x) => { const n = document.getElementById(x); if (n && !n.closest(".mmd")) n.remove(); });
      }
    });
    queue = job.catch(() => {});
    return job;
  }
  /* Mermaid measures a label in its own temporary element; the browser can then draw it wider (other font
     metrics, page styles leaking into that element) or off-centre (the mindmap root). The finished SVG is
     measured here, where it is really drawn: each one-line label is centred on its shape, and a shape that
     is narrower than its label is widened around its centre; the viewBox grows if a shape now sticks out. */
  const SVG_SHAPES = /^(rect|circle|ellipse|polygon|path)$/i;
  function fitLabels(svg) {
    if (typeof document === "undefined" || !document.body) return svg;
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0;width:2000px;opacity:0;pointer-events:none";
    host.innerHTML = svg;
    document.body.appendChild(host);
    try {
      const root = host.querySelector("svg"); if (!root) return svg;
      let changed = false;
      const scaleOf = (n) => { const m = n && n.getScreenCTM && n.getScreenCTM(); return m && m.a ? m.a : 1; };
      root.querySelectorAll("g.node, g.mindmap-node").forEach((g) => {
        const texts = g.querySelectorAll("text");
        if (texts.length !== 1 || !texts[0].textContent.trim()) return;
        const text = texts[0], label = text.closest("g.label") || text;
        if (!g.contains(label)) return;
        let shape = null, area = 0;
        g.querySelectorAll("rect, circle, ellipse, polygon, path").forEach((c) => {
          if (!SVG_SHAPES.test(c.tagName) || label.contains(c) || c.closest("g.node, g.mindmap-node") !== g) return;
          const r = c.getBoundingClientRect(), a = r.width * r.height;
          if (a > area) { area = a; shape = c; }
        });
        if (!shape) return;
        const tr = text.getBoundingClientRect(), sr = shape.getBoundingClientRect();
        if (!tr.width || !sr.width) return;
        const pad = 8 * scaleOf(root), need = tr.width + 2 * pad;
        if (sr.width < need) {                                  // widen the shape around its centre
          const k = scaleOf(shape), grow = (need - sr.width) / k, tag = shape.tagName.toLowerCase();
          if (tag === "rect") { shape.setAttribute("x", (+shape.getAttribute("x") || 0) - grow / 2); shape.setAttribute("width", (+shape.getAttribute("width") || 0) + grow); }
          else if (tag === "circle") shape.setAttribute("r", Math.max(+shape.getAttribute("r") || 0, need / k / 2));
          else if (tag === "ellipse") shape.setAttribute("rx", Math.max(+shape.getAttribute("rx") || 0, need / k / 2));
          else {
            const bb = shape.getBBox(), cx = bb.x + bb.width / 2, f = need / sr.width;
            shape.setAttribute("transform", (shape.getAttribute("transform") || "") + " translate(" + cx + " 0) scale(" + f + " 1) translate(" + (-cx) + " 0)");
          }
          changed = true;
        }
        const s2 = shape.getBoundingClientRect(), t2 = text.getBoundingClientRect();
        const dx = (s2.left + s2.width / 2) - (t2.left + t2.width / 2);
        if (Math.abs(dx) > 1.5) {                               // centre the label on its shape
          const k = scaleOf(label.parentNode);
          label.setAttribute("transform", "translate(" + (dx / k).toFixed(2) + " 0) " + (label.getAttribute("transform") || ""));
          changed = true;
        }
      });
      if (!changed) return svg;
      const vb = root.viewBox && root.viewBox.baseVal, bb = root.getBBox();
      if (vb && vb.width && (bb.x < vb.x || bb.x + bb.width > vb.x + vb.width || bb.y < vb.y || bb.y + bb.height > vb.y + vb.height)) {
        const x0 = Math.min(vb.x, bb.x - 4), y0 = Math.min(vb.y, bb.y - 4);
        const x1 = Math.max(vb.x + vb.width, bb.x + bb.width + 4), y1 = Math.max(vb.y + vb.height, bb.y + bb.height + 4);
        root.setAttribute("viewBox", [x0, y0, x1 - x0, y1 - y0].map((v) => +v.toFixed(2)).join(" "));
        if (/max-width:\s*[\d.]+px/.test(root.getAttribute("style") || "")) root.setAttribute("style", root.getAttribute("style").replace(/max-width:\s*[\d.]+px/, "max-width: " + (x1 - x0).toFixed(2) + "px"));
      }
      return root.outerHTML;
    } catch (e) { return svg; }
    finally { host.remove(); }
  }
  /* ---------------- 3D look (%% docxmd-style: 3d) — real geometry, so Word gets it too ----------------
     Boxes get a lighter-to-darker extrusion (right and bottom faces), other shapes an offset darker body
     behind them; the palette (light top, mid front, dark side) follows the DOCXMD 3D guide. */
  const STYLE3D = /^\s*%%\s*docxmd-style:\s*3d\b/m;
  const INIT3D = '%%{init: {"theme": "base", "themeVariables": {"primaryColor": "#5b8fd6", "primaryTextColor": "#ffffff", "primaryBorderColor": "#1d3f73", "lineColor": "#2b5797", "secondaryColor": "#cfe3ff", "tertiaryColor": "#eef4fc", "clusterBkg": "#eef4fc", "clusterBorder": "#2b5797", "edgeLabelBackground": "#ffffff", "pie1": "#5b8fd6", "pie2": "#1f9e8f", "pie3": "#e0a526", "pie4": "#d24a3c", "pie5": "#6c7a96", "pie6": "#8fb2e6", "pie7": "#13665c", "pie8": "#9b6bd1", "pieStrokeColor": "#ffffff", "taskBkgColor": "#5b8fd6", "taskBorderColor": "#1d3f73", "activeTaskBkgColor": "#1f9e8f", "doneTaskBkgColor": "#8fb2e6", "actorBkg": "#5b8fd6", "actorTextColor": "#ffffff", "actorBorder": "#1d3f73", "noteBkgColor": "#fff4cc"}}}%%';
  const is3D = (code) => STYLE3D.test(String(code || ""));
  function set3D(code, on) {
    let c = String(code || "").split("\n").filter((l) => !STYLE3D.test(l) && l.trim() !== INIT3D).join("\n");
    if (!on) return c;
    const fm = /^---\n[\s\S]*?\n---\n/.exec(c);
    const add = "%% docxmd-style: 3d\n" + INIT3D + "\n";
    return fm ? fm[0] + add + c.slice(fm[0].length) : add + c;
  }
  function rgbOf(v) { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(v || ""); if (!m || (m[4] != null && +m[4] < 0.2)) return null; return [+m[1], +m[2], +m[3]]; }
  const shade = (c, f) => "rgb(" + c.map((x) => Math.max(0, Math.min(255, Math.round(f > 1 ? x + (255 - x) * (f - 1) : x * f)))).join(",") + ")";
  const SVGNS = "http://www.w3.org/2000/svg";
  function extrude3d(svg) {
    if (typeof document === "undefined" || !document.body) return svg;
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0;width:2000px;opacity:0;pointer-events:none";
    host.innerHTML = svg;
    document.body.appendChild(host);
    try {
      const root = host.querySelector("svg"); if (!root) return svg;
      const SKIP = "marker, defs, .edgePaths, .edgeLabels, .edgeLabel, g.label, .flowchart-link, .relation, .messageLine0, .messageLine1, line, .divider";
      const OWNERS = "g.node, g.cluster, g.mindmap-node, g.classGroup, g.actor";
      const picks = new Map();                       // owner group → its biggest shape (one extrusion per node)
      const singles = [];
      root.querySelectorAll("rect, polygon, circle, ellipse, path").forEach((c) => {
        if (c.closest(SKIP)) return;
        const own = c.closest(OWNERS);
        const solo = c.matches("rect.task, rect.actor, path.pieCircle, rect.note, rect.actor-top, rect.actor-bottom");
        if (!own && !solo) return;
        const fill = rgbOf(getComputedStyle(c).fill);
        if (!fill) return;
        const b = c.getBBox(); if (!b.width || !b.height) return;
        if (solo || !own) { singles.push(c); return; }
        const cur = picks.get(own), area = b.width * b.height;
        if (!cur || area > cur.area) picks.set(own, { c, area });
      });
      const shapes = singles.concat(Array.from(picks.values()).map((x) => x.c));
      let maxD = 0;
      shapes.forEach((c) => {
        const fill = rgbOf(getComputedStyle(c).fill), b = c.getBBox();
        const d = Math.max(4, Math.min(9, Math.min(b.width, b.height) * 0.12)); maxD = Math.max(maxD, d);
        const sw = getComputedStyle(c).strokeWidth || "1";
        const side = shade(fill, 0.62), bottom = shade(fill, 0.45), edge = shade(fill, 0.38);
        const mk = (pts, f) => { const p = document.createElementNS(SVGNS, "polygon"); p.setAttribute("points", pts.map((q) => q.join(",")).join(" ")); p.setAttribute("fill", f); p.setAttribute("stroke", edge); p.setAttribute("stroke-width", sw); p.setAttribute("stroke-linejoin", "round"); return p; };
        const tf = c.getAttribute("transform");
        if (c.tagName.toLowerCase() === "rect" && !(+c.getAttribute("rx") > 8)) {
          const x = +c.getAttribute("x") || 0, y = +c.getAttribute("y") || 0, w = +c.getAttribute("width") || b.width, h = +c.getAttribute("height") || b.height;
          const r1 = mk([[x + w, y], [x + w + d, y + d], [x + w + d, y + h + d], [x + w, y + h]], side);
          const r2 = mk([[x, y + h], [x + w, y + h], [x + w + d, y + h + d], [x + d, y + h + d]], bottom);
          [r1, r2].forEach((r) => { if (tf) r.setAttribute("transform", tf); c.parentNode.insertBefore(r, c); });
        } else {
          for (let k = 3; k >= 1; k--) {                          // a few steps: a solid body, not a flat shadow
            const cl = c.cloneNode(false);
            cl.removeAttribute("id"); cl.removeAttribute("class"); cl.removeAttribute("style");
            cl.setAttribute("fill", k === 3 ? bottom : side); cl.setAttribute("stroke", edge); cl.setAttribute("stroke-width", sw);
            cl.setAttribute("transform", "translate(" + (d * k / 3).toFixed(2) + "," + (d * k / 3).toFixed(2) + ")" + (tf ? " " + tf : ""));
            c.parentNode.insertBefore(cl, c);
          }
        }
        // a light top edge on the front face
        if (!c.getAttribute("data-3d")) { c.setAttribute("data-3d", "1"); }
      });
      if (!shapes.length) return svg;
      const vb = root.viewBox && root.viewBox.baseVal;
      if (vb && vb.width) {
        const nw = vb.width + maxD + 2, nh = vb.height + maxD + 2;
        root.setAttribute("viewBox", [vb.x, vb.y, nw, nh].map((v) => +(+v).toFixed(2)).join(" "));
        if (/max-width:\s*[\d.]+px/.test(root.getAttribute("style") || "")) root.setAttribute("style", root.getAttribute("style").replace(/max-width:\s*[\d.]+px/, "max-width: " + nw.toFixed(2) + "px"));
      }
      return root.outerHTML;
    } catch (e) { return svg; }
    finally { host.remove(); }
  }
  // turn a finished SVG by 90 / 180 / 270° (the picture itself, so the preview and Word agree)
  function rotateSvg(svg, deg) {
    deg = +deg || 0;
    if (!deg || !svg) return svg;
    const m = /viewBox="\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*"/.exec(svg);
    if (!m) return svg;
    const x = +m[1], y = +m[2], w = +m[3], h = +m[4];
    const nw = deg === 180 ? w : h, nh = deg === 180 ? h : w;
    const tr = deg === 90 ? "translate(" + h + ",0) rotate(90)" : deg === 180 ? "translate(" + w + "," + h + ") rotate(180)" : "translate(0," + w + ") rotate(270)";
    return svg.replace(/<svg\b([^>]*)>/, (all, a) => "<svg" + a.replace(/viewBox="[^"]*"/, 'viewBox="0 0 ' + nw + " " + nh + '"').replace(/max-width:\s*[\d.]+px/, "max-width: " + nw + "px") + "><g transform=\"" + tr + " translate(" + (-x) + "," + (-y) + ")\">")
      .replace(/<\/svg>\s*$/, "</g></svg>");
  }
  const errText = (e) => String((e && (e.message || e.str)) || e || "Mermaid error").replace(/\s+$/, "");

  /* ---------------- cache: memory + IndexedDB ---------------- */
  const mem = new Map();
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res) => {
      try {
        const r = indexedDB.open("docxmd-mermaid", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("svg");
        r.onsuccess = () => res(r.result); r.onerror = () => res(null);
      } catch (e) { res(null); }
    });
    return dbP;
  }
  async function idbGet(k) { const d = await db(); if (!d) return null; return new Promise((res) => { try { const q = d.transaction("svg").objectStore("svg").get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function idbSet(k, v) { const d = await db(); if (!d) return; try { d.transaction("svg", "readwrite").objectStore("svg").put(v, k); } catch (e) {} }
  async function cached(code, o) {
    const ck = CACHE_V + "|" + hash(code) + "|" + (o.theme || "") + "|" + (o.font || "");
    if (mem.has(ck)) return mem.get(ck);
    let v = await idbGet(ck);
    if (!v) {
      try { v = { svg: await render(code, o) }; idbSet(ck, v); }
      catch (e) { v = { error: errText(e) }; if (e && e.transient) return v; }   // not cached: tried again next time
    }
    if (mem.size > 300) mem.delete(mem.keys().next().value);
    mem.set(ck, v);
    return v;
  }

  // HTML export: the SVG of a diagram from the cache (warm() first)
  function svgSync(key, o) { o = o || {}; const v = mem.get(CACHE_V + "|" + key + "|" + (o.theme || "") + "|" + (o.font || "")); return v && v.svg ? sized(v.svg).svg : null; }
  async function warm(o) { o = o || {}; for (const code of codes.values()) await cached(code, o); }

  /* ---------------- preview ---------------- */
  function cleanSvg(svg) {
    if (global.DOMPurify) return global.DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["style"] });
    return svg;
  }
  function put(el, v, code) {
    el.classList.remove("mmd-wait");
    if (v && v.svg) { el.classList.remove("mmd-bad"); el.innerHTML = cleanSvg(rotateSvg(v.svg, +el.getAttribute("data-rot") || 0)); return; }
    el.classList.add("mmd-bad");
    el.innerHTML = '<div class="mmd-err">' + esc(v ? v.error : "?") + "</div><pre><code>" + esc(code) + "</code></pre>";
  }
  // fill every placeholder in root; o = { theme, font }
  function fill(root, o) {
    o = o || {};
    root.querySelectorAll(".mmd[data-mmd]").forEach((el) => {
      const key = el.getAttribute("data-mmd"), code = codes.get(key);
      if (code == null) return;
      const ck = CACHE_V + "|" + key + "|" + (o.theme || "") + "|" + (o.font || "");
      el.setAttribute("data-mmd-ck", ck);              // what this placeholder waits for now
      if (mem.has(ck)) { put(el, mem.get(ck), code); return; }
      el.classList.add("mmd-wait");
      el.innerHTML = '<span class="mmd-load">⧗</span>';
      cached(code, o).then((v) => {
        // a render for an older theme / font must not overwrite a newer one
        root.querySelectorAll('.mmd[data-mmd="' + key + '"]').forEach((x) => { if (x.getAttribute("data-mmd-ck") === ck) put(x, v, code); });
        if (cfg.onChange) cfg.onChange(key);
      });
    });
  }

  /* ---------------- export ---------------- */
  // explicit width / height in px (Word and <img> need them; mermaid writes width="100%")
  function sized(svg) {
    const vb = /viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/.exec(svg);
    if (!vb) return { svg, w: 600, h: 400 };
    const w = Math.ceil(+vb[1]), h = Math.ceil(+vb[2]);
    let out = svg.replace(/<svg\b([^>]*)>/, (m, a) => "<svg" + a.replace(/\s(?:width|height)="[^"]*"/g, "").replace(/\sstyle="[^"]*"/, "") + ' width="' + w + '" height="' + h + '">');
    if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(out)) out = out.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
    return { svg: out, w, h };
  }
  // Word draws SVG without its <style>: copy the computed look of every element into
  // presentation attributes (fill, stroke, fonts …) and drop the stylesheet.
  const PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
    "opacity", "font-family", "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "visibility", "display"];
  const DEFAULTS = { "fill-opacity": "1", "stroke-opacity": "1", opacity: "1", "stroke-dasharray": "none", "stroke-linecap": "butt", "stroke-linejoin": "miter",
    "dominant-baseline": "auto", "text-anchor": "start", visibility: "visible", "font-weight": "400", "font-style": "normal", "stroke-width": "1px" };
  function inlineStyles(svg) {
    if (typeof document === "undefined" || !document.body) return svg;
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0;width:2000px;opacity:0;pointer-events:none";   // not visibility:hidden — it is inherited
    host.innerHTML = svg;
    document.body.appendChild(host);
    try {
      const root = host.querySelector("svg"); if (!root) return svg;
      root.querySelectorAll("*").forEach((n) => {
        if (/^(style|defs|title|desc|metadata|marker)$/i.test(n.localName) || n.closest("style")) return;
        const cs = getComputedStyle(n);
        PROPS.forEach((p) => {
          const v = cs.getPropertyValue(p);
          if (!v || DEFAULTS[p] === v || (p === "display" && v !== "none")) return;
          n.setAttribute(p, v);
        });
      });
      // markers (arrow heads) live in <defs>: style their paths too
      root.querySelectorAll("marker *").forEach((n) => { const cs = getComputedStyle(n); ["fill", "stroke", "stroke-width"].forEach((p) => { const v = cs.getPropertyValue(p); if (v) n.setAttribute(p, v); }); });
      root.querySelectorAll("style").forEach((x) => x.remove());
      root.removeAttribute("class");
      return root.outerHTML;
    } catch (e) { return svg; }
    finally { host.remove(); }
  }
  function svgToPng(svg, w, h, scale) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          const g = c.getContext("2d"); g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          c.toBlob((b) => resolve(b), "image/png");
        } catch (e) { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  // → { svg, png: Blob, w, h } in the light theme, or { error }
  async function exportImage(code, meta, rot) {
    const theme = String((meta && meta["mermaid-theme"]) || "default").replace(/^dark$/, "default");
    const font = (meta && (meta["mermaid-font"] || meta.font)) || "";
    const v = await cached(code, { theme, font: Array.isArray(font) ? font.join(", ") : font });
    if (!v || !v.svg) return { error: v ? v.error : "?" };
    const s = sized(rotateSvg(v.svg, rot || 0));
    const png = await svgToPng(s.svg, s.w, s.h, 3);
    return png ? { svg: inlineStyles(s.svg), png, w: s.w, h: s.h } : { error: "PNG" };
  }
  // the vector picture next to each PNG whose drawing is named "mermaid-<key>"
  async function addSvg(blob, svgByKey) {
    const Z = global.DOCXMDZip;
    if (!Z || !svgByKey || !svgByKey.size) return blob;
    try {
      const files = await Z.read(await blob.arrayBuffer());
      let doc = Z.text(files.get("word/document.xml"));
      let rels = Z.text(files.get("word/_rels/document.xml.rels"));
      let types = Z.text(files.get("[Content_Types].xml"));
      let n = 0;
      const added = new Map();
      doc = doc.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, (dr) => {
        const m = /<wp:docPr\b[^>]*\bname="mermaid-([A-Za-z0-9]+)"/.exec(dr);
        if (!m || !svgByKey.has(m[1]) || /svgBlip/.test(dr)) return dr;
        const key = m[1];
        let rid = added.get(key);
        if (!rid) {
          rid = "rIdMmdSvg" + (++n);
          files.set("word/media/mermaid-" + key + ".svg", Z.bytes(svgByKey.get(key)));
          rels = rels.replace("</Relationships>", '<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/mermaid-' + key + '.svg"/></Relationships>');
          added.set(key, rid);
        }
        const ext = '<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="' + rid + '"/></a:ext></a:extLst>';
        return dr.replace(/<a:blip\b([^>]*?)\/>/, '<a:blip$1>' + ext + "</a:blip>").replace(/<a:blip\b([^>]*?)>(?!<a:extLst)([\s\S]*?)<\/a:blip>/, (x, a, inner) => (/svgBlip/.test(inner) ? x : "<a:blip" + a + ">" + inner + ext + "</a:blip>"));
      });
      if (!added.size) return blob;
      if (!/Extension="svg"/i.test(types)) types = types.replace("<Types ", "<Types ").replace(/(<Types\b[^>]*>)/, '$1<Default Extension="svg" ContentType="image/svg+xml"/>');
      files.set("word/document.xml", Z.bytes(doc));
      files.set("word/_rels/document.xml.rels", Z.bytes(rels));
      files.set("[Content_Types].xml", Z.bytes(types));
      const out = await Z.write(files);
      return new Blob([out], { type: blob.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    } catch (e) { console.warn("mermaid svg", e); return blob; }
  }

  /* ---------------- Word picture alt text ⇄ source ---------------- */
  const encodeAlt = (code, attrs) => "mermaid:" + b64(JSON.stringify(Object.assign({ code }, attrs || {})));
  function decodeAlt(alt) {
    const m = /^mermaid:([A-Za-z0-9+/=]+)$/.exec(String(alt || "").trim());
    if (!m) return null;
    try { const o = JSON.parse(unb64(m[1])); return o && typeof o.code === "string" ? o : null; } catch (e) { return null; }
  }
  // Word import (mammoth HTML): pictures that carry a diagram → text markers ⟦MMD:n⟧
  function importHtml(html) {
    const blocks = [];
    const out = String(html || "").replace(/<img\b[^>]*\balt="(mermaid:[^"]+)"[^>]*>/gi, (m, alt) => {
      const o = decodeAlt(alt.replace(/&#x2F;/g, "/").replace(/&#43;/g, "+").replace(/&amp;/g, "&"));
      if (!o) return m;
      return "MMDBLOCK" + (blocks.push(o) - 1) + "MMDEND";
    });
    return { html: out, blocks };
  }
  const CAPTION_LINE = /^[ \t]*(?:<a\b[^>]*><\/a>)?\**(?:Figure|Рисунок|Figura|图|圖|図)\s+\d+\**(?:\s+—\s+.*)?[ \t]*$/;
  function importMd(md, blocks) {
    if (!blocks || !blocks.length) return md;
    const lines = String(md).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /MMDBLOCK(\d+)MMDEND/.exec(lines[i]); if (!m) continue;
      const o = blocks[+m[1]];
      const fence = /```/.test(o.code) ? "~~~~" : "```";
      const block = fence + "mermaid" + infoString(o) + "\n" + o.code.replace(/\n+$/, "") + "\n" + fence;
      lines[i] = lines[i].replace(/\s*MMDBLOCK\d+MMDEND\s*/, "").trim() ? lines[i].replace(/MMDBLOCK\d+MMDEND/, "\n\n" + block + "\n\n") : block;
      // our own caption paragraph under the picture ("Рисунок 2 — …"): the block carries it
      let j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
      // … or the plain italic caption of a diagram without an id
      const plain = (x) => String(x).replace(/\\(.)/g, "$1").replace(/^[ \t]*[*_]+|[*_]+[ \t]*$/g, "").trim();
      if ((o.id || o.caption) && j < lines.length && (CAPTION_LINE.test(lines[j].replace(/\\/g, "")) || (o.caption && plain(lines[j]) === String(o.caption).trim()))) lines.splice(j, 1);
    }
    // a centred picture came wrapped in <div align="center"> — the diagram is centred anyway
    return lines.join("\n").replace(/<div align="center">\s*\n+((?:```|~~~~)mermaid[^\n]*\n[\s\S]*?\n(?:```|~~~~))\s*\n+<\/div>/g, "$1");
  }

  /* ---------------- diagram → picture file (for GitHub / Obsidian / Pandoc without Mermaid) ---------------- */
  async function toImage(code, meta) {
    const r = await exportImage(code, meta);
    if (r.error) throw new Error(r.error);
    return { svg: new Blob([r.svg], { type: "image/svg+xml" }), png: r.png, w: r.w, h: r.h };
  }

  /* ---------------- styling from the preview: edits of the diagram source ----------------
     node  → "style ID fill:…,stroke:…,color:…,font-size:…,font-weight:…,font-style:…,font-family:…"
     edge  → "linkStyle N stroke:…,stroke-width:…,stroke-dasharray:…" (flowchart)
     whole → %%{init: {"theme": …, "themeVariables": {fontFamily, fontSize, primaryColor, primaryTextColor, lineColor}}}%%
     case  → the label text itself (so Word and every renderer show it), e.g. A[Markdown] → A[MARKDOWN] */
  const KIND_RE = [[/^flowchart\b|^graph\b/, "flowchart"], [/^stateDiagram/, "state"], [/^classDiagram/, "class"], [/^erDiagram/, "er"],
    [/^sequenceDiagram/, "sequence"], [/^gantt/, "gantt"], [/^pie\b/, "pie"], [/^mindmap/, "mindmap"], [/^timeline/, "timeline"]];
  function diagramKind(code) {
    const lines = String(code).replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
    for (const l of lines) {
      const t = l.trim(); if (!t || /^%%/.test(t)) continue;
      const k = KIND_RE.find((x) => x[0].test(t)); return k ? k[1] : "other";
    }
    return "other";
  }
  // what each kind lets us style per element
  const CAPS = {
    flowchart: { node: ["fill", "stroke", "color", "font", "case"], edge: true },
    state: { node: ["fill", "stroke", "color", "font", "case"] },
    er: { node: ["fill", "stroke", "color", "font", "case"] },
    class: { node: ["fill", "stroke", "case"] }
  };
  const NODE_ID = { flowchart: /-flowchart-(.+)-\d+$/, state: /-state-(.+)-\d+$/, class: /-classId-(.+)-\d+$/, er: /-entity-(.+)-\d+$/ };
  // the clicked part of a rendered diagram → { kind, type: "node"|"edge"|"diagram", id, index, text }
  function elementOf(target, code) {
    const kind = diagramKind(code), caps = CAPS[kind];
    const svg = target.closest && target.closest("svg");
    if (caps) {
      const node = target.closest("g.node");
      if (node && NODE_ID[kind]) {
        const m = NODE_ID[kind].exec(node.id || "");
        if (m && !/^root_(?:start|end)$/.test(m[1])) return { kind, type: "node", id: m[1], text: (node.querySelector(".label, text") || node).textContent.trim() };
      }
      if (caps.edge && svg) {
        const lbl = target.closest("g.edgeLabel");
        const path = target.closest("path.flowchart-link");
        const did = path ? path.getAttribute("data-id") : lbl && lbl.querySelector("[data-id]") ? lbl.querySelector("[data-id]").getAttribute("data-id") : null;
        if (did) {
          const all = Array.from(svg.querySelectorAll("path.flowchart-link")).map((p) => p.getAttribute("data-id"));
          const i = all.indexOf(did);
          if (i >= 0) return { kind, type: "edge", index: i, id: did };
        }
      }
    }
    return { kind, type: "diagram" };
  }
  const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function styleLineRe(sel) {
    return sel.type === "edge" ? new RegExp("^([ \\t]*)linkStyle[ \\t]+" + sel.index + "[ \\t]+(.*?);?[ \\t]*$", "m")
      : new RegExp("^([ \\t]*)style[ \\t]+" + reEsc(sel.id) + "[ \\t]+(.*?);?[ \\t]*$", "m");
  }
  function parseProps(s) {
    const o = {};
    String(s || "").split(",").forEach((p) => { const i = p.indexOf(":"); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
    return o;
  }
  function readStyle(code, sel) {
    if (sel.type === "diagram") return readInit(code);
    const m = styleLineRe(sel).exec(code);
    return m ? parseProps(m[2]) : {};
  }
  // props: { key: value } — "" / null removes the key; no keys left → the line goes
  function writeStyle(code, sel, props) {
    if (sel.type === "diagram") return writeInit(code, props);
    const re = styleLineRe(sel), m = re.exec(code);
    const cur = m ? parseProps(m[2]) : {};
    Object.keys(props).forEach((k) => { if (props[k] == null || props[k] === "") delete cur[k]; else cur[k] = String(props[k]).replace(/[,;\n]/g, " ").trim(); });
    const body = Object.keys(cur).map((k) => k + ":" + cur[k]).join(",");
    const line = (sel.type === "edge" ? "linkStyle " + sel.index : "style " + sel.id) + " " + body;
    if (m) return body ? code.replace(re, m[1] + line) : code.replace(re, "\u0000").replace(/\n?\u0000/, "");
    if (!body) return code;
    const ind = (/\n([ \t]+)\S/.exec(code) || [, "  "])[1];
    return code.replace(/\s*$/, "") + "\n" + ind + line;
  }
  const INIT_RE = /^[ \t]*%%\{\s*init\s*:\s*([\s\S]*?)\}%%[ \t]*\n?/m;
  function readInit(code) {
    const m = INIT_RE.exec(code); if (!m) return {};
    try { const o = JSON.parse(m[1]); return Object.assign({ theme: o.theme || "" }, o.themeVariables || {}); } catch (e) { return {}; }
  }
  function writeInit(code, props) {
    const m = INIT_RE.exec(code);
    let o = {};
    if (m) { try { o = JSON.parse(m[1]); } catch (e) { o = {}; } }
    const tv = Object.assign({}, o.themeVariables || {});
    Object.keys(props).forEach((k) => {
      const v = props[k];
      if (k === "theme") { if (v) o.theme = v; else delete o.theme; return; }
      if (v == null || v === "") delete tv[k]; else tv[k] = v;
    });
    if (Object.keys(tv).length) o.themeVariables = tv; else delete o.themeVariables;
    const rest = m ? code.replace(INIT_RE, "") : code;
    return Object.keys(o).length ? "%%{init: " + JSON.stringify(o) + "}%%\n" + rest : rest;
  }
  // text case of a label; tags (<br>) and entities stay as they are
  function recase(text, mode) {
    return String(text).split(/(<[^>]*>|&[#\w]+;)/).map((part, i) => {
      if (i % 2) return part;
      const lo = part.toLocaleLowerCase();
      if (mode === "upper") return part.toLocaleUpperCase();
      if (mode === "lower") return lo;
      if (mode === "title") return lo.replace(/(^|[\s\-–—(«"'])(\p{L})/gu, (x, a, c) => a + c.toLocaleUpperCase());
      if (mode === "sentence") return lo.replace(/^(\s*["'«(]?)(\p{L})/u, (x, a, c) => a + c.toLocaleUpperCase());
      return part;
    }).join("");
  }
  const SHAPES = [["(((", ")))"], ["((", "))"], ["([", "])"], ["[[", "]]"], ["[(", ")]"], ["{{", "}}"], ["[/", "/]"], ["[\\", "\\]"], ["[/", "\\]"], ["[\\", "/]"], ["[", "]"], ["(", ")"], ["{", "}"], [">", "]"]];
  // change the case of a node label in the source (shown = the text the diagram shows now)
  function setLabelCase(code, sel, mode, shown) {
    const id = sel.id, E = reEsc(id), lines = String(code).split("\n");
    const tr = (s) => { const q = /^(\s*"?`?)([\s\S]*?)(`?"?\s*)$/.exec(s); return q[1] + recase(q[2], mode) + q[3]; };
    if (sel.kind === "flowchart") {
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(?:%%|style\b|linkStyle\b|classDef\b|class\b|click\b)/.test(lines[i])) continue;
        const re = new RegExp("(^|[\\s;&|>-])(" + E + ")(\\(\\(\\(|\\(\\(|\\(\\[|\\[\\[|\\[\\(|\\{\\{|\\[/|\\[\\\\|\\[|\\(|\\{|>)", "g");
        let m;
        while ((m = re.exec(lines[i]))) {
          const open = m[3], at = m.index + m[0].length;
          const cands = SHAPES.filter((s) => s[0] === open).map((s) => s[1]);
          let best = -1, close = null;
          for (const c of cands) { const k = lines[i].indexOf(c, at); if (k >= 0 && (best < 0 || k < best)) { best = k; close = c; } }
          if (best < 0) continue;
          const inner = lines[i].slice(at, best);
          lines[i] = lines[i].slice(0, at) + tr(inner) + lines[i].slice(best);
          return lines.join("\n");
        }
      }
      return code.replace(/\s*$/, "") + "\n  " + id + '["' + recase(shown || id, mode).replace(/"/g, "#quot;") + '"]';
    }
    if (sel.kind === "state") {
      const re = new RegExp('^(\\s*state\\s+")([^"]*)("\\s+as\\s+' + E + "\\b.*)$");
      for (let i = 0; i < lines.length; i++) { const m = re.exec(lines[i]); if (m) { lines[i] = m[1] + recase(m[2], mode) + m[3]; return lines.join("\n"); } }
      const h = lines.findIndex((l) => /^\s*stateDiagram/.test(l));
      lines.splice(h + 1, 0, '  state "' + recase(shown || id, mode).replace(/"/g, "'") + '" as ' + id);
      return lines.join("\n");
    }
    if (sel.kind === "class" || sel.kind === "er") {
      const pre = sel.kind === "class" ? "class\\s+" : "";
      const re = new RegExp("^(\\s*" + pre + E + '\\[")([^"]*)("\\].*)$');
      for (let i = 0; i < lines.length; i++) { const m = re.exec(lines[i]); if (m) { lines[i] = m[1] + recase(m[2], mode) + m[3]; return lines.join("\n"); } }
      // class Document { … } → class Document["DOCUMENT"] { … }
      const lbl = '["' + recase(shown || id, mode).replace(/"/g, "'") + '"]';
      const dec = new RegExp("^(\\s*" + pre + E + ")(?![\\w\\[])");
      if (sel.kind === "class") for (let i = 0; i < lines.length; i++) if (dec.test(lines[i])) { lines[i] = lines[i].replace(dec, "$1" + lbl); return lines.join("\n"); }
      return code.replace(/\s*$/, "") + "\n  " + (sel.kind === "class" ? "class " : "") + id + '["' + recase(shown || id, mode).replace(/"/g, "'") + '"]';
    }
    return code;
  }
  // source range of the code of the ```mermaid block whose body is oldCode
  function replaceBlock(source, oldCode, newCode, nth) {
    const re = /(^|\n)( {0,3})(`{3,}|~{3,})([ \t]*mermaid\b[^\n`]*)\n([\s\S]*?)(\n {0,3}\3[`~]*[ \t]*)(?=\n|$)/g;
    let m, n = nth || 0;
    while ((m = re.exec(source))) {
      if (m[5] === oldCode || m[5].replace(/\s+$/, "") === String(oldCode).replace(/\s+$/, "")) {
        if (n-- > 0) continue;
        const s = m.index + m[1].length + m[2].length + m[3].length + m[4].length + 1;
        return { start: s, end: s + m[5].length, text: newCode };
      }
    }
    return null;
  }

  const TEMPLATES = {
    flowchart: "flowchart LR\n  A[Start] --> B{Check}\n  B -- yes --> C[Do it]\n  B -- no --> D[Skip]\n  C --> E[End]\n  D --> E",
    sequence: "sequenceDiagram\n  participant U as User\n  participant A as App\n  U->>A: Request\n  A-->>U: Response",
    class: "classDiagram\n  class Document {\n    +String title\n    +export()\n  }\n  class Page\n  Document \"1\" --> \"*\" Page",
    state: "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Published\n  Review --> Draft\n  Published --> [*]",
    er: "erDiagram\n  AUTHOR ||--o{ BOOK : writes\n  BOOK }o--|| PUBLISHER : \"published by\"",
    gantt: "gantt\n  dateFormat YYYY-MM-DD\n  axisFormat %d.%m\n  title Plan\n  section Work\n  Draft    :a1, 2026-01-05, 10d\n  Review   :after a1, 5d\n  Release  :milestone, 2026-01-25, 0d",
    pie: "pie title Share\n  \"A\" : 45\n  \"B\" : 30\n  \"C\" : 25",
    mindmap: "mindmap\n  root((Topic))\n    Idea A\n      Detail\n    Idea B\n    Idea C",
    timeline: "timeline\n  title History\n  2024 : Start\n  2025 : Growth\n  2026 : Release"
  };

  global.DOCXMDMermaid = { configure, load, register, codeOf, parseInfo, infoString, fill, render, exportImage, addSvg,
    encodeAlt, decodeAlt, importHtml, importMd, toImage, sized, hash, svgSync, warm, TEMPLATES, fitLabels, rotateSvg, extrude3d, is3D, set3D,
    diagramKind, elementOf, readStyle, writeStyle, setLabelCase, recase, replaceBlock, CAPS };
})(typeof window !== "undefined" ? window : this);
